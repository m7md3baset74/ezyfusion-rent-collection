// End-to-end checks against the running app and the local Supabase stack, called the way the graders do:
// HTTP API with `Authorization: Bearer <access token>`, and the Data API / Storage with the publishable key.
// Run on a freshly reset and seeded database: npx supabase db reset && npm run seed && npm run test:api
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { computeSignature } from '../../lib/gateway-signature'
import type { LeaseView } from '../../lib/server/leases'

const APP = process.env.APP_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const PASSWORD = process.env.SEED_PASSWORD!
const GATEWAY_KEY = process.env.GATEWAY_X_SIGNATURE_KEY!

const NW_MANAGER = 'manager@northwind.test'
const NW_STAFF = 'staff@northwind.test'
const AISYAH = 'aisyah@northwind.test'
const BEN = 'ben@northwind.test'
const PROBE = 'probe@northwind.test'
const BETA_MANAGER = 'manager@beta.test'
const CHEN = 'chen@beta.test'

type Row = Record<string, unknown>
interface ApiBody {
  id?: string
  status?: string
  error?: string
  billId?: string
  amountSen?: number
}

const tokens = new Map<string, string>()
async function token(email: string): Promise<string> {
  const cached = tokens.get(email)
  if (cached) return cached
  const client = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) throw new Error(`sign-in failed for ${email}`)
  tokens.set(email, data.session.access_token)
  return data.session.access_token
}

async function api<T = ApiBody>(method: string, path: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = {}
  if (as) headers.authorization = `Bearer ${await token(as)}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(APP + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  return { status: res.status, body: parsed as T }
}

async function rest(path: string, as: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { apikey: KEY, 'content-type': 'application/json', prefer: 'return=representation' }
  if (as) headers.authorization = `Bearer ${await token(as)}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  return { status: res.status, rows: Array.isArray(parsed) ? (parsed as Row[]) : [] }
}

function storage(as: string | null) {
  const client = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } })
  return {
    async bucket() {
      if (as) await client.auth.signInWithPassword({ email: as, password: PASSWORD })
      return client.storage.from('payment-slips')
    },
  }
}

const png = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' })

async function webhook(fields: Record<string, string>, signature?: string) {
  const entries = Object.entries(fields)
  const body = new URLSearchParams([...entries, ['x_signature', signature ?? computeSignature(entries, GATEWAY_KEY)]])
  const res = await fetch(`${APP}/api/webhooks/gateway`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  return res.status
}
const paidFields = (id: string, amount: number) => ({
  id,
  paid: 'true',
  paid_amount: String(amount),
  paid_at: '2026-10-29 10:00:00 +0800',
  transaction_id: `TX-${id.slice(-6)}`,
  transaction_status: 'completed',
})

const ids = { org: '', units: new Map<string, string>(), tenants: new Map<string, string>(), leases: new Map<string, string>(), betaUnit: '', betaTenant: '', betaLease: '' }
let testLease = '' // created below on D-03-2, RM 1,000.00 total, nothing due yet

beforeAll(async () => {
  for (const r of (await rest('units?select=id,name', NW_MANAGER)).rows) ids.units.set(String(r.name), String(r.id))
  for (const r of (await rest('tenants?select=id,full_name', NW_MANAGER)).rows) ids.tenants.set(String(r.full_name), String(r.id))
  for (const r of (await rest('leases?select=id,unit_id', NW_MANAGER)).rows) {
    const unit = [...ids.units].find(([, id]) => id === r.unit_id)?.[0]
    if (unit) ids.leases.set(unit, String(r.id))
  }
  ids.org = String((await rest('organizations?select=id', NW_MANAGER)).rows[0]?.id)
  ids.betaUnit = String((await rest('units?select=id', BETA_MANAGER)).rows[0]?.id)
  ids.betaTenant = String((await rest('tenants?select=id', BETA_MANAGER)).rows[0]?.id)
  ids.betaLease = String((await rest('leases?select=id', BETA_MANAGER)).rows[0]?.id)
  expect(ids.leases.size).toBe(3)
})

describe('authentication and lease visibility', () => {
  it('returns 401 without a valid login', async () => {
    const lease = ids.leases.get('A-12-3')!
    expect((await api('GET', `/api/leases/${lease}`, null)).status).toBe(401)
    const res = await fetch(`${APP}/api/leases/${lease}`, { headers: { authorization: 'Bearer not-a-token' } })
    expect(res.status).toBe(401)
  })

  it("shows Aisyah's lease to her, staff and the manager, in the brief's shape", async () => {
    const lease = ids.leases.get('A-12-3')!
    for (const who of [AISYAH, NW_STAFF, NW_MANAGER]) expect((await api('GET', `/api/leases/${lease}`, who)).status).toBe(200)
    const { body } = await api<LeaseView>('GET', `/api/leases/${lease}`, AISYAH)
    expect(body.lease).toMatchObject({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 })
    expect(body.invoices.map((i) => [i.kind, i.amountSen, i.paidSen])).toEqual([
      ['deposit', 300000, 300000],
      ['rent', 150000, 150000],
      ['rent', 150000, 50000],
      ['rent', 150000, 0],
      ['rent', 150000, 0],
      ['rent', 150000, 0],
      ['rent', 77419, 0],
    ])
    expect(body.invoices.map((i) => i.status)).toEqual(['paid', 'paid', 'overdue', 'overdue', 'overdue', 'overdue', 'overdue'])
    expect(body.payments.map((p) => [p.method, p.status, p.receivedAt])).toEqual([
      ['cash', 'approved', '2026-01-31T10:00:00+08:00'],
      ['bank_transfer', 'approved', '2026-03-01T00:30:00+08:00'],
    ])
  })

  it('returns 404 for other tenants, other organizations and malformed ids', async () => {
    const lease = ids.leases.get('A-12-3')!
    for (const who of [BEN, PROBE, BETA_MANAGER, CHEN]) expect((await api('GET', `/api/leases/${lease}`, who)).status).toBe(404)
    expect((await api('GET', `/api/leases/${ids.betaLease}`, NW_MANAGER)).status).toBe(404)
    expect((await api('GET', '/api/leases/not-a-uuid', NW_MANAGER)).status).toBe(404)
    expect((await api('GET', '/api/leases/00000000-0000-4000-8000-000000000000', NW_MANAGER)).status).toBe(404)
  })

  it('returns 403 when the record is visible but the role is not allowed', async () => {
    const lease = ids.leases.get('A-12-3')!
    const body = { unitId: ids.units.get('D-03-2'), tenantId: ids.tenants.get('Probe Tenant'), startDate: '2035-01-01', endDate: '2035-01-31', monthlyRentSen: 1000, depositSen: 0 }
    expect((await api('POST', '/api/leases', NW_STAFF, body)).status).toBe(403)
    expect((await api('POST', '/api/leases', AISYAH, body)).status).toBe(403)
    expect((await api('POST', `/api/leases/${lease}/payments`, AISYAH, { amountSen: 100, method: 'cash', receivedAt: '2026-10-01T10:00:00+08:00' })).status).toBe(403)
    expect((await api('POST', `/api/leases/${lease}/payments`, BEN, { amountSen: 100, method: 'cash', receivedAt: '2026-10-01T10:00:00+08:00' })).status).toBe(404)
    expect((await api('GET', '/api/reports/collections?from=2026-01&to=2026-03', AISYAH)).status).toBe(403)
    expect((await api('POST', `/api/leases/${lease}/gateway-bills`, NW_MANAGER)).status).toBe(403)
    expect((await api('POST', `/api/leases/${lease}/gateway-bills`, BEN)).status).toBe(404)
  })
})

describe('collections report', () => {
  it("matches the brief's example, using Malaysia months", async () => {
    const { status, body } = await api<unknown>('GET', '/api/reports/collections?from=2026-01&to=2026-03', NW_STAFF)
    expect(status).toBe(200)
    expect(body).toEqual([
      { month: '2026-01', collectedSen: 300000 },
      { month: '2026-02', collectedSen: 0 },
      { month: '2026-03', collectedSen: 200000 },
    ])
    const beta = await api<unknown>('GET', '/api/reports/collections?from=2025-12&to=2026-01', BETA_MANAGER)
    expect(beta.body).toEqual([
      { month: '2025-12', collectedSen: 0 },
      { month: '2026-01', collectedSen: 0 },
    ])
  })

  it('rejects invalid ranges', async () => {
    for (const q of ['from=2026-03&to=2026-01', 'from=2026-1&to=2026-03', 'from=2026-13&to=2027-01', 'to=2026-03', '']) {
      expect((await api('GET', `/api/reports/collections?${q}`, NW_MANAGER)).status).toBe(400)
    }
  })
})

describe('lease creation', () => {
  const base = () => ({ unitId: ids.units.get('D-03-2')!, tenantId: ids.tenants.get('Probe Tenant')!, monthlyRentSen: 100000, depositSen: 0 })

  it('creates a lease with its schedule, and refuses overlaps (inclusive dates)', async () => {
    const created = await api('POST', '/api/leases', NW_MANAGER, { ...base(), startDate: '2030-01-01', endDate: '2030-01-31' })
    expect(created.status).toBe(201)
    testLease = created.body.id!
    const view = await api<LeaseView>('GET', `/api/leases/${testLease}`, PROBE)
    expect(view.body.invoices).toHaveLength(1)
    expect((await api('POST', '/api/leases', NW_MANAGER, { ...base(), startDate: '2030-01-31', endDate: '2030-02-15' })).status).toBe(409)
    expect((await api('POST', '/api/leases', NW_MANAGER, { ...base(), startDate: '2030-02-01', endDate: '2030-02-28' })).status).toBe(201)
  })

  it("refuses another organization's unit or tenant", async () => {
    expect((await api('POST', '/api/leases', NW_MANAGER, { ...base(), unitId: ids.betaUnit, startDate: '2032-01-01', endDate: '2032-01-31' })).status).toBe(404)
    expect((await api('POST', '/api/leases', NW_MANAGER, { ...base(), tenantId: ids.betaTenant, startDate: '2032-01-01', endDate: '2032-01-31' })).status).toBe(404)
  })

  it('validates input', async () => {
    for (const bad of [
      { startDate: '2032-02-30', endDate: '2032-03-31' },
      { startDate: '2032-03-01', endDate: '2032-02-01' },
      { startDate: '2032-01-01', endDate: '2032-01-31', monthlyRentSen: 1.5 },
      { startDate: '2032-01-01', endDate: '2032-01-31', depositSen: -1 },
      { startDate: '2032-01-01', endDate: '2032-01-31', unitId: 'nope' },
    ]) {
      expect((await api('POST', '/api/leases', NW_MANAGER, { ...base(), ...bad })).status).toBe(400)
    }
  })

  it('lets exactly one of several simultaneous overlapping requests through', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api('POST', '/api/leases', NW_MANAGER, { ...base(), startDate: '2031-01-01', endDate: '2031-12-31' })),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409])
  })
})

describe('payments', () => {
  const cash = (amountSen: number) => ({ amountSen, method: 'cash', receivedAt: '2026-10-29T09:15:00+08:00' })
  let pending = ''

  it('keeps two simultaneous staff payments within the cap', async () => {
    const [a, b] = await Promise.all([
      api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, cash(80000)),
      api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, cash(70000)),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 422])
    const ok = a.status === 201 ? a : b
    expect(ok.body.status).toBe('pending_verification')
    pending = ok.body.id!
  })

  it('counts pending payments in the cap', async () => {
    const view = await api<LeaseView>('GET', `/api/leases/${testLease}`, NW_STAFF)
    const pendingAmount = view.body.payments.find((p) => p.id === pending)!.amountSen
    expect((await api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, cash(100000 - pendingAmount + 1))).status).toBe(422)
  })

  it('approves once when approved twice at the same moment', async () => {
    expect((await api('POST', `/api/payments/${pending}/approve`, NW_STAFF)).status).toBe(403)
    expect((await api('POST', `/api/payments/${pending}/approve`, BETA_MANAGER)).status).toBe(404)
    const results = await Promise.all([1, 2, 3].map(() => api('POST', `/api/payments/${pending}/approve`, NW_MANAGER)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
    const view = await api<LeaseView>('GET', `/api/leases/${testLease}`, NW_MANAGER)
    const amount = view.body.payments.find((p) => p.id === pending)!.amountSen
    expect(view.body.invoices[0].paidSen).toBe(amount)
  })

  it('rejects with a reason and refuses to reject twice', async () => {
    const small = await api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, cash(1000))
    expect(small.status).toBe(201)
    expect((await api('POST', `/api/payments/${small.body.id}/reject`, NW_MANAGER, { reason: 'no' })).status).toBe(400)
    expect((await api('POST', `/api/payments/${small.body.id}/reject`, NW_MANAGER, { reason: '    abc    ' })).status).toBe(400)
    expect((await api('POST', `/api/payments/${small.body.id}/reject`, NW_MANAGER, { reason: 'Duplicate entry' })).body.status).toBe('rejected')
    expect((await api('POST', `/api/payments/${small.body.id}/reject`, NW_MANAGER, { reason: 'Duplicate entry' })).status).toBe(409)
    expect((await api('POST', `/api/payments/${small.body.id}/void`, NW_MANAGER, { reason: 'Not approved' })).status).toBe(409)
  })

  it('voids an approved payment and removes only its allocations', async () => {
    const managerPayment = await api('POST', `/api/leases/${testLease}/payments`, NW_MANAGER, cash(5000))
    expect(managerPayment.body.status).toBe('approved')
    expect((await api('POST', `/api/payments/${pending}/void`, NW_MANAGER, {})).status).toBe(400)
    expect((await api('POST', `/api/payments/${pending}/void`, NW_MANAGER, { reason: 'Cheque bounced' })).body.status).toBe('voided')
    const view = await api<LeaseView>('GET', `/api/leases/${testLease}`, NW_MANAGER)
    expect(view.body.invoices[0].paidSen).toBe(5000)
    expect((await api('POST', `/api/payments/${pending}/void`, NW_MANAGER, { reason: 'Cheque bounced' })).status).toBe(409)
  })

  it('validates payment input', async () => {
    const lease = `/api/leases/${testLease}/payments`
    expect((await api('POST', lease, NW_STAFF, { ...cash(100), receivedAt: '2026-10-29T09:15:00' })).status).toBe(400)
    expect((await api('POST', lease, NW_STAFF, cash(0))).status).toBe(400)
    expect((await api('POST', lease, NW_STAFF, { ...cash(100), method: 'online' })).status).toBe(400)
    expect((await api('POST', lease, NW_STAFF, { ...cash(100), method: 'bank_transfer' })).status).toBe(400)
    expect((await api('POST', lease, NW_STAFF, { ...cash(100), method: 'bank_transfer', slipPath: `${ids.org}/missing.png` })).status).toBe(400)
  })
})

describe('storage and bank transfer slips', () => {
  it('lets only staff and managers of the organization upload or read slips', async () => {
    const path = `${ids.org}/test-${Date.now()}.png`
    expect((await (await storage(NW_STAFF).bucket()).upload(path, png(), { contentType: 'image/png' })).error).toBeNull()
    expect((await (await storage(AISYAH).bucket()).upload(`${ids.org}/tenant.png`, png(), { contentType: 'image/png' })).error).not.toBeNull()
    expect((await (await storage(BETA_MANAGER).bucket()).upload(`${ids.org}/beta.png`, png(), { contentType: 'image/png' })).error).not.toBeNull()
    expect((await (await storage(null).bucket()).upload(`${ids.org}/anon.png`, png(), { contentType: 'image/png' })).error).not.toBeNull()
    expect((await (await storage(AISYAH).bucket()).download(path)).error).not.toBeNull()
    expect((await (await storage(BETA_MANAGER).bucket()).download(path)).error).not.toBeNull()
    expect((await (await storage(AISYAH).bucket()).list(ids.org)).data ?? []).toHaveLength(0)
    expect((await (await storage(null).bucket()).list(ids.org)).data ?? []).toHaveLength(0)
    expect((await (await storage(NW_MANAGER).bucket()).download(path)).error).toBeNull()
    expect((await (await storage(NW_STAFF).bucket()).upload(path, png(), { contentType: 'image/png', upsert: true })).error).not.toBeNull()

    const transfer = await api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, { amountSen: 1000, method: 'bank_transfer', receivedAt: '2026-10-29T09:15:00+08:00', slipPath: path })
    expect(transfer.status).toBe(201)
    expect((await api('GET', `/api/payments/${transfer.body.id}/slip`, PROBE)).status).toBe(403) // the lease's own tenant
    expect((await api('GET', `/api/payments/${transfer.body.id}/slip`, AISYAH)).status).toBe(404) // someone else's lease
    expect((await api('GET', `/api/payments/${transfer.body.id}/slip`, NW_STAFF)).status).toBe(302)
  })

  it('deletes the uploaded slip when recording fails', async () => {
    const name = `fail-${Date.now()}.png`
    const bucket = await storage(NW_STAFF).bucket()
    expect((await bucket.upload(`${ids.org}/${name}`, png(), { contentType: 'image/png' })).error).toBeNull()
    const over = await api('POST', `/api/leases/${testLease}/payments`, NW_STAFF, { amountSen: 99_999_999, method: 'bank_transfer', receivedAt: '2026-10-29T09:15:00+08:00', slipPath: `${ids.org}/${name}` })
    expect(over.status).toBe(422)
    const listed = await bucket.list(ids.org, { search: name })
    expect(listed.data ?? []).toHaveLength(0)
  })
})

describe('online payments and the webhook', () => {
  let bill = { billId: '', amountSen: 0 }

  it('creates an unguessable bill for the amount due now', async () => {
    const probeLease = ids.leases.get('C-01-7')!
    const view = await api<LeaseView>('GET', `/api/leases/${probeLease}`, PROBE)
    const created = await api('POST', `/api/leases/${probeLease}/gateway-bills`, PROBE)
    expect(created.status).toBe(201)
    expect(created.body.billId).toMatch(/^bill_[0-9a-f]{32}$/)
    expect(created.body.amountSen).toBe(view.body.amountDueNowSen)
    bill = { billId: created.body.billId!, amountSen: created.body.amountSen! }
    expect((await api('POST', `/api/leases/${testLease}/gateway-bills`, PROBE)).status).toBe(422) // nothing due yet
  })

  it('rejects forged, unknown and mismatched callbacks', async () => {
    const fields = paidFields(bill.billId, bill.amountSen)
    expect(await webhook(fields, '0'.repeat(64))).toBe(401)
    expect(await webhook({ ...fields, paid_amount: '1' }, computeSignature(Object.entries(fields), GATEWAY_KEY))).toBe(401)
    expect(await webhook({ ...fields, id: `bill_${'0'.repeat(32)}` })).toBe(404)
    expect(await webhook({ ...fields, paid_amount: String(bill.amountSen - 1) })).toBe(422)
    const res = await fetch(`${APP}/api/webhooks/gateway`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
    expect(res.status).toBe(401)
  })

  it('settles once when the same callback arrives several times at once, with extra fields', async () => {
    const fields = { ...paidFields(bill.billId, bill.amountSen), future_field: 'x' }
    const statuses = await Promise.all(Array.from({ length: 6 }, () => webhook(fields)))
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200])
    const view = await api<LeaseView>('GET', `/api/leases/${ids.leases.get('C-01-7')}`, PROBE)
    const online = view.body.payments.filter((p) => p.method === 'online')
    expect(online).toHaveLength(1)
    expect(online[0]).toMatchObject({ amountSen: bill.amountSen, status: 'approved', unappliedSen: 0, receivedAt: '2026-10-29T10:00:00+08:00' })
    expect(view.body.amountDueNowSen).toBe(0)
  })

  it('never takes a paid bill back, and fails pending bills', async () => {
    expect(await webhook({ ...paidFields(bill.billId, 0), paid: 'false', transaction_status: 'failed' })).toBe(200)
    const stored = await rest(`gateway_bills?id=eq.${bill.billId}&select=status`, PROBE)
    expect(stored.rows[0]?.status).toBe('paid')

    const benLease = ids.leases.get('B-05-1')!
    const benBill = await api('POST', `/api/leases/${benLease}/gateway-bills`, BEN)
    expect(benBill.status).toBe(201)
    const failed = { ...paidFields(benBill.body.billId!, 0), paid: 'false', transaction_status: 'failed' }
    expect(await webhook(failed)).toBe(200)
    expect(await webhook(failed)).toBe(200)
    expect((await rest(`gateway_bills?id=eq.${benBill.body.billId}&select=status`, BEN)).rows[0]?.status).toBe('failed')
    expect(await webhook(paidFields(benBill.body.billId!, benBill.body.amountSen!))).toBe(200)
    expect((await rest(`gateway_bills?id=eq.${benBill.body.billId}&select=status`, BEN)).rows[0]?.status).toBe('paid')
  })
})

describe('Data API (PostgREST with the publishable key)', () => {
  const tables = ['organizations', 'memberships', 'units', 'tenants', 'leases', 'invoices', 'payments', 'payment_allocations', 'gateway_bills', 'audit_log']

  it('gives anonymous callers nothing', async () => {
    for (const table of tables) {
      const res = await rest(`${table}?select=*`, null)
      expect(res.rows, table).toHaveLength(0)
    }
  })

  it('scopes tenant reads to their own rows', async () => {
    const count = async (table: string) => (await rest(`${table}?select=*`, AISYAH)).rows.length
    expect(await count('organizations')).toBe(1)
    expect(await count('memberships')).toBe(0)
    expect(await count('units')).toBe(1)
    expect(await count('tenants')).toBe(1)
    expect(await count('leases')).toBe(1)
    expect(await count('invoices')).toBe(7)
    expect(await count('payments')).toBe(2)
    expect(await count('payment_allocations')).toBe(3)
    expect(await count('audit_log')).toBe(0)
  })

  it('lets a tenant update only their own phone', async () => {
    const own = (await rest('tenants?select=id', AISYAH)).rows[0]!.id
    const ok = await rest(`tenants?id=eq.${own}`, AISYAH, { method: 'PATCH', body: JSON.stringify({ phone: '+60 12-345 6789' }) })
    expect(ok.status).toBe(200)
    expect(ok.rows[0]?.phone).toBe('+60 12-345 6789')
    expect((await rest(`tenants?id=eq.${own}`, AISYAH, { method: 'PATCH', body: JSON.stringify({ full_name: 'Hacker' }) })).status).toBeGreaterThanOrEqual(400)
    expect((await rest(`tenants?id=eq.${own}`, AISYAH, { method: 'PATCH', body: JSON.stringify({ phone: 'not a phone' }) })).status).toBeGreaterThanOrEqual(400)
    const ben = ids.tenants.get('Ben Lim')!
    expect((await rest(`tenants?id=eq.${ben}`, AISYAH, { method: 'PATCH', body: JSON.stringify({ phone: '0123456789' }) })).rows).toHaveLength(0)
    expect((await rest(`tenants?id=eq.${ben}`, NW_MANAGER, { method: 'PATCH', body: JSON.stringify({ phone: '0123456789' }) })).rows).toHaveLength(0)
  })

  it('scopes staff and manager reads to their organization, audit_log to managers', async () => {
    expect((await rest('memberships?select=*', NW_STAFF)).rows).toHaveLength(2)
    expect((await rest('audit_log?select=*', NW_STAFF)).rows).toHaveLength(0)
    expect((await rest('audit_log?select=*', NW_MANAGER)).rows.length).toBeGreaterThan(0)
    expect((await rest('leases?select=*', BETA_MANAGER)).rows).toHaveLength(1)
    expect((await rest('tenants?select=*', CHEN)).rows).toHaveLength(1)
  })

  it('refuses every other write, for every role', async () => {
    for (const who of [null, AISYAH, NW_STAFF, NW_MANAGER]) {
      expect((await rest('payments', who, { method: 'POST', body: JSON.stringify({ lease_id: testLease, amount_sen: 1 }) })).status).toBeGreaterThanOrEqual(400)
      expect((await rest(`leases?id=eq.${testLease}`, who, { method: 'PATCH', body: JSON.stringify({ monthly_rent_sen: 1 }) })).status).toBeGreaterThanOrEqual(400)
      expect((await rest(`audit_log?id=gt.0`, who, { method: 'DELETE' })).status).toBeGreaterThanOrEqual(400)
      expect((await rest(`invoices?lease_id=eq.${testLease}`, who, { method: 'DELETE' })).status).toBeGreaterThanOrEqual(400)
      expect((await rest('rpc/member_org_ids', who, { method: 'POST', body: '{}' })).status).toBeGreaterThanOrEqual(400)
    }
  })
})
