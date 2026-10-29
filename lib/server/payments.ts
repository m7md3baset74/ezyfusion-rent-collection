import { z } from 'zod'
import { remainingBalance } from '../allocation'
import { prisma } from '../prisma'
import { parseInstant, toMytIso } from '../time'
import { findLeaseForCaller, findPaymentForCaller, requireRole, type Caller } from './caller'
import { allocatePayment, loadInvoiceBalances, lockLease, pendingTotal, TX_OPTIONS, writeAudit } from './db'
import { badRequest, HttpError, parseBody } from './http'
import { discardOrphanSlip, isSlipPathInOrg, slipExists } from './slips'

const recordSchema = z.object({
  amountSen: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(['cash', 'bank_transfer']),
  receivedAt: z.string(),
  slipPath: z.string().nullish(), // null or absent: no slip
})

const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'must be at least 5 characters'),
})

// POST /api/leases/:leaseId/payments. If anything fails after the slip was uploaded, the slip is removed.
export async function recordPayment(caller: Caller, leaseId: string, input: unknown): Promise<{ id: string; status: string }> {
  try {
    return await recordPaymentChecked(caller, leaseId, input)
  } catch (error) {
    const slipPath = (input as { slipPath?: unknown } | null)?.slipPath
    if (typeof slipPath === 'string' && caller.role !== 'tenant') await discardOrphanSlip(caller.orgId, slipPath)
    throw error
  }
}

async function recordPaymentChecked(caller: Caller, leaseId: string, input: unknown) {
  const lease = await findLeaseForCaller(caller, leaseId)
  requireRole(caller, 'manager', 'staff')
  const body = parseBody(recordSchema, input)
  const receivedAt = parseInstant(body.receivedAt)
  if (!receivedAt) throw badRequest('receivedAt must be an ISO 8601 date-time with an offset, e.g. 2026-03-01T00:30:00+08:00')

  let slipPath: string | null = null
  if (body.method === 'bank_transfer') {
    if (!body.slipPath) throw badRequest('A bank transfer needs a slip')
    if (!isSlipPathInOrg(lease.org_id, body.slipPath) || !(await slipExists(body.slipPath))) {
      throw badRequest("slipPath must point to an uploaded file in the organization's folder")
    }
    slipPath = body.slipPath
  } else if (body.slipPath != null) {
    throw badRequest('Only bank transfers take a slip')
  }

  const amount = BigInt(body.amountSen)
  const approved = caller.role === 'manager' // manager payments are approved immediately; staff payments wait

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, lease.id)
    const invoices = await loadInvoiceBalances(tx, lease.id)
    // Cap: remaining balance minus everything still pending, read under the lease lock.
    const cap = remainingBalance(invoices) - (await pendingTotal(tx, lease.id))
    if (amount > cap) {
      throw new HttpError(422, `Amount is more than the lease's remaining balance (at most ${cap > 0n ? cap : 0n} sen)`)
    }
    const payment = await tx.payments.create({
      data: {
        org_id: lease.org_id,
        lease_id: lease.id,
        amount_sen: amount,
        method: body.method,
        status: approved ? 'approved' : 'pending_verification',
        received_at: receivedAt,
        slip_path: slipPath,
        recorded_by: caller.userId,
        decided_by: approved ? caller.userId : null,
        decided_at: approved ? new Date() : null,
      },
    })
    const details = { amountSen: body.amountSen, method: body.method, receivedAt: toMytIso(receivedAt) }
    await writeAudit(tx, { orgId: lease.org_id, actorId: caller.userId, action: 'payment.recorded', entityId: payment.id, details })
    if (approved) {
      const plan = await allocatePayment(tx, payment, invoices)
      await writeAudit(tx, {
        orgId: lease.org_id,
        actorId: caller.userId,
        action: 'payment.approved',
        entityId: payment.id,
        details: { ...details, recordedByManager: true, allocatedTo: plan.allocations.map((a) => a.invoiceId) },
      })
    }
    return { id: payment.id, status: payment.status }
  }, TX_OPTIONS)
}

// POST /api/payments/:paymentId/approve
export async function approvePayment(caller: Caller, paymentId: string): Promise<{ status: string }> {
  const found = await findPaymentForCaller(caller, paymentId)
  requireRole(caller, 'manager')
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    // Re-read under the lock: a concurrent approval may have committed while we waited.
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
    if (payment.status !== 'pending_verification') throw new HttpError(409, 'Payment is not pending verification')
    const invoices = await loadInvoiceBalances(tx, payment.lease_id)
    const remaining = remainingBalance(invoices)
    if (payment.amount_sen > remaining) {
      throw new HttpError(422, `Payment is more than the lease's remaining balance (${remaining} sen); it stays pending`)
    }
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'approved', decided_by: caller.userId, decided_at: new Date() },
    })
    const plan = await allocatePayment(tx, payment, invoices)
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: caller.userId,
      action: 'payment.approved',
      entityId: payment.id,
      details: { amountSen: Number(payment.amount_sen), allocatedTo: plan.allocations.map((a) => a.invoiceId) },
    })
    return { status: 'approved' }
  }, TX_OPTIONS)
}

// POST /api/payments/:paymentId/reject
export async function rejectPayment(caller: Caller, paymentId: string, input: unknown): Promise<{ status: string }> {
  const found = await findPaymentForCaller(caller, paymentId)
  requireRole(caller, 'manager')
  const { reason } = parseBody(reasonSchema, input)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
    if (payment.status !== 'pending_verification') throw new HttpError(409, 'Payment is not pending verification')
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'rejected', decided_by: caller.userId, decided_at: new Date(), decision_reason: reason },
    })
    await writeAudit(tx, { orgId: payment.org_id, actorId: caller.userId, action: 'payment.rejected', entityId: payment.id, details: { reason } })
    return { status: 'rejected' }
  }, TX_OPTIONS)
}

// POST /api/payments/:paymentId/void. Removes only this payment's allocations; other payments (including any
// unapplied online credit) are left exactly as they are. See DECISIONS.md, question 5.
export async function voidPayment(caller: Caller, paymentId: string, input: unknown): Promise<{ status: string }> {
  const found = await findPaymentForCaller(caller, paymentId)
  requireRole(caller, 'manager')
  const { reason } = parseBody(reasonSchema, input)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
    if (payment.status !== 'approved') throw new HttpError(409, 'Only approved payments can be voided')
    const removed = await tx.payment_allocations.findMany({ where: { payment_id: payment.id } })
    await tx.payment_allocations.deleteMany({ where: { payment_id: payment.id } })
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'voided', decided_by: caller.userId, decided_at: new Date(), decision_reason: reason },
    })
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: caller.userId,
      action: 'payment.voided',
      entityId: payment.id,
      details: { reason, removedAllocations: removed.map((a) => ({ invoiceId: a.invoice_id, amountSen: Number(a.amount_sen) })) },
    })
    return { status: 'voided' }
  }, TX_OPTIONS)
}
