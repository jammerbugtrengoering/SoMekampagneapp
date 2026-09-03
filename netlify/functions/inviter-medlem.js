import { jsonSvar, kraevOrgRolle } from './_lib/supabase.js'

/**
 * POST /api/inviter-medlem  { orgId, email, navn, rolle }
 *
 * Giver en person adgang til en organisation.
 *
 * To tilfælde, og de skal opføre sig forskelligt:
 *
 *   Brugeren findes    → hun får blot et medlemskab. Ingen mail, intet nyt
 *                        login, ingen adgangskode der skal skiftes.
 *   Brugeren findes ikke → Supabase sender en invitation, og hun vælger selv
 *                        sin adgangskode. Vi genererer aldrig en og sender
 *                        den videre: en adgangskode der har været forbi os
 *                        er ikke længere hendes alene.
 *
 * Rollen afgøres serverside. Funktionen kører med secret key og går uden om
 * RLS, så uden tjekket kunne en redaktør invitere sig selv som ejer med et
 * enkelt kald.
 */

const ROLLER = ['ejer', 'redaktoer', 'godkender']

/** Findes brugeren i forvejen? Der bladres, for der er ikke filtrering på
 *  e-mail i alle udgaver af Auth Admin API'et. */
async function findBruger(klient, email) {
  const maal = email.toLowerCase()
  for (let side = 1; side <= 10; side++) {
    const { data, error } = await klient.auth.admin.listUsers({ page: side, perPage: 200 })
    if (error) throw new Error(error.message)
    const traef = data.users.find((u) => u.email?.toLowerCase() === maal)
    if (traef) return traef
    if (data.users.length < 200) break
  }
  return null
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  const email = (krop.email ?? '').trim().toLowerCase()
  const navn = (krop.navn ?? '').trim() || null
  const rolle = krop.rolle ?? 'redaktoer'

  if (!email || !email.includes('@')) return jsonSvar({ fejl: 'Skriv en gyldig e-mail.' }, 400)
  if (!ROLLER.includes(rolle)) return jsonSvar({ fejl: `Ukendt rolle: ${rolle}.` }, 400)

  const adgang = await kraevOrgRolle(req, { roller: ['ejer'], orgId: krop.orgId ?? null })
  if (!adgang.ok) return adgang.svar
  const { klient, orgId } = adgang

  let bruger
  try {
    bruger = await findBruger(klient, email)
  } catch (e) {
    return jsonSvar({ fejl: `Kunne ikke slå brugeren op: ${e.message}` }, 500)
  }

  let inviteret = false

  if (!bruger) {
    const { data, error } = await klient.auth.admin.inviteUserByEmail(email)

    if (error || !data?.user) {
      // Mail er den del der oftest ikke er sat op endnu. Sig hvad der så
      // skal gøres i stedet, frem for at give beskeden videre rå.
      return jsonSvar({
        fejl:
          `Kunne ikke sende invitationen: ${error?.message ?? 'ukendt fejl'}. ` +
          'Er afsendelse af mail sat op i Supabase (Authentication → Emails)? ' +
          'Ellers kan du oprette brugeren under Authentication → Users og invitere igen — ' +
          'så tilføjes hun med det samme uden mail.',
      }, 502)
    }

    bruger = data.user
    inviteret = true
  }

  // Er hun med i forvejen, retter vi rollen frem for at fejle. "Invitér igen
  // med en anden rolle" er en helt almindelig ting at ville.
  const { error } = await klient
    .from('org_members')
    .upsert(
      { org_id: orgId, user_id: bruger.id, rolle, email, name: navn },
      { onConflict: 'org_id,user_id' },
    )

  if (error) return jsonSvar({ fejl: error.message }, 500)

  return jsonSvar({
    ok: true,
    besked: inviteret
      ? `Invitation sendt til ${email}. Hun vælger selv adgangskode og er ${rolle}.`
      : `${email} har nu adgang som ${rolle}.`,
    inviteret,
  })
}
