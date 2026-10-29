import { getCaller } from '@/lib/server/auth'
import { createGatewayBill } from '@/lib/server/gateway'
import { handle, json } from '@/lib/server/http'

export async function POST(req: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  return handle(async () => {
    const caller = await getCaller(req)
    const { leaseId } = await params
    return json(await createGatewayBill(caller, leaseId), 201)
  })
}
