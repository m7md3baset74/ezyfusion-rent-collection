'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

export function SignOutButton() {
  const router = useRouter()
  async function signOut() {
    const { error } = await createClient().auth.signOut()
    if (error) {
      toast.error(`Could not sign out: ${error.message}`)
      return
    }
    toast.success('Signed out')
    router.replace('/login')
    router.refresh()
  }
  return (
    <Button variant="outline" size="sm" onClick={signOut}>
      Sign out
    </Button>
  )
}
