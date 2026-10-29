import { invoiceStatus, malaysiaDate } from '../billing'
import { senToNumber } from '../money'
import { prisma } from '../prisma'
import { monthRange, mytMonthStart, shiftMonth } from '../time'
import { requireRole, type Caller } from './caller'
import { badRequest } from './http'

// GET /api/reports/collections. Approved payments per Malaysia calendar month of received_at,
// one entry per month in order, including months with nothing collected.
export async function collectionsReport(caller: Caller, from: unknown, to: unknown) {
  requireRole(caller, 'manager', 'staff')
  const months = monthRange(from, to)
  if (!months) throw badRequest('from and to must be YYYY-MM, from <= to, at most 120 months')
  const start = mytMonthStart(months[0]).toISOString()
  const end = mytMonthStart(shiftMonth(months[months.length - 1], 1)).toISOString()
  const rows = await prisma.$queryRaw<{ month: string; total: bigint }[]>`
    SELECT to_char(received_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM') AS month, SUM(amount_sen)::bigint AS total
    FROM public.payments
    WHERE org_id = ${caller.orgId}::uuid AND status = 'approved'
      AND received_at >= ${start}::timestamptz AND received_at < ${end}::timestamptz
    GROUP BY 1`
  const totals = new Map(rows.map((r) => [r.month, r.total]))
  return months.map((month) => ({ month, collectedSen: senToNumber(totals.get(month) ?? 0n) }))
}

export async function overdueInvoiceCount(caller: Caller, now = new Date()): Promise<number> {
  requireRole(caller, 'manager', 'staff')
  const rows = await prisma.$queryRaw<{ due_date: string; amount_sen: bigint; paid_sen: bigint }[]>`
    SELECT to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.amount_sen, COALESCE(SUM(a.amount_sen), 0)::bigint AS paid_sen
    FROM public.invoices i LEFT JOIN public.payment_allocations a ON a.invoice_id = i.id
    WHERE i.org_id = ${caller.orgId}::uuid
    GROUP BY i.id`
  return rows.filter(
    (r) => invoiceStatus({ dueDate: r.due_date, amountSen: Number(r.amount_sen), paidSen: Number(r.paid_sen) }, now) === 'overdue',
  ).length
}

export async function listLeases(caller: Caller) {
  requireRole(caller, 'manager', 'staff')
  const leases = await prisma.leases.findMany({
    where: { org_id: caller.orgId },
    include: { units: { select: { name: true } }, tenants: { select: { full_name: true } } },
    orderBy: [{ units: { name: 'asc' } }, { start_date: 'asc' }],
  })
  return leases.map((l) => ({
    id: l.id,
    unitName: l.units.name,
    tenantName: l.tenants.full_name,
    startDate: l.start_date.toISOString().slice(0, 10),
    endDate: l.end_date.toISOString().slice(0, 10),
    monthlyRentSen: senToNumber(l.monthly_rent_sen),
  }))
}

export function lastMonths(count: number, now = new Date()): { from: string; to: string } {
  const to = malaysiaDate(now).slice(0, 7)
  return { from: shiftMonth(to, -(count - 1)), to }
}

// Choices for the create-lease form: only the manager's own organization.
export async function leaseFormOptions(caller: Caller) {
  requireRole(caller, 'manager')
  const [units, tenants] = await Promise.all([
    prisma.units.findMany({ where: { org_id: caller.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.tenants.findMany({ where: { org_id: caller.orgId }, select: { id: true, full_name: true }, orderBy: { full_name: 'asc' } }),
  ])
  return { units, tenants: tenants.map((t) => ({ id: t.id, name: t.full_name })) }
}
