import type { z } from 'zod'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (message: string) => new HttpError(400, message)
export const unauthorized = () => new HttpError(401, 'Not signed in')
export const forbidden = (message = 'Your role does not allow this action') => new HttpError(403, message)
export const notFound = (message = 'Not found') => new HttpError(404, message)

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

// Turns thrown HttpErrors into { error } responses. Anything else is a 500 that reveals nothing,
// and only the error message is logged (never request bodies).
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('Unhandled error:', error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'Internal server error' }, 500)
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
}

export function parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw badRequest(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  }
  return result.data
}

// Postgres SQLSTATE of a failed query, wherever Prisma or the pg adapter put it
// (e.g. '23505' unique violation, '23P01' exclusion violation).
export function dbErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): string | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) return undefined
    seen.add(value)
    const record = value as Record<string, unknown>
    for (const key of ['originalCode', 'code']) {
      const code = record[key]
      if (typeof code !== 'string') continue
      if (code === 'P2002') return '23505'
      if (/^[0-9A-Z]{5}$/.test(code) && !/^P[1-6]\d{3}$/.test(code)) return code
    }
    for (const key of ['cause', 'meta', 'driverAdapterError']) {
      const found = visit(record[key], depth + 1)
      if (found) return found
    }
    return undefined
  }
  return visit(error, 0)
}
