/**
 * Tester AI-baggrundenes udbydervalg og aflæsning af Cloudflares svar.
 *
 *   npm run test:billeder
 *
 * Hvorfor netop den har en test: funktionen kalder to fremmede API'er med
 * hvert sit svarformat, og den vælger mellem dem ud fra hvilke nøgler der
 * tilfældigvis står i Netlify. Det er den slags der virker lokalt og fejler
 * i produktionen -- eller værre, stilletiende vælger den udbyder der koster
 * penge, fordi en nøgle manglede.
 *
 * Testen importerer de RIGTIGE funktioner. En kopi af reglerne her i filen
 * ville bestå selv den dag funktionen holdt op med at følge dem.
 *
 * Intet netværk.
 */

import assert from 'node:assert/strict'

// _lib/supabase.js kræver disse ved import. Der kaldes aldrig ud.
process.env.SUPABASE_URL ??= 'https://eksempel.supabase.co'
process.env.SUPABASE_SECRET_KEY ??= 'sb_secret_test'

const { vaelgUdbyder, laesCloudflareSvar, default: handler } =
  await import('../netlify/functions/ai-baggrund.js')

let fejlede = 0
const test = async (navn, fn) => {
  try { await fn(); console.log(`  ✓ ${navn}`) }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`) }
}

const NOEGLER = [
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_IMAGE_MODEL',
  'GEMINI_API_KEY', 'AI_BILLED_UDBYDER',
]
const ryd = () => { for (const n of NOEGLER) delete process.env[n] }

console.log('\nUdbydervalg')

await test('ingen nøgler: ingen udbyder', async () => {
  ryd()
  assert.equal(vaelgUdbyder(), null)
})

await test('kun Cloudflare', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  assert.equal(vaelgUdbyder(), 'cloudflare')
})

await test('halv Cloudflare tæller ikke', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  assert.equal(vaelgUdbyder(), null, 'konto uden token ville give 401 ved hvert kald')
})

await test('kun Gemini', async () => {
  ryd()
  process.env.GEMINI_API_KEY = 'g'
  assert.equal(vaelgUdbyder(), 'gemini')
})

await test('begge sat: den gratis vinder', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  process.env.GEMINI_API_KEY = 'g'
  assert.equal(vaelgUdbyder(), 'cloudflare', 'ellers koster hvert billede penge uden at nogen bad om det')
})

await test('ønsket udbyder vinder over rækkefølgen', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  process.env.GEMINI_API_KEY = 'g'
  process.env.AI_BILLED_UDBYDER = 'gemini'
  assert.equal(vaelgUdbyder(), 'gemini')
})

await test('ønsket udbyder uden nøgle falder ikke tilbage', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  process.env.AI_BILLED_UDBYDER = 'gemini'
  assert.equal(vaelgUdbyder(), null,
    'et udtrykkeligt valg må ikke stilletiende blive til et andet')
})

await test('AI_BILLED_UDBYDER tåler store bogstaver og mellemrum', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  process.env.AI_BILLED_UDBYDER = '  Cloudflare '
  assert.equal(vaelgUdbyder(), 'cloudflare')
})

console.log('\nCloudflares svar')

await test('billedet ligger i result.image', async () => {
  const ud = laesCloudflareSvar({ success: true, result: { image: 'AAAA' }, errors: [] })
  assert.equal(ud.base64, 'AAAA')
  assert.equal(ud.kvadratisk, true, 'FLUX leverer kvadrat — klienten skal beskære')
})

await test('success:false bliver til fejlens egen tekst', async () => {
  const ud = laesCloudflareSvar({ success: false, errors: [{ message: 'Prompt afvist' }] })
  assert.match(ud.fejl, /Prompt afvist/)
  assert.ok(!ud.base64)
})

await test('success:false uden tekst giver stadig en fejl', async () => {
  const ud = laesCloudflareSvar({ success: false, errors: [] })
  assert.ok(ud.fejl)
})

await test('tomt resultat er en fejl, ikke et billede', async () => {
  const ud = laesCloudflareSvar({ success: true, result: {} })
  assert.match(ud.fejl, /intet billede/)
})

console.log('\nPrompten')

// byggPrompt er ikke eksporteret; det der skal holdes fast i, er at de to
// slags ikke må blandes sammen. Et motiv der også får at vide at det
// «ikke er et motiv» giver modellen to modsatrettede ordrer, og det var
// præcis det der skete da billedbriefen blev sendt ind i baggrundsprompten.
const { laesCloudflareSvar: _ } = await import('../netlify/functions/ai-baggrund.js')
void _

await test('motiv og baggrund er to forskellige ting i API\'et', async () => {
  const kilde = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../netlify/functions/ai-baggrund.js', import.meta.url), 'utf8'))

  assert.match(kilde, /slags === 'motiv'/, 'motiv skal have sin egen prompt')
  assert.match(kilde, /ikke et motiv/, 'baggrundsprompten skal stadig sige at det ikke er et motiv')

  // Forbuddene skal gælde begge. Deles de ikke, glider de fra hinanden.
  const antalForbud = (kilde.match(/Ingen mennesker, ingen ansigter/g) ?? []).length
  assert.equal(antalForbud, 1, 'forbuddene skal stå ét sted og deles af begge slags')
})

await test('standard er baggrund, ikke motiv', async () => {
  const kilde = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../netlify/functions/ai-baggrund.js', import.meta.url), 'utf8'))
  assert.match(kilde, /krop\.slags === 'motiv' \? 'motiv' : 'baggrund'/,
    'alt andet end et udtrykkeligt «motiv» skal blive til en baggrund')
})

console.log('\nSprog')

await test('FLUX får en engelsk prompt, Gemini en dansk', async () => {
  const kilde = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../netlify/functions/ai-baggrund.js', import.meta.url), 'utf8'))

  assert.match(kilde, /byggPrompt\(paaEngelsk, slags, 'en'\)/,
    'Cloudflare-kaldet skal bruge den oversatte tekst og den engelske ramme')
  assert.match(kilde, /byggPrompt\(beskrivelse, slags\)/,
    'Gemini forstår dansk og skal beholde den danske ramme')
  assert.match(kilde, /No people, no faces/, 'forbuddene skal også findes på engelsk')
})

await test('en fejlet oversættelse stopper ikke billedet', async () => {
  const kilde = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../netlify/functions/ai-baggrund.js', import.meta.url), 'utf8'))

  // Alle udgange fra tilEngelsk skal føre tilbage til den oprindelige tekst.
  const krop = kilde.slice(kilde.indexOf('async function tilEngelsk'),
    kilde.indexOf('async function cloudflare'))
  assert.match(krop, /if \(!svar\.ok\) return tekst/)
  assert.match(krop, /catch \{\s*return tekst/)
  assert.ok(!/throw/.test(krop), 'oversætteren må aldrig kaste videre')
})

console.log('\nAdgang')

await test('kun POST', async () => {
  const svar = await handler(new Request('https://x/api/ai-baggrund', { method: 'GET' }))
  assert.equal(svar.status, 405)
})

await test('uden session kommer man ikke til udbyderen', async () => {
  ryd()
  process.env.CLOUDFLARE_ACCOUNT_ID = 'k'
  process.env.CLOUDFLARE_API_TOKEN = 't'
  const svar = await handler(new Request('https://x/api/ai-baggrund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beskrivelse: 'blå flade' }),
  }))
  assert.notEqual(svar.status, 200, 'et kald uden session må aldrig koste en kvote')
  const data = await svar.json()
  assert.ok(!data.ok)
})

console.log(fejlede ? `\n${fejlede} test(s) fejlede.\n` : '\nAlle tests bestået.\n')
process.exit(fejlede ? 1 : 0)
