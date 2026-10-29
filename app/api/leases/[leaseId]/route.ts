import { getCaller } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import { getLeaseView } from '@/lib/server/leases'

export async function GET(req: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  return handle(async () => {
    const caller = await getCaller(req)
    const { leaseId } = await params
    return json(await getLeaseView(caller, leaseId))
  })
}
