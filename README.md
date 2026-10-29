# Rent collection module

Leases, invoices and payments (cash, bank transfer with slip, online gateway) for Malaysian property managers, with access control for managers, staff and tenants. Next.js 16 (App Router) · TypeScript (strict, no `any`) · Supabase (Postgres, Auth, Storage) · Prisma 7 · shadcn/ui · Tailwind CSS.

## Run it

```bash
npx supabase start            # realtime, edge runtime and analytics are disabled in supabase/config.toml
npx supabase db reset         # schema, grants, RLS, storage bucket and policies from supabase/migrations/
npm install                   # postinstall runs `prisma generate`
cp .env.example .env.local    # local values; keys come from `npx supabase status`
npm run seed                  # the brief's seed data, created through the app's own services
npm run build && npm start    # http://localhost:3000
```

All seeded accounts (`manager@northwind.test`, `staff@northwind.test`, `aisyah@`, `ben@`, `probe@northwind.test`, `manager@beta.test`, `chen@beta.test`) share the `SEED_PASSWORD` in `.env.example`.

Simulate the payment gateway for a bill shown after **Pay now**:

```bash
node --env-file=.env.local gateway-sim.mjs <bill_id> <amount_sen> [true|false]
```

## Tests

```bash
npm test          # unit: billing rules (worked example, edge cases), allocation, webhook signature test vector
npm run test:api  # integration: needs the stack + a fresh `db reset` + `npm run seed` + the app on :3000
```

`npm run test:api` calls the HTTP API with Bearer tokens, and PostgREST and Storage with the publishable key, as every seeded user. It covers 401/403/404 rules, cross-organization ids, the cap under concurrent requests, double approval, simultaneous overlapping leases, forged, duplicated, concurrent and out-of-order webhooks, the tenant phone update, and slip upload/read/cleanup. It creates data, so reset and re-seed before running it again. The unit tests pass under `TZ=UTC`, `Asia/Kuala_Lumpur` and `America/New_York`.

## Design (for the walkthrough)

| Concern | Where | How |
|---|---|---|
| Billing rules | `lib/billing.ts` | Pure integer calendar arithmetic (day numbers, no `Date` local getters); proration in BigInt with round half up |
| Allocation | `lib/allocation.ts` | Pure `planAllocation`: due date → deposit before rent → period index, fill each invoice, leftover → `unapplied_sen` |
| Schema | `supabase/migrations/…100_schema.sql` | bigint sen, `date`/`timestamptz`; composite `(id, org_id)` FKs so rows can't point across orgs; `EXCLUDE USING gist` against overlapping leases; `UNIQUE (payments.gateway_bill_id)` |
| Data API | `…200_security.sql` | Revoke everything from `anon`/`authenticated`, then grant `SELECT` on the 10 tables and `UPDATE (phone)` on tenants only; RLS per the brief's matrix through `SECURITY DEFINER` helpers in an unexposed `private` schema; append-only `audit_log` via triggers (applies to the owner and service role too) |
| Storage | `…300_storage.sql`, `lib/server/slips.ts` | Private `payment-slips` bucket (5 MB, JPEG/PNG/PDF); insert/select only for staff/managers of the org in the first folder; no update/delete policies; the server deletes a slip with the secret key if recording fails |
| Server authz | `lib/server/auth.ts`, `caller.ts` | `getUser()` from the Bearer token or cookie → role/org from `memberships` or `tenants.user_id` → record loaded in the caller's scope (else 404) → role check (else 403) → validation (400) → business rules (409/422) |
| Concurrency | `lib/server/db.ts:17` | Every money-changing transaction starts with `SELECT … FROM leases … FOR UPDATE`, so requests on one lease run one after another and re-read state under the lock |
| Webhook | `lib/server/gateway.ts`, `lib/gateway-signature.ts` | HMAC over the raw form fields (sorted by key, unknown fields included, constant-time compare) → 404 → 422 → state machine under the lease lock; nothing logged from the payload |
| Time | `lib/time.ts` | Malaysia is a fixed UTC+8: instants in and out carry offsets, display uses our own formatter (no Intl/locale), so there are no hydration differences |

Prisma's `schema.prisma` is introspected from the migrations (`npx prisma db pull`), so its model and field names match the tables exactly (snake_case). Prisma never runs migrations. Pages and route handlers call the same services in `lib/server/*`, and the seed does too. The tenant portal reads its data and updates the phone number straight through supabase-js under RLS, as the brief requires.

## Known issues and limitations

- A staff or manager `PATCH` of a tenant's phone through the Data API returns 200 with zero rows: RLS filters the row out, so nothing changes, but it isn't an error status.
- If the browser uploads a slip and is then closed before the payment is recorded, the file stays in Storage. Cleanup only runs when recording is attempted and fails. A scheduled sweep of unreferenced files would close this gap.
- Slip types are enforced by the bucket's MIME allow-list, which trusts the declared content type. File signatures (magic bytes) aren't checked.
- `tenants.user_id` is unique, so one login is a tenant of exactly one organization.
- `npm run seed` refuses to run on a non-empty database (run `npx supabase db reset` first).
- Auth rate limits for sign-in and token refresh are raised in `config.toml` so automated tests can sign in many times.

## Bonus done

- **Create-lease form with a live schedule preview** (`/leases/new`, managers only). The preview runs the same `generateSchedule` the server uses, and submitting goes through `POST /api/leases`, which re-checks everything.
- Unit tests for `lib/billing.ts`, allocation and the webhook signature, plus the integration suite above.

## Skipped

- Bonus items: realtime updates on the tenant portal (Realtime is disabled in `config.toml` to save RAM) and server-side search and pagination of leases.
- A UI for applying an online overpayment (`unapplied_sen`) to reopened invoices. See DECISIONS.md, question 5.

## What I would do next

- An "apply credit" manager action, plus a scheduled cleanup of orphaned slips.
- Magic-byte checks on slips; idempotency keys on payment recording.
- Run the integration suite in CI against a fresh `supabase start` (it runs locally today).

## Repository map

`lib/billing.ts` (graded functions) · `lib/allocation.ts` · `lib/time.ts` · `lib/money.ts` · `lib/server/*` (services, authz, webhook) · `app/api/*` (thin route handlers) · `app/(staff)/*`, `app/portal`, `app/payments/return` (UI) · `scripts/seed.ts` · `supabase/migrations/*` · `tests/*` · `REVIEW.md` (Part B) · `DECISIONS.md` (Part C) · `ai-logs/`
