import { CreateLeaseForm } from '@/components/app/create-lease-form'
import { requireStaffPage } from '@/lib/server/pages'
import { leaseFormOptions } from '@/lib/server/reports'

export default async function NewLeasePage() {
  const caller = await requireStaffPage()
  if (caller.role !== 'manager') {
    return <p className="text-sm text-muted-foreground">Only managers can create leases.</p>
  }
  const options = await leaseFormOptions(caller)
  return <CreateLeaseForm units={options.units} tenants={options.tenants} />
}
