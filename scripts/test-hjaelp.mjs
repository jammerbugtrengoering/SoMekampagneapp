/**
 * Tester hjælpeteksterne.
 *
 *   npm run test:hjaelp
 *
 * Hvorfor de har en test: de er skrevet til slutbrugeren, og den
 * hyppigste fejl i sådan en tekst er at der sniger sig udviklerstof ind —
 * en kommando, et tabelnavn, en miljøvariabel. Det er ubrugeligt for den
 * der læser det, og det er sket i denne app før.
 *
 * Og: en side uden hjælp er en tom boks. Listen skal følge sidernes.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HJAELP, HJAELP_STANDARD } from '../src/hjaelp.js'

let fejlede = 0
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`) }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`) }
}

const SIDER = ['kalender', 'ny', 'kampagner', 'kunder', 'afsender', 'medlemmer']

console.log('\nDækning')

test('hver side i appen har en hjælpetekst', () => {
  // Sidernes navne står i App.jsx. Tilføjes en side uden hjælp, fanges
  // det her frem for af en bruger der ser en tom boks.
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const navBlok = app.slice(app.indexOf('<nav style='), app.indexOf('</nav>'))
  const fundne = [...navBlok.matchAll(/\["([a-zæøå]+)",\s*"/g)].map((m) => m[1])

  assert.ok(fundne.length >= 6, `fandt kun ${fundne.length} sider i navigationen`)
  for (const side of fundne) {
    assert.ok(HJAELP[side], `siden «${side}» har ingen hjælpetekst`)
  }
})

test('listen matcher de sider vi forventer', () => {
  assert.deepEqual(Object.keys(HJAELP).sort(), [...SIDER].sort())
})

test('alle har titel, intro og mindst tre punkter', () => {
  for (const [side, h] of Object.entries(HJAELP)) {
    assert.ok(h.titel?.trim(), `${side}: ingen titel`)
    assert.ok(h.intro?.trim().length > 40, `${side}: introen er for tynd`)
    assert.ok(h.punkter.length >= 3, `${side}: kun ${h.punkter.length} punkter`)
  }
})

test('hvert punkt er et par af mærkat og forklaring', () => {
  for (const [side, h] of Object.entries(HJAELP)) {
    for (const p of h.punkter) {
      assert.equal(p.length, 2, `${side}: et punkt har ${p.length} dele`)
      assert.ok(p[0].trim() && p[1].trim(), `${side}: tomt punkt`)
    }
  }
})

console.log('\nSkrevet til brugeren, ikke til udvikleren')

// Det her er hele pointen med testen. Hver af dem har stået i appen før
// og måttet fjernes igen, fordi de er meningsløse for alle andre end den
// der har bygget den.
const FORBUDT = [
  [/npm run/i, 'en npm-kommando'],
  [/\bdb:setup\b/i, 'db:setup'],
  [/[A-Z_]{4,}=/, 'en miljøvariabel'],
  [/\bSUPABASE\b/, 'ordet SUPABASE med versaler'],
  [/\bRLS\b/, 'forkortelsen RLS'],
  [/\bAPI[- ]?nøgle/i, 'en API-nøgle'],
  [/\bmigration/i, 'ordet migration'],
  [/\bterminal/i, 'ordet terminal'],
  [/\bcommit\b/i, 'ordet commit'],
  [/\bconsole\./i, 'console.'],
]

test('ingen udviklerstof i teksterne', () => {
  for (const [side, h] of Object.entries(HJAELP)) {
    const alt = [h.titel, h.intro, h.bemaerk ?? '', ...h.punkter.flat()].join(' ')
    for (const [m, hvad] of FORBUDT) {
      assert.ok(!m.test(alt), `${side}: indeholder ${hvad}`)
    }
  }
})

test('bemærkningen peger et sted hen når noget kan gå galt', () => {
  // En bemærkning der kun konstaterer et problem er værre end ingen.
  for (const [side, h] of Object.entries(HJAELP)) {
    if (!h.bemaerk) continue
    assert.ok(h.bemaerk.length > 40, `${side}: bemærkningen er for kort til at hjælpe`)
  }
})

test('faldback findes, så en ny side ikke giver en tom boks', () => {
  assert.ok(HJAELP_STANDARD.titel)
  assert.ok(Array.isArray(HJAELP_STANDARD.punkter))
})

console.log(fejlede ? `\n${fejlede} test(s) fejlede.\n` : '\nAlle tests bestået.\n')
process.exit(fejlede ? 1 : 0)
