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
  // Hvordan kender vi Netlifys egen scheduler?
  //
  // Det gjorde vi ikke. Funktionen krævede headeren `x-nf-event: schedule`,
  // og den er ikke dokumenteret for v2-funktioner. Resultatet var at
  // scheduleren selv blev afvist med 403 hvert kvarter -- på under 50 ms,
  // uden en eneste log-linje, fordi afvisningen ikke loggede noget. Alt så
  // rigtigt ud: funktionen stod som «Scheduled», den kørte til tiden, og
  // den gjorde ingenting.
  //
  // Det dokumenterede kendetegn er kroppen: et JSON-objekt med `next_run`.
  // Headeren beholdes som ekstra signal -- den koster intet, og sætter
  // Netlify den en dag, virker den også.
  //
  // Og hver eneste afvisning logges nu. En sikkerhedsspærre der afviser i
  // stilhed er ikke en spærre, det er en fælde man selv falder i.
  let planlagt = req.headers.get('x-nf-event') === 'schedule'

  if (!planlagt) {
    try {
      const krop = await req.clone().json()
      planlagt = typeof krop?.next_run === 'string'
    } catch {
      // Ingen krop, eller ikke JSON. Så er det ikke scheduleren.
    }
  }

  if (!planlagt) {
    const hemmelighed = process.env.CRON_SECRET
    if (!hemmelighed) {
      console.warn(
        'Planlagt publicering afvist: hverken x-nf-event, next_run i kroppen ' +
          'eller CRON_SECRET. Sæt CRON_SECRET for at kunne kalde manuelt.',
      )
      return jsonSvar(
        { fejl: 'Kun den planlagte kørsel må kalde denne. Sæt CRON_SECRET for at kalde manuelt.' },
        403,
      )
    }
    if (req.headers.get('x-cron-secret') !== hemmelighed) {
      console.warn('Planlagt publicering afvist: forkert eller manglende x-cron-secret.')
      return jsonSvar({ fejl: 'Uautoriseret.' }, 401)
    }
  }

  console.log(`Planlagt publicering starter (${planlagt ? 'scheduler' : 'manuelt kald'}).`)

  try {
    const resultater = await publicerForfaldne(adminKlient())

    // .every() på en tom liste er true. Uden `length` blev et opslag uden
    // kanaler talt som udgivet, og loggen sagde «1 ok» om noget der aldrig
    // gik nogen steder hen.
    const udgivet = resultater.filter(
      (r) => r.resultater.length > 0 && r.resultater.every((x) => x.ok),
    ).length
    const fejlet = resultater.length - udgivet

    console.log(
      `Planlagt publicering: ${resultater.length} behandlet, ${udgivet} ok, ${fejlet} fejlet` +
        (tørkørsel() ? ' (tørkørsel)' : ''),
    )

    // Grundene med, ikke bare tallene. En log der siger «1 fejlet» uden at
    // sige hvorfor, sender en op i databasen for at lede efter noget
    // funktionen lige har haft i hånden.
    for (const r of resultater) {
      const grunde = r.resultater.filter((x) => !x.ok).map((x) => x.fejl).filter(Boolean)
      if (!r.resultater.length) {
        console.error(`Opslag ${r.opslagId}: ingen kanaler at publicere til.`)
      } else if (grunde.length) {
        console.error(`Opslag ${r.opslagId}: ${grunde.join(' · ')}`)
      }
    }

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
