import { genererKampagne, tidspunkt } from './_lib/claude.js'
import { jsonSvar, kraevOrgRolle } from './_lib/supabase.js'

/**
 * POST /api/generer-kampagne
 *
 * Opretter en kampagne og genererer opslagene. Kladder — der publiceres intet.
 *
 * ANTHROPIC_API_KEY findes kun her på serveren. Kaldte browseren Claude direkte,
 * ville nøglen ligge i klient-JS'en, og enhver besøgende kunne bruge den.
 */
export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  // At skrive kampagnetekst er redaktørens arbejde.
  const adgang = await kraevOrgRolle(req, { roller: ['ejer', 'redaktoer'] })
  if (!adgang.ok) return adgang.svar
  const klient = adgang.klient

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  const { brandId, navn, brief, maal, start, slut, antal = 5, kanaler = [] } = krop

  if (!brandId || !navn?.trim() || !brief?.trim() || !start) {
    return jsonSvar({ fejl: 'Udfyld kunde, navn, brief og startdato.' }, 400)
  }
  if (!kanaler.length) {
    return jsonSvar({ fejl: 'Vælg mindst én kanal.' }, 400)
  }

  const { data: brand } = await klient.from('brands').select('*').eq('id', brandId).single()
  if (!brand) return jsonSvar({ fejl: 'Kunden findes ikke.' }, 404)

  const { data: kanalRaekker } = await klient
    .from('channels')
    .select('*')
    .eq('brand_id', brandId)
    .eq('active', true)

  const aktive = kanalRaekker ?? []

  let genereret
  try {
    genereret = await genererKampagne({
      brand,
      navn: navn.trim(),
      brief: brief.trim(),
      maal: maal?.trim() || null,
      antal: Math.min(Math.max(Number(antal) || 5, 1), 20),
      kanaler,
      start,
      slut: slut || null,
    })
  } catch (e) {
    console.error('Generering fejlede:', e)
    return jsonSvar({ fejl: e.message }, 502)
  }

  const { data: kampagne, error: kampagneFejl } = await klient
    .from('campaigns')
    .insert({
      brand_id: brandId,
      name: navn.trim(),
      brief: brief.trim(),
      goal: maal?.trim() || null,
      starts_on: start,
      ends_on: slut || null,
      status: 'draft',
    })
    .select()
    .single()

  if (kampagneFejl || !kampagne) {
    return jsonSvar({ fejl: kampagneFejl?.message ?? 'Kunne ikke oprette kampagnen.' }, 500)
  }

  let oprettede = 0

  for (const o of genereret) {
    const { data: raekke } = await klient
      .from('posts')
      .insert({
        campaign_id: kampagne.id,
        brand_id: brandId,
        body: o.tekst,
        hashtags: o.hashtags,
        image_brief: o.billedbrief,
        scheduled_at: tidspunkt(start, o.dag, o.klokke),
        status: 'needs_approval',
      })
      .select()
      .single()

    if (!raekke) continue
    oprettede++

    // Ét mål pr. kanal opslaget skal ud på.
    const maalRaekker = aktive
      .filter((k) => o.kanaler.includes(k.platform))
      .map((k) => ({ post_id: raekke.id, channel_id: k.id }))

    if (maalRaekker.length) await klient.from('post_targets').insert(maalRaekker)
  }

  return jsonSvar({ ok: true, kampagneId: kampagne.id, antal: oprettede })
}
