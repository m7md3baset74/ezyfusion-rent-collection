-- Data API access (brief §6). Default deny: anon and authenticated lose every privilege Supabase grants
-- by default, then authenticated gets back only SELECT on the listed tables and UPDATE of tenants.phone.
-- Row level security narrows those reads to the caller's organization or the tenant's own leases.
-- Server code uses Prisma as the database owner, which bypasses RLS; it does its own checks (lib/server/caller.ts).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

-- Helpers for policies live in a schema PostgREST does not expose, so they cannot be called via /rest/v1/rpc.
-- SECURITY DEFINER so policies can read memberships/tenants without recursing into their own RLS.
-- They only ever look up rows for auth.uid(); they take no arguments.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.member_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid())
$$;

create function private.manager_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid()) and m.role = 'manager'
$$;

create function private.tenant_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.org_id from public.tenants t where t.user_id = (select auth.uid())
$$;

create function private.tenant_lease_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = (select auth.uid())
$$;

create function private.tenant_unit_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select l.unit_id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = (select auth.uid())
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.member_org_ids(), private.manager_org_ids(), private.tenant_org_ids(),
  private.tenant_lease_ids(), private.tenant_unit_ids() to authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

grant select on public.organizations, public.memberships, public.units, public.tenants, public.leases,
  public.invoices, public.payments, public.payment_allocations, public.gateway_bills, public.audit_log
  to authenticated;
-- Column privilege: a tenant can change their phone and nothing else.
grant update (phone) on public.tenants to authenticated;

create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.member_org_ids()) or id in (select private.tenant_org_ids()));

-- Tenants have no membership rows, so they see none.
create policy memberships_select on public.memberships for select to authenticated
  using (org_id in (select private.member_org_ids()));

create policy units_select on public.units for select to authenticated
  using (org_id in (select private.member_org_ids()) or id in (select private.tenant_unit_ids()));

create policy tenants_select on public.tenants for select to authenticated
  using (org_id in (select private.member_org_ids()) or user_id = (select auth.uid()));

create policy tenants_update_own_phone on public.tenants for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy leases_select on public.leases for select to authenticated
  using (org_id in (select private.member_org_ids()) or id in (select private.tenant_lease_ids()));

create policy invoices_select on public.invoices for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));

create policy payments_select on public.payments for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));

create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (
    org_id in (select private.member_org_ids())
    or invoice_id in (select i.id from public.invoices i where i.lease_id in (select private.tenant_lease_ids()))
  );

create policy gateway_bills_select on public.gateway_bills for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));

create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id in (select private.manager_org_ids()));

-- audit_log is append-only for every role, including service_role and the owner (triggers apply to the owner).
create function private.reject_audit_log_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end
$$;
revoke all on function private.reject_audit_log_change() from public, anon, authenticated;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.reject_audit_log_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.reject_audit_log_change();
revoke update, delete, truncate on public.audit_log from service_role;

-- Safety net: an invoice can never be allocated more than its amount. The lease row lock in the server
-- code is what prevents races; this deferred check catches logic errors at commit time.
create function private.check_invoice_not_overallocated() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select coalesce(sum(a.amount_sen), 0) from public.payment_allocations a where a.invoice_id = new.invoice_id)
     > (select i.amount_sen from public.invoices i where i.id = new.invoice_id) then
    raise exception 'invoice % would be allocated more than its amount', new.invoice_id;
  end if;
  return null;
end
$$;
revoke all on function private.check_invoice_not_overallocated() from public, anon, authenticated;

create constraint trigger payment_allocations_not_overallocated
  after insert or update on public.payment_allocations
  deferrable initially deferred
  for each row execute function private.check_invoice_not_overallocated();
