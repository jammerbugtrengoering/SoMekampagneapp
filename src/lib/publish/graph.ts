const VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0'
const BASE = 'https://graph.facebook.com'

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly type?: string,
  ) {
    super(message)
    this.name = 'GraphError'
  }

  /**
   * Nogle fejl forsvinder af sig selv (rate limit, midlertidig Meta-fejl).
   * Andre gør ikke (token udløbet, mangler rettighed) — dem skal vi ikke
   * blive ved med at prøve på, for så brænder vi bare rate limit af.
   */
  get retryable(): boolean {
    if (this.code === undefined) return true // netværksfejl
    // 4 = app rate limit, 17 = user rate limit, 32/613 = page rate limit,
    // 2 = midlertidig Meta-fejl, 1 = ukendt
    return [1, 2, 4, 17, 32, 613].includes(this.code)
  }
}

interface GraphErrorBody {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    type?: string
  }
}

async function handle(response: Response): Promise<any> {
  const text = await response.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new GraphError(`Uforståeligt svar fra Meta (${response.status}): ${text.slice(0, 200)}`)
  }

  if (!response.ok || (json as GraphErrorBody).error) {
    const err = (json as GraphErrorBody).error
    throw new GraphError(
      err?.message ?? `Graph API fejl (${response.status})`,
      err?.code,
      err?.error_subcode,
      err?.type,
    )
  }
  return json
}

export async function graphGet(
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const url = new URL(`${BASE}/${VERSION}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, { method: 'GET' })
  return handle(response)
}

export async function graphPost(
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const url = `${BASE}/${VERSION}/${path.replace(/^\//, '')}`
  const body = new URLSearchParams(params)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return handle(response)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
