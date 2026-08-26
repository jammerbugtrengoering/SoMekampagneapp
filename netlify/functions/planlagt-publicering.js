import { publicerForfaldne } from './_lib/meta.js'
import { adminKlient, jsonSvar, tørkørsel } from './_lib/supabase.js'

/**
 * Planlagt kørsel hvert 15. minut (skemaet står i netlify.toml).
 *
 * Publicerer alt der er godkendt og hvis tidspunkt er passeret. Kladder og
 * opslag der afventer godkendelse røres ikke.
 *
 * Der er ingen brugersession bag et cron-kald, så funktionen kører med
 * service-role. Kaldes den manuelt over HTTP, kræves CRON_SECRET.
 */
export default async function handler(req) {
  // Netlifys egen scheduler kalder uden header. Alle andre skal vise nøglen.
  const fraScheduler = req.headers.get('x-nf-event') === 'schedule'
  if (!fraScheduler) {
    const hemmelighed = process.env.CRON_SECRET
    if (!hemmelighed) return jsonSvar({ fejl: 'CRON_SECRET er ikke sat.' }, 500)
    if (req.headers.get('x-cron-secret') !== hemmelighed) {
      return jsonSvar({ fejl: 'Uautoriseret.' }, 401)
    }
  }

  try {
    const resultater = await publicerForfaldne(adminKlient())

    const udgivet = resultater.filter((r) => r.resultater.every((x) => x.ok)).length
    const fejlet = resultater.length - udgivet

    console.log(
      `Planlagt publicering: ${resultater.length} behandlet, ${udgivet} ok, ${fejlet} fejlet` +
        (tørkørsel() ? ' (tørkørsel)' : ''),
    )

    return jsonSvar({
      ok: true,
      tørkørsel: tørkørsel(),
      behandlet: resultater.length,
      udgivet,
      fejlet,
    })
  } catch (e) {
    console.error('Planlagt publicering fejlede:', e)
    return jsonSvar({ fejl: e.message }, 500)
  }
}
