import { redirect } from 'next/navigation'
import { getPageCaller } from '@/lib/server/auth'

export default async function Home() {
  const caller = await getPageCaller()
  if (!caller) redirect('/login')
  redirect(caller.role === 'tenant' ? '/portal' : '/dashboard')
}
