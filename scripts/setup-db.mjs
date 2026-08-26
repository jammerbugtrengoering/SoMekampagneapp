/**
 * Kører migrationer og seed mod Supabase-projektet.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *   npm run db:setup
 *
 * Anvendte migrationer noteres i schema_migrations, så scriptet kan køres igen
 * uden at gøre skade. Seed springes over hvis der allerede er kunder.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { findProjektRef, hentNoegler, koerSql, kraevToken, laesEnv } from './lib/mgmt.mjs'

const MIGRATIONER = resolve(process.cwd(), 'supabase/migrations')
const SEED = resolve(process.cwd(), 'supabase/seed.sql')

const MIGRATIONSTABEL = `
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
`

async function main() {
  const token = kraevToken()
  const env = laesEnv()
  const ref = await findProjektRef(token, 'SoMePlanning App')

  console.log(`Projekt: ${ref}\n`)

  await koerSql(ref, token, MIGRATIONSTABEL)
  const koerte = new Set(
    ((await koerSql(ref, token, 'select version from public.schema_migrations;')) ?? []).map(
      (r) => r.version,
    ),
  )

  const filer = readdirSync(MIGRATIONER).filter((f) => f.endsWith('.sql')).sort()

  let antal = 0
  for (const fil of filer) {
    if (koerte.has(fil)) {
      console.log(`  – ${fil} (allerede kørt)`)
      continue
    }
    process.stdout.write(`  · ${fil} … `)
    await koerSql(ref, token, readFileSync(resolve(MIGRATIONER, fil), 'utf8'))
    await koerSql(
      ref,
      token,
      `insert into public.schema_migrations (version) values ('${fil}');`,
    )
    console.log('ok')
    antal++
  }

  console.log(antal ? `\n${antal} migration(er) kørt.` : '\nSkemaet var allerede opdateret.')

  // --- Seed ---
  const kunder = await koerSql(ref, token, 'select count(*)::int as n from public.brands;')
  if ((kunder?.[0]?.n ?? 0) > 0) {
    console.log(`Seed sprunget over — der er allerede ${kunder[0].n} kunde(r).`)
  } else if (existsSync(SEED)) {
    process.stdout.write('Seeder de to kunder … ')
    await koerSql(ref, token, readFileSync(SEED, 'utf8'))
    console.log('ok')
  }

  // --- Storage ---
  // Bucket'en SKAL være public: Meta henter selv billedet fra URL'en og kan
  // ikke logge ind. Det er et bevidst valg, ikke en forglemmelse.
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'kampagne-assets'
  const noegler = await hentNoegler(ref, token)
  const service = noegler.find((n) => n.name === 'service_role')?.api_key

  if (service) {
    process.stdout.write(`Storage-bucket "${bucket}" … `)
    const svar = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    })
    const krop = await svar.text()
    console.log(
      svar.ok ? 'oprettet (public)'
        : krop.includes('already exists') ? 'findes allerede'
        : `kunne ikke oprettes: ${krop.slice(0, 140)}`,
    )
  }

  console.log('\nFærdig.\n')
  console.log('Til sidst: opret din bruger i Supabase (Authentication → Users → Add user),')
  console.log('og gør hende administrator:')
  console.log('  npm run admin:add din@mail.dk')
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`)
  process.exitCode = 1
})
