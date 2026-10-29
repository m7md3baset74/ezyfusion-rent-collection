import { describe, expect, it } from 'vitest'
import { generateSchedule, invoiceStatus, malaysiaDate, parseRinggitToSen } from '../lib/billing'

const rent = (s: ReturnType<typeof generateSchedule>) => s.filter((i) => i.kind === 'rent')

describe('generateSchedule', () => {
  it('matches the worked example (Aisyah)', () => {
    const s = generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 })
    expect(s).toEqual([
      { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-01-31', amountSen: 300000 },
      { kind: 'rent', periodIndex: 0, periodStart: '2026-01-31', periodEnd: '2026-02-27', dueDate: '2026-01-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 1, periodStart: '2026-02-28', periodEnd: '2026-03-30', dueDate: '2026-02-28', amountSen: 150000 },
      { kind: 'rent', periodIndex: 2, periodStart: '2026-03-31', periodEnd: '2026-04-29', dueDate: '2026-03-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 3, periodStart: '2026-04-30', periodEnd: '2026-05-30', dueDate: '2026-04-30', amountSen: 150000 },
      { kind: 'rent', periodIndex: 4, periodStart: '2026-05-31', periodEnd: '2026-06-29', dueDate: '2026-05-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 5, periodStart: '2026-06-30', periodEnd: '2026-07-15', dueDate: '2026-06-30', amountSen: 77419 },
    ])
  })

  it('omits the deposit when it is 0', () => {
    const s = generateSchedule({ startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0 })
    expect(s.map((i) => i.kind)).toEqual(['rent', 'rent', 'rent', 'rent'])
    // Period 3: 2026-04-01..2026-04-15 = 15 of 30 days: 100029 * 15 / 30 = 50014.5 -> 50015 (half up)
    expect(s[3]).toMatchObject({ periodStart: '2026-04-01', periodEnd: '2026-04-15', amountSen: 50015 })
  })

  it('uses Feb 29 as an anchor in leap years and counts anchors from the start', () => {
    const s = rent(generateSchedule({ startDate: '2028-01-31', endDate: '2028-05-30', monthlyRentSen: 1000, depositSen: 0 }))
    expect(s.map((i) => i.dueDate)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
    expect(s[3]).toMatchObject({ periodEnd: '2028-05-30', amountSen: 1000 }) // full period, no proration
  })

  it('handles a leap-day start', () => {
    const s = rent(generateSchedule({ startDate: '2028-02-29', endDate: '2029-03-28', monthlyRentSen: 1000, depositSen: 0 }))
    expect(s[11].dueDate).toBe('2029-01-29')
    expect(s[12]).toMatchObject({ dueDate: '2029-02-28', periodStart: '2029-02-28', periodEnd: '2029-03-28', amountSen: 1000 })
  })

  it('makes a one-day lease a single prorated period', () => {
    const s = generateSchedule({ startDate: '2026-03-15', endDate: '2026-03-15', monthlyRentSen: 310000, depositSen: 0 })
    expect(s).toEqual([
      { kind: 'rent', periodIndex: 0, periodStart: '2026-03-15', periodEnd: '2026-03-15', dueDate: '2026-03-15', amountSen: 10000 },
    ])
  })

  it('creates a one-day last period when endDate is an anchor', () => {
    const s = rent(generateSchedule({ startDate: '2026-01-10', endDate: '2026-03-10', monthlyRentSen: 2800, depositSen: 0 }))
    expect(s).toHaveLength(3)
    // 2026-03-10..2026-04-09 is 31 days: 2800 / 31 = 90.32 -> 90
    expect(s[2]).toMatchObject({ periodStart: '2026-03-10', periodEnd: '2026-03-10', amountSen: 90 })
  })

  it('rounds exactly half up', () => {
    const s = generateSchedule({ startDate: '2026-04-01', endDate: '2026-04-15', monthlyRentSen: 1, depositSen: 0 })
    expect(s[0].amountSen).toBe(1) // 1 x 15 / 30 = 0.5 -> 1
  })

  it('handles multi-year leases and year rollover', () => {
    const s = rent(generateSchedule({ startDate: '2026-11-30', endDate: '2028-11-29', monthlyRentSen: 500, depositSen: 0 }))
    expect(s).toHaveLength(24)
    expect(s[3]).toMatchObject({ periodStart: '2027-02-28', periodEnd: '2027-03-29' })
    expect(s[15]).toMatchObject({ periodStart: '2028-02-29', periodEnd: '2028-03-29' })
    expect(s.every((i) => i.amountSen === 500)).toBe(true)
  })

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-13-01', '2027-01-01'],
    ['2026-1-05', '2026-03-01'],
    [' 2026-01-05', '2026-03-01'],
    ['2026-01-05T00:00:00Z', '2026-03-01'],
    ['2025-02-29', '2025-03-01'],
    ['2026-01-01', '2026-00-10'],
    ['', '2026-01-01'],
  ])('rejects invalid dates %s / %s', (startDate, endDate) => {
    expect(() => generateSchedule({ startDate, endDate, monthlyRentSen: 100, depositSen: 0 })).toThrow(Error)
  })

  it('rejects endDate before startDate', () => {
    expect(() => generateSchedule({ startDate: '2026-02-01', endDate: '2026-01-31', monthlyRentSen: 100, depositSen: 0 })).toThrow(Error)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('rejects monthlyRentSen %s', (monthlyRentSen) => {
    expect(() => generateSchedule({ startDate: '2026-01-01', endDate: '2026-02-01', monthlyRentSen, depositSen: 0 })).toThrow(Error)
  })

  it.each([-1, 0.5, Number.NaN])('rejects depositSen %s', (depositSen) => {
    expect(() => generateSchedule({ startDate: '2026-01-01', endDate: '2026-02-01', monthlyRentSen: 100, depositSen })).toThrow(Error)
  })

  it('rejects non-number amounts passed from untyped callers', () => {
    const lease = { startDate: '2026-01-01', endDate: '2026-02-01', monthlyRentSen: '100', depositSen: 0 } as unknown as Parameters<typeof generateSchedule>[0]
    expect(() => generateSchedule(lease)).toThrow(Error)
  })
})

describe('invoiceStatus', () => {
  const due = { dueDate: '2026-03-01', amountSen: 1000 }
  it('becomes overdue exactly at Malaysia midnight after the due date', () => {
    expect(invoiceStatus({ ...due, paidSen: 0 }, new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid')
    expect(invoiceStatus({ ...due, paidSen: 0 }, new Date('2026-03-01T16:00:00.000Z'))).toBe('overdue')
  })
  it('applies the rules in order', () => {
    const late = new Date('2026-04-01T00:00:00Z')
    const early = new Date('2026-02-01T00:00:00Z')
    expect(invoiceStatus({ ...due, paidSen: 1000 }, late)).toBe('paid')
    expect(invoiceStatus({ ...due, paidSen: 1200 }, late)).toBe('paid')
    expect(invoiceStatus({ ...due, paidSen: 500 }, late)).toBe('overdue')
    expect(invoiceStatus({ ...due, paidSen: 500 }, early)).toBe('partially_paid')
    expect(invoiceStatus({ ...due, paidSen: 0 }, early)).toBe('unpaid')
  })
  it('converts instants to Malaysia dates', () => {
    expect(malaysiaDate(new Date('2026-02-28T16:30:00Z'))).toBe('2026-03-01')
    expect(malaysiaDate(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    expect(malaysiaDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
  })
})

describe('parseRinggitToSen', () => {
  it.each([
    ['1,500.50', 150050],
    ['1.15', 115],
    ['7', 700],
    ['1.5', 150],
    ['0', 0],
    ['1234', 123400],
    ['1,234,567.89', 123456789],
    ['  12.30 ', 1230],
    ['007', 700],
  ])('parses %j', (input, expected) => {
    expect(parseRinggitToSen(input)).toBe(expected)
  })

  it.each(['', ' ', '-5', '1.234', '1e3', 'RM 10', '1,23', '1,5000', '12,34', ',500', '.5', '5.', '1 000', '+5', '1,000,00', '1..5', '99999999999999999', 'NaN'])(
    'rejects %j',
    (input) => {
      expect(() => parseRinggitToSen(input)).toThrow(Error)
    },
  )
})
