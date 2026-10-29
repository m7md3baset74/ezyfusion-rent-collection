// 150050 -> 'RM 1,500.50'. Integer formatting only, so the output never depends on the locale.
export function formatSen(sen: number | bigint): string {
  const value = BigInt(sen)
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}RM ${whole}.${cents}`
}

// bigint sen from Postgres -> number for JSON. Amounts are far below 2^53, but fail loudly if not.
export function senToNumber(sen: bigint): number {
  if (sen > BigInt(Number.MAX_SAFE_INTEGER) || sen < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount out of range')
  }
  return Number(sen)
}
