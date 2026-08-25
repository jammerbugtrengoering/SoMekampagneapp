import { createClient } from '@supabase/supabase-js'

/**
 * Service-role klient. Går uden om RLS — må KUN bruges server-side i
 * baggrundsjobs (fx den planlagte publicering, som ikke har en bruger-session).
 * Alt der udspringer af et brugerklik skal gå gennem serverClient() i stedet.
 */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat.',
    )
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
