import { createClient } from '@supabase/supabase-js'

/**
 * Service-role klient til funktionerne. Går uden om RLS.
 *
 * Bruges kun efter at kaldet er godkendt: enten via kraevAdmin() nedenfor,
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

/**
 * Slår brugerens bearer-token op og bekræfter at hun står i app_admins.
 *
 * Funktionerne kører med service-role og kan alt. Derfor er det her, og ikke
 * i skærmbilledet, at adgangen faktisk afgøres — et POST med curl skal falde
 * på samme sten som en uautoriseret bruger i browseren.
 *
 * Returnerer { ok: true, bruger } eller { ok: false, svar } hvor svar er en
 * færdig Response der kan returneres direkte.
 */
export async function kraevAdmin(req) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return { ok: false, svar: jsonSvar({ fejl: 'Ikke logget ind.' }, 401) }
  }

  const klient = adminKlient()

  const { data, error } = await klient.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false, svar: jsonSvar({ fejl: 'Ugyldig session.' }, 401) }
  }

  const { data: admin } = await klient
    .from('app_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (!admin) {
    return {
      ok: false,
      svar: jsonSvar({ fejl: 'Din bruger er ikke administrator i kampagneappen.' }, 403),
    }
  }

  return { ok: true, bruger: data.user, klient }
}

export function jsonSvar(krop, status = 200) {
  return new Response(JSON.stringify(krop), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export { tørkørsel } from './miljo.js'
