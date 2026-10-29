import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSen } from '@/lib/money'
import { requireStaffPage } from '@/lib/server/pages'
import { collectionsReport, lastMonths, overdueInvoiceCount } from '@/lib/server/reports'
import { formatMonth } from '@/lib/time'

export default async function DashboardPage() {
  const caller = await requireStaffPage()
  const range = lastMonths(6)
  const [overdue, report] = await Promise.all([overdueInvoiceCount(caller), collectionsReport(caller, range.from, range.to)])
  const total = report.reduce((sum, r) => sum + r.collectedSen, 0)

  return (
    <>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Overdue invoices</CardDescription>
            <CardTitle className="text-4xl">{overdue}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Collected in the last 6 months</CardDescription>
            <CardTitle className="text-4xl">{formatSen(total)}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Collections</CardTitle>
          <CardDescription>Approved payments by month received (Malaysia time)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.map((r) => (
                <TableRow key={r.month}>
                  <TableCell>{formatMonth(r.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSen(r.collectedSen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
