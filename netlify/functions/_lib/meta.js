import { dekrypter } from './krypto.js'
import { testLinkedIn, udgivLinkedIn } from './linkedin.js'
import { tørkørsel } from './miljo.js'
import { tekstTilKanal } from '../../../src/kanalregler.js'

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
  linkedin: udgivLinkedIn,
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
/**
 * LinkedIn-tokenet hører ikke i channels.token_ciphertext.
 *
 * Det er fire værdier med to udløbsdatoer og bor i sin egen tabel, hentet
 * med ind via kunden. PostgREST giver en indlejret relation som array
 * eller objekt alt efter hvordan den læses — begge former tages her, så
 * kaldstedet ikke skal vide hvilken det blev.
 */
export function linkedinRaekke(kanal) {
  const r = kanal?.brands?.customers?.linkedin_tokens ?? kanal?.linkedin_tokens
  return Array.isArray(r) ? (r[0] ?? null) : (r ?? null)
}

export function gaeldendeToken(kanal) {
  // LinkedIn arver ikke kanal → kunde som Meta gør. Autorisationen hører
  // til det menneske der gav den, og den ligger på kunden.
  if (kanal?.platform === 'linkedin') return linkedinRaekke(kanal)?.access_ciphertext ?? null

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

  // Et udløbet LinkedIn-token giver en 401 der ligner en rettighedsfejl.
  // Datoen står i basen, så spørgsmålet kan stilles uden et netværkskald —
  // og svaret kan sige hvad man skal gøre ved det.
  if (kanal.platform === 'linkedin') {
    const r = linkedinRaekke(kanal)
    if (r?.access_udloeber && new Date(r.access_udloeber).getTime() < Date.now()) {
      return {
        ...grund,
        fejl: 'LinkedIn-adgangen er udløbet. Forbind kunden igen under Kunder → LinkedIn.',
      }
    }
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

    if (kanal.platform === 'linkedin') return testLinkedIn(kanal, token)

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
  // ALLE maal hentes, ikke kun de ventende. Forskellen paa «opslaget har
  // ingen kanaler» og «kanalerne er allerede sendt» er to vidt forskellige
  // tilstande, og filtrerede vi dem sammen, blev de begge til en tom liste
  // -- og en tom liste blev til et opslag der laa og blev sprunget over
  // hvert kvarter, resten af sin levetid, uden at nogen fik det at vide.
  const { data: alleMaal } = await klient
    .from('post_targets')
    .select(
      '*, channels(*, brands(customers(token_ciphertext, ' +
        'linkedin_tokens(access_ciphertext, access_udloeber))))',
    )
    .eq('post_id', opslagId)

  // Et opslag uden en eneste kanalraekke er ikke forsinket -- det er sat
  // forkert op, og det bliver aldrig bedre af at proeve igen. Det sker naar
  // modellen foreslog en kanal kunden ikke har, eller kanalen var slaaet fra
  // da serien blev oprettet.
  if (!alleMaal?.length) {
    throw new Error(
      'Opslaget har ingen kanaler at publicere til. Vælg kanaler under ' +
        '«Ret kampagnen → Kanaler», eller tjek at kundens kanaler er slået til.',
    )
  }

  const maal = alleMaal.filter((m) => m.status === 'pending' || m.status === 'failed')

  // Alt er allerede ude. Sket fx hvis en koersel blev afbrudt efter kanalerne
  // var opdateret men foer opslaget blev det. Statussen rettes her frem for
  // at opslaget bliver ved at staa som godkendt og forfaldent for evigt.
  if (!maal.length) {
    const alleUde = alleMaal.every((m) => m.status === 'published')
    if (alleUde && !tørkørsel()) {
      await klient.from('posts').update({ status: 'published' }).eq('id', opslagId)
    }
    return alleMaal.map((m) => ({
      ok: m.status === 'published',
      platform: m.channels?.platform,
      kanalId: m.channel_id,
      kanalNavn: m.channels?.display_name,
      fejl: m.status === 'published' ? undefined : `Kanalen står som «${m.status}».`,
      alleredeBehandlet: true,
    }))
  }

  // Tørkørsel må ikke efterlade spor. Markerede vi opslaget som publiceret,
  // ville kalenderen lyve OG opslaget blive sprunget over den dag du går live,
  // fordi det allerede stod som færdigt. En tørkørsel skal kunne gentages i det
  // uendelige og lade databasen stå præcis som før.
  const tørt = tørkørsel()

  if (!tørt) {
    await klient.from('posts').update({ status: 'publishing' }).eq('id', opslagId)
  }

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

    // Teksten er pr. kanal: Instagram kan ikke klikke på links, så linjer med
    // links tages ud dér — se tekstTilKanal.
    const res = await publicerTilKanal(kanal, {
      tekst: tekstTilKanal(opslag, kanal.platform),
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
