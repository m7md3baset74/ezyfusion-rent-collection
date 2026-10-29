import { SignOutButton } from '@/components/app/sign-out-button'
import { TenantPortal } from '@/components/app/tenant-portal'
import { requireTenantPage } from '@/lib/server/pages'

export default async function PortalPage() {
  await requireTenantPage()
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3">
          <span className="font-semibold">My rent</span>
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <TenantPortal />
      </main>
    </div>
  )
}
