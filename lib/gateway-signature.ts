// Gateway webhook signature (brief §5). Pure, so it can be unit-tested against the brief's test vector.
import { createHmac, timingSafeEqual } from 'node:crypto'

// Every field except x_signature, sorted by key (character code order), as key+value, joined with '|'.
export function signatureSource(fields: [string, string][]): string {
  return fields
    .filter(([key]) => key !== 'x_signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}${value}`)
    .join('|')
}

export function computeSignature(fields: [string, string][], key: string): string {
  return createHmac('sha256', key).update(signatureSource(fields)).digest('hex')
}

// Constant-time comparison; anything that is not 64 hex characters is simply invalid.
export function signatureIsValid(fields: [string, string][], provided: string | undefined, key: string): boolean {
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false
  return timingSafeEqual(Buffer.from(computeSignature(fields, key), 'hex'), Buffer.from(provided, 'hex'))
}
