import Link from 'next/link'
import { redirect } from 'next/navigation'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSen } from '@/lib/money'
import { getPageCaller } from '@/lib/server/auth'
import { getBillForCaller } from '@/lib/server/gateway'

const MESSAGES: Record<string, string> = {
  paid: 'Your payment has been received. Thank you.',
  failed: 'The payment did not go through. You can try again from your account.',
  pending: 'We have not had confirmation from the payment gateway yet. Refresh this page in a moment.',
}

// Shows the bill's real status from the database. It never changes anything: the `paid` query parameter is
// ignored, and only the signed webhook (/api/webhooks/gateway) can settle a bill.
export default async function PaymentReturnPage({ searchParams }: PageProps<'/payments/return'>) {
  const caller = await getPageCaller()
  if (!caller) redirect('/login')
  const { bill_id: billId } = await searchParams
  const bill = typeof billId === 'string' ? await getBillForCaller(caller, billId) : null

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Payment status</CardTitle>
          <CardDescription>{bill ? <code className="font-mono text-xs">{bill.id}</code> : 'Bill not found'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bill ? (
            <>
              <div className="flex items-center gap-3">
                <StatusBadge status={bill.status} />
                <span className="font-semibold">{formatSen(bill.amountSen)}</span>
              </div>
              <p className="text-sm">{MESSAGES[bill.status]}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">We could not find this payment on your account.</p>
          )}
          <Link href="/" className="text-sm underline underline-offset-4">
            Back to my account
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
