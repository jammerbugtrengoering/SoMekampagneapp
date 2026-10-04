import { jsonSvar, kraevOrgRolle } from './_lib/supabase.js'

/**
 * POST /api/ai-baggrund  { beskrivelse, format }
 *
 * Genererer en BAGGRUND — flader, teksturer, stemninger. Ikke mennesker,
 * ikke lokaler, ikke noget der skal forestille virkeligheden.
 *
 * Det er et bevidst valg og ikke en teknisk begrænsning. Appen skriver for
 * afsendere der sælger på at vide noget og have været der selv, og et
 * opdigtet foto af "vores folk" eller "vores lokaler" arbejder direkte imod
 * det argument. Læg hellere tekst på en flade med skabelonen.
 *
 * To udbydere, fordi de koster vidt forskelligt:
 *
 *   cloudflare  FLUX-1-schnell på Workers AI. 10.000 neuroner om dagen
 *               gratis, og et 1024×1024-billede koster ~19 — altså omkring
 *               500 billeder i døgnet uden at betale.
 *   gemini      Bedre billeder, men ingen gratis kvote overhovedet til
 *               billedmodellerne, og på free tier bruger Google indholdet
 *               til at forbedre deres produkter.
 *
 * Valget træffes af hvilke nøgler der står i Netlify, ikke af en indstilling
 * i appen: en udbyder uden nøgle er ikke et valg, det er en fejl der venter.
 *
 * Funktionen returnerer billedet som base64. Klienten lægger det i bucket'en,
 * så al upload-logik bliver ét sted.
 */

const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image'

// Interactions API afløste generateContent til billeder. Revisionen skal med:
// uden den svarer Google med det nyeste format, og så knækker det den dag de
// ændrer noget.
const GEMINI_REVISION = process.env.GEMINI_API_REVISION ?? '2026-05-20'

// Den billigste af Cloudflares billedmodeller. Navnet kan sættes i Netlify,
// for Workers AI skifter katalog oftere end vi deployer.
const CF_MODEL = process.env.CLOUDFLARE_IMAGE_MODEL ?? '@cf/black-forest-labs/flux-1-schnell'

// Oversætteren. En lille sprogmodel på samme konto og samme gratis kvote.
const CF_OVERSAETTER = process.env.CLOUDFLARE_TEKST_MODEL ?? '@cf/meta/llama-3.1-8b-instruct'

// Google forventer forholdet som parameter. At bede om det i prompten i
// stedet gav billeder der var *næsten* rigtige — og et opslag der er beskåret
// skævt på Instagram ser sjusket ud.
const FORMATER = {
  kvadrat: '1:1',
  hoej: '4:5',
  bred: '16:9',
}

/**
 * To slags billeder, og forskellen er værd at holde fast i.
 *
 * En BAGGRUND er en flade man lægger tekst ovenpå. Den må ikke have et
 * motiv, for så slås motivet og teksten om opmærksomheden.
 *
 * Et MOTIV er billedet selv: et vægur i en produktionshal, en tavle med
 * post-its. Det er den slags billedbriefen på opslaget beskriver, og
 * indtil nu havde appen ingen måde at bede om det på — briefen blev
 * klistret ind i en prompt der udtrykkeligt sagde «ikke et motiv», og
 * modellen fik to modsatrettede ordrer.
 *
 * Det de har tilfælles, er forbuddene: ingen mennesker, ingen tekst, ingen
 * genkendelige bygninger eller varemærker. Mennesker er udeladt med vilje
 * og ikke af tekniske grunde — afsenderen her sælger på at have været der
 * selv, og et opdigtet foto af «vores folk» arbejder direkte imod det.
 */
const FORBUD = `- Ingen mennesker, ingen ansigter, ingen kropsdele.
- Ingen tekst, ingen bogstaver, ingen logoer, ingen tal.
- Ingen genkendelige bygninger, skilte eller varemærker.`

// Samme krav på engelsk. Ikke en oversættelse for syns skyld: FLUX' encoder
// er T5, trænet på et overvejende engelsk korpus, og al vejledning fra Black
// Forest Labs er engelsk. Dansk virker delvist -- og svigter netop på de
// konkrete substantiver der bærer billedet.
const FORBUD_EN = `- No people, no faces, no body parts.
- No text, no letters, no logos, no numbers.
- No recognisable buildings, signs or trademarks.`

function byggPrompt(beskrivelse, slags, sprog = 'da') {
  if (sprog === 'en') {
    if (slags === 'motiv') {
      return `A photographic image for a social media post.

${beskrivelse}

Requirements:
${FORBUD_EN}
- Natural light, real materials, no glossy advertising aesthetic.
- A place that looks used rather than staged.`
    }

    return `An abstract background for a social media post.

${beskrivelse}

Requirements:
${FORBUD_EN}
- Calm composition with open space in the middle, where text will be placed on top.
- Photographic or graphic, but clearly a background — not a subject.`
  }

  if (slags === 'motiv') {
    return `Lav et fotografisk billede til et opslag på sociale medier.

${beskrivelse}

Krav:
${FORBUD}
- Naturligt lys, ægte materialer, ingen glossy reklameæstetik.
- Et sted der ser brugt ud frem for iscenesat.`
  }

  return `Lav en abstrakt baggrund til et opslag på sociale medier.

${beskrivelse}

Krav:
${FORBUD}
- Rolig komposition med plads i midten, hvor tekst skal kunne læses ovenpå.
- Fotografisk eller grafisk, men tydeligt en baggrund — ikke et motiv.`
}

/**
 * Oversætter beskrivelsen til engelsk før den går til FLUX.
 *
 * Billedbriefen er skrevet på dansk med vilje -- den skal kunne læses af den
 * der tager billedet. Men modellen der laver billedet forstår engelsk bedst,
 * så de to ting trækker hver sin vej. Oversættelsen her løser det uden at
 * røre briefen: det er kun prompten der skifter sprog.
 *
 * Samme konto, samme gratis kvote, og prisen forsvinder i afrundingen --
 * en oversættelse er få hundrede tokens mod billedets ~19 neuroner.
 *
 * Fejler den, går den danske tekst videre uændret. Et lidt ringere billede
 * er bedre end ingen billede, og brugeren skal ikke stoppes af et
 * hjælpetrin han ikke bad om.
 */
async function tilEngelsk(tekst, konto, token) {
  try {
    const svar = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${konto}/ai/run/${CF_OVERSAETTER}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content:
                'You translate image descriptions from Danish to English for an image ' +
                'generation model. Reply with the translation only — no quotes, no ' +
                'explanation, no preamble. If the text is already English, repeat it ' +
                'unchanged. Keep proper nouns and product names as they are. Be literal: ' +
                'do not add details that are not in the original.',
            },
            { role: 'user', content: tekst },
          ],
          max_tokens: 400,
        }),
      },
    )

    if (!svar.ok) return tekst

    const data = await svar.json()
    const ud = (data.result?.response ?? '').trim()

    // En tom eller mistænkeligt kort oversættelse af en lang tekst er et
    // tegn på at modellen svarede noget andet end en oversættelse.
    if (!ud || ud.length < Math.min(10, tekst.length / 3)) return tekst

    return ud
  } catch {
    return tekst
  }
}

/* ---------------------------------------------------------------------
   Cloudflare Workers AI
   --------------------------------------------------------------------- */
/**
 * FLUX-1-schnell tager hverken bredde, højde eller format. Den leverer et
 * kvadrat, punktum.
 *
 * Derfor siger svaret `kvadratisk: true`, og klienten beskærer til det
 * valgte format. Det er ærligere end at lade som om vi bad om 16:9 — og
 * det er netop beskæring der er forsvarlig her, fordi billedet er en flade
 * uden motiv der kan klippes over.
 *
 * steps er sat til 4. Modellen tillader 8, men den er trænet til at være
 * færdig på få skridt, og forskellen på en baggrund er ikke til at se.
 * Prisen er derimod til at se: hvert skridt tæller.
 */
async function cloudflare(beskrivelse, slags) {
  const konto = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN

  const paaEngelsk = await tilEngelsk(beskrivelse, konto, token)

  const svar = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${konto}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Prompten må højst fylde 2048 tegn. Vores egne krav fylder ~330, så
      // beskrivelsen er skåret i klienten — her klippes der for en sikkerheds
      // skyld igen, så et langt indsæt giver et billede og ikke en 400'er.
      body: JSON.stringify({ prompt: byggPrompt(paaEngelsk, slags, 'en').slice(0, 2048), steps: 4 }),
    },
  )

  const tekst = await svar.text()

  if (!svar.ok) {
    if (svar.status === 401 || svar.status === 403) {
      return {
        fejl:
          'Cloudflare afviste nøglen. Tokenet skal have BÅDE «Workers AI: Read» og ' +
          '«Workers AI: Edit» — Read alene kan ikke køre en model. Og er ' +
          'CLOUDFLARE_ACCOUNT_ID den rigtige konto?',
      }
    }
    if (svar.status === 429) {
      return { fejl: 'Dagens gratis kvote hos Cloudflare er brugt op. Den nulstilles i morgen.' }
    }
    if (svar.status === 404) {
      return {
        fejl:
          `Modellen "${CF_MODEL}" findes ikke. Sæt CLOUDFLARE_IMAGE_MODEL i Netlify til ` +
          'et navn fra developers.cloudflare.com/workers-ai/models/.',
      }
    }
    return { fejl: `Cloudflare svarede ${svar.status}: ${tekst.slice(0, 250)}` }
  }

  let data
  try {
    data = JSON.parse(tekst)
  } catch {
    return { fejl: 'Cloudflare svarede noget der ikke var JSON.' }
  }

  return laesCloudflareSvar(data)
}

/**
 * Pakker billedet ud af Cloudflares svar.
 *
 * Eksporteret fordi den er værd at teste for sig: Cloudflare svarer 200 med
 * success:false når noget er galt, og den detalje er nem at overse. Gør man
 * det, bliver "prompten blev afvist" til "der kom intet billede" — og så
 * leder man det forkerte sted.
 */
export function laesCloudflareSvar(data) {
  if (data.success === false) {
    const besked = (data.errors ?? []).map((e) => e.message).filter(Boolean).join('; ')
    return { fejl: besked || 'Cloudflare afviste forespørgslen.' }
  }

  const base64 = data.result?.image
  if (!base64) return { fejl: 'Der kom intet billede retur fra Cloudflare.' }

  return { base64, mimeType: 'image/jpeg', kvadratisk: true }
}

/* ---------------------------------------------------------------------
   Gemini
   --------------------------------------------------------------------- */
async function gemini(beskrivelse, format, slags) {
  const noegle = process.env.GEMINI_API_KEY

  const svar = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': noegle,
      'Api-Revision': GEMINI_REVISION,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [{ type: 'text', text: byggPrompt(beskrivelse, slags) }],
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: FORMATER[format] ?? FORMATER.kvadrat,
      },
    }),
  })

  const tekst = await svar.text()

  if (!svar.ok) {
    // 404 betyder næsten altid at modelnavnet er skiftet — Google omdøber
    // billedmodellerne oftere end de fleste.
    if (svar.status === 404) {
      return {
        fejl:
          `Modellen "${GEMINI_MODEL}" findes ikke længere. Sæt GEMINI_IMAGE_MODEL i Netlify ` +
          'til det aktuelle navn fra ai.google.dev/gemini-api/docs/pricing.',
      }
    }
    if (svar.status === 401 || svar.status === 403) {
      return { fejl: 'Gemini afviste nøglen. Er GEMINI_API_KEY gyldig og fakturering slået til?' }
    }
    if (svar.status === 429) {
      return { fejl: 'Gemini har sagt stop for nu (kvote). Prøv igen om lidt.' }
    }
    return { fejl: `Gemini svarede ${svar.status}: ${tekst.slice(0, 250)}` }
  }

  const data = JSON.parse(tekst)
  const dele = (data.steps ?? []).flatMap((s) => s.content ?? [])
  const billede = dele.find((d) => d.type === 'image' && d.data)

  if (!billede) {
    // Modellen svarer nogle gange med tekst i stedet — typisk når prompten
    // er blevet afvist. Den forklaring er mere brugbar end "intet billede".
    const forklaring = dele.find((d) => d.text)?.text
    return {
      fejl: forklaring
        ? `Der kom ingen baggrund: ${forklaring.slice(0, 250)}`
        : 'Der kom intet billede retur. Prøv en anden beskrivelse.',
    }
  }

  return { base64: billede.data, mimeType: billede.mime_type ?? 'image/jpeg', kvadratisk: false }
}

/**
 * Hvem skal lave billedet?
 *
 * Cloudflare først, fordi den er gratis. Står der udtrykkeligt en udbyder i
 * AI_BILLED_UDBYDER, vinder den — ellers vælger vi den der har nøgler.
 */
export function vaelgUdbyder() {
  const oenske = (process.env.AI_BILLED_UDBYDER ?? '').trim().toLowerCase()
  const harCf = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)
  const harGemini = !!process.env.GEMINI_API_KEY

  if (oenske === 'cloudflare') return harCf ? 'cloudflare' : null
  if (oenske === 'gemini') return harGemini ? 'gemini' : null
  if (harCf) return 'cloudflare'
  if (harGemini) return 'gemini'
  return null
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  // AI-baggrunde hører til indholdsarbejdet — og hos Cloudflare tæller de
  // på en fælles dagskvote. Derfor redaktør og ejer, ikke en godkender.
  const adgang = await kraevOrgRolle(req, { roller: ['ejer', 'redaktoer'] })
  if (!adgang.ok) return adgang.svar

  const udbyder = vaelgUdbyder()
  if (!udbyder) {
    return jsonSvar(
      {
        fejl:
          'AI-baggrunde er ikke slået til. Sæt CLOUDFLARE_ACCOUNT_ID og CLOUDFLARE_API_TOKEN ' +
          'i Netlify — det er gratis op til omkring 500 billeder om dagen. ' +
          'Upload og skabeloner virker uden.',
      },
      501,
    )
  }

  let krop
  try {
    krop = await req.json()
  } catch {
    return jsonSvar({ fejl: 'Ugyldig JSON.' }, 400)
  }

  const beskrivelse = (krop.beskrivelse ?? '').trim().slice(0, 1200)
  if (!beskrivelse) return jsonSvar({ fejl: 'Skriv hvad baggrunden skal vise.' }, 400)

  const format = FORMATER[krop.format] ? krop.format : 'kvadrat'
  // Baggrund er standarden. Et motiv er et valg man skal træffe.
  const slags = krop.slags === 'motiv' ? 'motiv' : 'baggrund'

  try {
    const resultat = udbyder === 'cloudflare'
      ? await cloudflare(beskrivelse, slags)
      : await gemini(beskrivelse, format, slags)

    if (resultat.fejl) return jsonSvar({ fejl: resultat.fejl }, 502)

    return jsonSvar({
      ok: true,
      base64: resultat.base64,
      mimeType: resultat.mimeType,
      // Klienten skal vide om den selv skal beskære. At gætte ud fra
      // billedets mål ville virke indtil den dag en model leverer et
      // kvadrat selvom der blev bedt om 16:9.
      kvadratisk: !!resultat.kvadratisk,
      udbyder,
    })
  } catch (e) {
    console.error('AI-baggrund fejlede:', e)
    return jsonSvar({ fejl: e.message }, 500)
  }
}
