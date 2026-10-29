import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Secret-key client: bypasses RLS and Storage policies. Server only (the import above makes a client
// bundle that imports this fail to build). Used for Storage housekeeping and signed URLs, after our own checks.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Supabase server environment is not configured')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
