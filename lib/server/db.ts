// Shared transaction helpers for everything that moves money.
import { planAllocation, compareAllocationOrder, type InvoiceBalance } from '../allocation'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../prisma'
import { dateOnly } from '../time'

export type Tx = Prisma.TransactionClient
type Db = Tx | typeof prisma

// Concurrent requests on one lease queue on the lease lock, so give them time instead of failing.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

// Every money-changing operation on a lease takes this row lock first (record, approve, reject, void,
// bill creation, webhook settlement). Requests on the same lease therefore run one after another, and
// each re-reads balances and statuses after the previous one has committed. Lock order is always
// lease first, then its payments/bills, so these transactions cannot deadlock each other.
export async function lockLease(tx: Tx, leaseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM public.leases WHERE id = ${leaseId}::uuid FOR UPDATE`
}

export interface LeaseInvoice extends InvoiceBalance {
  periodStart: string | null
  periodEnd: string | null
}

// The lease's invoices with their paid amounts (sum of allocations), in allocation order.
export async function loadInvoiceBalances(db: Db, leaseId: string): Promise<LeaseInvoice[]> {
  const rows = await db.invoices.findMany({
    where: { lease_id: leaseId },
    include: { payment_allocations: { select: { amount_sen: true } } },
  })
  return rows
    .map((i) => ({
      id: i.id,
      kind: i.kind === 'deposit' ? ('deposit' as const) : ('rent' as const),
      periodIndex: i.period_index,
      periodStart: i.period_start ? dateOnly(i.period_start) : null,
      periodEnd: i.period_end ? dateOnly(i.period_end) : null,
      dueDate: dateOnly(i.due_date),
      amountSen: i.amount_sen,
      paidSen: i.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n),
    }))
    .sort(compareAllocationOrder)
}

export async function pendingTotal(tx: Tx, leaseId: string): Promise<bigint> {
  const result = await tx.payments.aggregate({
    where: { lease_id: leaseId, status: 'pending_verification' },
    _sum: { amount_sen: true },
  })
  return result._sum.amount_sen ?? 0n
}

// Allocates an approved payment and stores what is left as unapplied_sen. Caller holds the lease lock.
export async function allocatePayment(
  tx: Tx,
  payment: { id: string; org_id: string; amount_sen: bigint },
  invoices: InvoiceBalance[],
) {
  const plan = planAllocation(invoices, payment.amount_sen)
  if (plan.allocations.length > 0) {
    await tx.payment_allocations.createMany({
      data: plan.allocations.map((a) => ({
        org_id: payment.org_id,
        payment_id: payment.id,
        invoice_id: a.invoiceId,
        amount_sen: a.amountSen,
      })),
    })
  }
  await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: plan.unappliedSen } })
  return plan
}

export async function writeAudit(
  tx: Tx,
  entry: { orgId: string; actorId: string | null; action: string; entityId: string; details: Prisma.InputJsonObject },
): Promise<void> {
  await tx.audit_log.create({
    data: {
      org_id: entry.orgId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_id: entry.entityId,
      details: entry.details,
    },
  })
}
