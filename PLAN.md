# PLAN.md: working checklist (derived from BRIEF.md; not a graded file)

## 1. Grading contract (exact names that the tests depend on)

**Grading commands, fresh clone:** `npx supabase start` → `npx supabase db reset` → `npm install` → `cp .env.example .env.local` → `npm run seed` → `npm run build && npm start` (port 3000).
So: every DB object comes from `supabase/migrations/`; `npm install` must generate the Prisma client; the seed runs once on a fresh DB.

**Files:** `lib/billing.ts` · `supabase/config.toml` · `supabase/migrations/*.sql` · `prisma/schema.prisma` · seed script (`npm run seed`) · `.env.example` (local values + where each comes from) · `gateway-sim.mjs` · `README.md` · `REVIEW.md` · `DECISIONS.md` · `ai-logs/`. No real `.env*` committed.

**Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`, `GATEWAY_X_SIGNATURE_KEY` (+ our own `SEED_PASSWORD`).

**`lib/billing.ts` exports:** `InvoiceKind`, `ScheduledInvoice`, `generateSchedule`, `InvoiceStatus`, `invoiceStatus`, `parseRinggitToSen`. Pure: no Next/React/Supabase/Prisma imports, no I/O, same result under TZ=UTC / Asia/Kuala_Lumpur / America/New_York.

**Tables / required columns** (money `bigint` sen, calendar dates `date`, instants `timestamptz`):

| table | required columns |
|---|---|
| organizations | id, name |
| memberships | user_id, org_id, role (`manager` \| `staff`) |
| units | id, org_id, name |
| tenants | id, org_id, user_id, full_name, email, phone |
| leases | id, org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen |
| invoices | id, org_id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen |
| payments | id, org_id, lease_id, amount_sen, unapplied_sen, method, status, received_at, slip_path, gateway_bill_id |
| payment_allocations | id, org_id, payment_id, invoice_id, amount_sen |
| gateway_bills | id, org_id, lease_id, amount_sen, status (`pending` \| `paid` \| `failed`) |
| audit_log | id, org_id, actor_id, action, entity_id, details, created_at |

**Enum values:** invoice kind `deposit|rent` · method `cash|bank_transfer|online` · payment status `pending_verification|approved|rejected|voided` · invoice status (computed, never stored) `paid|partially_paid|unpaid|overdue`.

**Storage:** private bucket `payment-slips`, objects at `<org_id>/...`, JPEG/PNG/PDF, max 5 MB.

**HTTP API** (JSON; errors `{ "error": "..." }`; 401 no valid login · 404 other org's or other tenant's record · 403 visible record, role not allowed). Accept `Authorization: Bearer <access token>` and the session cookie.

| route | who | success | other |
|---|---|---|---|
| POST /api/leases | manager | 201 `{ id }` | 400, 409 overlap |
| GET /api/leases/:leaseId | staff, manager, lease's tenant | 200 `{ lease, invoices (allocation order), payments }` | |
| POST /api/leases/:leaseId/payments | staff, manager | 201 `{ id, status }` | 400, 422 over cap |
| POST /api/payments/:paymentId/approve | manager | 200 `{ status }` | 409 not pending, 422 over balance |
| POST /api/payments/:paymentId/reject | manager | 200 `{ status }` | 400 reason, 409 not pending |
| POST /api/payments/:paymentId/void | manager | 200 `{ status }` | 400 reason, 409 not approved |
| POST /api/leases/:leaseId/gateway-bills | lease's tenant | 201 `{ billId, amountSen }` | 422 nothing due |
| GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM | staff, manager | 200 `[{ month, collectedSen }]`, every month, in order | 400 bad range |
| POST /api/webhooks/gateway | gateway | form-urlencoded, see §5 of brief | 401 / 404 / 422 |

**Pages:** `/payments/return?bill_id=...&paid=true`, read-only status from the DB.

**Seed** (`npm run seed`, through the app's own lease and payment code):
- Northwind Properties: manager@northwind.test (manager), staff@northwind.test (staff), tenants aisyah@ "Aisyah Rahman", ben@ "Ben Lim", probe@ "Probe Tenant".
- Beta Realty: manager@beta.test (manager), tenant chen@beta.test "Chen Wei".
- Leases: A-12-3 Aisyah 2026-01-31 → 2026-07-15, RM 1,500.00, deposit RM 3,000.00 · B-05-1 Ben 2026-01-01 → 2026-04-15, RM 1,000.29, no deposit · C-01-7 Probe 2026-02-28 → 2027-02-27, RM 2,000.00, deposit RM 4,000.00 · D-03-2 no lease · Beta KL-1 Chen 2026-03-15 → 2027-03-14, RM 2,200.00, deposit RM 4,400.00.
- Aisyah's payments: cash RM 3,000.00 at 2026-01-31 10:00 MYT by the manager; bank transfer RM 2,000.00 at 2026-03-01 00:30 MYT by staff with a slip, then approved by the manager.
- One shared password for every account (submitted with the work).

**Expected seed results (acceptance checks):**
- Aisyah's schedule = the worked example (deposit 300000; periods 0–4 = 150000; period 5 = 2026-06-30 → 2026-07-15 = 77419).
- Cash 300000 → deposit. Transfer 200000 → period 0 (150000) + period 1 (50000).
- Northwind collections 2026-01..2026-03 = 300000, 0, 200000. (00:30 MYT on 1 March is still 28 Feb in UTC: that's the trap.)

**Submission:** public GitHub repo; env values from `.env.local`; test account manager@northwind.test + shared password; summary of what works, what doesn't, what was skipped.

**Instant fail:** secret key reaches the browser · anon can read/write any table via the Data API · float money · return page settles a bill.

## 2. Requirements in the brief's priority order

### Billing (§3)
- [ ] Throw on: date not a real YYYY-MM-DD, end < start, rent not a positive integer, deposit not a non-negative integer
- [ ] Deposit first when > 0, due on startDate, period fields null
- [ ] Anchor k = start + k months counted from the start, clamped to month end
- [ ] Period k = anchor k → anchor k+1 − 1 day, due on anchor k; one period per anchor ≤ endDate
- [ ] Last period cut at endDate; if short, rent × used / full days, round half up (integer maths)
- [ ] invoiceStatus in order: paid → overdue (MYT today > dueDate) → partially_paid → unpaid
- [ ] parseRinggitToSen grammar and rejections

### Access control (§6)
- [ ] Every handler authenticates (getUser), takes role/org from memberships or tenants.user_id, scopes by org
- [ ] 401 / 404 / 403 rules; IDs in bodies checked against the caller's org
- [ ] Data API: grants + RLS exactly per matrix; every other write fails; no callable rpc functions; audit_log append-only for every role
- [ ] Storage policies on payment-slips
- [ ] Secret key server-only

### Payments (§4)
- [ ] Record: amount, method, receivedAt (MYT), slip for bank transfers
- [ ] Manager → approved + allocated; staff → pending_verification
- [ ] Cap: amount ≤ total invoices − allocated − pending
- [ ] Approve (re-check remaining; 422 leaves it pending), reject (reason ≥ 5), void (reason ≥ 5, removes only its own allocations)
- [ ] audit_log rows for lease creation, approve, reject, void
- [ ] Allocation order: due date, deposit before rent, period index; fill each fully; leftover → unapplied_sen
- [ ] Slip deleted if recording fails after upload; slip_path must exist in the lease org's folder
- [ ] Concurrency: parallel records respect the cap; double approve allocates once
- [ ] Collections report by MYT month, including zero months

### Online payments and webhook (§5)
- [ ] Bill = unpaid amounts of invoices due ≤ MYT today; 422 when 0; unguessable id
- [ ] Webhook: signature over all fields except x_signature (sorted, `key+value`, joined by `|`, HMAC-SHA256 hex) → 401; unknown bill → 404; amount mismatch → 422; state machine; at most one payment per bill; received_at = paid_at
- [ ] Never log the key or payloads
- [ ] /payments/return is read-only

### UI (§9)
- [ ] Staff/manager: dashboard (overdue count + last-6-months collections), leases list, lease page (invoices, payments, slip links), record payment (ringgit via parseRinggitToSen, MYT date/time, slip upload), approve/reject/void with confirmation + reason
- [ ] Tenant: lease, invoices + statuses, payments, amount due now, Pay now (bill id + amount), return page, edit phone (supabase-js directly)
- [ ] shadcn + Tailwind, toasts for every action, loading/empty/invalid states, strict TS without `any`
- [ ] Every date/time in MYT whatever the browser timezone; no hydration warnings

### Write-ups
- [ ] REVIEW.md (Part B), DECISIONS.md (Part C: 6 answers ≤ 150 words with file:line), README (run, known issues, next steps, skipped), ai-logs/

## 3. Edge cases to test

- **Billing:** Jan 31 start (Feb 28/29 clamp); leap-day start (2028-02-29); starts on the 29th/30th; endDate = startDate; endDate = day before an anchor (no proration); endDate = an anchor (1-day last period); multi-year leases; half-up rounding at exactly .5; invalid dates (2026-02-30, 2026-13-01, 2026-1-5, padded strings); non-integer / unsafe / NaN amounts; overdue boundary 2026-03-01T15:59:59.999Z vs 16:00:00Z; parse: the brief's examples plus ".5", "5.", "1,5000", "0", surrounding whitespace, huge numbers.
- **API:** non-uuid ids → 404 (not 500); another org's lease/payment/unit/tenant → 404; a tenant on another tenant's lease → 404; tenant/staff on manager actions → 403; missing or invalid token → 401; bank transfer with no slip, with a slip in another org's folder, or with a missing file → 400.
- **Concurrency:** parallel records over the cap; parallel approvals of one payment; parallel overlapping lease creation; parallel identical webhooks.
- **Webhook:** forged or missing signature; extra unknown fields; duplicates; paid=false then paid=true; paid=true then a late paid=false; amount mismatch; unknown bill.
- **Timezones:** run the seed and server once under TZ=America/New_York and compare; browser in a different timezone.

## 4. Design (to confirm before coding)

### Schema
- SQL migrations are the only source of truth. Prisma reads them (`prisma db pull` → `schema.prisma`); no `prisma migrate`, so no `_prisma_migrations` table ends up in the exposed schema.
- uuid ids (`gen_random_uuid()`), except `gateway_bills.id` = `bill_` + 32 hex chars from 16 random bytes.
- `memberships.user_id` is the primary key (exactly one org per staff/manager); `tenants.user_id` unique.
- Same-org integrity in the DB: composite FKs such as `(unit_id, org_id) → units(id, org_id)` for leases, invoices, payments, allocations and bills.
- No overlapping leases: `EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)` (btree_gist) → 409, race-proof.
- invoices: `UNIQUE (lease_id, kind, period_index) NULLS NOT DISTINCT`; CHECKs tying kind to the period fields.
- payments: CHECK bank_transfer ⇔ slip_path present and starting with `org_id || '/'`; online ⇔ gateway_bill_id present; `UNIQUE (gateway_bill_id)`; `0 ≤ unapplied_sen ≤ amount_sen`; extra columns recorded_by, decided_by, decided_at, reason.
- payment_allocations: `UNIQUE (payment_id, invoice_id)`, amount > 0.
- audit_log: identity id; BEFORE UPDATE / DELETE / TRUNCATE trigger that raises, so it's append-only for the owner and service role too; those privileges revoked as well.
- No FK to `auth.users`: Prisma introspection can't follow cross-schema FKs. The seed keeps them consistent.

### Data API
- Revoke everything from anon and authenticated (tables, sequences, functions, including PUBLIC execute), plus `ALTER DEFAULT PRIVILEGES` so future objects start closed.
- Grant authenticated `SELECT` on the 10 tables and `UPDATE (phone)` on tenants. No other insert/update/delete grants; anon gets nothing.
- RLS on every table. Policies call SECURITY DEFINER helpers in a `private` schema that PostgREST doesn't expose, so they can't be called through `/rest/v1/rpc`.
- Policies follow the matrix exactly. Tenant: own org, units of own leases, own tenant row, rows of own leases. Staff/manager: own org. audit_log: managers only.
- CHECK constraint on phone format, since tenants write it directly.

### Storage
- Bucket created in a migration: private, 5 MB limit, image/jpeg, image/png, application/pdf.
- storage.objects policies: INSERT and SELECT for authenticated users when the first folder is an org they're staff/manager of. No UPDATE or DELETE policies, so nobody can overwrite or delete through the API.
- The browser uploads with the user's token to `<org_id>/<uuid>.<ext>`. The API checks that slipPath starts with the lease's org id and that the object exists in `storage.objects` (and checks magic bytes if there's time).
- If recording fails after the upload, the server deletes the object with the secret key, but only when it's in the caller's org folder and no payment references it.
- Slip links are 60-second signed URLs, created by the server after the authz check.

### Server authorization
- `getCaller(req)`: Bearer header → `auth.getUser(token)`, otherwise the cookie client's `auth.getUser()`. Role and org then come from memberships or tenants.user_id via Prisma, never from metadata.
- Order inside each handler: 401 → load the record scoped to the caller (invisible or non-uuid → 404) → role (403) → body validation (400) → business rules (409/422).
- unitId/tenantId in bodies must belong to the caller's org → 404.
- Route handlers stay thin; logic lives in `lib/server/*` services that take a caller context. The seed calls the same services.
- The UI calls the same API routes (no separate Server Actions to secure). The exception is the tenant portal, which reads its data and updates the phone through supabase-js, as the brief requires.
- The secret key only appears in `lib/supabase/admin.ts`, behind `import 'server-only'`.

### Concurrency and idempotency
- One rule: every money-changing operation runs in a Prisma interactive transaction that starts with `SELECT … FROM leases WHERE id = $1 FOR UPDATE`. That serializes, per lease, recording (cap), approval (re-check + allocate), void, bill creation and webhook settlement. Locks are always taken lease first, then payment or bill, so no deadlocks.
- Double approve: the second request waits for the lock, re-reads the payment, sees `approved` → 409. It's allocated once.
- Webhook: verify the signature on the raw body (URLSearchParams, duplicate keys rejected, `timingSafeEqual`) → 404 → 422 → transaction: lock the lease, re-read the bill `FOR UPDATE`, apply the state machine. `UNIQUE (payments.gateway_bill_id)` is the hard guarantee of one payment per bill; a unique violation is treated as a repeat delivery (200).
- Allocation is a pure, unit-tested function (`planAllocation(openInvoices, amount)`), applied inside the transaction.
- Void deletes only that payment's allocations. It never re-applies another payment's unapplied_sen ("other payments' allocations do not change"), so the credit stays visible on the online payment for a manager to handle. (Part C Q5)
- Interactive transaction maxWait/timeout raised (10 s / 15 s), so queued concurrent requests wait instead of failing.

### Time
- MYT is a fixed UTC+8 with no DST: `mytToday(now) = new Date(now + 8h).toISOString().slice(0, 10)`. The code never uses local-time Date getters.
- Calendar dates stay 'YYYY-MM-DD' strings end to end; billing does pure integer calendar maths.
- Instant inputs must carry an offset (receivedAt; webhook paid_at `+0800`). The UI sends `${date}T${time}:00+08:00`.
- Collections: month boundaries at `YYYY-MM-01T00:00+08:00`, grouped by `received_at AT TIME ZONE 'Asia/Kuala_Lumpur'`.
- Display: our own fixed-format MYT formatter instead of Intl/locale output, so server and client produce the same string and there's no hydration mismatch.
- Check once by running the seed and server under TZ=America/New_York.

### Stack details
- Next 16 App Router at the repo root (`app/`, `lib/`), Turbopack, `proxy.ts` only to refresh the session.
- Prisma 7: `prisma.config.ts`, `prisma-client` generator → `lib/generated/prisma` (gitignored, generated on postinstall), `@prisma/adapter-pg`.
- `tsx` runs the seed script.
- Vitest for billing, allocation and signature tests; a smoke script for the API, RLS, storage and concurrency.
- config.toml: realtime, edge_runtime and analytics off; public sign-ups off.

## 5. Build order (commit after each)
1. Scaffold: Next 16 + shadcn + `supabase init` / config + git
2. `lib/billing.ts` + tests
3. Migrations (schema, grants/RLS, storage, audit) → `db reset`
4. Prisma pull/generate, caller/auth helper
5. Services + API routes (leases, payments, approve/reject/void, report)
6. Seed → check the expected results above
7. Gateway bills + webhook + simulator + signature test
8. Smoke tests: access matrix, Data API, storage, concurrency
9. UI
10. REVIEW.md, DECISIONS.md, README, ai-logs, push

If time runs short: cut UI polish first, then bonuses. Never cut billing or authz.
