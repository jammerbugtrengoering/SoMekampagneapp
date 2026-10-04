import { krypter } from './_lib/krypto.js'
import { lavState, laesState } from './_lib/linkedin-state.js'
import { adminKlient, jsonSvar, kraevOrgRolle } from './_lib/supabase.js'

/**
 * /api/linkedin-oauth — forbind en kundes LinkedIn-adgang.
 *
 *   ?trin=start     POST, logget ind. Verificerer at kalderen er ejer og
 *                   svarer med den URL browseren skal sendes til.
 *   ?trin=callback  GET fra LinkedIn. Bytter code til tokens og gemmer.
 *   ?trin=status    POST, logget ind. Er kunden forbundet, som hvem, og
 *                   hvor laenge endnu?
 *
 * Personlig profil, ikke firmaside. Det er ikke et lille valg: opslag paa
 * en firmaside kraever Community Management API med ansoegning,
 * godkendelse og en registreret juridisk enhed. Opslag paa ens egen
 * profil kraever «Share on LinkedIn», som tilfoejes selv i Developer
 * Portal under Products. Samme API bagefter -- forskellen er eet felt,
 * forfatteren.
 *
 * Derfor spoerges der om tre scopes: openid og profile for at faa fat i
 * personens URN, og w_member_social for at maatte skrive. Vi beder ikke
 * om mere. Et scope man ikke bruger, er et scope brugeren skal sige ja
 * til uden grund.
 *
 * Modsat Metas systemtoken findes der ingen LinkedIn-token der ikke
 * udloeber. Access varer 60 dage, refresh et aar, og det aar nulstilles
 * ikke naar access fornys. Begge datoer gemmes derfor i klartekst: en
 * advarsel om at adgangen snart stopper skal kunne stilles uden at
 * dekryptere noget.
 */

const AUTORISER = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO = 'https://api.linkedin.com/v2/userinfo'

const SCOPES = process.env.LINKEDIN_SCOPES ?? 'openid profile w_member_social'

function konfiguration() {
  const id = process.env.LINKEDIN_CLIENT_ID
  const hemmelighed = process.env.LINKEDIN_CLIENT_SECRET

  // Netlify saetter selv URL til sitets adresse. Den kan overskrives, fordi
  // LinkedIn matcher redirect-URL'en EKSAKT -- et deploy preview har et
  // andet domaene og bliver derfor afvist, medmindre man peger her.
  const base = process.env.APP_URL ?? process.env.URL
  const redirect = process.env.LINKEDIN_REDIRECT_URI ??
    (base ? `${base.replace(/\/+$/, '')}/api/linkedin-oauth?trin=callback` : null)

  if (!id || !hemmelighed || !redirect) {
    throw new Error(
      'LinkedIn er ikke sat op. LINKEDIN_CLIENT_ID og LINKEDIN_CLIENT_SECRET ' +
        'skal staa i Netlify, og redirect-URL\'en skal kunne udledes af URL ' +
        '(eller saettes som LINKEDIN_REDIRECT_URI).',
    )
  }
  return { id, hemmelighed, redirect, base }
}

/** Sender browseren tilbage til appen med et resultat den kan vise. */
function tilbage(base, params) {
  const url = new URL(base ?? 'https://example.invalid')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

// ---------------------------------------------------------------------
// Trin 1: start
// ---------------------------------------------------------------------
async function start(req) {
  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }
  if (!krop.kundeId) return jsonSvar({ fejl: 'kundeId mangler.' }, 400)

  // Ejer, ikke redaktoer: det her ender med skriveadgang til en
  // LinkedIn-profil. Samme skel som for Meta-tokens.
  const adgang = await kraevOrgRolle(req, { roller: ['ejer'], kundeId: krop.kundeId })
  if (!adgang.ok) return adgang.svar

  let cfg
  try {
    cfg = konfiguration()
  } catch (e) {
    return jsonSvar({ fejl: e.message }, 501)
  }

  const url = new URL(AUTORISER)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', cfg.id)
  url.searchParams.set('redirect_uri', cfg.redirect)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set(
    'state',
    lavState({ kundeId: krop.kundeId, orgId: adgang.orgId, brugerId: adgang.bruger.id }),
  )

  return jsonSvar({ ok: true, url: url.toString() })
}

// ---------------------------------------------------------------------
// Trin 2: callback
// ---------------------------------------------------------------------
async function callback(req, url) {
  let cfg
  try {
    cfg = konfiguration()
  } catch (e) {
    return jsonSvar({ fejl: e.message }, 501)
  }

  // Sagde brugeren nej i LinkedIns dialog, kommer hun tilbage med error og
  // uden code. Det er ikke en fejl i systemet og skal ikke se ud som en.
  const afvist = url.searchParams.get('error')
  if (afvist) {
    return tilbage(cfg.base, {
      linkedin: 'afbrudt',
      besked: url.searchParams.get('error_description') ?? afvist,
    })
  }

  const code = url.searchParams.get('code')
  if (!code) return tilbage(cfg.base, { linkedin: 'fejl', besked: 'Intet code fra LinkedIn.' })

  // Hele adgangskontrollen for dette kald. Se _lib/linkedin-state.js.
  let state
  try {
    state = laesState(url.searchParams.get('state'))
  } catch (e) {
    return tilbage(cfg.base, { linkedin: 'fejl', besked: e.message })
  }

  try {
    const svar = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirect,
        client_id: cfg.id,
        client_secret: cfg.hemmelighed,
      }),
    })
    const tekst = await svar.text()
    if (!svar.ok) throw new Error(`Tokenbyttet fejlede (${svar.status}): ${tekst.slice(0, 300)}`)
    const t = JSON.parse(tekst)

    // Hvem gav adgangen? sub er personens id, og URN'en er det der skal
    // staa som forfatter paa hvert opslag. Uden den kan der ikke
    // publiceres, saa den hentes nu frem for ved foerste opslag.
    const profil = await fetch(USERINFO, {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })
    if (!profil.ok) {
      throw new Error(
        `Kunne ikke hente profilen (${profil.status}). ` +
          'Mangler appen scopet openid eller profile?',
      )
    }
    const p = await profil.json()
    if (!p.sub) throw new Error('LinkedIn svarede uden sub — ingen person-URN at skrive under.')

    const nu = Date.now()
    const { error } = await adminKlient()
      .from('linkedin_tokens')
      .upsert(
        {
          customer_id: state.kundeId,
          channel_id: null,
          member_urn: `urn:li:person:${p.sub}`,
          member_navn: p.name ?? null,
          access_ciphertext: krypter(t.access_token),
          refresh_ciphertext: t.refresh_token ? krypter(t.refresh_token) : null,
          access_udloeber: new Date(nu + (t.expires_in ?? 0) * 1000).toISOString(),
          refresh_udloeber: t.refresh_token_expires_in
            ? new Date(nu + t.refresh_token_expires_in * 1000).toISOString()
            : null,
          scope: t.scope ?? SCOPES,
          sidst_fornyet_at: new Date(nu).toISOString(),
          sidste_fejl: null,
          updated_at: new Date(nu).toISOString(),
        },
        { onConflict: 'customer_id' },
      )
    if (error) throw new Error(`Kunne ikke gemme tokenet: ${error.message}`)

    return tilbage(cfg.base, {
      linkedin: 'ok',
      kunde: state.kundeId,
      navn: p.name ?? '',
      urn: `urn:li:person:${p.sub}`,
    })
  } catch (e) {
    return tilbage(cfg.base, { linkedin: 'fejl', besked: e.message })
  }
}

// ---------------------------------------------------------------------
// Trin 3: status
// ---------------------------------------------------------------------
/**
 * Bevidst uden netvaerkskald: den svarer paa hvad basen ved.
 *
 * Det er datoerne der er interessante. Uden dem opdages en udloebet
 * adgang foerst den dag et opslag ikke kom ud -- og det er for sent til
 * at goere noget ved.
 */
async function status(req) {
  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }
  if (!krop.kundeId) return jsonSvar({ fejl: 'kundeId mangler.' }, 400)

  const adgang = await kraevOrgRolle(req, { roller: ['ejer', 'redaktoer'], kundeId: krop.kundeId })
  if (!adgang.ok) return adgang.svar

  const { data: r } = await adminKlient()
    .from('linkedin_tokens')
    .select('member_urn, member_navn, access_udloeber, refresh_udloeber, scope, sidste_fejl')
    .eq('customer_id', krop.kundeId)
    .maybeSingle()

  if (!r) return jsonSvar({ ok: true, forbundet: false })

  const dage = (d) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / 86400000) : null)

  return jsonSvar({
    ok: true,
    forbundet: true,
    medlemUrn: r.member_urn,
    medlemNavn: r.member_navn,
    adgangDageTilbage: dage(r.access_udloeber),
    fornyelseDageTilbage: dage(r.refresh_udloeber),
    scope: r.scope,
    sidsteFejl: r.sidste_fejl,
  })
}

export default async function handler(req) {
  const url = new URL(req.url)
  const trin = url.searchParams.get('trin')

  if (trin === 'callback') {
    if (req.method !== 'GET') return jsonSvar({ fejl: 'Callback er et GET.' }, 405)
    return callback(req, url)
  }

  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)
  if (trin === 'start') return start(req)
  if (trin === 'status') return status(req)

  return jsonSvar({ fejl: 'Ukendt trin. Brug start, callback eller status.' }, 400)
}
