import { jsonSvar, kraevAdmin } from './_lib/supabase.js'

/**
 * POST /api/ai-baggrund  { beskrivelse, format }
 *
 * Genererer en BAGGRUND — flader, teksturer, stemninger. Ikke mennesker,
 * ikke lokaler, ikke noget der skal forestille virkeligheden.
 *
 * Det er et bevidst valg og ikke en teknisk begrænsning: begge kunder sælger
 * på at være ægte og lokale. Et opdigtet foto af "vores medarbejdere" eller
 * "vores klubhus" underminerer præcis det argument, og for foreningen ville
 * AI-børn desuden omgå hele samtykke-spørgsmålet på den forkerte måde.
 *
 * Funktionen returnerer billedet som base64. Klienten lægger det i bucket'en,
 * så al upload-logik bliver ét sted.
 */

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image'

// Google forventer forholdet som parameter. At bede om det i prompten i
// stedet gav billeder der var *næsten* rigtige — og et opslag der er beskåret
// skævt på Instagram ser sjusket ud.
const FORMATER = {
  kvadrat: '1:1',
  hoej: '4:5',
  bred: '16:9',
}

// Interactions API afløste generateContent til billeder. Revisionen skal med:
// uden den svarer Google med det nyeste format, og så knækker det den dag de
// ændrer noget.
const REVISION = process.env.GEMINI_API_REVISION ?? '2026-05-20'

export default async function handler(req) {
  if (req.method !== 'POST') return jsonSvar({ fejl: 'Kun POST.' }, 405)

  const adgang = await kraevAdmin(req)
  if (!adgang.ok) return adgang.svar

  const noegle = process.env.GEMINI_API_KEY
  if (!noegle) {
    return jsonSvar(
      {
        fejl:
          'AI-baggrunde er ikke slået til. Sæt GEMINI_API_KEY i Netlify hvis du vil bruge dem — ' +
          'upload og skabeloner virker uden.',
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

  const beskrivelse = (krop.beskrivelse ?? '').trim()
  if (!beskrivelse) return jsonSvar({ fejl: 'Skriv hvad baggrunden skal vise.' }, 400)

  const format = FORMATER[krop.format] ?? FORMATER.kvadrat

  const prompt = `Lav en abstrakt baggrund til et opslag på sociale medier.

${beskrivelse}

Krav:
- Ingen mennesker, ingen ansigter, ingen kropsdele.
- Ingen tekst, ingen bogstaver, ingen logoer, ingen tal.
- Ingen genkendelige bygninger, skilte eller varemærker.
- Rolig komposition med plads i midten, hvor tekst skal kunne læses ovenpå.
- Fotografisk eller grafisk, men tydeligt en baggrund — ikke et motiv.`

  try {
    const svar = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': noegle,
        'Api-Revision': REVISION,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{ type: 'text', text: prompt }],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          aspect_ratio: format,
        },
      }),
    })

    const tekst = await svar.text()

    if (!svar.ok) {
      // 404 betyder næsten altid at modelnavnet er skiftet — Google omdøber
      // billedmodellerne oftere end de fleste.
      if (svar.status === 404) {
        return jsonSvar(
          {
            fejl:
              `Modellen "${MODEL}" findes ikke længere. Sæt GEMINI_IMAGE_MODEL i Netlify ` +
              'til det aktuelle navn fra ai.google.dev/gemini-api/docs/pricing.',
          },
          502,
        )
      }
      if (svar.status === 401 || svar.status === 403) {
        return jsonSvar({ fejl: 'Gemini afviste nøglen. Er GEMINI_API_KEY gyldig og fakturering slået til?' }, 502)
      }
      if (svar.status === 429) {
        return jsonSvar({ fejl: 'Gemini har sagt stop for nu (kvote). Prøv igen om lidt.' }, 502)
      }
      return jsonSvar({ fejl: `Gemini svarede ${svar.status}: ${tekst.slice(0, 250)}` }, 502)
    }

    const data = JSON.parse(tekst)
    const dele = (data.steps ?? []).flatMap((s) => s.content ?? [])
    const billede = dele.find((d) => d.type === 'image' && d.data)

    if (!billede) {
      // Modellen svarer nogle gange med tekst i stedet — typisk når prompten
      // er blevet afvist. Den forklaring er mere brugbar end "intet billede".
      const forklaring = dele.find((d) => d.text)?.text
      return jsonSvar(
        {
          fejl: forklaring
            ? `Der kom ingen baggrund: ${forklaring.slice(0, 250)}`
            : 'Der kom intet billede retur. Prøv en anden beskrivelse.',
        },
        502,
      )
    }

    return jsonSvar({
      ok: true,
      base64: billede.data,
      mimeType: billede.mime_type ?? 'image/jpeg',
    })
  } catch (e) {
    console.error('AI-baggrund fejlede:', e)
    return jsonSvar({ fejl: e.message }, 500)
  }
}
