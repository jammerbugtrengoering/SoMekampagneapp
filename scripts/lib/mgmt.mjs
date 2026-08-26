/**
 * Tynd klient til Supabase Management API. Kun node-indbygget fetch —
 * scripts kan derfor køres uden at have installeret afhængigheder.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'https://api.supabase.com'

export function laesEnv() {
  const ud = {}
  for (const fil of ['.env', '.env.local']) {
    const sti = resolve(process.cwd(), fil)
    if (!existsSync(sti)) continue
    for (const linje of readFileSync(sti, 'utf8').split('\n')) {
      const m = linje.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) ud[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return ud
}

export function kraevToken() {
  const t = process.env.SUPABASE_ACCESS_TOKEN
  if (!t) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN mangler.\n' +
        'Hent et token på https://supabase.com/dashboard/account/tokens og kør:\n' +
        '  export SUPABASE_ACCESS_TOKEN=sbp_...',
    )
  }
  return t
}

/** Finder projektets ref ud fra .env, miljøet, eller navnet på projektet. */
export async function findProjektRef(token, ønsketNavn) {
  const env = laesEnv()

  const direkte = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF
  if (direkte) return direkte

  const url = process.env.SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const fraUrl = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (fraUrl) return fraUrl

  const projekter = await kald('GET', '/v1/projects', token)
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '')
  const traef = projekter.filter((p) => norm(p.name) === norm(ønsketNavn ?? ''))

  if (traef.length === 1) return traef[0].ref ?? traef[0].id

  throw new Error(
    'Kunne ikke afgøre hvilket projekt der skal bruges.\n' +
      'Sæt SUPABASE_PROJECT_REF i .env, eller vælg blandt:\n' +
      projekter.map((p) => `  ${p.name}  (${p.ref ?? p.id})`).join('\n'),
  )
}

async function kald(metode, sti, token, krop) {
  let svar
  try {
    svar = await fetch(`${BASE}${sti}`, {
      method: metode,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(krop ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(krop ? { body: JSON.stringify(krop) } : {}),
    })
  } catch (e) {
    // Node pakker den rigtige årsag ned i .cause, og "fetch failed" alene
    // fortæller ingenting. Her hentes den frem, for det er næsten altid
    // VPN, proxy eller DNS — ikke Supabase.
    const aarsag = e.cause?.code ?? e.cause?.message ?? e.message
    const raad = {
      ENOTFOUND: 'DNS kunne ikke slå api.supabase.com op. Er VPN eller DNS i vejen?',
      EAI_AGAIN: 'DNS svarede ikke. Prøv igen, eller slå VPN fra.',
      ECONNREFUSED: 'Forbindelsen blev afvist. En proxy eller firewall blokerer formentlig.',
      ETIMEDOUT: 'Forbindelsen løb ud. Typisk VPN eller firewall.',
      CERT_HAS_EXPIRED: 'Certifikatfejl — en proxy bryder TLS op (typisk firma-VPN).',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE:
        'Certifikatet kunne ikke verificeres — en proxy bryder TLS op (typisk firma-VPN).',
      SELF_SIGNED_CERT_IN_CHAIN:
        'Selvsigneret certifikat i kæden — en proxy bryder TLS op (typisk firma-VPN).',
    }[aarsag]

    throw new Error(
      `Kunne ikke nå api.supabase.com (${aarsag}).\n` +
        (raad ? `  ${raad}\n` : '') +
        '  Test forbindelsen med:\n' +
        '    curl -sS -o /dev/null -w "%{http_code}\\n" https://api.supabase.com/v1/projects',
    )
  }

  const tekst = await svar.text()
  if (!svar.ok) {
    throw new Error(`${metode} ${sti} → ${svar.status}: ${tekst.slice(0, 400)}`)
  }
  return tekst ? JSON.parse(tekst) : null
}

/**
 * Kører SQL i projektets database.
 *
 * Endpointet kører med fulde rettigheder. Det er derfor access tokenet hører
 * i din shell og ikke i .env — appen har kun brug for anon-nøglen.
 */
export const koerSql = (ref, token, sql) =>
  kald('POST', `/v1/projects/${ref}/database/query`, token, { query: sql })

export const hentNoegler = (ref, token) =>
  kald('GET', `/v1/projects/${ref}/api-keys?reveal=true`, token)

/**
 * Finder en nøgle der bypasser RLS — sb_secret_… hvis den findes, ellers den
 * gamle service_role. Endpointet navngiver dem forskelligt afhængigt af
 * hvornår projektet er oprettet, så vi kigger både på navn og på præfiks.
 */
export function findHemmeligNoegle(noegler) {
  return (
    noegler.find((n) => n.api_key?.startsWith('sb_secret_'))?.api_key ??
    noegler.find((n) => n.name === 'service_role')?.api_key ??
    noegler.find((n) => n.type === 'secret')?.api_key ??
    null
  )
}

export { kald }
