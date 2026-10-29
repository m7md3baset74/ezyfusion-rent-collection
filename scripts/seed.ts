// npm run seed: creates the brief's seed data on a freshly reset database. Leases and payments go through the
// app's own services (createLease, recordPayment, approvePayment), so invoices and allocations are exactly what
// the app would produce. Organizations, accounts, tenants and units have no app code path and are inserted directly.
import { createClient } from '@supabase/supabase-js'
import { prisma } from '../lib/prisma'
import { loadCaller, type Caller } from '../lib/server/caller'
import { createLease } from '../lib/server/leases'
import { approvePayment, recordPayment } from '../lib/server/payments'
import { SLIP_BUCKET } from '../lib/server/slips'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env.local)`)
  return value
}

const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL')
const PUBLISHABLE_KEY = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const SECRET_KEY = env('SUPABASE_SECRET_KEY')
const PASSWORD = env('SEED_PASSWORD')
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

// 1x1 PNG used as the seeded bank transfer slip.
const SLIP_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function main() {
  if ((await prisma.organizations.count()) > 0) {
    throw new Error('The database already has data. Run `npx supabase db reset` first.')
  }
  const admin = createClient(SUPABASE_URL, SECRET_KEY, noSession)

  async function createUser(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`)
    return data.user.id
  }
  async function callerFor(userId: string): Promise<Caller> {
    const caller = await loadCaller(userId)
    if (!caller) throw new Error('Seeded user has no role')
    return caller
  }

  const northwind = await prisma.organizations.create({ data: { name: 'Northwind Properties' } })
  const beta = await prisma.organizations.create({ data: { name: 'Beta Realty' } })

  const staffAccounts = [
    { email: 'manager@northwind.test', org: northwind.id, role: 'manager' },
    { email: 'staff@northwind.test', org: northwind.id, role: 'staff' },
    { email: 'manager@beta.test', org: beta.id, role: 'manager' },
  ]
  const userIds = new Map<string, string>()
  for (const account of staffAccounts) {
    const userId = await createUser(account.email)
    userIds.set(account.email, userId)
    await prisma.memberships.create({ data: { user_id: userId, org_id: account.org, role: account.role } })
  }

  const tenantAccounts = [
    { email: 'aisyah@northwind.test', name: 'Aisyah Rahman', org: northwind.id },
    { email: 'ben@northwind.test', name: 'Ben Lim', org: northwind.id },
    { email: 'probe@northwind.test', name: 'Probe Tenant', org: northwind.id },
    { email: 'chen@beta.test', name: 'Chen Wei', org: beta.id },
  ]
  const tenantIds = new Map<string, string>()
  for (const account of tenantAccounts) {
    const userId = await createUser(account.email)
    const tenant = await prisma.tenants.create({
      data: { org_id: account.org, user_id: userId, full_name: account.name, email: account.email },
    })
    tenantIds.set(account.email, tenant.id)
  }

  const unitIds = new Map<string, string>()
  for (const [org, name] of [
    [northwind.id, 'A-12-3'],
    [northwind.id, 'B-05-1'],
    [northwind.id, 'C-01-7'],
    [northwind.id, 'D-03-2'],
    [beta.id, 'KL-1'],
  ]) {
    const unit = await prisma.units.create({ data: { org_id: org, name } })
    unitIds.set(name, unit.id)
  }

  const nwManager = await callerFor(userIds.get('manager@northwind.test')!)
  const nwStaff = await callerFor(userIds.get('staff@northwind.test')!)
  const betaManager = await callerFor(userIds.get('manager@beta.test')!)

  const leases = [
    { by: nwManager, unit: 'A-12-3', tenant: 'aisyah@northwind.test', startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 },
    { by: nwManager, unit: 'B-05-1', tenant: 'ben@northwind.test', startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0 },
    { by: nwManager, unit: 'C-01-7', tenant: 'probe@northwind.test', startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000 },
    { by: betaManager, unit: 'KL-1', tenant: 'chen@beta.test', startDate: '2026-03-15', endDate: '2027-03-14', monthlyRentSen: 220000, depositSen: 440000 },
  ]
  const leaseIds = new Map<string, string>()
  for (const l of leases) {
    const { id } = await createLease(l.by, {
      unitId: unitIds.get(l.unit),
      tenantId: tenantIds.get(l.tenant),
      startDate: l.startDate,
      endDate: l.endDate,
      monthlyRentSen: l.monthlyRentSen,
      depositSen: l.depositSen,
    })
    leaseIds.set(l.unit, id)
  }

  const aisyahLease = leaseIds.get('A-12-3')!
  await recordPayment(nwManager, aisyahLease, { amountSen: 300000, method: 'cash', receivedAt: '2026-01-31T10:00:00+08:00' })

  // The staff member uploads the slip with their own session, so the Storage policy is exercised too.
  const staffClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, noSession)
  const signIn = await staffClient.auth.signInWithPassword({ email: 'staff@northwind.test', password: PASSWORD })
  if (signIn.error) throw new Error(`Staff sign-in failed: ${signIn.error.message}`)
  const slipPath = `${northwind.id}/seed-transfer-slip.png`
  const upload = await staffClient.storage
    .from(SLIP_BUCKET)
    .upload(slipPath, new Blob([Buffer.from(SLIP_PNG, 'base64')], { type: 'image/png' }), { contentType: 'image/png' })
  if (upload.error) throw new Error(`Slip upload failed: ${upload.error.message}`)

  const transfer = await recordPayment(nwStaff, aisyahLease, {
    amountSen: 200000,
    method: 'bank_transfer',
    receivedAt: '2026-03-01T00:30:00+08:00',
    slipPath,
  })
  await approvePayment(nwManager, transfer.id)

  console.log('Seeded 2 organizations, 7 accounts, 5 units, 4 leases and 2 payments.')
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
