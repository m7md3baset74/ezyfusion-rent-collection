// Browser calls to our own API routes. The session cookie authenticates them; the server does every check.
export async function postJson<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const message = (data as { error?: unknown } | null)?.error
      return { ok: false, error: typeof message === 'string' ? message : `Request failed (${res.status})` }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: 'Network error, please try again' }
  }
}
