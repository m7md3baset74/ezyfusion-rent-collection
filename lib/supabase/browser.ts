import { createBrowserClient } from '@supabase/ssr'

// Browser client with the publishable key: everything it does goes through RLS and Storage policies.
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
}
