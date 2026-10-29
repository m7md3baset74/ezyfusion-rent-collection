// Online payments: bill creation (tenant) and the gateway webhook (the only thing that can settle a bill).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { amountDueNow } from '../allocation'
import { malaysiaDate } from '../billing'
import { senToNumber } from '../money'
import { prisma } from '../prisma'
import { parseGatewayTime } from '../time'
import { findLeaseForCaller, type Caller } from './caller'
import { allocatePayment, loadInvoiceBalances, lockLease, TX_OPTIONS, writeAudit } from './db'
import { dbErrorCode, forbidden, HttpError } from './http'

const BILL_ID_RE = /^bill_[0-9a-f]{32}$/

// POST /api/leases/:leaseId/gateway-bills. Only the lease's own tenant may create a bill.
export async function createGatewayBill(caller: Caller, leaseId: string, now = new Date()): Promise<{ billId: string; amountSen: number }> {
  const lease = await findLeaseForCaller(caller, leaseId)
  if (caller.role !== 'tenant') throw forbidden('Only the tenant can pay online')
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, lease.id)
    const due = amountDueNow(await loadInvoiceBalances(tx, lease.id), malaysiaDate(now))
    if (due <= 0n) throw new HttpError(422, 'Nothing is due on this lease')
    // 128 random bits: bill ids cannot be guessed.
    const bill = await tx.gateway_bills.create({
      data: { id: `bill_${randomBytes(16).toString('hex')}`, org_id: lease.org_id, lease_id: lease.id, amount_sen: due, created_by: caller.userId },
    })
    return { billId: bill.id, amountSen: senToNumber(bill.amount_sen) }
  }, TX_OPTIONS)
}

// Every field except x_signature, sorted by key (character code order), as key+value, joined with '|'.
export function signatureSource(fields: [string, string][]): string {
  return fields
    .filter(([key]) => key !== 'x_signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}${value}`)
    .join('|')
}

export function computeSignature(fields: [string, string][], key: string): string {
  return createHmac('sha256', key).update(signatureSource(fields)).digest('hex')
}

function signatureIsValid(fields: [string, string][], provided: string | undefined, key: string): boolean {
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false
  return timingSafeEqual(Buffer.from(computeSignature(fields, key), 'hex'), Buffer.from(provided, 'hex'))
}

type WebhookResult = { status: number; body: Record<string, unknown> }

// POST /api/webhooks/gateway. Never logs the key or the payload.
export async function handleGatewayCallback(rawBody: string): Promise<WebhookResult> {
  const key = process.env.GATEWAY_X_SIGNATURE_KEY
  if (!key) throw new Error('GATEWAY_X_SIGNATURE_KEY is not configured')

  const fields = [...new URLSearchParams(rawBody).entries()]
  const byKey = new Map(fields)
  if (byKey.size !== fields.length) return { status: 400, body: { error: 'Duplicate field' } }
  if (!signatureIsValid(fields, byKey.get('x_signature'), key)) return { status: 401, body: { error: 'Invalid signature' } }

  const billId = byKey.get('id') ?? ''
  const bill = BILL_ID_RE.test(billId) ? await prisma.gateway_bills.findUnique({ where: { id: billId } }) : null
  if (!bill) return { status: 404, body: { error: 'Unknown bill' } }

  const paid = byKey.get('paid')
  if (paid !== 'true' && paid !== 'false') return { status: 400, body: { error: 'paid must be true or false' } }

  if (paid === 'false') {
    await prisma.$transaction(async (tx) => {
      await lockLease(tx, bill.lease_id)
      // Only a pending bill can fail: a failed bill stays failed and a paid bill never goes back.
      await tx.gateway_bills.updateMany({ where: { id: bill.id, status: 'pending' }, data: { status: 'failed', updated_at: new Date() } })
    }, TX_OPTIONS)
    return { status: 200, body: { ok: true } }
  }

  const paidAmount = byKey.get('paid_amount') ?? ''
  if (!/^\d+$/.test(paidAmount) || BigInt(paidAmount) !== bill.amount_sen) {
    return { status: 422, body: { error: 'paid_amount does not match the bill' } }
  }
  const paidAt = parseGatewayTime(byKey.get('paid_at'))
  if (!paidAt) return { status: 400, body: { error: 'Invalid paid_at' } }

  try {
    await prisma.$transaction(async (tx) => {
      // Duplicate deliveries queue on this lock; the second one then sees status 'paid' and does nothing.
      await lockLease(tx, bill.lease_id)
      const current = await tx.gateway_bills.findUniqueOrThrow({ where: { id: bill.id } })
      if (current.status === 'paid') return
      await tx.gateway_bills.update({
        where: { id: bill.id },
        data: { status: 'paid', paid_at: paidAt, transaction_id: byKey.get('transaction_id') ?? null, updated_at: new Date() },
      })
      // payments.gateway_bill_id is UNIQUE: even if the lock were bypassed, a second payment cannot be inserted.
      const payment = await tx.payments.create({
        data: {
          org_id: bill.org_id,
          lease_id: bill.lease_id,
          amount_sen: bill.amount_sen,
          method: 'online',
          status: 'approved',
          received_at: paidAt,
          gateway_bill_id: bill.id,
          decided_at: new Date(),
        },
      })
      const plan = await allocatePayment(tx, payment, await loadInvoiceBalances(tx, bill.lease_id))
      await writeAudit(tx, {
        orgId: bill.org_id,
        actorId: null,
        action: 'payment.online_settled',
        entityId: payment.id,
        details: { billId: bill.id, amountSen: Number(bill.amount_sen), unappliedSen: Number(plan.unappliedSen) },
      })
    }, TX_OPTIONS)
  } catch (error) {
    if (dbErrorCode(error) === '23505') return { status: 200, body: { ok: true } } // repeat delivery
    throw error
  }
  return { status: 200, body: { ok: true } }
}
