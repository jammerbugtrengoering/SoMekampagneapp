import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Den signerede state-parameter i LinkedIns OAuth-flow.
 *
 * Callback'et er et browser-redirect fra LinkedIn. Der er ingen
 * Authorization-header, ingen session, intet kraevOrgRolle kan spoerge om
 * -- og alligevel skal funktionen skrive et token ind hos en bestemt kunde.
 *
 * Hele adgangskontrollen ligger derfor i denne state. Den udstedes kun
 * efter at en ejer er verificeret i trin «start», og callback'et stoler
 * paa den og intet andet. Kunne den forfalskes, kunne enhver faa sit eget
 * LinkedIn-token skrevet ind hos en fremmed kunde -- og derefter
 * publicere paa den kundes vegne.
 *
 * Derfor: HMAC, en levetid paa faa minutter, en nonce, og en
 * konstanttids-sammenligning.
 */

const LEVETID_MS = 10 * 60 * 1000

/**
 * Noeglen udledes af TOKEN_ENCRYPTION_KEY frem for at vaere en ny variabel.
 *
 * Det er bevidst ikke den samme noegle der bruges direkte: at signere og
 * kryptere med praecis samme bytes er den slags genbrug der en dag bider.
 * En HMAC over et fast maerkat giver en noegle der kun bruges her, uden at
 * der skal saettes endnu en hemmelighed op i Netlify som kan blive glemt.
 */
function noegle() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY mangler — state kan ikke signeres.')
  }
  return createHmac('sha256', Buffer.from(raw, 'base64')).update('linkedin-oauth-state').digest()
}

const b64 = (buf) => Buffer.from(buf).toString('base64url')

function signatur(nyttelast) {
  return createHmac('sha256', noegle()).update(nyttelast).digest('base64url')
}

/** Udsteder en state. Kaldes kun naar en ejer er verificeret. */
export function lavState({ kundeId, orgId, brugerId, nu = Date.now() }) {
  const krop = b64(
    JSON.stringify({
      k: kundeId,
      o: orgId,
      u: brugerId,
      n: randomBytes(16).toString('base64url'),
      udloeber: nu + LEVETID_MS,
    }),
  )
  return `${krop}.${signatur(krop)}`
}

/**
 * Laeser en state, eller kaster.
 *
 * Kaster frem for at returnere null: en ugyldig state er ikke en tom
 * vaerdi, det er et forsoeg -- enten paa forfalskning eller paa at bruge
 * et link der er blevet for gammelt. Begge dele skal siges hoejt.
 */
export function laesState(state, nu = Date.now()) {
  if (typeof state !== 'string' || !state.includes('.')) {
    throw new Error('State mangler eller har forkert form.')
  }

  const [krop, sig] = state.split('.', 2)
  const forventet = signatur(krop)

  // Laengderne skal matche foer timingSafeEqual, ellers kaster den selv --
  // og saa ville laengden i sig selv laekke.
  const a = Buffer.from(sig)
  const b = Buffer.from(forventet)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('State har ugyldig signatur.')
  }

  let data
  try {
    data = JSON.parse(Buffer.from(krop, 'base64url').toString('utf8'))
  } catch {
    throw new Error('State kunne ikke laeses.')
  }

  if (typeof data.udloeber !== 'number' || data.udloeber < nu) {
    throw new Error('State er udloebet. Start forbindelsen forfra.')
  }
  if (!data.k || !data.o) {
    throw new Error('State mangler kunde eller organisation.')
  }

  return { kundeId: data.k, orgId: data.o, brugerId: data.u }
}

export const STATE_LEVETID_MS = LEVETID_MS
