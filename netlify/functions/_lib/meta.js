import { dekrypter } from './krypto.js'
import { tørkørsel } from './miljo.js'

/**
 * Publicering til Facebook Page og Instagram via Graph API.
 *
 * Hele appen taler kun med publicerTilKanal(). Skal du senere skifte til en
 * aggregator som Ayrshare, er det den ene funktion du udskifter.
 */

const VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0'
const BASE = 'https://graph.facebook.com'

const sov = (ms) => new Promise((r) => setTimeout(r, ms))

class GraphFejl extends Error {
  constructor(besked, kode) {
    super(besked)
    this.name = 'GraphFejl'
    this.kode = kode
  }

  /**
   * Nogle fejl går væk af sig selv (rate limit, midlertidig Meta-fejl). Andre
   * gør ikke (token udløbet, manglende rettighed) — dem skal vi ikke blive ved
   * med at prøve på, for så brænder vi bare rate limit af.
   */
  get kanGentages() {
    if (this.kode === undefined) return true // netværksfejl
    return [1, 2, 4, 17, 32, 613].includes(this.kode)
  }
}

async function haandter(svar) {
  const tekst = await svar.text()
  let json
  try {
    json = tekst ? JSON.parse(tekst) : {}
  } catch {
    throw new GraphFejl(`Uforståeligt svar fra Meta (${svar.status}): ${tekst.slice(0, 200)}`)
  }

  if (!svar.ok || json.error) {
    throw new GraphFejl(
      json.error?.message ?? `Graph API-fejl (${svar.status})`,
      json.error?.code,
    )
  }
  return json
}

async function hent(sti, params) {
  const url = new URL(`${BASE}/${VERSION}/${String(sti).replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return haandter(await fetch(url, { method: 'GET' }))
}

async function send(sti, params) {
  const url = `${BASE}/${VERSION}/${String(sti).replace(/^\//, '')}`
  return haandter(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  )
}

// ---------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------
// Med billede: /{page-id}/photos — Meta henter selv billedet fra url'en.
// Uden billede: /{page-id}/feed.
// Kræver pages_manage_posts + pages_read_engagement.
async function udgivFacebook(kanal, token, opslag) {
  if (!kanal.page_id) throw new GraphFejl('Kanalen mangler page_id.')

  let opslagId
  if (opslag.billedUrl) {
    const svar = await send(`${kanal.page_id}/photos`, {
      url: opslag.billedUrl,
      caption: opslag.tekst,
      access_token: token,
    })
    // /photos giver både billed-id og post_id. Vi vil have post_id'et, for
    // det er opslaget i feedet — ikke billedobjektet.
    opslagId = svar.post_id ?? svar.id
  } else {
    const svar = await send(`${kanal.page_id}/feed`, {
      message: opslag.tekst,
      access_token: token,
    })
    opslagId = svar.id
  }

  let permalink
  try {
    permalink = (await hent(opslagId, { fields: 'permalink_url', access_token: token }))
      .permalink_url
  } catch {
    // Opslaget er ude — vi kunne bare ikke hente linket. Ikke en fejl.
  }

  return { eksternId: opslagId, permalink }
}

// ---------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------
// To trin: opret media container, publicér den. Mellem trinnene henter og
// behandler Meta selv billedet. Publicerer man for tidligt, får man en fejl
// der ligner en rettighedsfejl, men bare er utålmodighed — derfor polles der.
//
// Kræver instagram_basic + instagram_content_publish + pages_read_engagement.
// Kontoen skal være Business eller Creator og koblet til en Facebook-side.
const POLL_MS = 2000
const POLL_MAKS = 15

async function ventPaaContainer(containerId, token) {
  for (let i = 0; i < POLL_MAKS; i++) {
    const svar = await hent(containerId, { fields: 'status_code,status', access_token: token })

    if (svar.status_code === 'FINISHED') return
    if (svar.status_code === 'ERROR') {
      throw new GraphFejl(
        `Instagram kunne ikke behandle billedet: ${svar.status ?? 'ukendt årsag'}. ` +
          'Tjek at URL\'en er offentligt tilgængelig og at billedet er JPEG.',
      )
    }
    if (svar.status_code === 'EXPIRED') {
      throw new GraphFejl('Media container udløb før publicering.')
    }
    await sov(POLL_MS)
  }
  throw new GraphFejl(
    `Instagram blev ikke færdig med billedet inden for ${(POLL_MAKS * POLL_MS) / 1000} sekunder.`,
  )
}

async function udgivInstagram(kanal, token, opslag) {
  if (!kanal.ig_user_id) throw new GraphFejl('Kanalen mangler ig_user_id.')
  if (!opslag.billedUrl) {
    throw new GraphFejl('Instagram kræver et billede — opslaget har ingen billed-URL.')
  }

  const container = await send(`${kanal.ig_user_id}/media`, {
    image_url: opslag.billedUrl,
    caption: opslag.tekst,
    ...(opslag.altTekst ? { alt_text: opslag.altTekst } : {}),
    access_token: token,
  })

  await ventPaaContainer(container.id, token)

  const udgivet = await send(`${kanal.ig_user_id}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  })

  let permalink
  try {
    permalink = (await hent(udgivet.id, { fields: 'permalink', access_token: token })).permalink
  } catch {
    // Ikke kritisk.
  }

  return { eksternId: udgivet.id, permalink }
}

const UDGIVERE = {
  facebook: udgivFacebook,
  instagram: udgivInstagram,
  linkedin: async () => {
    // LinkedIn vil have billedet uploadet til sig først, modsat Meta der selv
    // henter fra en URL. Det er reelt arbejde, ikke bare en ekstra streng.
    throw new GraphFejl('LinkedIn-publicering er ikke implementeret endnu.')
  },
}

/**
 * Hvilket token gælder for en kanal?
 *
 * Kanalens eget vinder; ellers låner den kundens. Et Meta-systemtoken hører
 * til en Business-portefølje og dækker de sider det er tildelt — så ét token
 * kan betjene alle en kundes sider, og skal kun roteres ét sted.
 *
 * Reglen står også som view'et kanal_med_token i migration 0004, så appen og
 * funktionerne svarer ens.
 */
export function gaeldendeToken(kanal) {
  return kanal?.token_ciphertext ?? kanal?.brands?.customers?.token_ciphertext ?? null
}

/** Tekst + hashtags samlet til det der faktisk står i opslaget. */
export function tekstMedTags(opslag) {
  const tags = (opslag.hashtags ?? []).map((t) => (t.startsWith('#') ? t : `#${t}`))
  return tags.length ? `${opslag.body}\n\n${tags.join(' ')}` : opslag.body
}

/**
 * Sender ét opslag til én kanal. Kaster aldrig — returnerer altid et resultat,
 * så én kanals fejl ikke stopper de andre.
 */
export async function publicerTilKanal(kanal, opslag) {
  const grund = { ok: false, platform: kanal.platform, kanalId: kanal.id }

  if (tørkørsel()) {
    console.log(
      `[TØRKØRSEL] ${kanal.platform}/${kanal.display_name}:`,
      JSON.stringify({ tekst: opslag.tekst, billedUrl: opslag.billedUrl }, null, 2),
    )
    return { ...grund, ok: true, eksternId: `tørkørsel_${kanal.id}`, tørkørsel: true }
  }

  if (!kanal.active) return { ...grund, fejl: 'Kanalen er slået fra.' }
  if (!kanal.token_ciphertext) {
    return { ...grund, fejl: 'Hverken kanalen eller kunden har et token.' }
  }

  let token
  try {
    token = dekrypter(kanal.token_ciphertext)
  } catch (e) {
    return { ...grund, fejl: `Kunne ikke dekryptere token: ${e.message}` }
  }

  try {
    const { eksternId, permalink } = await UDGIVERE[kanal.platform](kanal, token, opslag)
    return { ...grund, ok: true, eksternId, permalink }
  } catch (e) {
    const kode = e instanceof GraphFejl && e.kode ? ` (kode ${e.kode})` : ''
    return { ...grund, fejl: `${e.message}${kode}`, kanGentages: e.kanGentages ?? false }
  }
}

/** Bekræfter at tokenet stadig kan se kanalen. */
export async function testKanal(kanal) {
  if (!kanal.token_ciphertext) return { ok: false, fejl: 'Intet token.' }

  try {
    const token = dekrypter(kanal.token_ciphertext)

    if (kanal.platform === 'instagram') {
      if (!kanal.ig_user_id) return { ok: false, fejl: 'Mangler ig_user_id.' }
      const svar = await hent(kanal.ig_user_id, { fields: 'id,username', access_token: token })
      return { ok: true, navn: svar.username }
    }

    if (kanal.platform === 'facebook') {
      if (!kanal.page_id) return { ok: false, fejl: 'Mangler page_id.' }
      const svar = await hent(kanal.page_id, { fields: 'id,name', access_token: token })
      return { ok: true, navn: svar.name }
    }

    return { ok: false, fejl: 'Platformen understøttes ikke endnu.' }
  } catch (e) {
    return { ok: false, fejl: e.message }
  }
}

/**
 * Publicerer ét opslag til alle dets kanaler og skriver resultatet tilbage.
 * Hver kanal for sig: fejler Instagram, skal Facebook stadig ud.
 */
export async function publicerOpslag(klient, opslagId) {
  const { data: opslag, error } = await klient
    .from('posts')
    .select('*')
    .eq('id', opslagId)
    .single()

  if (error || !opslag) throw new Error(`Opslag ${opslagId} findes ikke.`)

  // Kundens token hentes med, så en kanal uden eget token kan låne det.
  // Ét systemtoken dækker typisk alle sider i samme Business-portefølje.
  const { data: maal } = await klient
    .from('post_targets')
    .select('*, channels(*, brands(customers(token_ciphertext)))')
    .eq('post_id', opslagId)
    .in('status', ['pending', 'failed'])

  if (!maal?.length) return []

  // Tørkørsel må ikke efterlade spor. Markerede vi opslaget som publiceret,
  // ville kalenderen lyve OG opslaget blive sprunget over den dag du går live,
  // fordi det allerede stod som færdigt. En tørkørsel skal kunne gentages i det
  // uendelige og lade databasen stå præcis som før.
  const tørt = tørkørsel()

  if (!tørt) {
    await klient.from('posts').update({ status: 'publishing' }).eq('id', opslagId)
  }

  const tekst = tekstMedTags(opslag)
  const resultater = []

  for (const m of maal) {
    const kanal = m.channels ? { ...m.channels, token_ciphertext: gaeldendeToken(m.channels) } : null
    if (!kanal) continue

    if (!tørt) {
      await klient
        .from('post_targets')
        .update({ status: 'publishing', attempts: (m.attempts ?? 0) + 1 })
        .eq('id', m.id)
    }

    const res = await publicerTilKanal(kanal, {
      tekst,
      billedUrl: opslag.image_url ?? undefined,
    })
    resultater.push({ ...res, kanalNavn: kanal.display_name })

    if (tørt) continue

    await klient
      .from('post_targets')
      .update({
        status: res.ok ? 'published' : 'failed',
        external_id: res.eksternId ?? null,
        permalink: res.permalink ?? null,
        error: res.fejl ?? null,
        published_at: res.ok ? new Date().toISOString() : null,
      })
      .eq('id', m.id)
  }

  if (tørt) return resultater

  const alleOk = resultater.every((r) => r.ok)
  await klient
    .from('posts')
    .update({ status: alleOk ? 'published' : 'failed' })
    .eq('id', opslagId)

  return resultater
}

/** Finder og publicerer alt der er godkendt og forfaldent. */
export async function publicerForfaldne(klient, nu = new Date()) {
  const { data: forfaldne, error } = await klient
    .from('posts')
    .select('id')
    .eq('status', 'approved')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', nu.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(25)

  if (error) throw new Error(error.message)
  if (!forfaldne?.length) return []

  const ud = []
  for (const r of forfaldne) {
    try {
      ud.push({ opslagId: r.id, resultater: await publicerOpslag(klient, r.id) })
    } catch (e) {
      console.error(`Publicering af ${r.id} fejlede:`, e)
      ud.push({ opslagId: r.id, resultater: [{ ok: false, fejl: e.message }] })
    }
  }
  return ud
}
