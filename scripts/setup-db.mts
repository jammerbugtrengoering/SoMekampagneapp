/**
 * Kører migrationer og seed mod Supabase-projektet.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *   npm run db:setup
 *
 * Anvendte migrationer noteres i tabellen schema_migrations, så scriptet kan
 * køres igen uden at gøre skade. Seed køres kun hvis der ikke allerede er
 * kunder — ellers ville et gentaget kald overskrive dine rettelser.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getApiKeys, requireToken, runQuery } from './lib/mgmt.mts'

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations')
const SEED_PATH = resolve(process.cwd(), 'supabase/seed.sql')
const ENV_PATH = resolve(process.cwd(), '.env.local')

const MIGRATIONS_TABLE = `
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
`

function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

function resolveProjectRef(env: Record<string, string>): string {
  const direct = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF
  if (direct) return direct

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const match = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (match) return match[1]

  throw new Error(
    'Kunne ikke finde projektets ref. Sæt SUPABASE_PROJECT_REF, eller kør npm run db:create først.',
  )
}

async function appliedVersions(ref: string, token: string): Promise<Set<string>> {
  await runQuery(ref, token, MIGRATIONS_TABLE)
  const rows = await runQuery(
    ref,
    token,
    'select version from public.schema_migrations;',
  )
  return new Set((rows ?? []).map((row: any) => row.version))
}

async function main() {
  const token = requireToken()
  const env = readEnvLocal()
  const ref = resolveProjectRef(env)

  console.log(`Projekt: ${ref}\n`)

  const applied = await appliedVersions(ref, token)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  – ${file} (allerede kørt)`)
      continue
    }

    process.stdout.write(`  · ${file} … `)
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

    try {
      await runQuery(ref, token, sql)
      await runQuery(
        ref,
        token,
        `insert into public.schema_migrations (version) values ('${file}');`,
      )
      console.log('ok')
      ran++
    } catch (error) {
      console.log('FEJL')
      throw error
    }
  }

  console.log(ran ? `\n${ran} migration(er) kørt.` : '\nSkemaet var allerede opdateret.')

  // --- Seed ---
  const brands = await runQuery(ref, token, 'select count(*)::int as n from public.brands;')
  const brandCount = brands?.[0]?.n ?? 0

  if (brandCount > 0) {
    console.log(`Seed sprunget over — der er allerede ${brandCount} kunde(r).`)
  } else if (existsSync(SEED_PATH)) {
    process.stdout.write('Seeder de to kunder … ')
    await runQuery(ref, token, readFileSync(SEED_PATH, 'utf8'))
    console.log('ok')
  }

  // --- Storage bucket ---
  // Meta henter selv billedet fra URL'en og kan ikke logge ind, så bucket'en
  // skal være public. Det er et bevidst valg, ikke en forglemmelse.
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'kampagne-assets'
  const keys = await getApiKeys(ref, token)
  const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key

  if (serviceKey) {
    process.stdout.write(`Storage-bucket "${bucket}" … `)
    const response = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    })
    const body = await response.text()
    console.log(
      response.ok
        ? 'oprettet (public)'
        : body.includes('already exists')
          ? 'findes allerede'
          : `kunne ikke oprettes: ${body.slice(0, 160)}`,
    )
  }

  console.log('\nFærdig.\n')
  console.log('Til sidst: log ind i appen én gang, og giv derefter din bruger adgang:')
  console.log('  npm run db:grant din@mail.dk')
}

main().catch((error) => {
  console.error(`\nFejl: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
