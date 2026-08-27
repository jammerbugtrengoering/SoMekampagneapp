import { krypter, maskeer } from './_lib/krypto.js'
import { testKanal } from './_lib/meta.js'
import { jsonSvar, kraevAdmin } from './_lib/supabase.js'

/**
 * POST /api/gem-kunde
 *
 * Gemmer kundens stamkort og krypterer det fælles Meta-token.
 *
 * Tokenet ligger på kunden, fordi et Meta-systemtoken hører til en
 * Business-portefølje og dækker de sider det er tildelt — ét token til alle
 * Jammerbugts sider, ét sted at rotere det. En enkelt kanal kan stadig have
 * sit eget, hvis en side ligger i en anden portefølje.
 *
 * Med handling: "test" prøves tokenet mod hver af kundens kanaler, så du kan
 * se om det faktisk dækker dem alle — det er den fejl man ellers først finder
 * når et opslag skulle publiceres.
 */
export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  const adgang = await kraevAdmin(req)
  if (!adgang.ok) return adgang.svar
  const klient = adgang.klient

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  // ---- Test kundens token mod alle dens kanaler ----
  if (krop.handling === 'test') {
    if (!krop.kundeId) return jsonSvar({ fejl: 'kundeId mangler.' }, 400)

    const { data: kunde } = await klient
      .from('customers').select('*').eq('id', krop.kundeId).single()

    if (!kunde) return jsonSvar({ fejl: 'Kunden findes ikke.' }, 404)
    if (!kunde.token_ciphertext) {
      return jsonSvar({ fejl: 'Kunden har intet token at teste.' }, 400)
    }

    const { data: kanaler } = await klient
      .from('channels')
      .select('*, brands!inner(customer_id, name)')
      .eq('brands.customer_id', kunde.id)
      .eq('active', true)

    if (!kanaler?.length) {
      return jsonSvar({ fejl: 'Kunden har ingen aktive kanaler at teste imod.' }, 400)
    }

    const resultater = []
    for (const k of kanaler) {
      // Kanaler med eget token testes med deres eget — det er jo det der bruges.
      const eget = Boolean(k.token_ciphertext)
      const res = await testKanal({
        ...k,
        token_ciphertext: k.token_ciphertext ?? kunde.token_ciphertext,
      })
      resultater.push({
        kanal: `${k.brands?.name ?? ''} · ${k.display_name}`,
        platform: k.platform,
        kilde: eget ? 'kanalens eget' : 'kundens',
        ok: res.ok,
        besked: res.ok ? (res.navn ?? 'virker') : res.fejl,
      })

      await klient.from('channels').update({
        last_verified_at: res.ok ? new Date().toISOString() : null,
        last_error: res.ok ? null : (res.fejl ?? 'Ukendt fejl'),
      }).eq('id', k.id)
    }

    const fejlede = resultater.filter((r) => !r.ok)
    await klient.from('customers').update({
      token_testet_at: new Date().toISOString(),
      token_fejl: fejlede.length ? `${fejlede.length} af ${resultater.length} kanaler fejlede` : null,
    }).eq('id', kunde.id)

    return jsonSvar({
      ok: fejlede.length === 0,
      resultater,
      besked: fejlede.length
        ? `${fejlede.length} af ${resultater.length} kanaler kunne ikke nås. ` +
          'Er de tildelt systembrugeren i Business-porteføljen?'
        : `Tokenet dækker alle ${resultater.length} kanaler.`,
    })
  }

  // ---- Gem stamkortet ----
  const { kundeId, token, ...felter } = krop

  const tilladt = [
    'name', 'slug', 'kontakt_navn', 'kontakt_mail', 'kontakt_telefon',
    'aftale', 'godkender', 'meta_portefoelje_id', 'meta_systembruger',
    'token_label', 'samtykke', 'guardrails', 'noter',
  ]

  // Kun kendte felter skrives. Et POST med token_ciphertext direkte skal
  // ikke kunne omgå krypteringen.
  const opdatering = {}
  for (const n of tilladt) {
    if (felter[n] !== undefined) opdatering[n] = felter[n] === '' ? null : felter[n]
  }

  if (!opdatering.name?.trim() && !kundeId) {
    return jsonSvar({ fejl: 'Kunden skal have et navn.' }, 400)
  }

  // Tomt token-felt betyder "behold det nuværende", ikke "slet det".
  if (token?.trim()) {
    try {
      opdatering.token_ciphertext = krypter(token.trim())
      opdatering.token_label = opdatering.token_label || 'system user'
      opdatering.token_testet_at = null
      opdatering.token_fejl = null
    } catch (e) {
      return jsonSvar({ fejl: e.message }, 500)
    }
  }

  const forespoergsel = kundeId
    ? klient.from('customers').update(opdatering).eq('id', kundeId)
    : klient.from('customers').insert({
        ...opdatering,
        slug: opdatering.slug
          || opdatering.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      })

  const { error } = await forespoergsel
  if (error) return jsonSvar({ fejl: error.message }, 500)

  return jsonSvar({
    ok: true,
    besked: token?.trim()
      ? `Gemt. Token ${maskeer(token.trim())} er krypteret — husk at teste det.`
      : 'Gemt.',
  })
}
