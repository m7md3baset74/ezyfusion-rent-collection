import { getCaller } from '@/lib/server/auth'
import { handle, json, readJson } from '@/lib/server/http'
import { rejectPayment } from '@/lib/server/payments'

export async function POST(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  return handle(async () => {
    const caller = await getCaller(req)
    const { paymentId } = await params
    return json(await rejectPayment(caller, paymentId, await readJson(req)))
  })
}
