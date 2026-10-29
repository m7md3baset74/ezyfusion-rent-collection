'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/app/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compareAllocationOrder } from '@/lib/allocation'
import { invoiceStatus, malaysiaDate } from '@/lib/billing'
import { postJson } from '@/lib/client/api'
import { formatSen } from '@/lib/money'
import { createClient } from '@/lib/supabase/browser'
import { formatDate, formatMytDateTime } from '@/lib/time'

// The tenant portal reads straight from the Data API with the tenant's session, so RLS decides what comes back.
interface TenantRow { id: string; full_name: string; email: string; phone: string | null }
interface LeaseRow { id: string; start_date: string; end_date: string; monthly_rent_sen: number; deposit_sen: number; units: { name: string } | null }
interface InvoiceRow {
  id: string
  lease_id: string
  kind: 'deposit' | 'rent'
  period_index: number | null
  period_start: string | null
  period_end: string | null
  due_date: string
  amount_sen: number
  payment_allocations: { amount_sen: number }[]
}
interface PaymentRow { id: string; lease_id: string; amount_sen: number; method: string; status: string; received_at: string }
interface PortalData { tenant: TenantRow; leases: LeaseRow[]; invoices: InvoiceRow[]; payments: PaymentRow[] }

const PHONE_RE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/
const METHODS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' }

export function TenantPortal() {
  const [data, setData] = useState<PortalData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [tenant, leases, invoices, payments] = await Promise.all([
      supabase.from('tenants').select('id, full_name, email, phone').single(),
      supabase.from('leases').select('id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name)').order('start_date'),
      supabase.from('invoices').select('id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen, payment_allocations(amount_sen)'),
      supabase.from('payments').select('id, lease_id, amount_sen, method, status, received_at').order('received_at'),
    ])
    const error = tenant.error ?? leases.error ?? invoices.error ?? payments.error
    if (error) {
      setLoadError(error.message)
      toast.error(`Could not load your account: ${error.message}`)
      return
    }
    setData({
      tenant: tenant.data as TenantRow,
      leases: leases.data as unknown as LeaseRow[],
      invoices: invoices.data as InvoiceRow[],
      payments: payments.data as PaymentRow[],
    })
  }, [])

  useEffect(() => {
    // Data is fetched after mount, so the server and the first client render are the same skeleton.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (loadError) return <p className="text-sm text-destructive">Could not load your account: {loadError}</p>
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PhoneCard tenant={data.tenant} onSaved={load} />
      {data.leases.length === 0 ? <p className="text-sm text-muted-foreground">You have no leases.</p> : null}
      {data.leases.map((lease) => (
        <LeaseCard
          key={lease.id}
          lease={lease}
          invoices={data.invoices.filter((i) => i.lease_id === lease.id)}
          payments={data.payments.filter((p) => p.lease_id === lease.id)}
        />
      ))}
    </div>
  )
}

function PhoneCard({ tenant, onSaved }: { tenant: TenantRow; onSaved: () => Promise<void> }) {
  const [phone, setPhone] = useState(tenant.phone ?? '')
  const [busy, setBusy] = useState(false)
  const invalid = phone.trim() !== '' && !PHONE_RE.test(phone.trim())

  async function save() {
    if (invalid) {
      toast.error('Enter a phone number such as +60 12-345 6789')
      return
    }
    setBusy(true)
    const value = phone.trim() === '' ? null : phone.trim()
    const { error } = await createClient().from('tenants').update({ phone: value }).eq('id', tenant.id)
    setBusy(false)
    if (error) {
      toast.error(`Could not save your phone number: ${error.message}`)
      return
    }
    toast.success('Phone number saved')
    await onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tenant.full_name}</CardTitle>
        <CardDescription>{tenant.email}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" value={phone} placeholder="+60 12-345 6789" onChange={(e) => setPhone(e.target.value)} aria-invalid={invalid} />
        </div>
        <Button onClick={save} disabled={busy || invalid}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {invalid ? <p className="w-full text-sm text-destructive">Use digits, spaces and dashes, optionally starting with +.</p> : null}
      </CardContent>
    </Card>
  )
}

function LeaseCard({ lease, invoices, payments }: { lease: LeaseRow; invoices: InvoiceRow[]; payments: PaymentRow[] }) {
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const now = new Date()
  const today = malaysiaDate(now)
  const rows = invoices
    .map((i) => ({ ...i, paidSen: i.payment_allocations.reduce((s, a) => s + a.amount_sen, 0) }))
    .sort((a, b) =>
      compareAllocationOrder(
        { id: a.id, kind: a.kind, periodIndex: a.period_index, dueDate: a.due_date, amountSen: 0n, paidSen: 0n },
        { id: b.id, kind: b.kind, periodIndex: b.period_index, dueDate: b.due_date, amountSen: 0n, paidSen: 0n },
      ),
    )
  const dueNow = rows.filter((i) => i.due_date <= today).reduce((s, i) => s + Math.max(i.amount_sen - i.paidSen, 0), 0)

  async function payNow() {
    setBusy(true)
    const result = await postJson<{ billId: string; amountSen: number }>(`/api/leases/${lease.id}/gateway-bills`)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setBill(result.data)
    toast.success('Payment bill created')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unit {lease.units?.name}</CardTitle>
        <CardDescription>
          {formatDate(lease.start_date)} to {formatDate(lease.end_date)} · {formatSen(lease.monthly_rent_sen)} per month
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Amount due now</div>
            <div className="text-2xl font-semibold">{formatSen(dueNow)}</div>
          </div>
          <Button onClick={payNow} disabled={busy || dueNow === 0}>
            {busy ? 'Creating bill…' : 'Pay now'}
          </Button>
          {dueNow === 0 ? <span className="text-sm text-muted-foreground">Nothing is due right now.</span> : null}
        </div>
        {bill ? (
          <div className="rounded-md border p-4 text-sm">
            <p>
              Gateway bill <code className="font-mono">{bill.billId}</code> for {formatSen(bill.amountSen)}.
            </p>
            <p className="text-muted-foreground">
              In production you would now be redirected to the payment gateway. Simulate it with:{' '}
              <code className="font-mono">
                node gateway-sim.mjs {bill.billId} {bill.amountSen}
              </code>
            </p>
            <Link href={`/payments/return?bill_id=${bill.billId}`} className="underline underline-offset-4">
              Check the bill status
            </Link>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  {i.kind === 'deposit' ? 'Deposit' : `Rent: ${formatDate(i.period_start!)} to ${formatDate(i.period_end!)}`}
                </TableCell>
                <TableCell>{formatDate(i.due_date)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatSen(i.amount_sen)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatSen(i.paidSen)}</TableCell>
                <TableCell>
                  <StatusBadge status={invoiceStatus({ dueDate: i.due_date, amountSen: i.amount_sen, paidSen: i.paidSen }, now)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div>
          <h3 className="mb-2 font-medium">Payments</h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received (MYT)</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatMytDateTime(p.received_at)}</TableCell>
                    <TableCell>{METHODS[p.method] ?? p.method}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSen(p.amount_sen)}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
