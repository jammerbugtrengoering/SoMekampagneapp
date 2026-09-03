/**
 * Kører adskillelsestesten mod en engangsdatabase.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:adskillelse
 *
 * Testen svarer på det spørgsmål der afgør om løsningen kan sælges: kan en
 * bruger hos én kunde se eller ændre noget hos en anden? Den spørger basen
 * direkte, for det er basen der er sikkerheden — skærmbilledet er bare
 * høfligheden.
 *
 * Den skriver rigtige rækker (og ruller tilbage til sidst), så den nægter at
 * køre mod noget der ligner produktion. Vil du alligevel, findes --tvang,
 * men gør det på en Supabase-branch og ikke på det projekt kunderne bruger.
 *
 * Sådan får du en engangsbase:
 *   docker run --rm -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres npm run test:adskillelse
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.env.TEST_DATABASE_URL
const tvang = process.argv.includes('--tvang')

if (!url) {
  console.error(
    'TEST_DATABASE_URL mangler.\n\n' +
      'Start en engangsbase og peg på den:\n' +
      '  docker run --rm -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16\n' +
      '  TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres npm run test:adskillelse',
  )
  process.exit(1)
}

if (/supabase\.(co|com)/.test(url) && !tvang) {
  console.error(
    'TEST_DATABASE_URL peger på Supabase. Testen opretter data og skal ikke\n' +
      'røre det projekt kunderne bruger. Brug en lokal base eller en branch.\n' +
      'Er du helt sikker: tilføj --tvang.',
  )
  process.exit(1)
}

if (spawnSync('psql', ['--version'], { stdio: 'ignore' }).error) {
  console.error('psql findes ikke i PATH. På macOS: brew install libpq && brew link --force libpq')
  process.exit(1)
}

/** Kører en fil og returnerer { ok, ud }. */
function koer(sti, { stopVedFejl = true } = {}) {
  const res = spawnSync(
    'psql',
    [url, '-q', ...(stopVedFejl ? ['-v', 'ON_ERROR_STOP=1'] : []), '-f', sti],
    { encoding: 'utf8' },
  )
  if (res.error) throw res.error
  return { ok: res.status === 0, ud: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

const rod = resolve(import.meta.dirname, '..')
const attrap = resolve(rod, 'supabase/tests/supabase-attrap.sql')
const test = resolve(rod, 'supabase/tests/adskillelse.sql')
const migrationer = resolve(rod, 'supabase/migrations')

if (!existsSync(attrap)) {
  console.error(`Mangler ${attrap}`)
  process.exit(1)
}

// ---- Byg basen op forfra ----
console.log('Sætter Supabase-attrappen op…')
let res = koer(attrap)
if (!res.ok) {
  console.error(res.ud)
  console.error('\nAttrappen fejlede. Er basen tom? Testen skal køre mod en engangsbase.')
  process.exit(1)
}

for (const fil of readdirSync(migrationer).filter((f) => f.endsWith('.sql')).sort()) {
  process.stdout.write(`  ${fil} … `)
  res = koer(resolve(migrationer, fil))
  if (!res.ok) {
    console.log('FEJL')
    console.error(res.ud.split('\n').filter((l) => !l.startsWith('NOTICE')).join('\n'))
    process.exit(1)
  }
  console.log('ok')
}

// ---- Selve testen ----
console.log('\nAdskillelse:')
res = koer(test)

const linjer = res.ud.split('\n')
const bestaaet = linjer.filter((l) => l.includes('ok  ')).length
const fejlet = linjer.filter((l) => l.includes('FEJLET'))

for (const l of linjer) {
  if (l.includes('ok  ')) console.log(`  ✓ ${l.split('ok  ')[1]}`)
}

if (!res.ok || fejlet.length) {
  console.error('\nEn kontrol slap igennem der ikke burde:')
  for (const l of fejlet) console.error(`  ${l.trim()}`)
  if (!fejlet.length) {
    console.error(res.ud.split('\n').filter((l) => l.startsWith('ERROR')).join('\n'))
  }
  process.exit(1)
}

// Er der ingen kontroller, er noget galt med opsætningen — en test der
// ikke tester noget må ikke kunne vise sig som bestået.
if (bestaaet === 0) {
  console.error('\nIngen kontroller blev kørt. Kom filen igennem psql?')
  process.exit(1)
}

console.log(`\n${bestaaet} kontroller bestået. Organisationerne er tætte.`)
