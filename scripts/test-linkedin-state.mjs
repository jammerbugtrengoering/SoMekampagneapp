/**
 * Tester den signerede state i LinkedIns OAuth-flow.
 *
 *   npm run test:linkedin
 *
 * Hvorfor netop den har en test: callback'et er et redirect fra LinkedIn.
 * Der er ingen session, ingen Authorization-header, intet kraevOrgRolle
 * kan spoerge om -- og alligevel skriver funktionen et token ind hos en
 * bestemt kunde. State'en ER adgangskontrollen. Kunne den forfalskes,
 * kunne enhver faa sit eget LinkedIn-token skrevet ind hos en fremmed
 * kunde og derefter publicere paa dennes vegne.
 *
 * Intet netvaerk. Testen roerer kun signaturen.
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const { lavState, laesState } = await import('../netlify/functions/_lib/linkedin-state.js')

let fejlede = 0
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`) }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`) }
}

const GYLDIG = { kundeId: 'kunde-a', orgId: 'org-a', brugerId: 'bruger-a' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

console.log('\nRundtur')

test('det der blev signeret, kommer ud igen', () => {
  const ud = laesState(lavState(GYLDIG))
  assert.equal(ud.kundeId, 'kunde-a')
  assert.equal(ud.orgId, 'org-a')
  assert.equal(ud.brugerId, 'bruger-a')
})

test('to states er aldrig ens', () => {
  assert.notEqual(lavState(GYLDIG), lavState(GYLDIG))
})

console.log('\nForfalskning')

// Den vigtigste: skift kunden ud, behold signaturen. Lykkedes det, kunne
// et token skrives ind hos en anden kundes profil.
test('en anden kunde i kroppen afvises', () => {
  const [, sig] = lavState(GYLDIG).split('.')
  const falsk = `${b64({ k: 'kunde-b', o: 'org-a', u: 'bruger-a', n: 'x', udloeber: Date.now() + 60000 })}.${sig}`
  assert.throws(() => laesState(falsk), /ugyldig signatur/i)
})

test('en aendret signatur afvises', () => {
  const [krop, sig] = lavState(GYLDIG).split('.')
  const vendt = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A')
  assert.throws(() => laesState(`${krop}.${vendt}`), /ugyldig signatur/i)
})

test('en state uden signatur afvises', () => {
  assert.throws(() => laesState(b64(GYLDIG)), /form/i)
})

test('tom og forkert type afvises', () => {
  assert.throws(() => laesState(''), /mangler|form/i)
  assert.throws(() => laesState(null), /mangler|form/i)
})

// En laengere signatur maa ikke faa timingSafeEqual til at kaste noget
// andet end vores egen fejl -- og laengden alene maa ikke afgoere noget.
test('en signatur af forkert laengde afvises pænt', () => {
  const [krop, sig] = lavState(GYLDIG).split('.')
  assert.throws(() => laesState(`${krop}.${sig}ekstra`), /ugyldig signatur/i)
  assert.throws(() => laesState(`${krop}.kort`), /ugyldig signatur/i)
})

console.log('\nLevetid')

test('en udloebet state afvises', () => {
  const gammel = lavState({ ...GYLDIG, nu: Date.now() - 60 * 60 * 1000 })
  assert.throws(() => laesState(gammel), /udloebet/i)
})

test('en frisk state er gyldig lige inden udloeb', () => {
  const s = lavState(GYLDIG)
  // 9 minutter senere: stadig inden for de 10.
  assert.equal(laesState(s, Date.now() + 9 * 60 * 1000).kundeId, 'kunde-a')
})

test('udloeb kan ikke fjernes ved at slette feltet', () => {
  const [, sig] = lavState(GYLDIG).split('.')
  const uden = `${b64({ k: 'kunde-a', o: 'org-a', u: 'bruger-a', n: 'x' })}.${sig}`
  assert.throws(() => laesState(uden), /ugyldig signatur/i)
})

console.log('\nNoeglen')

test('en state signeret med en anden noegle afvises', async () => {
  // Modulet laeser noeglen ved hvert kald, saa et skift her rammer med det
  // samme -- praecis som hvis TOKEN_ENCRYPTION_KEY blev rullet i Netlify.
  const s = lavState(GYLDIG)
  const oprindelig = process.env.TOKEN_ENCRYPTION_KEY
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  try {
    assert.throws(() => laesState(s), /ugyldig signatur/i)
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = oprindelig
  }
})

console.log(fejlede === 0 ? '\nAlle tests bestået.\n' : `\n${fejlede} test(s) fejlede.\n`)
process.exit(fejlede === 0 ? 0 : 1)
