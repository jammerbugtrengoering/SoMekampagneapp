import { krypter, maskeer } from './_lib/krypto.js'
import { gaeldendeToken, testKanal } from './_lib/meta.js'
import { adminKlient, jsonSvar, kraevOrgRolle } from './_lib/supabase.js'

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
/**
 * Hvilken organisation hører brandet under?
 *
 * Bruges når en NY kanal oprettes: der er intet kanal-id at slå op endnu,
 * og organisationen må ikke komme fra kaldet selv. Opslaget sker med secret
 * key, men resultatet bruges kun til at afgøre hvad brugerens rolle skal
 * måles imod — svarer hun ikke, ryger kaldet på 403 lige efter.
 */
async function orgForBrand(brandId) {
  if (!brandId) return null
  const { data } = await adminKlient()
    .from('brands').select('customers(organisation_id)').eq('id', brandId).maybeSingle()
  return data?.customers?.organisation_id ?? null
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  // Kanalen peger på en rigtig Facebook-side og kan bære sit eget token.
  // Derfor ejer, ikke redaktør. Organisationen udledes af kanalen eller af
  // brandet, så den ikke kan sendes med udefra.
  const adgang = await kraevOrgRolle(req, {
    roller: ['ejer'],
    kanalId: krop.kanalId ?? null,
    orgId: await orgForBrand(krop.brandId),
  })
  if (!adgang.ok) return adgang.svar
  const klient = adgang.klient

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

  // Et brandId på en eksisterende kanal betyder "flyt den hertil". Det er
  // vejen ud af en dublet, hvor Facebook og Instagram er endt på hver sit
  // brand — uden at oprette siden forfra med samme Page ID.
  if (kanalId && brandId) felter.brand_id = brandId

  const forespoergsel = kanalId
    ? klient.from('channels').update(felter).eq('id', kanalId)
    : klient.from('channels').insert({ ...felter, brand_id: brandId })

  const { error } = await forespoergsel
  if (error) {
    // 23505 = unique (brand_id, platform, page_id). Sker når modtageren
    // allerede har den samme side liggende.
    return jsonSvar({
      fejl: error.code === '23505'
        ? 'Modtageren har allerede en kanal med samme platform og Page ID. ' +
          'Deaktivér eller slet dubletten der i stedet.'
        : error.message,
    }, 500)
  }

  return jsonSvar({
    ok: true,
    besked: token?.trim()
      ? `Kanal gemt. Token ${maskeer(token.trim())} er krypteret.`
      : 'Kanal gemt.',
  })
}
