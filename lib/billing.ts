// Billing rules (brief §3). Pure: no I/O, no framework imports, and no use of the machine's
// timezone. Calendar dates are handled as day numbers (days since 1970-01-01) computed with
// integer arithmetic, and "now" is turned into a Malaysia date by adding the fixed +8h offset.

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string // 'YYYY-MM-DD'
  amountSen: number // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

// Malaysia is UTC+8 all year (no daylight saving), so a fixed offset is exact.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

interface CivilDate {
  y: number
  m: number // 1-12
  d: number
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

function parseDate(value: unknown, field: string): CivilDate {
  const match = typeof value === 'string' ? DATE_RE.exec(value) : null
  if (!match) throw new Error(`${field} must be a date written as YYYY-MM-DD`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`${field} is not a real calendar date`)
  }
  return { y, m, d }
}

// Days since 1970-01-01 (Howard Hinnant's days_from_civil). Avoids Date.UTC, which maps years 0-99 to 19xx.
function toDayNumber({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = (m + 9) % 12 // March = 0
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function fromDayNumber(dayNumber: number): CivilDate {
  const z = dayNumber + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

function formatDayNumber(dayNumber: number): string {
  const { y, m, d } = fromDayNumber(dayNumber)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Start date plus k calendar months, clamped to the last day of a shorter month.
function addMonths(start: CivilDate, k: number): CivilDate {
  const monthIndex = start.m - 1 + k
  const y = start.y + Math.floor(monthIndex / 12)
  const m = (monthIndex % 12) + 1
  return { y, m, d: Math.min(start.d, daysInMonth(y, m)) }
}

// rent x used / full, rounded half up, in BigInt so large rents cannot lose precision.
function prorate(rentSen: number, usedDays: number, fullDays: number): number {
  const numerator = BigInt(rentSen) * BigInt(usedDays) * 2n + BigInt(fullDays)
  return Number(numerator / (2n * BigInt(fullDays)))
}

export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, 'startDate')
  const end = parseDate(lease.endDate, 'endDate')
  const startDay = toDayNumber(start)
  const endDay = toDayNumber(end)
  if (endDay < startDay) throw new Error('endDate is before startDate')
  if (!Number.isSafeInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer')
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error('depositSen must be a non-negative integer')
  }

  const schedule: ScheduledInvoice[] = []
  if (lease.depositSen > 0) {
    schedule.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: formatDayNumber(startDay),
      amountSen: lease.depositSen,
    })
  }

  // Every anchor is counted from the start date, never from the previous anchor.
  for (let k = 0; ; k++) {
    const anchor = toDayNumber(addMonths(start, k))
    if (anchor > endDay) break
    const nextAnchor = toDayNumber(addMonths(start, k + 1))
    const periodEnd = Math.min(nextAnchor - 1, endDay)
    const fullDays = nextAnchor - anchor
    const usedDays = periodEnd - anchor + 1
    schedule.push({
      kind: 'rent',
      periodIndex: k,
      periodStart: formatDayNumber(anchor),
      periodEnd: formatDayNumber(periodEnd),
      dueDate: formatDayNumber(anchor),
      amountSen: usedDays === fullDays ? lease.monthlyRentSen : prorate(lease.monthlyRentSen, usedDays, fullDays),
    })
  }
  return schedule
}

// Today's calendar date in Malaysia ('YYYY-MM-DD') for an instant, whatever the machine's timezone.
export function malaysiaDate(now: Date): string {
  const ms = now.getTime()
  if (!Number.isFinite(ms)) throw new Error('Invalid date')
  return formatDayNumber(Math.floor((ms + MYT_OFFSET_MS) / DAY_MS))
}

export function invoiceStatus(invoice: { dueDate: string; amountSen: number; paidSen: number }, now: Date): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid'
  // 'YYYY-MM-DD' strings compare in calendar order.
  if (malaysiaDate(now) > invoice.dueDate) return 'overdue'
  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// Digits with optional comma thousands separators (groups of exactly 3), then an optional 1-2 digit decimal part.
const RINGGIT_RE = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parseRinggitToSen(input: string): number {
  const match = typeof input === 'string' ? RINGGIT_RE.exec(input.trim()) : null
  if (!match) throw new Error('Enter an amount in ringgit, for example 1,500.00')
  const sen = BigInt(match[1].replaceAll(',', '')) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (sen > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return Number(sen)
}
