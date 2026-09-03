import { createClient } from '@supabase/supabase-js'

/**
 * Service-role klient til funktionerne. Går uden om RLS.
 *
 * Bruges kun efter at kaldet er godkendt: enten via kraevOrgRolle() nedenfor,
 * eller via CRON_SECRET i den planlagte publicering.
 */
export function adminKlient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL

  // sb_secret_… er afløseren for service_role. Den nye foretrækkes; den gamle
  // virker indtil Supabase lukker den ved udgangen af 2026. Begge bypasser RLS.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL og SUPABASE_SECRET_KEY skal være sat ' +
        '(SUPABASE_SERVICE_ROLE_KEY virker også indtil den udfases).',
    )
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/*
 * kraevAdmin() er fjernet med migration 0005.
 *
 * Den slog op i app_admins — én global liste over folk der kunne alt. Efter
 * organisationerne er adgang ikke længere et ja/nej, men en rolle i en
 * bestemt organisation, og det er kraevOrgRolle() nedenfor der afgør den.
 * Funktionen står ikke tilbage som en genvej: en adgangskontrol der ikke
 * længere kontrollerer noget, er farligere end ingen.
 */

/**
 * Kræver at brugeren har en af rollerne i en bestemt organisation.
 *
 * Funktionerne kører med secret key og går uden om RLS. Basens politikker
 * beskytter altså browseren, men ikke et POST med curl — så rollen skal
 * afgøres her, ellers er en redaktør reelt ejer så snart hun kalder API'et
 * direkte. Og det er tokens der står på spil.
 *
 * Organisationen kan komme tre steder fra, i denne rækkefølge:
 *   1. orgId i kaldet
 *   2. udledt af den kunde eller kanal kaldet handler om
 *   3. brugerens eneste organisation, hvis hun kun er med i én
 *
 * Er hun med i flere og ikke har sagt hvilken, svarer vi 400 og beder om
 * det. At gætte kunne skrive et token ind hos den forkerte kunde.
 */
export async function kraevOrgRolle(
  req,
  { roller = ['ejer'], orgId = null, kundeId = null, kanalId = null } = {},
) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, svar: jsonSvar({ fejl: 'Ikke logget ind.' }, 401) }

  const klient = adminKlient()
  const { data, error } = await klient.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false, svar: jsonSvar({ fejl: 'Ugyldig session.' }, 401) }
  }
  const bruger = data.user

  let maal = orgId

  if (!maal && kundeId) {
    const { data: k } = await klient
      .from('customers').select('organisation_id').eq('id', kundeId).maybeSingle()
    maal = k?.organisation_id ?? null
  }

  if (!maal && kanalId) {
    const { data: k } = await klient
      .from('channels').select('brands(customers(organisation_id))').eq('id', kanalId).maybeSingle()
    maal = k?.brands?.customers?.organisation_id ?? null
  }

  const { data: medlemskaber } = await klient
    .from('org_members').select('org_id, rolle').eq('user_id', bruger.id)

  if (!medlemskaber?.length) {
    return {
      ok: false,
      svar: jsonSvar({ fejl: 'Din bruger er ikke medlem af nogen organisation.' }, 403),
    }
  }

  if (!maal) {
    const brugbare = medlemskaber.filter((m) => roller.includes(m.rolle))
    if (brugbare.length === 1) {
      maal = brugbare[0].org_id
    } else {
      return {
        ok: false,
        svar: jsonSvar({
          fejl: brugbare.length
            ? 'Du er med i flere organisationer. Sig hvilken (orgId) kaldet gælder.'
            : `Handlingen kræver rollen ${roller.join(' eller ')}.`,
        }, 400),
      }
    }
  }

  const medlemskab = medlemskaber.find((m) => m.org_id === maal)

  // Samme svar hvad enten organisationen ikke findes, eller brugeren står
  // udenfor: ellers kan fejlteksten bruges til at kortlægge hvem der er
  // kunder i systemet.
  if (!medlemskab) {
    return { ok: false, svar: jsonSvar({ fejl: 'Ingen adgang til den organisation.' }, 403) }
  }

  if (!roller.includes(medlemskab.rolle)) {
    return {
      ok: false,
      svar: jsonSvar({
        fejl: `Handlingen kræver rollen ${roller.join(' eller ')}. Du er ${medlemskab.rolle}.`,
      }, 403),
    }
  }

  return { ok: true, bruger, klient, orgId: maal, rolle: medlemskab.rolle }
}

export function jsonSvar(krop, status = 200) {
  return new Response(JSON.stringify(krop), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export { tørkørsel } from './miljo.js'
