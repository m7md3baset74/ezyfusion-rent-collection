import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSen } from '@/lib/money'
import { requireStaffPage } from '@/lib/server/pages'
import { listLeases } from '@/lib/server/reports'
import { formatDate } from '@/lib/time'

export default async function LeasesPage() {
  const caller = await requireStaffPage()
  const leases = await listLeases(caller)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leases</CardTitle>
      </CardHeader>
      <CardContent>
        {leases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leases yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Monthly rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leases.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link href={`/leases/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                      {l.unitName}
                    </Link>
                  </TableCell>
                  <TableCell>{l.tenantName}</TableCell>
                  <TableCell>{formatDate(l.startDate)}</TableCell>
                  <TableCell>{formatDate(l.endDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSen(l.monthlyRentSen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
