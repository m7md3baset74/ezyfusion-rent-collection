# Part B: Code review

Line numbers count from the first line *after* each `// path` header comment (so line 1 is the first `import`, or `'use server'`).
Files: **LF** = `app/api/leases/[leaseId]/late-fees/route.ts`, **WH** = `app/api/webhooks/gateway/route.ts`, **CR** = `app/(staff)/dashboard/actions.ts`.

Ordered from most to least severe.

## Critical

### 1. CR L1, L5: the Server Action has no authentication or authorization, and trusts `orgId` from the caller
`'use server'` exports `getCollections` as a public POST endpoint. Anyone who has its action ID (it's in the client bundle) can call it with any arguments, even without signing in. `prisma` connects as the owner, so RLS doesn't apply.
**Scenario:** a Beta Realty tenant (or an anonymous visitor) calls the action with Northwind's `orgId` and reads Northwind's monthly collections.
**Fix:** authenticate with `supabase.auth.getUser()`, load the caller's membership (manager or staff), and use *its* `org_id`. Don't take `orgId` as a parameter.

### 2. LF L12 (and L17–21): role taken from `user_metadata`; lease not scoped to the caller's organization
Users can write their own `user_metadata` (`supabase.auth.updateUser({ data: { role: 'manager' } })`). The lease is then loaded by id alone, with the owner connection.
**Scenario:** a tenant sets `role: 'manager'` on their account and adds late fees to any lease in any organization. A real Beta manager can also add fees to Northwind's leases, and the 404-vs-200 difference reveals which lease ids exist.
**Fix:** take the role and org from `memberships`, require `manager`, and load the lease with `where: { id, orgId: membership.orgId }`. Return 404 when it isn't found, 403 for non-managers in the org, and 401 when `user` is null (today an anonymous call gets 403).

### 3. WH L20–38: check-then-act race, so one bill can create two payments
The `status === 'paid'` check (L22) happens outside the transaction. The update (L25) isn't conditional and nothing locks the bill.
**Scenario:** the gateway retries and two identical `paid=true` callbacks arrive 5 ms apart. Both read `pending`, both transactions mark the bill paid and both create an approved payment. The lease is credited twice and `allocate` fills invoices twice. (If `payments.gateway_bill_id` happens to be unique, the second one fails with a 500 and the gateway keeps retrying.)
**Fix:** inside the transaction, use `updateMany({ where: { id, status: { in: ['pending', 'failed'] } }, data: { status: 'paid' } })` and create the payment only when `count === 1` (or `SELECT … FOR UPDATE` the bill first). Back it with `UNIQUE (payments.gateway_bill_id)` and treat a unique violation as a repeat delivery (200).

## High

### 4. WH L15: logs the whole payload and the valid signature
`console.error('Invalid signature', { fields, expected })` breaks "never log whole callback payloads". Worse, `expected` is the correct HMAC for fields the *sender* chose.
**Scenario:** an attacker posts a callback for their own bill with `paid=true` and a garbage signature. Anyone who can read the logs (a log pipeline, a support tool, a leaked log file) now has a valid signature for that exact payload and can replay it to settle the bill. The log is a signing oracle.
**Fix:** log only a fixed message (maybe the bill id), never `fields` or `expected`.

### 5. WH L26–35: `paid_amount` isn't checked against the bill
The brief requires a 422 with no effect when `paid=true` and `paid_amount ≠ bill.amount_sen`. Here the bill is marked paid whatever the amount, and the payment records the gateway's amount.
**Scenario:** a bill of 210050 settles with `paid_amount=100`. The bill is "paid" but the lease is credited RM 1.00. A non-integer value such as `"2100.50"` makes `BigInt()` throw, so the endpoint returns 500.
**Fix:** check that `paid_amount` matches `/^\d+$/` and that `BigInt(paid_amount) === bill.amountSen` before the transaction; otherwise return 422. Use `bill.amountSen` for the payment.

### 6. LF L27–45: not idempotent, so every call charges the fee again
Nothing records which invoice a fee belongs to, and nothing stops a second run.
**Scenario:** the manager double-clicks, or a cron job runs daily. Each run adds another 2% fee for every overdue invoice, and two simultaneous requests double it too.
**Fix:** store `source_invoice_id` on the fee with a unique constraint (one fee per invoice), skip invoices that already have one, and run it in one transaction under a lease lock.

### 7. CR L7, L10: months and range bounds are computed in UTC, not Malaysia time
`date_trunc('month', received_at)` and `${from}::date` use the session timezone (UTC on Supabase).
**Scenario:** the brief's own seed. The bank transfer received 2026-03-01 00:30 MYT is 2026-02-28 16:30 UTC, so it's reported in **February**: `[Jan 300000, Feb 200000]` instead of `Jan 300000, Feb 0, Mar 200000`. The range edges are also 8 hours off.
**Fix:** group by `to_char(received_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM')` and bound by `received_at >= (from::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`, with the same for the exclusive upper bound.

## Medium

### 8. WH L18: `paid=false` returns 200 before anything else
**Scenario:** the gateway reports a failed payment. The bill stays `pending` forever instead of becoming `failed`, and `paid=false` for an unknown bill id returns 200 instead of 404.
**Fix:** look up the bill first (404), then for `paid=false` run `updateMany({ where: { id, status: 'pending' }, data: { status: 'failed' } })`. Paid and failed bills stay as they are.

### 9. WH L33: `receivedAt: new Date()` instead of `paid_at`
**Scenario:** a payment made at 23:58 on 31 March MYT whose callback is retried at 00:05 on 1 April is reported as April money. Every retried callback gets the wrong time.
**Fix:** parse `paid_at` (`'2026-04-01 00:30:12 +0800'`, offset included) and store it as `received_at`. Reject it if it can't be parsed.

### 10. LF L40, L49–52: invoice references are duplicated
Prisma queries are lazy: the `create` calls only run at `Promise.all` (L45), after **every** `nextReference` call has already read the same "latest" invoice.
**Scenario:** three overdue invoices give three fees that all get `INV-42`. Two managers running it at the same time collide as well. If `reference` is unique, some fees are created and others fail (there's no transaction), and the request returns 500.
**Fix:** use a per-organization counter row (`UPDATE … SET next = next + 1 RETURNING`) or a sequence inside one transaction, and create the fees in that same transaction.

### 11. LF L30: the 0.995 ratio treats partly unpaid invoices as paid
**Scenario:** RM 1,500.00 rent with RM 1,493.00 paid (RM 7.00 still due, about 0.47%) gets no late fee, even though the invoice is still unpaid. Float division on money also makes the cut-off imprecise.
**Fix:** compare integers: skip only when `paid >= invoice.amountSen`.

### 12. LF L37: `kind: 'late_fee'` is outside the invoice contract
`invoices.kind` is `'deposit' | 'rent'`. The `GET /api/leases/:id` response type and the allocation order (due date, deposit before rent, period index) have no place for it. With a `CHECK (kind in ('deposit','rent'))` the insert fails with a 500. Without one, clients and the allocation code see a kind they don't handle.
**Fix:** add `late_fee` deliberately (migration, CHECK, response type, allocation-order rule), or keep fees in their own table.

### 13. CR L11–13: months with no collections are missing
The contract is "one entry per month in order, including months with nothing collected". In the brief's example, February would simply be absent.
**Fix:** `generate_series` over the months with a `LEFT JOIN`, or fill zeros in TypeScript.

## Low

### 14. WH L14: signature compared with `!==`
This isn't constant-time, which leaks timing information about the expected HMAC. **Fix:** `crypto.timingSafeEqual` on equal-length buffers, after checking the input is 64 hex characters.

### 15. CR L5–10: no validation of `from`/`to`
A malformed value makes Postgres throw (500), and `from > to` silently returns `[]`. **Fix:** validate `YYYY-MM` and `from <= to`, and return 400 otherwise.

## Looks suspicious, but is correct
- **LF L23–24, L28 (grace period):** `todayMyt` adds +8 h then takes the UTC date, which gives the correct Malaysia date. `Date.parse('YYYY-MM-DD')` is UTC midnight, and Prisma returns `date` columns at UTC midnight, so `dueDate < today − 7 days` means "more than 7 days after the due date" exactly (due 1 Mar: no fee on 8 Mar, fee on 9 Mar). `new Date(todayMyt)` (L38) also stores the right calendar date.
- **LF L11:** uses `getUser()` (validated with the Auth server), not `getSession()`. The problem is only where the role comes from (finding 2).
- **WH L10:** `.sort()` with no comparator sorts by UTF-16 code unit, which is what the brief's "ascending by character code" requires.
- **CR L9–10:** the `${…}` values in `$queryRaw` tagged templates are bound parameters, so there's no SQL injection.
