'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseRinggitToSen } from '@/lib/billing'
import { postJson } from '@/lib/client/api'
import { formatSen } from '@/lib/money'
import { createClient } from '@/lib/supabase/browser'

const SLIP_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const MAX_SLIP_BYTES = 5 * 1024 * 1024

interface Props {
  leaseId: string
  orgId: string
  role: 'manager' | 'staff'
  today: string // Malaysia date, computed on the server so server and client render the same value
  nowTime: string // Malaysia 'HH:mm'
  capSen: number
}

export function RecordPaymentForm({ leaseId, orgId, role, today, nowTime, capSen }: Props) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState(nowTime)
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function fail(message: string) {
    setError(message)
    toast.error(message)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let amountSen: number
    try {
      amountSen = parseRinggitToSen(amount)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Invalid amount')
    }
    if (amountSen <= 0) return fail('The amount must be more than RM 0.00')
    if (amountSen > capSen) return fail(`The amount is more than this lease can take now (${formatSen(Math.max(capSen, 0))})`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return fail('Enter the date and time the money was received')
    // The inputs are Malaysia time whatever the browser's timezone, so the offset is fixed here.
    const receivedAt = `${date}T${time}:00+08:00`

    setBusy(true)
    let slipPath: string | undefined
    if (method === 'bank_transfer') {
      if (!file) {
        setBusy(false)
        return fail('A bank transfer needs a slip (JPEG, PNG or PDF)')
      }
      const ext = SLIP_TYPES[file.type]
      if (!ext) {
        setBusy(false)
        return fail('The slip must be a JPEG, PNG or PDF file')
      }
      if (file.size > MAX_SLIP_BYTES) {
        setBusy(false)
        return fail('The slip must be 5 MB or smaller')
      }
      slipPath = `${orgId}/${crypto.randomUUID()}.${ext}`
      const upload = await createClient().storage.from('payment-slips').upload(slipPath, file, { contentType: file.type })
      if (upload.error) {
        setBusy(false)
        return fail(`Slip upload failed: ${upload.error.message}`)
      }
    }

    // If this fails after the upload, the server deletes the slip.
    const result = await postJson<{ id: string; status: string }>(`/api/leases/${leaseId}/payments`, { amountSen, method, receivedAt, slipPath })
    setBusy(false)
    if (!result.ok) return fail(result.error)
    toast.success(result.data.status === 'approved' ? 'Payment recorded and approved' : 'Payment recorded; it is waiting for a manager to approve it')
    setAmount('')
    setFile(null)
    setFileKey((k) => k + 1)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a payment</CardTitle>
        <CardDescription>
          {role === 'manager' ? 'Payments you record are approved immediately.' : 'Payments you record wait for a manager to approve them.'} Up to{' '}
          {formatSen(Math.max(capSen, 0))} can be recorded now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (RM)</Label>
            <Input id="amount" inputMode="decimal" placeholder="1,500.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error !== null} />
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <div className="flex gap-2">
              <Button type="button" variant={method === 'cash' ? 'default' : 'outline'} onClick={() => setMethod('cash')}>
                Cash
              </Button>
              <Button type="button" variant={method === 'bank_transfer' ? 'default' : 'outline'} onClick={() => setMethod('bank_transfer')}>
                Bank transfer
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date received (Malaysia time)</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="time">Time received (Malaysia time)</Label>
            <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          {method === 'bank_transfer' ? (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="slip">Slip (JPEG, PNG or PDF, max 5 MB)</Label>
              <Input key={fileKey} id="slip" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
