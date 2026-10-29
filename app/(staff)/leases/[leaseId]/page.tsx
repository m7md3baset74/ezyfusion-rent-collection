import { PaymentActions } from '@/components/app/payment-actions'
import { RecordPaymentForm } from '@/components/app/record-payment-form'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { malaysiaDate } from '@/lib/billing'
import { formatSen } from '@/lib/money'
import { getLeaseView } from '@/lib/server/leases'
import { orNotFound, requireStaffPage } from '@/lib/server/pages'
import { formatDate, formatMytDateTime, toMytIso } from '@/lib/time'

const METHODS = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' } as const

export default async function LeasePage({ params }: PageProps<'/leases/[leaseId]'>) {
  const caller = await requireStaffPage()
  const { leaseId } = await params
  const view = await orNotFound(getLeaseView(caller, leaseId))
  const { lease } = view
  const now = new Date()
  const pendingSen = view.payments.filter((p) => p.status === 'pending_verification').reduce((s, p) => s + p.amountSen, 0)

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">
          {lease.unitName} · {lease.tenantName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(lease.startDate)} to {formatDate(lease.endDate)} · {formatSen(lease.monthlyRentSen)} per month
          {lease.depositSen > 0 ? ` · deposit ${formatSen(lease.depositSen)}` : ''}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Remaining balance</CardDescription>
            <CardTitle className="text-2xl">{formatSen(view.remainingSen)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Due now</CardDescription>
            <CardTitle className="text-2xl">{formatSen(view.amountDueNowSen)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Pending verification</CardDescription>
            <CardTitle className="text-2xl">{formatSen(pendingSen)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.kind === 'deposit' ? 'Deposit' : `Rent ${i.periodIndex! + 1}: ${formatDate(i.periodStart!)} to ${formatDate(i.periodEnd!)}`}
                  </TableCell>
                  <TableCell>{formatDate(i.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSen(i.amountSen)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSen(i.paidSen)}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {view.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received (MYT)</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slip</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatMytDateTime(p.receivedAt)}</TableCell>
                    <TableCell>{METHODS[p.method]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSen(p.amountSen)}
                      {p.unappliedSen > 0 ? <div className="text-xs text-muted-foreground">{formatSen(p.unappliedSen)} unapplied</div> : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                      {p.decisionReason ? <div className="text-xs text-muted-foreground">{p.decisionReason}</div> : null}
                    </TableCell>
                    <TableCell>
                      {p.hasSlip ? (
                        <a href={`/api/payments/${p.id}/slip`} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
                          View slip
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {caller.role === 'manager' ? <PaymentActions paymentId={p.id} status={p.status} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RecordPaymentForm
        leaseId={lease.id}
        orgId={caller.orgId}
        role={caller.role}
        today={malaysiaDate(now)}
        nowTime={toMytIso(now).slice(11, 16)}
        capSen={view.remainingSen - pendingSen}
      />
    </>
  )
}
