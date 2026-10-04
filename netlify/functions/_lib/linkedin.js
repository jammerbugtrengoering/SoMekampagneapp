/**
 * Publicering til LinkedIn.
 *
 * Ligger ved siden af meta.js frem for inde i den. De to deler intet ud
 * over formen paa publicerTilKanal(): andre endepunkter, andre headere,
 * andre fejlkoder -- og en billedmodel der vender modsat.
 *
 * Meta henter selv billedet fra en offentlig URL. LinkedIn vil have det
 * uploadet til sig foerst, i tre kald. Det er den reelle forskel i koden.
 *
 * Forfatteren staar i kanalens author_urn og er enten
 * urn:li:person:xxx (personlig profil, «Share on LinkedIn») eller
 * urn:li:organization:yyy (firmaside, Community Management API). Selve
 * opslaget er det samme -- kun det ene felt skifter.
 */

const API = 'https://api.linkedin.com'

export class LinkedInFejl extends Error {
  constructor(besked, status) {
    super(besked)
    this.name = 'LinkedInFejl'
    this.status = status
  }

  /**
   * Nogle fejl gaar vaek af sig selv, andre goer ikke.
   *
   * 401 og 403 betyder at tokenet er udloebet eller mangler et scope. At
   * proeve igen paa dem braender bare rate limit af paa noget der aldrig
   * lykkes foer et menneske har gjort noget.
   */
  get kanGentages() {
    if (this.status === undefined) return true // netvaerksfejl
    if (this.status === 429) return true
    return this.status >= 500
  }
}

async function haandter(svar) {
  const tekst = await svar.text()
  if (!svar.ok) {
    let besked = tekst.slice(0, 300)
    try {
      const j = JSON.parse(tekst)
      besked = j.message ?? j.error_description ?? besked
    } catch {
      // Ikke JSON. Den raa tekst er stadig bedre end ingenting.
    }
    throw new LinkedInFejl(`LinkedIn: ${besked}`, svar.status)
  }
  return { krop: tekst ? JSON.parse(tekst) : {}, headere: svar.headers }
}

function headere(token, ekstra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
    ...ekstra,
  }
}

/**
 * Billedet ind hos LinkedIn foerst.
 *
 * Tre kald: registrer, upload de raa bytes, brug asset-URN'en i opslaget.
 * Hentningen fra vores egen bucket er det foerste netvaerkskald i kaeden
 * og dermed det foerste der kan fejle -- derfor siges det tydeligt hvad
 * der gik galt, i stedet for at lade en tom body naa LinkedIn.
 */
async function uploadBillede(forfatter, token, billedUrl) {
  const { krop: reg } = await haandter(
    await fetch(`${API}/v2/assets?action=registerUpload`, {
      method: 'POST',
      headers: headere(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: forfatter,
          serviceRelationships: [
            { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
          ],
        },
      }),
    }),
  )

  const mekanisme =
    reg.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]
  const uploadUrl = mekanisme?.uploadUrl
  const asset = reg.value?.asset

  if (!uploadUrl || !asset) {
    throw new LinkedInFejl('LinkedIn gav hverken uploadUrl eller asset tilbage.')
  }

  let bytes
  try {
    const hentet = await fetch(billedUrl)
    if (!hentet.ok) throw new Error(`status ${hentet.status}`)
    bytes = Buffer.from(await hentet.arrayBuffer())
  } catch (e) {
    throw new LinkedInFejl(
      `Kunne ikke hente billedet fra ${billedUrl}: ${e.message}. ` +
        'Er storage-bucket\'en stadig public?',
    )
  }

  const lagt = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: bytes,
  })
  if (!lagt.ok) {
    throw new LinkedInFejl(`Billedet blev afvist ved upload (${lagt.status}).`, lagt.status)
  }

  return asset
}

/**
 * Sender ét opslag. Samme signatur som udgivFacebook og udgivInstagram,
 * saa UDGIVERE-tabellen i meta.js kan kalde alle tre ens.
 */
export async function udgivLinkedIn(kanal, token, opslag) {
  const forfatter = kanal.author_urn
  if (!forfatter) {
    throw new LinkedInFejl(
      'Kanalen mangler author_urn. Forbind kunden under Kunder → LinkedIn.',
    )
  }

  const medie = opslag.billedUrl
    ? await uploadBillede(forfatter, token, opslag.billedUrl)
    : null

  const indhold = {
    shareCommentary: { text: opslag.tekst },
    shareMediaCategory: medie ? 'IMAGE' : 'NONE',
    ...(medie
      ? {
          media: [
            {
              status: 'READY',
              media: medie,
              ...(opslag.altTekst
                ? { description: { text: opslag.altTekst } }
                : {}),
            },
          ],
        }
      : {}),
  }

  const { krop, headere: svarHeadere } = await haandter(
    await fetch(`${API}/v2/ugcPosts`, {
      method: 'POST',
      headers: headere(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: forfatter,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': indhold },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    }),
  )

  // Id'et staar i x-restli-id-headeren OG i body. Headeren er den
  // paalidelige -- derfor laeses den foerst.
  const eksternId = svarHeadere.get('x-restli-id') ?? krop.id
  if (!eksternId) throw new LinkedInFejl('Opslaget blev oprettet, men uden id.')

  return {
    eksternId,
    permalink: `https://www.linkedin.com/feed/update/${eksternId}`,
  }
}

/** Bekraefter at tokenet stadig kan se den profil der skal skrives som. */
export async function testLinkedIn(kanal, token) {
  if (!kanal.author_urn) return { ok: false, fejl: 'Kanalen mangler author_urn.' }

  try {
    const { krop } = await haandter(
      await fetch(`${API}/v2/userinfo`, { headers: headere(token) }),
    )
    const urn = krop.sub ? `urn:li:person:${krop.sub}` : null

    // At tokenet virker er ikke nok. Peger kanalen et andet sted hen, ville
    // opslaget gaa ud paa en forkert profil -- og det opdages ikke bagefter.
    if (urn && kanal.author_urn.startsWith('urn:li:person:') && urn !== kanal.author_urn) {
      return {
        ok: false,
        fejl: `Tokenet hoerer til ${krop.name ?? urn}, men kanalen skriver som ${kanal.author_urn}.`,
      }
    }
    return { ok: true, navn: krop.name ?? urn }
  } catch (e) {
    return { ok: false, fejl: e.message }
  }
}
