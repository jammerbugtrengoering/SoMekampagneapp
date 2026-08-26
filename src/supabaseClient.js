import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;

/**
 * Supabase udfaser anon- og service_role-nøglerne ved udgangen af 2026 til
 * fordel for sb_publishable_… og sb_secret_…. Vi foretrækker den nye, men
 * falder tilbage på den gamle, så appen kan skifte uden en flagdag — og så de
 * to andre apps kan migrere i deres eget tempo.
 *
 * De nye nøgler er drop-in i createClient. Til gengæld må de IKKE sendes i en
 * Authorization: Bearer-header, kun som apikey — det klarer klienten selv, så
 * længe nøglen kun gives hertil og ikke sættes i headers i egen kode.
 */
const offentligNoegle =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Mangler variablerne, kaster createClient inden React når at montere, og man
 * får en hvid side uden en forklaring. Derfor tjekkes de her i stedet, så
 * App.jsx kan vise hvad der mangler.
 *
 * VITE_-variabler læses ved BUILD, ikke ved kørsel. Er de ikke sat i Netlify
 * når buildet kører, hjælper det ikke at sætte dem bagefter — der skal et nyt
 * deploy til.
 */
export const opsaetningsfejl = !url
  ? 'VITE_SUPABASE_URL er ikke sat.'
  : !offentligNoegle
    ? 'VITE_SUPABASE_PUBLISHABLE_KEY er ikke sat (VITE_SUPABASE_ANON_KEY virker også).'
    : null;

// detectSessionInUrl: false — vi håndterer selv recovery-tokenet i App.jsx,
// på samme måde som i Planning-App og Medarbejder-App.
export const supabase = opsaetningsfejl
  ? null
  : createClient(url, offentligNoegle, { auth: { detectSessionInUrl: false } });

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

  // Rammer man /api uden at funktionerne kører — fx "npm run dev" i stedet for
  // "npm run dev:api" — svarer SPA-reglen med index.html, og så er svaret HTML.
  const type = svar.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    return {
      ok: false,
      fejl:
        svar.status === 404
          ? `Funktionen "${navn}" blev ikke fundet. Kører du "npm run dev" i stedet for "npm run dev:api"?`
          : `Serveren svarede ${svar.status} uden JSON.`,
    };
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
