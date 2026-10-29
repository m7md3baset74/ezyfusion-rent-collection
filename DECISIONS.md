# Part C: Decisions

## 1. The same `paid=true` callback arrives twice, 5 ms apart

Both requests verify the HMAC on the raw body (`lib/server/gateway.ts:52`), find the bill (`:55`) and check `paid_amount` (`:70`), all without locks. Each then opens a transaction and locks the lease row (`:80`, which calls `lib/server/db.ts:17-18`, `SELECT … FOR UPDATE`). The first request gets the lock, re-reads the bill (`:81`), sees `pending`, marks it paid (`:83-86`), inserts one approved online payment with `received_at = paid_at` (`:88-98`), allocates it and commits. The second request was waiting on the lock. Once it gets it, it re-reads the bill, sees `paid` (`:82`) and returns 200 without changing anything.

The hard guarantee is `gateway_bill_id text unique` (`supabase/migrations/20261029000100_schema.sql:115`). Even without the lock, a second insert would fail with 23505, which is answered as a repeat delivery (`gateway.ts:110`). Six identical simultaneous callbacks are covered in `tests/integration/api.test.ts` ("settles once…").

## 2. Two staff record RM 800 and RM 700 at the same moment, with RM 1,000 remaining

Both requests pass auth and validation, then enter `recordPayment`'s transaction (`lib/server/payments.ts:53`). Whichever reaches `lockLease` (`:54`) first holds the lease row, and the other waits there. Under the lock, the first computes cap = remaining balance − pending total (`:56-57`) = RM 1,000, accepts its amount and commits a `pending_verification` payment. The second then gets the lock and re-reads balances and the pending total, which now includes the first payment. Its cap is RM 200 or RM 300, so it gets 422 (`:58-60`) and nothing is written. If it carried a slip, the slip is deleted (`:22-29`).

Without the lock, both would read RM 1,000 under READ COMMITTED and both would succeed. Approval re-checks the remaining balance under the same lock (`:96-104`). Covered by the "keeps two simultaneous staff payments within the cap" test.

## 3. Every place that works out "today" or converts between a date and an instant

Malaysia is a fixed UTC+8 (no DST), so +8 h with UTC arithmetic is exact, whatever the server's or browser's timezone.
- `lib/billing.ts:142` `malaysiaDate(now)`: today in Malaysia. Used for overdue status (`:151`), amount due and bills (`gateway.ts:21`, `leases.ts:90`), dashboard months (`reports.ts:56`), form defaults (`app/(staff)/leases/[leaseId]/page.tsx:143`) and in the browser (`tenant-portal.tsx:144`).
- `lib/time.ts:15` `parseInstant` requires an offset. The form sends `…+08:00` (`record-payment-form.tsx:56`), as does the seed (`seed.ts:109,124`).
- `time.ts:36`: the gateway's `paid_at` with its `+0800`.
- `time.ts:43,48`: output in Malaysia time, identical on server and browser.
- `time.ts:66,70`: Postgres `date` ↔ UTC midnight; checked under TZ=America/New_York.
- `reports.ts:14-17`: months start at `-01T00:00+08:00`, grouped `AT TIME ZONE 'Asia/Kuala_Lumpur'`.

## 4. Queries that bypass RLS, and what authorizes them instead

- **Prisma (all server data access, as the DB owner, `lib/prisma.ts:10`).** `getCaller` (`lib/server/auth.ts:26`) validates the token or cookie with `getUser()` and loads the role and org from `memberships`/`tenants.user_id` (`caller.ts:13`). Services load records only through `findLeaseForCaller`/`findPaymentForCaller` (`caller.ts:34-48`, 404 outside the caller's scope), then call `requireRole` (`:24`, 403). Creates use `caller.orgId` and check the ids in the body (`leases.ts:33-36`), and reports filter on `org_id = caller.orgId` (`reports.ts:19`).
- **Webhook:** the HMAC signature (`gateway.ts:52`).
- **Secret-key client** (`lib/supabase/admin.ts`, `server-only`): it deletes a slip only if the file is in the caller's own org folder and no payment uses it (`slips.ts:20-24`). It signs slip URLs only after `findPaymentForCaller` plus a role check (`app/api/payments/[paymentId]/slip/route.ts`).
- **SECURITY DEFINER `private.*` helpers** (`20261029000200_security.sql:20-44`): they take no arguments, return only rows for `auth.uid()`, are only used inside RLS policies, and live in a schema PostgREST doesn't expose.

## 5. A void reopens invoices while the lease still has `unapplied_sen` from an online payment

`voidPayment` (`lib/server/payments.ts:141-163`) deletes only the voided payment's allocations (`:150`) and marks it voided. The invoices it paid reopen. Another payment's `unapplied_sen` is **not** re-applied automatically.

Why:
- The brief says other payments' allocations don't change on a void. Auto-applying the credit would create new allocations for a payment the manager didn't touch, and the void would then have a hidden side effect.
- The leftover is money the tenant overpaid. Whether it's refunded or applied is a business decision.

The credit stays visible on the lease page ("… unapplied") so a manager can act on it. The next step would be an explicit "apply credit" manager action that allocates under the lease lock and writes an audit row.

## 6. Two things the AI assistant got wrong, and how they were noticed

1. **It disabled email login while trying to disable sign-ups.** It set `[auth.email] enable_signup = false` in `supabase/config.toml`, but that setting turns off email/password **login**. It was caught when `npm run seed` failed with "Email logins are disabled" (AI log: search for that phrase). The fix keeps it `true` with a comment and relies on `[auth] enable_signup = false` to block sign-ups.
2. **It wrote a wrong test expectation.** Its first integration test expected Aisyah to get **403** for the slip of a payment on *Probe's* lease. The app correctly returned **404**, because she can't see that lease. The test was wrong, not the app. It was caught by running the suite (AI log: "expected 404 to be 403"), and the test now checks 403 for the lease's own tenant and 404 for Aisyah.
