'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/client/api'

// Manager actions on one payment. The buttons are a convenience; the API checks the role and status again.
export function PaymentActions({ paymentId, status }: { paymentId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run(action: 'approve' | 'reject' | 'void', reason?: string): Promise<boolean> {
    setBusy(true)
    const result = await postJson<{ status: string }>(`/api/payments/${paymentId}/${action}`, reason === undefined ? undefined : { reason })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    toast.success(`Payment ${result.data.status}`)
    router.refresh()
    return true
  }

  if (status === 'pending_verification') {
    return (
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => run('approve')}>
          Approve
        </Button>
        <ReasonDialog label="Reject" title="Reject this payment?" description="The payment stays on record as rejected." busy={busy} onConfirm={(r) => run('reject', r)} />
      </div>
    )
  }
  if (status === 'approved') {
    return (
      <ReasonDialog
        label="Void"
        title="Void this payment?"
        description="Its allocations are removed and the invoices it paid reopen. This cannot be undone."
        destructive
        busy={busy}
        onConfirm={(r) => run('void', r)}
      />
    )
  }
  return null
}

function ReasonDialog(props: {
  label: string
  title: string
  description: string
  destructive?: boolean
  busy: boolean
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const tooShort = reason.trim().length < 5

  async function confirm() {
    if (tooShort) return
    if (await props.onConfirm(reason.trim())) {
      setOpen(false)
      setReason('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={props.destructive ? 'destructive' : 'outline'} />}>{props.label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`reason-${props.label}`}>Reason (at least 5 characters)</Label>
          <Textarea id={`reason-${props.label}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          {reason.length > 0 && tooShort ? <p className="text-sm text-destructive">The reason must be at least 5 characters.</p> : null}
        </div>
        <DialogFooter>
          <Button variant={props.destructive ? 'destructive' : 'default'} disabled={props.busy || tooShort} onClick={confirm}>
            {props.busy ? 'Working…' : `${props.label} payment`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
