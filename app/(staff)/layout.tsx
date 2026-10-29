import Link from 'next/link'
import type { ReactNode } from 'react'
import { SignOutButton } from '@/components/app/sign-out-button'
import { Badge } from '@/components/ui/badge'
import { prisma } from '@/lib/prisma'
import { requireStaffPage } from '@/lib/server/pages'

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const caller = await requireStaffPage()
  const org = await prisma.organizations.findUnique({ where: { id: caller.orgId }, select: { name: true } })
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">{org?.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/leases" className="hover:underline">
              Leases
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="secondary">{caller.role}</Badge>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  )
}
