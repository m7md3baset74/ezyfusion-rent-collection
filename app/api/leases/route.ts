import { getCaller } from '@/lib/server/auth'
import { handle, json, readJson } from '@/lib/server/http'
import { createLease } from '@/lib/server/leases'

export async function POST(req: Request) {
  return handle(async () => {
    const caller = await getCaller(req)
    return json(await createLease(caller, await readJson(req)), 201)
  })
}
