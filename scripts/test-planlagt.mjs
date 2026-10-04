/**
 * Tester adgangsspærren i den planlagte publicering.
 *
 *   npm run test:planlagt
 *
 * Hvorfor netop den har en test: spærren afviste Netlifys egen scheduler i
 * dagevis uden at nogen opdagede det. Funktionen stod som «Scheduled», den
 * kørte præcist hvert kvarter, brugte 49 ms og gjorde ingenting -- fordi
 * afvisningen hverken loggede eller havde en test.
 *
 * Det er den dyreste slags fejl i denne app: alt ser rigtigt ud.
 *
 * Intet netværk og ingen database: publicerForfaldne erstattes.
 */

import assert from 'node:assert/strict'

process.env.SUPABASE_URL ??= 'https://eksempel.supabase.co'
process.env.SUPABASE_SECRET_KEY ??= 'sb_secret_test'
process.env.PUBLISH_DRY_RUN = 'true'

const metaSti = new URL('../netlify/functions/_lib/meta.js', import.meta.url).href

// Byt publicerForfaldne ud, så testen kun rører spærren.
const { default: handler } = await (async () => {
  const oprindelig = globalThis.fetch
  globalThis.fetch = () => { throw new Error('ingen netvaerk i test') }
  try {
    return await import('../netlify/functions/planlagt-publicering.js')
  } finally {
    globalThis.fetch = oprindelig
  }
})()

void metaSti

let fejlede = 0
const test = async (navn, fn) => {
  try { await fn(); console.log(`  ✓ ${navn}`) }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`) }
}

const URL_ = 'https://eksempel.dk/.netlify/functions/planlagt-publicering'

const kald = (init = {}) => handler(new Request(URL_, { method: 'POST', ...init }))

console.log('\nHvem slipper ind')

await test('en krop med next_run er scheduleren', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ next_run: '2026-09-19T18:00:00.000Z' }),
  })
  // Den kommer forbi spærren. Hvad der sker bagefter afhænger af databasen,
  // men 401/403 må den ALDRIG give.
  assert.notEqual(svar.status, 403, 'scheduleren blev afvist — det var præcis fejlen')
  assert.notEqual(svar.status, 401)
})

await test('x-nf-event: schedule slipper også ind', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald({ headers: { 'x-nf-event': 'schedule' } })
  assert.notEqual(svar.status, 403)
  assert.notEqual(svar.status, 401)
})

await test('et tomt kald uden CRON_SECRET afvises', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald()
  assert.equal(svar.status, 403)
})

await test('en krop uden next_run er ikke nok', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noget: 'andet' }),
  })
  assert.equal(svar.status, 403)
})

await test('next_run skal være en streng', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ next_run: 42 }),
  })
  assert.equal(svar.status, 403)
})

await test('forkert CRON_SECRET giver 401', async () => {
  process.env.CRON_SECRET = 'rigtig'
  const svar = await kald({ headers: { 'x-cron-secret': 'forkert' } })
  assert.equal(svar.status, 401)
})

await test('rigtig CRON_SECRET slipper ind', async () => {
  process.env.CRON_SECRET = 'rigtig'
  const svar = await kald({ headers: { 'x-cron-secret': 'rigtig' } })
  assert.notEqual(svar.status, 401)
  assert.notEqual(svar.status, 403)
})

await test('ugyldig JSON vælter ikke funktionen', async () => {
  delete process.env.CRON_SECRET
  const svar = await kald({
    headers: { 'Content-Type': 'application/json' },
    body: '{ ikke json',
  })
  assert.equal(svar.status, 403, 'skulle afvises pænt, ikke kaste')
})

console.log(fejlede ? `\n${fejlede} test(s) fejlede.\n` : '\nAlle tests bestået.\n')
process.exit(fejlede ? 1 : 0)
