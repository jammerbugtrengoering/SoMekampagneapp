/**
 * Røgtest uden netværk og uden database.
 *
 *   npm run test:publicering
 *
 * Kontrollerer at:
 *   - token-kryptering kan gå frem og tilbage, og at pillet ciphertext afvises
 *   - tørkørsel faktisk ikke sender noget til Meta
 *   - Instagram afvises pænt når der ikke er noget billede
 *   - hashtags havner rigtigt i teksten
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.PUBLISH_DRY_RUN = 'true'

const { krypter, dekrypter, maskeer } = await import(
  '../netlify/functions/_lib/krypto.js'
)
const { publicerTilKanal, tekstMedTags } = await import(
  '../netlify/functions/_lib/meta.js'
)

let fejlede = 0

async function test(navn, fn) {
  try {
    await fn()
    console.log(`  ✓ ${navn}`)
  } catch (e) {
    fejlede++
    console.error(`  ✗ ${navn}\n    ${e.message}`)
  }
}

const kanal = {
  id: 'ch-1', brand_id: 'br-1', platform: 'facebook', display_name: 'Testside',
  page_id: '123456', ig_user_id: null, token_ciphertext: null, active: true,
}

console.log('\nKryptering')

await test('token overlever kryptering og dekryptering', () => {
  const org = 'EAAGm0PX4ZCpsBA' + 'x'.repeat(180)
  assert.equal(dekrypter(krypter(org)), org)
})

await test('to krypteringer af samme token giver forskellig ciphertext', () => {
  assert.notEqual(krypter('EAAG-hemmeligt'), krypter('EAAG-hemmeligt'))
})

await test('pillet ciphertext afvises', () => {
  const b = Buffer.from(krypter('EAAG-hemmeligt'), 'base64')
  b[b.length - 1] ^= 0xff
  assert.throws(() => dekrypter(b.toString('base64')))
})

await test('maskeer skjuler midten', () => {
  const m = maskeer('EAAGabcdefghijklmnop9xQ2')
  assert.equal(m, 'EAAG…9xQ2')
  assert.ok(!m.includes('efghij'))
})

console.log('\nBeskeder')

await test('hashtags sættes på til sidst', () => {
  assert.equal(
    tekstMedTags({ body: 'Vi søger frivillige.', hashtags: ['klubliv', 'lokalt'] }),
    'Vi søger frivillige.\n\n#klubliv #lokalt',
  )
})

await test('hashtags med # bliver ikke dobbelt-tagget', () => {
  assert.equal(tekstMedTags({ body: 'Hej.', hashtags: ['#rengøring'] }), 'Hej.\n\n#rengøring')
})

await test('ingen hashtags giver ingen ekstra linjeskift', () => {
  assert.equal(tekstMedTags({ body: 'Bare tekst.', hashtags: [] }), 'Bare tekst.')
})

console.log('\nTørkørsel')

await test('tørkørsel publicerer ikke, men melder ok', async () => {
  // Rører koden nettet, fejler testen her.
  const oprindelig = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Tørkørsel forsøgte at kalde nettet!') }
  try {
    const r = await publicerTilKanal(kanal, { tekst: 'Test' })
    assert.equal(r.ok, true)
    assert.equal(r.tørkørsel, true)
  } finally {
    globalThis.fetch = oprindelig
  }
})

console.log('\nInstagram-regler')

await test('Instagram afvises uden billede', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const r = await publicerTilKanal(
    { ...kanal, platform: 'instagram', ig_user_id: '789', token_ciphertext: krypter('t') },
    { tekst: 'Uden billede' },
  )
  process.env.PUBLISH_DRY_RUN = 'true'
  assert.equal(r.ok, false)
  assert.match(r.fejl ?? '', /billede/i)
})

await test('Instagram afvises uden ig_user_id', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const r = await publicerTilKanal(
    { ...kanal, platform: 'instagram', token_ciphertext: krypter('t') },
    { tekst: 'Test', billedUrl: 'https://example.com/a.jpg' },
  )
  process.env.PUBLISH_DRY_RUN = 'true'
  assert.equal(r.ok, false)
  assert.match(r.fejl ?? '', /ig_user_id/)
})

await test('kanal uden token afvises før netværkskald', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const r = await publicerTilKanal(kanal, { tekst: 'Test' })
  process.env.PUBLISH_DRY_RUN = 'true'
  assert.equal(r.ok, false)
  assert.match(r.fejl ?? '', /token/i)
})

console.log(fejlede === 0 ? '\nAlle tests bestået.\n' : `\n${fejlede} test(s) fejlede.\n`)
process.exit(fejlede === 0 ? 0 : 1)
