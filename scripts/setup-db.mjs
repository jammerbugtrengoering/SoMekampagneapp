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
import {
  findHemmeligNoegle, findProjektRef, hentNoegler, koerSql, kraevToken, laesEnv,
} from './lib/mgmt.mjs'

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
  const ref = await findProjektRef(token, process.env.SUPABASE_PROJECT_NAVN ?? 'Kampagneapp')

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
  //
  // Seeden køres ÉN gang, nogensinde, og noteres i schema_migrations som
  // alt andet. Den talte tidligere brands for at afgøre om den skulle
  // køre, og blev så sat til altid at køre, så den kunne samle
  // forældreløse brands op. Begge dele var forkerte:
  //
  // Tæller man brands, springer seeden over på en base hvor der ligger
  // brands uden kunde — og det var netop dér der var noget at reparere.
  // Kører man altid, kommer demokunderne tilbage hver gang nogen kører
  // db:setup. Også dem der var slettet med vilje. Det er værre: en seed
  // der genopliver data, er en seed man ikke tør køre.
  //
  // Reparationen bor derfor i migration 0011, hvor den hører hjemme, og
  // seeden gør kun det en seed skal: fylder en tom base.
  const SEED_MAERKE = 'seed.sql'
  if (existsSync(SEED) && !koerte.has(SEED_MAERKE)) {
    process.stdout.write('Seeder kunder og brands (kun første gang) … ')
    await koerSql(ref, token, readFileSync(SEED, 'utf8'))
    await koerSql(
      ref,
      token,
      `insert into public.schema_migrations (version) values ('${SEED_MAERKE}');`,
    )
    console.log('ok')
  } else if (existsSync(SEED)) {
    console.log('Seed sprunget over — den er kørt før.')
  }

  // --- Storage ---
  // Bucket'en SKAL være public: Meta henter selv billedet fra URL'en og kan
  // ikke logge ind. Det er et bevidst valg, ikke en forglemmelse.
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'kampagne-assets'
  const noegler = await hentNoegler(ref, token)
  const service = findHemmeligNoegle(noegler)

  if (service) {
    process.stdout.write(`Storage-bucket "${bucket}" … `)
    // Begge headere med SAMME værdi. En sb_secret_-nøgle må ikke stå alene i
    // Authorization: Bearer — kun hvis apikey er identisk. Og en gammel
    // service_role-JWT skal have Authorization. Sådan virker begge slags.
    const svar = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
      },
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
