/**
 * Kobler appen til et Supabase-projekt du allerede har oprettet.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *   npm run db:link                      # bruger PROJECT_NAME fra .env eller standarden
 *   npm run db:link "SoMePlanning App"   # eller angiv navnet direkte
 *
 * Finder projektet på navn, henter API-nøglerne og skriver .env.local. Du
 * slipper for at klikke rundt i dashboardet efter anon- og service-nøgler.
 *
 * Findes .env.local i forvejen, bevares de værdier du selv har sat —
 * ANTHROPIC_API_KEY, TOKEN_ENCRYPTION_KEY og CRON_SECRET bliver ikke nulstillet.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { getApiKeys, listProjects, requireToken, type Project } from './lib/mgmt.mts'

const ENV_PATH = resolve(process.cwd(), '.env.local')
const DEFAULT_NAME = process.env.PROJECT_NAME ?? 'SoMePlanning App'

function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

/** Navne sammenlignes løst — mellemrum og store bogstaver skal ikke kunne vælte det. */
const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '')

async function pick(projects: Project[], wanted: string): Promise<Project> {
  const exact = projects.filter((p) => normalize(p.name) === normalize(wanted))
  if (exact.length === 1) return exact[0]

  const partial = projects.filter((p) => normalize(p.name).includes(normalize(wanted)))
  const candidates = exact.length ? exact : partial.length ? partial : projects

  if (candidates.length === 1) return candidates[0]

  if (!candidates.length) {
    throw new Error('Ingen projekter på kontoen.')
  }

  console.log(
    exact.length || partial.length
      ? `\nFlere projekter matcher "${wanted}":`
      : `\nFandt ikke "${wanted}". Vælg blandt dine projekter:`,
  )
  candidates.forEach((p, index) =>
    console.log(`  ${index + 1}. ${p.name}  (${p.ref ?? p.id}, ${p.region}, ${p.status})`),
  )

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Vælg (1-${candidates.length}): `)
  rl.close()

  const chosen = candidates[Number(answer) - 1]
  if (!chosen) throw new Error('Ugyldigt valg.')
  return chosen
}

async function main() {
  const token = requireToken()
  const wanted = process.argv[2] ?? DEFAULT_NAME

  const projects = await listProjects(token)
  const project = await pick(projects, wanted)
  const ref = project.ref ?? project.id

  console.log(`\nProjekt:  ${project.name}`)
  console.log(`Ref:      ${ref}`)
  console.log(`Region:   ${project.region}`)
  console.log(`Status:   ${project.status}`)

  if (project.status !== 'ACTIVE_HEALTHY') {
    console.log(
      '\nBemærk: projektet er ikke ACTIVE_HEALTHY endnu. Er det lige oprettet,' +
        '\nså vent et minut og kør kommandoen igen.',
    )
  }

  const keys = await getApiKeys(ref, token)
  const anon = keys.find((key) => key.name === 'anon')?.api_key
  const service = keys.find((key) => key.name === 'service_role')?.api_key

  if (!anon || !service) {
    throw new Error(
      'Kunne ikke hente API-nøglerne. Find dem under Project Settings → API i dashboardet.',
    )
  }

  // Behold det brugeren selv har sat; udfyld kun det der mangler.
  const existing = readEnvLocal()
  const keep = (name: string, fallback: string) => existing[name] || fallback

  const env = `# Skrevet af scripts/link-project.mts — projekt: ${project.name}
NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}
SUPABASE_STORAGE_BUCKET=${keep('SUPABASE_STORAGE_BUCKET', 'kampagne-assets')}
SUPABASE_PROJECT_REF=${ref}

ANTHROPIC_API_KEY=${keep('ANTHROPIC_API_KEY', '')}
ANTHROPIC_MODEL=${keep('ANTHROPIC_MODEL', 'claude-sonnet-4-6')}

META_GRAPH_VERSION=${keep('META_GRAPH_VERSION', 'v21.0')}
PUBLISH_DRY_RUN=${keep('PUBLISH_DRY_RUN', 'true')}

TOKEN_ENCRYPTION_KEY=${keep('TOKEN_ENCRYPTION_KEY', randomBytes(32).toString('base64'))}
CRON_SECRET=${keep('CRON_SECRET', randomBytes(32).toString('hex'))}
`

  writeFileSync(ENV_PATH, env, { mode: 0o600 })

  console.log(`\nSkrevet til .env.local.`)
  if (!keep('ANTHROPIC_API_KEY', '')) {
    console.log('Mangler stadig: ANTHROPIC_API_KEY')
  }
  console.log(`Dashboard: https://supabase.com/dashboard/project/${ref}`)
  console.log('\nNæste: npm run db:setup')
}

main().catch((error) => {
  console.error(`\nFejl: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
