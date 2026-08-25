/**
 * Opretter et nyt Supabase-projekt til kampagneappen og skriver .env.local.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...      # supabase.com/dashboard/account/tokens
 *   npm run db:create
 *
 * Databaseadgangskoden genereres lokalt, vises én gang og gemmes i .env.local.
 * Den bruges ikke af appen — appen taler med Supabase via API-nøglerne — men
 * du får brug for den hvis du en dag skal forbinde med psql.
 *
 * Scriptet opretter ikke noget, før du har set hvad det vil gøre og sagt ja.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import {
  api,
  getApiKeys,
  getProject,
  listOrganizations,
  listProjects,
  requireToken,
  sleep,
  type Organization,
} from './lib/mgmt.mts'

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'kampagneapp'
const ENV_PATH = resolve(process.cwd(), '.env.local')

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (question: string) => rl.question(question)

/** Adgangskode uden tegn der driller i en connection-string. */
function generatePassword(): string {
  const alphabet =
    'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_'
  const bytes = randomBytes(32)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function pickOrganization(token: string): Promise<Organization> {
  const orgs = await listOrganizations(token)
  if (!orgs.length) {
    throw new Error('Ingen organisationer på kontoen. Opret én i dashboardet først.')
  }
  if (orgs.length === 1) {
    console.log(`Organisation: ${orgs[0].name}`)
    return orgs[0]
  }

  console.log('\nOrganisationer:')
  orgs.forEach((org, index) => console.log(`  ${index + 1}. ${org.name}`))
  const answer = await ask(`Vælg (1-${orgs.length}): `)
  const chosen = orgs[Number(answer) - 1]
  if (!chosen) throw new Error('Ugyldigt valg.')
  return chosen
}

async function pickRegion(token: string): Promise<string> {
  // Hentes fra API'et i stedet for at hardkodes — Supabase justerer listen,
  // og et forkert region-navn giver en fejl der er svær at tyde.
  let regions: { name?: string; region?: string; display_name?: string }[] = []
  try {
    regions = await api.get('/v1/projects/available-regions?continent=EU', token)
  } catch {
    // Endpointet findes ikke på alle konti — så falder vi tilbage.
  }

  const codes = regions
    .map((r) => r.region ?? r.name)
    .filter((code): code is string => Boolean(code))

  if (!codes.length) {
    console.log('\nKunne ikke hente regionsliste — bruger eu-central-1 (Frankfurt).')
    return 'eu-central-1'
  }

  console.log('\nEU-regioner:')
  codes.forEach((code, index) => console.log(`  ${index + 1}. ${code}`))
  const preferred = codes.indexOf('eu-central-1')
  const fallback = preferred >= 0 ? preferred + 1 : 1

  const answer = await ask(`Vælg (1-${codes.length}) [${fallback}]: `)
  return codes[Number(answer || fallback) - 1] ?? codes[fallback - 1]
}

async function waitUntilReady(ref: string, token: string): Promise<void> {
  process.stdout.write('Venter på at projektet bliver klar')

  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5000)
    process.stdout.write('.')

    try {
      const project = await getProject(ref, token)
      if (project.status === 'ACTIVE_HEALTHY') {
        console.log(' klar.')
        return
      }
      if (project.status?.includes('FAILED')) {
        throw new Error(`Projektet fejlede under oprettelse: ${project.status}`)
      }
    } catch (error) {
      // 404 lige efter oprettelse er normalt — projektet er ikke registreret endnu.
      if (error instanceof Error && !error.message.includes('404')) {
        // Andre fejl kan være midlertidige. Vi prøver videre og fejler på timeout.
      }
    }
  }

  throw new Error('Projektet blev ikke klar inden for 5 minutter.')
}

async function main() {
  const token = requireToken()

  if (existsSync(ENV_PATH)) {
    const answer = await ask(
      '.env.local findes allerede og vil blive overskrevet. Fortsæt? (ja/nej) ',
    )
    if (answer.trim().toLowerCase() !== 'ja') {
      console.log('Afbrudt.')
      return
    }
  }

  const existing = await listProjects(token)
  const clash = existing.find((project) => project.name === PROJECT_NAME)
  if (clash) {
    console.log(
      `\nDer findes allerede et projekt ved navn "${PROJECT_NAME}" (${clash.ref ?? clash.id}).`,
    )
    const answer = await ask('Opret et til alligevel? (ja/nej) ')
    if (answer.trim().toLowerCase() !== 'ja') {
      console.log('Afbrudt.')
      return
    }
  }

  const organization = await pickOrganization(token)
  const region = await pickRegion(token)
  const dbPass = generatePassword()

  console.log('\nOpretter:')
  console.log(`  Navn:          ${PROJECT_NAME}`)
  console.log(`  Organisation:  ${organization.name}`)
  console.log(`  Region:        ${region}`)
  console.log(`  Adgangskode:   genereres lokalt og gemmes i .env.local`)

  const confirm = await ask('\nOpret projektet? (ja/nej) ')
  if (confirm.trim().toLowerCase() !== 'ja') {
    console.log('Afbrudt.')
    return
  }

  const created = await api.post('/v1/projects', token, {
    name: PROJECT_NAME,
    organization_slug: organization.slug ?? organization.id,
    organization_id: organization.id,
    region,
    db_pass: dbPass,
  })

  const ref: string = created.ref ?? created.id
  console.log(`\nProjekt oprettet: ${ref}`)

  await waitUntilReady(ref, token)

  const keys = await getApiKeys(ref, token)
  const anon = keys.find((key) => key.name === 'anon')?.api_key
  const service = keys.find((key) => key.name === 'service_role')?.api_key

  if (!anon || !service) {
    throw new Error(
      'Kunne ikke hente API-nøgler. Find dem i dashboardet under Project Settings → API.',
    )
  }

  const env = `# Genereret af scripts/create-project.mts
NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}
SUPABASE_STORAGE_BUCKET=kampagne-assets
SUPABASE_PROJECT_REF=${ref}

# Databaseadgangskode — bruges ikke af appen, men af psql hvis du får brug for det.
SUPABASE_DB_PASSWORD=${dbPass}

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

META_GRAPH_VERSION=v21.0
PUBLISH_DRY_RUN=true

TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
CRON_SECRET=${randomBytes(32).toString('hex')}
`

  writeFileSync(ENV_PATH, env, { mode: 0o600 })

  console.log(`\nSkrevet til .env.local (kun læsbar for dig).`)
  console.log(`Dashboard: https://supabase.com/dashboard/project/${ref}`)
  console.log('\nNæste skridt:')
  console.log('  npm run db:setup     # opretter tabeller, RLS og de to kunder')
  console.log('  # og sæt ANTHROPIC_API_KEY i .env.local')
}

main()
  .catch((error) => {
    console.error(`\nFejl: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
  .finally(() => rl.close())
