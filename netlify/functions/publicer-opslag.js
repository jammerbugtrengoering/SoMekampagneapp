import { publicerOpslag } from './_lib/meta.js'
import { adminKlient, jsonSvar, kraevOrgRolle, tørkørsel } from './_lib/supabase.js'

/**
 * POST /api/publicer-opslag  { opslagId }
 *
 * "Publicér nu" — springer det planlagte tidspunkt over.
 *
 * Tokens dekrypteres her på serveren. Browseren ser dem aldrig, hverken
 * krypteret eller i klartekst.
 */
/** Hvilken organisation hører opslaget under? */
async function orgForOpslag(opslagId) {
  const { data } = await adminKlient()
    .from('posts')
    .select('brands(customers(organisation_id))')
    .eq('id', opslagId)
    .maybeSingle()
  return data?.brands?.customers?.organisation_id ?? null
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  if (!krop?.opslagId) return jsonSvar({ fejl: 'opslagId mangler.' }, 400)

  // Publicering er det uigenkaldelige skridt: opslaget går ud på en rigtig
  // side og kan ikke kaldes tilbage herfra. Derfor ejer — og organisationen
  // udledes af opslaget, så man ikke kan publicere i en fremmed kunde ved at
  // sende et andet orgId med.
  const adgang = await kraevOrgRolle(req, {
    roller: ['ejer'],
    orgId: await orgForOpslag(krop.opslagId),
  })
  if (!adgang.ok) return adgang.svar

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
