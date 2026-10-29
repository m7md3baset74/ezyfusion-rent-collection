import { Badge } from '@/components/ui/badge'

const VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  paid: 'default',
  approved: 'default',
  partially_paid: 'secondary',
  pending_verification: 'secondary',
  pending: 'secondary',
  unpaid: 'outline',
  overdue: 'destructive',
  rejected: 'outline',
  voided: 'outline',
  failed: 'destructive',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? 'outline'}>{status.replaceAll('_', ' ')}</Badge>
}
