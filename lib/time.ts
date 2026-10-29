// Malaysia time helpers (UTC+8 all year, no daylight saving). Pure, and independent of the timezone of the
// server or the browser: everything is done with UTC arithmetic plus the fixed offset.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// ISO 8601 instant that must carry an offset (Z or ±HH:MM), e.g. 2026-03-01T00:30:00+08:00.
// Without an offset the instant would depend on the server's timezone, so it is rejected.
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/i

export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const m = INSTANT_RE.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]))
  const s = m[6] ? Number(m[6]) : 0
  if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || s > 59) return null
  let offsetMinutes = 0
  if (m[8].toUpperCase() !== 'Z') {
    const oh = Number(m[10])
    const om = Number(m[11])
    if (oh > 14 || om > 59) return null
    offsetMinutes = (m[9] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMinutes * 60_000)
}

// Gateway format: '2026-04-01 00:30:12 +0800'. ISO 8601 with an offset is accepted too.
const GATEWAY_TIME_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/

export function parseGatewayTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const m = GATEWAY_TIME_RE.exec(value)
  return m ? parseInstant(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : parseInstant(value)
}

// '2026-03-01T00:30:00+08:00': the API's instant format.
export function toMytIso(instant: Date): string {
  return `${new Date(instant.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 19)}+08:00`
}

// '2026-03-01 00:30' for display, in Malaysia time whatever the viewer's timezone.
export function formatMytDateTime(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  return new Date(date.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

// '2026-01-31' -> '31 Jan 2026'. Calendar dates have no timezone; this is plain string formatting.
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`
}

// '2026-03' -> 'Mar 2026'
export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

// Prisma maps Postgres `date` to a Date at UTC midnight; these convert both ways without any local time.
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function dbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const MAX_REPORT_MONTHS = 120

// Every month from `from` to `to` inclusive ('YYYY-MM'), or null for an invalid or oversized range.
export function monthRange(from: unknown, to: unknown): string[] | null {
  const a = typeof from === 'string' ? MONTH_RE.exec(from) : null
  const b = typeof to === 'string' ? MONTH_RE.exec(to) : null
  if (!a || !b) return null
  const start = Number(a[1]) * 12 + Number(a[2]) - 1
  const end = Number(b[1]) * 12 + Number(b[2]) - 1
  if (end < start || end - start >= MAX_REPORT_MONTHS) return null
  const months: string[] = []
  for (let i = start; i <= end; i++) months.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
  return months
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y * 12 + m - 1 + delta
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

// The instant a Malaysia calendar month starts: 2026-03 -> 2026-02-28T16:00:00.000Z.
export function mytMonthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00+08:00`)
}
