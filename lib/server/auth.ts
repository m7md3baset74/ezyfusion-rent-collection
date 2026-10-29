import 'server-only'
import { createClient as createTokenClient } from '@supabase/supabase-js'
import { createClient as createCookieClient } from '../supabase/server'
import { loadCaller, type Caller } from './caller'
import { forbidden, unauthorized } from './http'

// Authenticates the request: `Authorization: Bearer <access token>` (API clients and tests) or the session
// cookie (the web app). Both are checked with the Auth server through getUser(), never getSession().
export async function authenticatedUserId(req?: Request): Promise<string | null> {
  const header = req?.headers.get('authorization')
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    if (!match) return null
    const client = createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.getUser(match[1])
    return error || !data.user ? null : data.user.id
  }
  const supabase = await createCookieClient()
  const { data, error } = await supabase.auth.getUser()
  return error || !data.user ? null : data.user.id
}

// 401 without a valid login; 403 for a valid login that has no role in any organization.
export async function getCaller(req?: Request): Promise<Caller> {
  const userId = await authenticatedUserId(req)
  if (!userId) throw unauthorized()
  const caller = await loadCaller(userId)
  if (!caller) throw forbidden('This account has no access')
  return caller
}

// For server components: null instead of throwing, so the page can redirect to /login.
export async function getPageCaller(): Promise<Caller | null> {
  const userId = await authenticatedUserId()
  return userId ? loadCaller(userId) : null
}
