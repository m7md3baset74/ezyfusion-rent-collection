import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Only refreshes the Supabase session cookie. It is not an access check: every route handler and
// page authenticates and authorizes the caller itself (lib/server/auth.ts, lib/server/caller.ts).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  await supabase.auth.getUser()
  return response
}

export const config = {
  // Skip static assets and the API (API clients send a Bearer token; the gateway sends no session).
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
}
