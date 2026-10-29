import { getCaller } from '@/lib/server/auth'
import { handle, json, readJson } from '@/lib/server/http'
import { recordPayment } from '@/lib/server/payments'

export async function POST(req: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  return handle(async () => {
    const caller = await getCaller(req)
    const { leaseId } = await params
    return json(await recordPayment(caller, leaseId, await readJson(req)), 201)
  })
}
