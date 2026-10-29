import { z } from 'zod'
import { amountDueNow, remainingBalance } from '../allocation'
import { generateSchedule, invoiceStatus, malaysiaDate, type ScheduledInvoice } from '../billing'
import { senToNumber } from '../money'
import { prisma } from '../prisma'
import { dateOnly, dbDate, toMytIso } from '../time'
import { findLeaseForCaller, requireRole, type Caller } from './caller'
import { loadInvoiceBalances, TX_OPTIONS, writeAudit } from './db'
import { badRequest, dbErrorCode, HttpError, notFound, parseBody, UUID_RE } from './http'

const createLeaseSchema = z.object({
  unitId: z.string().regex(UUID_RE, 'must be a uuid'),
  tenantId: z.string().regex(UUID_RE, 'must be a uuid'),
  startDate: z.string(),
  endDate: z.string(),
  monthlyRentSen: z.number(),
  depositSen: z.number(),
})

// POST /api/leases. Stores the lease and exactly the invoices generateSchedule returns, in one transaction.
export async function createLease(caller: Caller, input: unknown): Promise<{ id: string }> {
  requireRole(caller, 'manager')
  const body = parseBody(createLeaseSchema, input)
  let schedule: ScheduledInvoice[]
  try {
    schedule = generateSchedule(body)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid lease')
  }

  // IDs in the body are untrusted: the unit and the tenant must both be in the manager's organization.
  const [unit, tenant] = await Promise.all([
    prisma.units.findFirst({ where: { id: body.unitId, org_id: caller.orgId }, select: { id: true } }),
    prisma.tenants.findFirst({ where: { id: body.tenantId, org_id: caller.orgId }, select: { id: true } }),
  ])
  if (!unit) throw notFound('Unit not found')
  if (!tenant) throw notFound('Tenant not found')

  try {
    return await prisma.$transaction(async (tx) => {
      const lease = await tx.leases.create({
        data: {
          org_id: caller.orgId,
          unit_id: unit.id,
          tenant_id: tenant.id,
          start_date: dbDate(body.startDate),
          end_date: dbDate(body.endDate),
          monthly_rent_sen: BigInt(body.monthlyRentSen),
          deposit_sen: BigInt(body.depositSen),
          created_by: caller.userId,
        },
      })
      await tx.invoices.createMany({
        data: schedule.map((s) => ({
          org_id: caller.orgId,
          lease_id: lease.id,
          kind: s.kind,
          period_index: s.periodIndex,
          period_start: s.periodStart ? dbDate(s.periodStart) : null,
          period_end: s.periodEnd ? dbDate(s.periodEnd) : null,
          due_date: dbDate(s.dueDate),
          amount_sen: BigInt(s.amountSen),
        })),
      })
      await writeAudit(tx, {
        orgId: caller.orgId,
        actorId: caller.userId,
        action: 'lease.created',
        entityId: lease.id,
        details: { ...body, invoiceCount: schedule.length },
      })
      return { id: lease.id }
    }, TX_OPTIONS)
  } catch (error) {
    // leases_no_overlap exclusion constraint: also catches two overlapping requests at the same moment.
    if (dbErrorCode(error) === '23P01') throw new HttpError(409, 'This lease overlaps another lease on the unit')
    throw error
  }
}

// GET /api/leases/:leaseId
export async function getLeaseView(caller: Caller, leaseId: string, now = new Date()) {
  const lease = await findLeaseForCaller(caller, leaseId)
  const [invoices, payments, unit, tenant] = await Promise.all([
    loadInvoiceBalances(prisma, lease.id),
    prisma.payments.findMany({ where: { lease_id: lease.id }, orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }] }),
    prisma.units.findUnique({ where: { id: lease.unit_id }, select: { name: true } }),
    prisma.tenants.findUnique({ where: { id: lease.tenant_id }, select: { full_name: true } }),
  ])
  const today = malaysiaDate(now)
  return {
    lease: {
      id: lease.id,
      unitId: lease.unit_id,
      tenantId: lease.tenant_id,
      startDate: dateOnly(lease.start_date),
      endDate: dateOnly(lease.end_date),
      monthlyRentSen: senToNumber(lease.monthly_rent_sen),
      depositSen: senToNumber(lease.deposit_sen),
      unitName: unit?.name ?? '',
      tenantName: tenant?.full_name ?? '',
    },
    invoices: invoices.map((i) => {
      const amountSen = senToNumber(i.amountSen)
      const paidSen = senToNumber(i.paidSen)
      return {
        id: i.id,
        kind: i.kind,
        periodIndex: i.periodIndex,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        dueDate: i.dueDate,
        amountSen,
        paidSen,
        status: invoiceStatus({ dueDate: i.dueDate, amountSen, paidSen }, now),
      }
    }),
    payments: payments.map((p) => ({
      id: p.id,
      amountSen: senToNumber(p.amount_sen),
      unappliedSen: senToNumber(p.unapplied_sen),
      method: p.method as 'cash' | 'bank_transfer' | 'online',
      status: p.status as 'pending_verification' | 'approved' | 'rejected' | 'voided',
      receivedAt: toMytIso(p.received_at),
      hasSlip: p.slip_path !== null,
      decisionReason: p.decision_reason,
    })),
    remainingSen: senToNumber(remainingBalance(invoices)),
    amountDueNowSen: senToNumber(amountDueNow(invoices, today)),
  }
}

export type LeaseView = Awaited<ReturnType<typeof getLeaseView>>
