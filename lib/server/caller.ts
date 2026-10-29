// Who is calling, and what they may see. Roles come only from our tables (memberships for staff and
// managers, tenants.user_id for tenants), never from anything the user can edit such as user_metadata.
import { prisma } from '../prisma'
import { forbidden, notFound, UUID_RE } from './http'

export type StaffRole = 'manager' | 'staff'
export type Role = StaffRole | 'tenant'

export type Caller =
  | { userId: string; role: StaffRole; orgId: string; tenantId: null }
  | { userId: string; role: 'tenant'; orgId: string; tenantId: string }

export async function loadCaller(userId: string): Promise<Caller | null> {
  const membership = await prisma.memberships.findUnique({ where: { user_id: userId } })
  if (membership && (membership.role === 'manager' || membership.role === 'staff')) {
    return { userId, role: membership.role, orgId: membership.org_id, tenantId: null }
  }
  const tenant = await prisma.tenants.findUnique({ where: { user_id: userId } })
  if (tenant) return { userId, role: 'tenant', orgId: tenant.org_id, tenantId: tenant.id }
  return null
}

// 403: the caller can see the record but their role does not allow the action.
export function requireRole(caller: Caller, ...roles: Role[]): void {
  if (!roles.includes(caller.role)) throw forbidden()
}

// Staff and managers see their organization's leases; a tenant sees only their own.
export function canSeeLease(caller: Caller, lease: { org_id: string; tenant_id: string }): boolean {
  return caller.role === 'tenant' ? lease.tenant_id === caller.tenantId : lease.org_id === caller.orgId
}

// 404 for anything outside the caller's scope, so other organizations' records are never revealed.
export async function findLeaseForCaller(caller: Caller, leaseId: string) {
  if (!UUID_RE.test(leaseId)) throw notFound('Lease not found')
  const lease = await prisma.leases.findUnique({ where: { id: leaseId } })
  if (!lease || !canSeeLease(caller, lease)) throw notFound('Lease not found')
  return lease
}

export async function findPaymentForCaller(caller: Caller, paymentId: string) {
  if (!UUID_RE.test(paymentId)) throw notFound('Payment not found')
  const payment = await prisma.payments.findUnique({
    where: { id: paymentId },
    include: { leases: { select: { org_id: true, tenant_id: true } } },
  })
  if (!payment || !canSeeLease(caller, payment.leases)) throw notFound('Payment not found')
  return payment
}
