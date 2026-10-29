// Bank transfer slips in the private payment-slips bucket, at <org_id>/<file>.
import { prisma } from '../prisma'
import { adminClient } from '../supabase/admin'

export const SLIP_BUCKET = 'payment-slips'

export function isSlipPathInOrg(orgId: string, path: string): boolean {
  return path.startsWith(`${orgId}/`) && /^[^/]+\/[^/]+$/.test(path) && !path.includes('..')
}

export async function slipExists(path: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM storage.objects WHERE bucket_id = ${SLIP_BUCKET} AND name = ${path}`
  return (rows[0]?.n ?? 0n) > 0n
}

// Called when recording a payment fails after the slip was uploaded. Deletes the file only if it is in the
// caller's own organization folder and no payment uses it, so a bad request cannot remove someone else's slip.
export async function discardOrphanSlip(orgId: string, path: string): Promise<void> {
  try {
    if (!isSlipPathInOrg(orgId, path)) return
    if ((await prisma.payments.count({ where: { slip_path: path } })) > 0) return
    const { error } = await adminClient().storage.from(SLIP_BUCKET).remove([path])
    if (error) console.error('Could not delete orphaned slip:', error.message)
  } catch (error) {
    console.error('Could not delete orphaned slip:', error instanceof Error ? error.message : 'unknown error')
  }
}

// Short-lived link, created only after the caller's access to the payment has been checked.
export async function signedSlipUrl(path: string): Promise<string> {
  const { data, error } = await adminClient().storage.from(SLIP_BUCKET).createSignedUrl(path, 60)
  if (error || !data) throw new Error('Could not sign slip URL')
  return data.signedUrl
}
