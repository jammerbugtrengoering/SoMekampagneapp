import { krypter, maskeer } from './_lib/krypto.js'
import { gaeldendeToken, testKanal } from './_lib/meta.js'
import { jsonSvar, kraevAdmin } from './_lib/supabase.js'

/**
 * POST /api/gem-kanal
 *
 * Gemmer en kanal og krypterer dens Meta-token.
 *
 * Krypteringsnøglen findes kun på serveren, så det er nødt til at gå gennem en
 * funktion — browseren kan ikke selv kryptere. Tokenet passerer altså denne
 * funktion i klartekst over HTTPS og forlader den krypteret.
 *
 * Med handling: "test" testes en gemt kanal i stedet.
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

  // ---- Test af en eksisterende kanal ----
  if (krop.handling === 'test') {
    if (!krop.kanalId) return jsonSvar({ fejl: 'kanalId mangler.' }, 400)

    const { data: kanal } = await klient
      .from('channels')
      .select('*, brands(customers(token_ciphertext))')
      .eq('id', krop.kanalId)
      .single()

    if (!kanal) return jsonSvar({ fejl: 'Kanalen findes ikke.' }, 404)

    // Samme regel som ved publicering: kanalens eget token, ellers kundens.
    const res = await testKanal({ ...kanal, token_ciphertext: gaeldendeToken(kanal) })

    await klient
      .from('channels')
      .update({
        last_verified_at: res.ok ? new Date().toISOString() : null,
        last_error: res.ok ? null : (res.fejl ?? 'Ukendt fejl'),
      })
      .eq('id', kanal.id)

    return jsonSvar({
      ok: res.ok,
      besked: res.ok
        ? `Forbindelsen virker${res.navn ? ` — ${res.navn}` : ''}.`
        : res.fejl,
    })
  }

  // ---- Gem ----
  const { kanalId, brandId, platform, visningsnavn, pageId, igUserId, token, tokenLabel, aktiv } =
    krop

  if (!platform || !visningsnavn?.trim()) {
    return jsonSvar({ fejl: 'Platform og visningsnavn skal udfyldes.' }, 400)
  }
  if (!kanalId && !brandId) {
    return jsonSvar({ fejl: 'brandId mangler.' }, 400)
  }

  const felter = {
    platform,
    display_name: visningsnavn.trim(),
    page_id: pageId?.trim() || null,
    ig_user_id: igUserId?.trim() || null,
    active: aktiv !== false,
  }

  // Tomt token-felt betyder "behold det nuværende", ikke "slet det". Ellers
  // ville et gem af navnet koste adgangen til siden.
  if (token?.trim()) {
    try {
      felter.token_ciphertext = krypter(token.trim())
      felter.token_label = tokenLabel?.trim() || 'manuelt'
    } catch (e) {
      return jsonSvar({ fejl: e.message }, 500)
    }
  }

  const forespoergsel = kanalId
    ? klient.from('channels').update(felter).eq('id', kanalId)
    : klient.from('channels').insert({ ...felter, brand_id: brandId })

  const { error } = await forespoergsel
  if (error) return jsonSvar({ fejl: error.message }, 500)

  return jsonSvar({
    ok: true,
    besked: token?.trim()
      ? `Kanal gemt. Token ${maskeer(token.trim())} er krypteret.`
      : 'Kanal gemt.',
  })
}
