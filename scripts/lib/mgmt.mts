/**
 * Tynd klient til Supabase Management API.
 *
 * Bruges af setup-scripts. Alt går over HTTPS med et personal access token —
 * ingen database-forbindelse og ingen ekstra afhængigheder. Det sparer os for
 * at gætte på om projektet svarer på direkte Postgres eller kun via pooler.
 */

const BASE = 'https://api.supabase.com'

export class MgmtError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'MgmtError'
  }
}

export function requireToken(): string {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN mangler.\n' +
        'Hent et token på https://supabase.com/dashboard/account/tokens og kør:\n' +
        '  export SUPABASE_ACCESS_TOKEN=sbp_...',
    )
  }
  return token
}

async function call(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await response.text()

  if (!response.ok) {
    throw new MgmtError(
      `${method} ${path} → ${response.status}: ${text.slice(0, 400)}`,
      response.status,
      text,
    )
  }

  return text ? JSON.parse(text) : null
}

export const api = {
  get: (path: string, token: string) => call('GET', path, token),
  post: (path: string, token: string, body: unknown) =>
    call('POST', path, token, body),
}

export interface Organization {
  id: string
  slug?: string
  name: string
}

export interface Project {
  id: string
  ref?: string
  name: string
  region: string
  status: string
  organization_id: string
}

export const listOrganizations = (token: string): Promise<Organization[]> =>
  api.get('/v1/organizations', token)

export const listProjects = (token: string): Promise<Project[]> =>
  api.get('/v1/projects', token)

export const getProject = (ref: string, token: string): Promise<Project> =>
  api.get(`/v1/projects/${ref}`, token)

/**
 * Kører SQL i projektets database.
 *
 * Bemærk: endpointet kører med fulde rettigheder. Det er fint til migrationer,
 * men det er også grunden til at access tokenet aldrig må ende i appen selv —
 * det hører hjemme i din shell, ikke i .env.local.
 */
export const runQuery = (ref: string, token: string, query: string): Promise<any> =>
  api.post(`/v1/projects/${ref}/database/query`, token, { query })

export interface ApiKey {
  name: string
  api_key: string
}

export const getApiKeys = (ref: string, token: string): Promise<ApiKey[]> =>
  api.get(`/v1/projects/${ref}/api-keys?reveal=true`, token)

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
