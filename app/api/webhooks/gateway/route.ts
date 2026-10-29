import { handleGatewayCallback } from '@/lib/server/gateway'
import { handle, json } from '@/lib/server/http'

// Called by the payment gateway (form-urlencoded, signed). The only code path that settles a bill.
export async function POST(req: Request) {
  return handle(async () => {
    const result = await handleGatewayCallback(await req.text())
    return json(result.body, result.status)
  })
}
