import { findPaymentForCaller, requireRole } from '@/lib/server/caller'
import { getCaller } from '@/lib/server/auth'
import { handle, notFound } from '@/lib/server/http'
import { signedSlipUrl } from '@/lib/server/slips'

// Redirects staff and managers to a 60-second signed URL for the payment's slip. Tenants cannot read slips.
export async function GET(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  return handle(async () => {
    const caller = await getCaller(req)
    const { paymentId } = await params
    const payment = await findPaymentForCaller(caller, paymentId)
    requireRole(caller, 'manager', 'staff')
    if (!payment.slip_path) throw notFound('This payment has no slip')
    return Response.redirect(await signedSlipUrl(payment.slip_path), 302)
  })
}
