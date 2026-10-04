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

console.log('\nTørkørsel rører ikke databasen')

/**
 * Stub-klient der optager hvert skrivekald. Under tørkørsel skal listen
 * være tom — ellers ville kalenderen vise "Publiceret" for noget der aldrig
 * blev sendt, og opslaget ville blive sprunget over den dag vi går live.
 */
function stubKlient(skrivninger) {
  const opslag = {
    id: 'p1', body: 'Tekst', hashtags: [], image_url: 'https://eksempel.dk/a.jpg',
  }
  // status skal med: rækken i databasen har 'pending' som standard, og
  // publiceringen vælger netop på den. Uden feltet lignede stubben et mål
  // der allerede var behandlet.
  const maal = [{
    id: 't1', attempts: 0, status: 'pending',
    channels: { ...kanal, id: 'ch-1', token_ciphertext: krypter('t') },
  }]

  // eq() skal både kunne await'es direkte (post_targets hentes nu uden
  // .in(), fordi alle mål skal med) og bruges som .eq().single().
  const byg = (tabel) => ({
    select: () => ({
      eq: () => {
        const svar = { data: tabel === 'post_targets' ? maal : null, error: null }
        return Object.assign(Promise.resolve(svar), {
          single: async () => ({ data: tabel === 'posts' ? opslag : null, error: null }),
          in: async () => ({ data: tabel === 'post_targets' ? maal : [], error: null }),
        })
      },
    }),
    update: (v) => ({ eq: async () => { skrivninger.push({ tabel, v }); return { error: null } } }),
  })

  return { from: byg }
}

/** Som stubKlient, men opslaget har ingen kanalrækker overhovedet. */
function stubUdenKanaler() {
  const opslag = { id: 'p1', body: 'Tekst', hashtags: [] }
  return {
    from: (tabel) => ({
      select: () => ({
        eq: () => Object.assign(Promise.resolve({ data: [], error: null }), {
          single: async () => ({ data: tabel === 'posts' ? opslag : null, error: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }
}

const { publicerOpslag } = await import('../netlify/functions/_lib/meta.js')

await test('tørkørsel skriver ingen status til databasen', async () => {
  process.env.PUBLISH_DRY_RUN = 'true'
  const skrivninger = []
  const res = await publicerOpslag(stubKlient(skrivninger), 'p1')

  assert.equal(res.length, 1, 'skulle stadig give et resultat')
  assert.equal(res[0].tørkørsel, true)
  assert.deepEqual(skrivninger, [], `forventede ingen skrivninger, fik ${JSON.stringify(skrivninger)}`)
})

await test('et opslag uden kanaler siger det hoejt i stedet for at blive sprunget over', async () => {
  // Det her var den tavse fejl: en tom liste betød «ingen ventende mål», og
  // funktionen returnerede bare []. Opslaget blev så liggende som godkendt
  // og forfaldent, kvarter efter kvarter, uden et ord nogen steder.
  await assert.rejects(
    () => publicerOpslag(stubUdenKanaler(), 'p1'),
    /ingen kanaler/i,
  )
})

await test('uden tørkørsel skrives status som normalt', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const skrivninger = []
  // Netværket blokeres, så kaldet fejler — men statusskrivningerne skal ske.
  const oprindelig = globalThis.fetch
  globalThis.fetch = () => { throw new Error('ingen netvaerk i test') }
  try {
    await publicerOpslag(stubKlient(skrivninger), 'p1')
  } finally {
    globalThis.fetch = oprindelig
    process.env.PUBLISH_DRY_RUN = 'true'
  }
  const tabeller = skrivninger.map((s) => s.tabel)
  assert.ok(tabeller.includes('posts'), 'posts skulle opdateres')
  assert.ok(tabeller.includes('post_targets'), 'post_targets skulle opdateres')
})

console.log('\nLinkedIn')

const { gaeldendeToken } = await import('../netlify/functions/_lib/meta.js')
const { LinkedInFejl } = await import('../netlify/functions/_lib/linkedin.js')

const liKanal = {
  id: 'ch-li', brand_id: 'br-1', platform: 'linkedin', display_name: 'Jonn',
  author_urn: 'urn:li:person:abc123', active: true, token_ciphertext: null,
}

const iMorgen = () => new Date(Date.now() + 86400000).toISOString()
const iGaar = () => new Date(Date.now() - 86400000).toISOString()

await test('tokenet hentes fra linkedin_tokens, ikke fra kanalen', () => {
  const k = {
    ...liKanal,
    token_ciphertext: 'metas-token-der-ikke-maa-bruges',
    brands: { customers: { token_ciphertext: 'kundens-meta-token',
      linkedin_tokens: [{ access_ciphertext: 'li-token', access_udloeber: iMorgen() }] } },
  }
  assert.equal(gaeldendeToken(k), 'li-token')
})

await test('en Meta-kanal rører ikke linkedin_tokens', () => {
  const k = { ...kanal, token_ciphertext: 'metas-token' }
  assert.equal(gaeldendeToken(k), 'metas-token')
})

// Billed-uploaden er et netværkskald FØR selve publiceringen. Det er præcis
// den slags der slipper uden om en gate der kun dækker det sidste kald.
await test('tørkørsel rører ikke nettet — heller ikke billed-uploaden', async () => {
  process.env.PUBLISH_DRY_RUN = 'true'
  const oprindelig = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Tørkørsel forsøgte at kalde nettet!') }
  try {
    const r = await publicerTilKanal(
      { ...liKanal, token_ciphertext: krypter('t') },
      { tekst: 'Test', billedUrl: 'https://eksempel.dk/a.jpg' },
    )
    assert.equal(r.ok, true)
    assert.equal(r.tørkørsel, true)
  } finally {
    globalThis.fetch = oprindelig
  }
})

await test('udløbet adgang afvises før netværkskald', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const oprindelig = globalThis.fetch
  globalThis.fetch = () => { throw new Error('skulle aldrig nå nettet') }
  try {
    const r = await publicerTilKanal(
      {
        ...liKanal,
        token_ciphertext: krypter('t'),
        brands: { customers: { linkedin_tokens: [{ access_udloeber: iGaar() }] } },
      },
      { tekst: 'Test' },
    )
    assert.equal(r.ok, false)
    assert.match(r.fejl ?? '', /udløbet/i)
  } finally {
    globalThis.fetch = oprindelig
    process.env.PUBLISH_DRY_RUN = 'true'
  }
})

await test('kanal uden author_urn afvises pænt', async () => {
  process.env.PUBLISH_DRY_RUN = 'false'
  const r = await publicerTilKanal(
    { ...liKanal, author_urn: null, token_ciphertext: krypter('t') },
    { tekst: 'Test' },
  )
  process.env.PUBLISH_DRY_RUN = 'true'
  assert.equal(r.ok, false)
  assert.match(r.fejl ?? '', /author_urn/)
})

await test('401 gentages ikke, 429 og 503 gør', () => {
  assert.equal(new LinkedInFejl('udløbet', 401).kanGentages, false)
  assert.equal(new LinkedInFejl('ingen adgang', 403).kanGentages, false)
  assert.equal(new LinkedInFejl('for hurtigt', 429).kanGentages, true)
  assert.equal(new LinkedInFejl('nede', 503).kanGentages, true)
  assert.equal(new LinkedInFejl('netværk').kanGentages, true)
})

console.log(fejlede === 0 ? '\nAlle tests bestået.\n' : `\n${fejlede} test(s) fejlede.\n`)
process.exit(fejlede === 0 ? 0 : 1)
