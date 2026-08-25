import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Bruger-scoped klient. RLS gælder — brugeren ser kun sine egne brands. */
export async function serverClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Kaldt fra en Server Component — middleware opdaterer sessionen.
          }
        },
      },
    },
  )
}
