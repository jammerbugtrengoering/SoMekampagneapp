import { createClient } from '@supabase/supabase-js';

// detectSessionInUrl: false — vi håndterer selv recovery-tokenet i App.jsx,
// på samme måde som i Planning-App og Medarbejder-App.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { detectSessionInUrl: false } }
);

/**
 * Kalder en Netlify-funktion med brugerens session i Authorization-headeren.
 *
 * Funktionerne slår tokenet op og bekræfter at brugeren står i app_admins.
 * Adgangen afgøres altså på serveren, ikke i skærmbilledet.
 */
export async function kaldApi(navn, krop) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, fejl: 'Du er ikke logget ind længere. Genindlæs siden.' };

  let svar;
  try {
    svar = await fetch(`/api/${navn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(krop ?? {}),
    });
  } catch {
    return { ok: false, fejl: 'Kunne ikke nå serveren. Er du online?' };
  }

  let data;
  try {
    data = await svar.json();
  } catch {
    return { ok: false, fejl: `Serveren svarede ${svar.status} uden indhold.` };
  }

  if (!svar.ok || data.fejl) {
    return { ok: false, fejl: data.fejl ?? `Serveren svarede ${svar.status}.` };
  }
  return { ok: true, ...data };
}
