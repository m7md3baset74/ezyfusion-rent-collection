import { describe, expect, it } from 'vitest'
import { amountDueNow, planAllocation, remainingBalance, type InvoiceBalance } from '../lib/allocation'

const inv = (id: string, kind: 'deposit' | 'rent', periodIndex: number | null, dueDate: string, amount: number, paid = 0): InvoiceBalance => ({
  id,
  kind,
  periodIndex,
  dueDate,
  amountSen: BigInt(amount),
  paidSen: BigInt(paid),
})

// Aisyah's lease, shuffled to prove the sort.
const aisyah = [
  inv('p1', 'rent', 1, '2026-02-28', 150000),
  inv('p0', 'rent', 0, '2026-01-31', 150000),
  inv('dep', 'deposit', null, '2026-01-31', 300000),
  inv('p2', 'rent', 2, '2026-03-31', 150000),
]

describe('planAllocation', () => {
  it('fills the deposit before rent on the same due date', () => {
    expect(planAllocation(aisyah, 300000n)).toEqual({ allocations: [{ invoiceId: 'dep', amountSen: 300000n }], unappliedSen: 0n })
  })

  it('fills each invoice fully before the next, skipping paid ones', () => {
    const afterCash = aisyah.map((i) => (i.id === 'dep' ? { ...i, paidSen: 300000n } : i))
    expect(planAllocation(afterCash, 200000n).allocations).toEqual([
      { invoiceId: 'p0', amountSen: 150000n },
      { invoiceId: 'p1', amountSen: 50000n },
    ])
  })

  it('pays invoices that are not due yet and keeps any leftover as unapplied', () => {
    expect(planAllocation(aisyah, 800000n)).toEqual({
      allocations: [
        { invoiceId: 'dep', amountSen: 300000n },
        { invoiceId: 'p0', amountSen: 150000n },
        { invoiceId: 'p1', amountSen: 150000n },
        { invoiceId: 'p2', amountSen: 150000n },
      ],
      unappliedSen: 50000n,
    })
  })

  it('continues a partially paid invoice', () => {
    const partial = [inv('a', 'rent', 0, '2026-01-01', 1000, 400), inv('b', 'rent', 1, '2026-02-01', 1000)]
    expect(planAllocation(partial, 700n).allocations).toEqual([
      { invoiceId: 'a', amountSen: 600n },
      { invoiceId: 'b', amountSen: 100n },
    ])
  })
})

describe('balances', () => {
  it('computes the remaining balance and the amount due now', () => {
    const list = [inv('a', 'deposit', null, '2026-01-01', 1000, 1000), inv('b', 'rent', 0, '2026-01-01', 500, 200), inv('c', 'rent', 1, '2026-02-01', 500)]
    expect(remainingBalance(list)).toBe(800n)
    expect(amountDueNow(list, '2026-01-31')).toBe(300n)
    expect(amountDueNow(list, '2026-02-01')).toBe(800n)
  })
})
