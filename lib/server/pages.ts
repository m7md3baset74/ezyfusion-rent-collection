import 'server-only'
import { notFound, redirect } from 'next/navigation'
import type { Caller, StaffRole } from './caller'
import { getPageCaller } from './auth'
import { HttpError } from './http'

// Every page checks the caller itself; layouts and hidden buttons are not access checks.
export async function requireStaffPage(): Promise<Caller & { role: StaffRole }> {
  const caller = await getPageCaller()
  if (!caller) redirect('/login')
  if (caller.role === 'tenant') redirect('/portal')
  return caller
}

export async function requireTenantPage(): Promise<Caller & { role: 'tenant' }> {
  const caller = await getPageCaller()
  if (!caller) redirect('/login')
  if (caller.role !== 'tenant') redirect('/dashboard')
  return caller
}

// Service 404s become the Next.js not-found page; anything else propagates.
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
}
