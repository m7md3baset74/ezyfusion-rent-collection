// Pure allocation rules (brief §4). The database code in lib/server/payments.ts loads the lease's
// invoices with their paid totals, calls planAllocation, and writes the result in the same transaction.
import type { InvoiceKind } from './billing'

export interface InvoiceBalance {
  id: string
  kind: InvoiceKind
  periodIndex: number | null
  dueDate: string // 'YYYY-MM-DD'
  amountSen: bigint
  paidSen: bigint
}

// Allocation order: due date, then deposit before rent, then period index (id only to make ties stable).
export function compareAllocationOrder(a: InvoiceBalance, b: InvoiceBalance): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
  const ai = a.periodIndex ?? -1
  const bi = b.periodIndex ?? -1
  if (ai !== bi) return ai - bi
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function planAllocation(
  invoices: InvoiceBalance[],
  amountSen: bigint,
): { allocations: { invoiceId: string; amountSen: bigint }[]; unappliedSen: bigint } {
  let left = amountSen
  const allocations: { invoiceId: string; amountSen: bigint }[] = []
  for (const invoice of [...invoices].sort(compareAllocationOrder)) {
    if (left <= 0n) break
    const unpaid = invoice.amountSen - invoice.paidSen
    if (unpaid <= 0n) continue
    const take = unpaid < left ? unpaid : left
    allocations.push({ invoiceId: invoice.id, amountSen: take })
    left -= take
  }
  return { allocations, unappliedSen: left }
}

// Total still unpaid on the lease (all invoices, due or not).
export function remainingBalance(invoices: InvoiceBalance[]): bigint {
  return invoices.reduce((sum, i) => sum + (i.amountSen > i.paidSen ? i.amountSen - i.paidSen : 0n), 0n)
}

// Unpaid amount of the invoices due on or before `today` (a Malaysia date).
export function amountDueNow(invoices: InvoiceBalance[], today: string): bigint {
  return remainingBalance(invoices.filter((i) => i.dueDate <= today))
}
