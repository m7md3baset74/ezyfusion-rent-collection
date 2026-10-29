'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { generateSchedule, parseRinggitToSen, type ScheduledInvoice } from '@/lib/billing'
import { postJson } from '@/lib/client/api'
import { formatSen } from '@/lib/money'
import { formatDate } from '@/lib/time'

interface Option {
  id: string
  name: string
}

// The preview runs the same generateSchedule the server uses, so what you see is what gets stored.
// The server validates everything again (role, organization of the unit and tenant, overlaps).
export function CreateLeaseForm({ units, tenants }: { units: Option[]; tenants: Option[] }) {
  const router = useRouter()
  const [unitId, setUnitId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useMemo((): { schedule: ScheduledInvoice[]; input: Record<string, string | number> } | { error: string } | null => {
    if (!startDate || !endDate || !rent.trim()) return null
    try {
      const monthlyRentSen = parseRinggitToSen(rent)
      const depositSen = deposit.trim() === '' ? 0 : parseRinggitToSen(deposit)
      const input = { startDate, endDate, monthlyRentSen, depositSen }
      return { schedule: generateSchedule(input), input }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid lease' }
    }
  }, [startDate, endDate, rent, deposit])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!unitId || !tenantId) {
      toast.error('Choose a unit and a tenant')
      return
    }
    if (!preview || 'error' in preview) {
      toast.error(preview ? preview.error : 'Enter the dates and the monthly rent')
      return
    }
    setBusy(true)
    const result = await postJson<{ id: string }>('/api/leases', { unitId, tenantId, ...preview.input })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Lease created')
    router.push(`/leases/${result.data.id}`)
  }

  const total = preview && 'schedule' in preview ? preview.schedule.reduce((s, i) => s + i.amountSen, 0) : 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New lease</CardTitle>
          <CardDescription>Dates are Malaysia calendar dates; both are inclusive.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select items={units.map((u) => ({ value: u.id, label: u.name }))} value={unitId} onValueChange={(v) => setUnitId(typeof v === 'string' ? v : '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a unit" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tenant</Label>
              <Select items={tenants.map((t) => ({ value: t.id, label: t.name }))} value={tenantId} onValueChange={(v) => setTenantId(typeof v === 'string' ? v : '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="start">Start date</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End date (tenant&apos;s last day)</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rent">Monthly rent (RM)</Label>
              <Input id="rent" inputMode="decimal" placeholder="1,500.00" value={rent} onChange={(e) => setRent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deposit">Deposit (RM, optional)</Label>
              <Input id="deposit" inputMode="decimal" placeholder="3,000.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || !preview || 'error' in preview}>
                {busy ? 'Creating…' : 'Create lease'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule preview</CardTitle>
          <CardDescription>{preview && 'schedule' in preview ? `${preview.schedule.length} invoices, ${formatSen(total)} in total` : 'Updates as you type'}</CardDescription>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <p className="text-sm text-muted-foreground">Enter the dates and the monthly rent to see the invoices.</p>
          ) : 'error' in preview ? (
            <p className="text-sm text-destructive">{preview.error}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.schedule.map((i) => (
                  <TableRow key={`${i.kind}-${i.periodIndex ?? 'd'}`}>
                    <TableCell>{i.kind === 'deposit' ? 'Deposit' : `Rent ${i.periodIndex! + 1}`}</TableCell>
                    <TableCell>{i.periodStart ? `${formatDate(i.periodStart)} to ${formatDate(i.periodEnd!)}` : ''}</TableCell>
                    <TableCell>{formatDate(i.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSen(i.amountSen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
