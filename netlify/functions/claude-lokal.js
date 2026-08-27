import { spawn } from 'node:child_process'
import {
  KAMPAGNE_SKEMA, OMSKRIV_SKEMA, byggOmskrivOpgave, byggOpgave,
} from '../../src/prompt.js'
import { jsonSvar, kraevAdmin } from './_lib/supabase.js'

/**
 * POST /api/claude-lokal
 *
 * Kører `claude -p` på DIN maskine, så du slipper for copy/paste mens du
 * bygger. Virker kun når appen kører lokalt med `npm run dev:api` — en
 * server i skyen har ingen adgang til dit Claude-login.
 *
 * ---------------------------------------------------------------------
 * Hvorfor gaten er som den er
 *
 * Vi gætter ikke på Netlifys egne variabler. I stedet kræves TILLAD_LOKAL_CLAUDE
 * i miljøet, og den står kun i din lokale .env — en fil der er gitignoreret og
 * aldrig når Netlify. Et deploy kan derfor ikke starte processer, uanset hvad
 * Netlify måtte sætte af variabler i fremtiden.
 *
 * Dertil et bælte: er NETLIFY sat til "true", er vi i skyen, og så nægter vi
 * uanset flaget.
 * ---------------------------------------------------------------------
 */

const TIMEOUT_MS = 120000

/**
 * Må vi starte en proces her?
 *
 * Trukket ud som en ren funktion, så den kan testes uden at hele
 * admin-tjekket og en database skal med. Returnerer null når det er i orden,
 * ellers en forklaring til brugeren.
 */
export function maaKoereLokalt(env) {
  if (env.NETLIFY === 'true') {
    return 'Claude kan kun køres direkte når appen kører på din egen maskine. ' +
      'Her på serveren findes dit login ikke — brug copy/paste nedenfor.'
  }
  if (env.TILLAD_LOKAL_CLAUDE !== 'true') {
    return 'Sæt TILLAD_LOKAL_CLAUDE=true i din lokale .env og start "npm run dev:api" igen, ' +
      'hvis du vil kalde Claude direkte fra appen.'
  }
  return null
}

function koerClaude(opgave, skema, model) {
  return new Promise((klar, fejl) => {
    // Argumenter gives som en liste, ikke som en kommandostreng. Ingen shell
    // betyder at en brief med anførselstegn eller semikolon bare er tekst.
    const args = ['-p', opgave, '--output-format', 'json', '--json-schema', JSON.stringify(skema)]
    if (model) args.push('--model', model)

    const proces = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let ud = '', fejltekst = '', afbrudt = false

    const ur = setTimeout(() => {
      afbrudt = true
      proces.kill('SIGTERM')
      fejl(new Error(
        `Claude svarede ikke inden for ${TIMEOUT_MS / 1000} sekunder. ` +
        'Prøv "npm run kampagne" i terminalen — den har ingen tidsgrænse.',
      ))
    }, TIMEOUT_MS)

    proces.stdout.on('data', (d) => (ud += d))
    proces.stderr.on('data', (d) => (fejltekst += d))

    proces.on('error', (e) => {
      clearTimeout(ur)
      fejl(new Error(
        e.code === 'ENOENT'
          ? 'Kunne ikke finde kommandoen "claude". Er Claude Code installeret og logget ind?'
          : e.message,
      ))
    })

    proces.on('close', (kode) => {
      clearTimeout(ur)
      if (afbrudt) return
      if (kode !== 0) {
        return fejl(new Error(`claude sluttede med kode ${kode}. ${(fejltekst || ud).slice(0, 300)}`))
      }
      try {
        const svar = JSON.parse(ud)
        klar(svar.structured_output ?? svar.result)
      } catch {
        fejl(new Error(`Kunne ikke læse svaret fra claude: ${ud.slice(0, 300)}`))
      }
    })
  })
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  const adgang = await kraevAdmin(req)
  if (!adgang.ok) return adgang.svar

  const naegtet = maaKoereLokalt(process.env)
  if (naegtet) return jsonSvar({ lokalKraeves: true, fejl: naegtet }, 501)

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  const { handling } = krop

  try {
    if (handling === 'omskriv') {
      const { brand, kampagne, opslag, instruks } = krop
      if (!brand || !opslag?.length || !instruks?.trim()) {
        return jsonSvar({ fejl: 'brand, opslag og instruks skal med.' }, 400)
      }
      const svar = await koerClaude(
        byggOmskrivOpgave({ brand, kampagne, opslag, instruks: instruks.trim() }),
        OMSKRIV_SKEMA,
        process.env.CLAUDE_MODEL,
      )
      return jsonSvar({ ok: true, resultat: svar })
    }

    if (handling === 'generer') {
      const { brand, navn, brief, maal, antal, kanaler, start, slut } = krop
      if (!brand || !navn?.trim() || !brief?.trim() || !kanaler?.length) {
        return jsonSvar({ fejl: 'brand, navn, brief og kanaler skal med.' }, 400)
      }
      const svar = await koerClaude(
        byggOpgave({
          brand, navn: navn.trim(), brief: brief.trim(), maal: maal ?? '',
          antal: Math.min(Math.max(Number(antal) || 5, 1), 20),
          kanaler, start, slut: slut ?? '',
        }),
        KAMPAGNE_SKEMA,
        process.env.CLAUDE_MODEL,
      )
      return jsonSvar({ ok: true, resultat: svar })
    }

    return jsonSvar({ fejl: `Ukendt handling: ${handling}` }, 400)
  } catch (e) {
    console.error('claude-lokal fejlede:', e)
    return jsonSvar({ fejl: e.message }, 502)
  }
}
