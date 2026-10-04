/**
 * Tester artiklen: prompten og læsningen af svaret.
 *
 *   npm run test:artikel
 *
 * Hvorfor den har en test: artiklen er det eneste sted i appen hvor et
 * svar fra modellen bliver til ÉN tekst man kopierer ud i hånden. Går
 * noget galt i sammensætningen, opdages det ikke af en fejlbesked -- det
 * opdages af at noget mangler i det man lige har indsat i LinkedIn.
 *
 * Intet netværk.
 */

import assert from 'node:assert/strict'
import {
  byggArtikelPrompt, byggCoverPrompt, laesArtikel, laesCoverBrief, STANDARD_RETNINGSLINJER,
} from '../src/prompt.js'

let fejlede = 0
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`) }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`) }
}

const BRAND = { name: 'Pearl', description: 'SAP-rådgivning' }
const KAMPAGNE = { name: 'Service management', brief: 'Servitization', goal: '' }
const OPSLAG = [
  { tekst: 'Første opslag om anlægsdata.' },
  { tekst: 'Andet opslag om prissætning af risiko.' },
]

console.log('\nPrompten')

test('opslagene kommer med, nummererede', () => {
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.match(p, /OPSLAG 1/)
  assert.match(p, /OPSLAG 2/)
  assert.match(p, /anlægsdata/)
})

test('den siger udtrykkeligt at det ikke er en opsummering', () => {
  // Uden den sætning skriver modellen «i denne serie gennemgik jeg …»,
  // og så er artiklen kun læselig for dem der allerede så opslagene.
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.match(p, /ikke en opsummering/)
})

test('sproget arves fra kampagnen', () => {
  const p = byggArtikelPrompt({
    brand: BRAND, kampagne: { ...KAMPAGNE, sprog: 'en' }, opslag: OPSLAG,
  })
  assert.match(p, /in ENGLISH/)
})

test('dansk er standard', () => {
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.match(p, /SPROG: dansk/)
})

test('retningslinjerne står først', () => {
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.ok(p.startsWith(STANDARD_RETNINGSLINJER.slice(0, 40)))
})

test('en særlig instruks kommer med', () => {
  const p = byggArtikelPrompt({
    brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG, instruks: 'Hold den under 800 ord.',
  })
  assert.match(p, /Hold den under 800 ord/)
})

test('ingen instruks giver intet tomt afsnit', () => {
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.ok(!p.includes('SÆRLIGT FOR DENNE ARTIKEL'))
})

console.log('\nLæsning af svaret')

const svar = (o) => '```json\n' + JSON.stringify(o) + '\n```'

test('titel, underrubrik og brødtekst pakkes ud', () => {
  const a = laesArtikel(svar({
    titel: 'Den dyre beslutning', underrubrik: 'Hvad det koster', brødtekst: '## Et\nTo',
  }))
  assert.equal(a.titel, 'Den dyre beslutning')
  assert.equal(a.underrubrik, 'Hvad det koster')
  assert.match(a.brødtekst, /## Et/)
})

test('den samlede tekst starter med titlen', () => {
  const a = laesArtikel(svar({ titel: 'T', underrubrik: 'U', brødtekst: 'B' }))
  assert.ok(a.samlet.startsWith('T'), 'titlen skal stå først — den skal i LinkedIns titelfelt')
  assert.match(a.samlet, /U/)
  assert.match(a.samlet, /B/)
})

test('uden underrubrik bliver der ikke et hul i teksten', () => {
  const a = laesArtikel(svar({ titel: 'T', brødtekst: 'B' }))
  assert.equal(a.underrubrik, '')
  assert.ok(!a.samlet.includes('\n\n\n'), `tre linjeskift i træk: ${JSON.stringify(a.samlet)}`)
})

test('rå JSON uden blok virker også', () => {
  const a = laesArtikel(JSON.stringify({ titel: 'T', brødtekst: 'B' }))
  assert.equal(a.titel, 'T')
})

test('et objekt kan sendes direkte ind', () => {
  const a = laesArtikel({ titel: 'T', brødtekst: 'B' })
  assert.equal(a.titel, 'T')
})

test('manglende titel giver en forklarende fejl', () => {
  assert.throws(() => laesArtikel(svar({ brødtekst: 'B' })), /titel/i)
})

test('manglende brødtekst giver en forklarende fejl', () => {
  assert.throws(() => laesArtikel(svar({ titel: 'T' })), /brødtekst/i)
})

test('tomt indsæt siger hvad der mangler', () => {
  assert.throws(() => laesArtikel('   '), /Indsæt/)
})

test('ugyldig JSON nævner at det er JSON der fejler', () => {
  assert.throws(() => laesArtikel('{ ikke json'), /JSON/)
})

console.log('\nCoverbilledet')

test('prompten beder om en billedbrief til coveret', () => {
  const p = byggArtikelPrompt({ brand: BRAND, kampagne: KAMPAGNE, opslag: OPSLAG })
  assert.match(p, /billedbrief/)
  assert.match(p, /coverbilledet/)
  assert.match(p, /Ingen mennesker/)
})

test('billedbriefen kommer med ud', () => {
  const a = laesArtikel(svar({
    titel: 'T', brødtekst: 'B', billedbrief: 'En tom produktionshal i morgenlys.',
  }))
  assert.equal(a.billedbrief, 'En tom produktionshal i morgenlys.')
})

test('en manglende billedbrief vælter ikke artiklen', () => {
  // Et gammelt svar, eller en model der sprang feltet over. Artiklen er
  // stadig brugbar — coveret kan laves i hånden bagefter.
  const a = laesArtikel(svar({ titel: 'T', brødtekst: 'B' }))
  assert.equal(a.billedbrief, '')
  assert.equal(a.titel, 'T')
})

test('billedbriefen havner ikke i den samlede tekst', () => {
  // Den er en arbejdsanvisning, ikke noget der skal i LinkedIns editor.
  const a = laesArtikel(svar({ titel: 'T', brødtekst: 'B', billedbrief: 'HEMMELIG' }))
  assert.ok(!a.samlet.includes('HEMMELIG'))
})

console.log('\nBrief til en artikel der allerede findes')

// Den vej findes fordi alternativet var at skrive artiklen om for at få et
// billede -- og dermed kaste håndrettelserne væk.
test('prompten indeholder artiklen selv', () => {
  const p = byggCoverPrompt({ brand: BRAND, artikel: 'Titel\n\nNoget om anlægsdata.' })
  assert.match(p, /anlægsdata/)
  assert.match(p, /COVERBILLEDE/)
})

test('den beder om ét forslag, ikke en liste', () => {
  const p = byggCoverPrompt({ brand: BRAND, artikel: 'T' })
  assert.match(p, /ÉN beskrivelse/)
  assert.match(p, /Ikke flere forslag/)
})

test('JSON-svar læses', () => {
  assert.equal(laesCoverBrief(svar({ billedbrief: 'En hal' })), 'En hal')
})

test('et objekt kan sendes direkte ind', () => {
  assert.equal(laesCoverBrief({ billedbrief: 'Fra objekt' }), 'Fra objekt')
})

test('bar tekst accepteres', () => {
  // Beder man om én beskrivelse, svarer modellen ofte med præcis den og
  // ingen JSON. At afvise netop det man bad om ville være pedanteri.
  assert.equal(laesCoverBrief('En tom hal i morgenlys.'), 'En tom hal i morgenlys.')
})

test('citationstegn omkring hele svaret klippes væk', () => {
  assert.equal(laesCoverBrief('«En tom hal.»'), 'En tom hal.')
  assert.equal(laesCoverBrief('"En tom hal."'), 'En tom hal.')
})

test('tomt svar siger hvad der mangler', () => {
  assert.throws(() => laesCoverBrief('   '), /Indsæt/)
})

test('JSON uden billedbrief giver en forklarende fejl', () => {
  assert.throws(() => laesCoverBrief(svar({ noget: 'andet' })), /billedbrief/)
})

test('et ægte linjeskift inde i strengen vælter det ikke', () => {
  // Det her er den fejl der faktisk skete: modellen skrev beskrivelsen over
  // to linjer, og så er JSON'en ugyldig. Indholdet fejlede ingenting —
  // kun formen — og et svar der er helt i orden må ikke afvises.
  const raat = '{ "billedbrief": "Et reservedelslager sent på dagen.\nIngen mennesker." }'
  const ud = laesCoverBrief(raat)
  assert.match(ud, /reservedelslager/)
  assert.match(ud, /Ingen mennesker/)
  assert.ok(!ud.includes('\n'), 'linjeskiftet skal blive til et mellemrum')
})

test('escapede citationstegn overlever udtrækket', () => {
  const raat = '{ "billedbrief": "En hal med et skilt der siger \\"stop\\" ved døren." }'
  assert.match(laesCoverBrief(raat), /stop/)
})

console.log(fejlede ? `\n${fejlede} test(s) fejlede.\n` : '\nAlle tests bestået.\n')
process.exit(fejlede ? 1 : 0)
