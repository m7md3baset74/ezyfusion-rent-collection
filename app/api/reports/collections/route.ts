import { getCaller } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import { collectionsReport } from '@/lib/server/reports'

export async function GET(req: Request) {
  return handle(async () => {
    const caller = await getCaller(req)
    const url = new URL(req.url)
    return json(await collectionsReport(caller, url.searchParams.get('from'), url.searchParams.get('to')))
  })
}
