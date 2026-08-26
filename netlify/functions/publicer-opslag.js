import { publicerOpslag } from './_lib/meta.js'
import { jsonSvar, kraevAdmin, tørkørsel } from './_lib/supabase.js'

/**
 * POST /api/publicer-opslag  { opslagId }
 *
 * "Publicér nu" — springer det planlagte tidspunkt over.
 *
 * Tokens dekrypteres her på serveren. Browseren ser dem aldrig, hverken
 * krypteret eller i klartekst.
 */
export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  const adgang = await kraevAdmin(req)
  if (!adgang.ok) return adgang.svar

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  if (!krop?.opslagId) return jsonSvar({ fejl: 'opslagId mangler.' }, 400)

  try {
    const resultater = await publicerOpslag(adgang.klient, krop.opslagId)

    if (!resultater.length) {
      return jsonSvar({ fejl: 'Opslaget har ingen kanaler at publicere til.' }, 400)
    }

    const fejlede = resultater.filter((r) => !r.ok)

    return jsonSvar({
      ok: fejlede.length === 0,
      tørkørsel: tørkørsel(),
      resultater,
      besked: fejlede.length
        ? fejlede.map((f) => `${f.kanalNavn ?? f.platform}: ${f.fejl}`).join(' · ')
        : tørkørsel()
          ? 'Tørkørsel: opslaget blev skrevet til loggen. Der gik intet til Meta.'
          : `Publiceret til ${resultater.map((r) => r.platform).join(' og ')}.`,
    })
  } catch (e) {
    console.error('Publicering fejlede:', e)
    return jsonSvar({ fejl: e.message }, 500)
  }
}
