import { describe, expect, it } from 'vitest'
import { computeSignature, signatureIsValid, signatureSource } from '../lib/gateway-signature'

// The brief's test vector (fields deliberately out of order).
const fields: [string, string][] = [
  ['transaction_status', 'completed'],
  ['id', 'bill_8f3a2c'],
  ['paid_amount', '210050'],
  ['paid', 'true'],
  ['transaction_id', 'TX-000123'],
  ['paid_at', '2026-04-01 00:30:12 +0800'],
]
const SIGNATURE = '06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641'

describe('gateway signature', () => {
  it('builds the source string from sorted fields', () => {
    expect(signatureSource([...fields, ['x_signature', 'ignored']])).toBe(
      'idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted',
    )
  })

  it('matches the test vector', () => {
    expect(computeSignature(fields, 'test_x_signature_key')).toBe(SIGNATURE)
    expect(signatureIsValid(fields, SIGNATURE, 'test_x_signature_key')).toBe(true)
  })

  it('rejects wrong, missing, malformed or other-key signatures, and signs unknown fields', () => {
    expect(signatureIsValid(fields, SIGNATURE.replace(/^0/, '1'), 'test_x_signature_key')).toBe(false)
    expect(signatureIsValid(fields, undefined, 'test_x_signature_key')).toBe(false)
    expect(signatureIsValid(fields, 'abc', 'test_x_signature_key')).toBe(false)
    expect(signatureIsValid(fields, SIGNATURE, 'another_key')).toBe(false)
    expect(signatureIsValid([...fields, ['new_field', 'x']], SIGNATURE, 'test_x_signature_key')).toBe(false)
  })
})
