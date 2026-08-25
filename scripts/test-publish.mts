/**
 * Røgtest uden netværk og uden database.
 *
 * Kontrollerer at:
 *   - token-kryptering kan gå frem og tilbage
 *   - dry-run faktisk ikke sender noget til Meta
 *   - Instagram afvises pænt når der ikke er noget billede
 *   - hashtags renderes ind i beskeden
 *
 * Kør: npm run test:publish
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.PUBLISH_DRY_RUN = 'true'

const { encryptToken, decryptToken, maskToken } = await import('../src/lib/crypto')
const { publishToChannel, renderMessage, isDryRun } = await import('../src/lib/publish')
const { instagramPublisher } = await import('../src/lib/publish/instagram')

let failures = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : error}`)
  }
}

const channel = {
  id: 'ch-1',
  brand_id: 'br-1',
  platform: 'facebook' as const,
  display_name: 'Testside',
  page_id: '123456',
  ig_user_id: null,
  token_ciphertext: null,
  token_label: null,
  active: true,
  last_verified_at: null,
  last_error: null,
  created_at: new Date().toISOString(),
}

console.log('\nKryptering')
await test('token overlever kryptering og dekryptering', () => {
  const original = 'EAAGm0PX4ZCpsBA' + 'x'.repeat(180)
  assert.equal(decryptToken(encryptToken(original)), original)
})

await test('to krypteringer af samme token giver forskellig ciphertext', () => {
  const token = 'EAAG-hemmeligt-token'
  assert.notEqual(encryptToken(token), encryptToken(token))
})

await test('pillet ciphertext afvises', () => {
  const packed = encryptToken('EAAG-hemmeligt-token')
  const bytes = Buffer.from(packed, 'base64')
  bytes[bytes.length - 1] ^= 0xff
  assert.throws(() => decryptToken(bytes.toString('base64')))
})

await test('maskToken skjuler midten', () => {
  const masked = maskToken('EAAGabcdefghijklmnop9xQ2')
  assert.equal(masked, 'EAAG…9xQ2')
  assert.ok(!masked.includes('efghij'))
})

console.log('\nBeskeder')
await test('hashtags sættes på til sidst', () => {
  const message = renderMessage({ body: 'Vi søger frivillige.', hashtags: ['klubliv', 'lokalt'] })
  assert.equal(message, 'Vi søger frivillige.\n\n#klubliv #lokalt')
})

await test('hashtags der allerede har # bliver ikke dobbelt-tagget', () => {
  const message = renderMessage({ body: 'Hej.', hashtags: ['#rengøring'] })
  assert.equal(message, 'Hej.\n\n#rengøring')
})

await test('ingen hashtags giver ingen ekstra linjeskift', () => {
  assert.equal(renderMessage({ body: 'Bare tekst.', hashtags: [] }), 'Bare tekst.')
})

console.log('\nDry-run')
await test('dry-run er slået til når PUBLISH_DRY_RUN ikke er "false"', () => {
  assert.equal(isDryRun(), true)
})

await test('dry-run publicerer ikke, men melder ok', async () => {
  // Hvis der bliver kaldt ud til Meta, fejler testen her.
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('Dry-run forsøgte at kalde nettet!')
  }) as typeof fetch

  try {
    const result = await publishToChannel(channel, { message: 'Test' })
    assert.equal(result.ok, true)
    assert.equal(result.dryRun, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

console.log('\nInstagram-regler')
await test('Instagram afvises uden billede', async () => {
  const result = await instagramPublisher.publish(
    { ...channel, platform: 'instagram', ig_user_id: '789' },
    'token',
    { message: 'Uden billede' },
  )
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /billede/i)
})

await test('Instagram afvises uden ig_user_id', async () => {
  const result = await instagramPublisher.publish(
    { ...channel, platform: 'instagram' },
    'token',
    { message: 'Test', imageUrl: 'https://example.com/a.jpg' },
  )
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /ig_user_id/)
})

console.log(
  failures === 0
    ? '\nAlle tests bestået.\n'
    : `\n${failures} test(s) fejlede.\n`,
)
process.exit(failures === 0 ? 0 : 1)
