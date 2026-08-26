/**
 * Kampagnegenerering via Claude.
 *
 * Kaldes med fetch i stedet for SDK'et, så afhængighedslisten holdes lige så
 * kort som i de to andre apps. Modellen tvinges gennem et værktøj med et fast
 * skema, så vi får struktureret data i stedet for tekst der skal fortolkes.
 */

const API = 'https://api.anthropic.com/v1/messages'
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

const VAERKTOEJ = {
  name: 'lever_kampagne',
  description: 'Aflever den færdige serie af opslag.',
  input_schema: {
    type: 'object',
    properties: {
      opslag: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tekst: {
              type: 'string',
              description:
                'Selve opslagsteksten på dansk. Uden hashtags — de hører i hashtags-feltet.',
            },
            hashtags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Uden #-tegn. Maks 5. Tom liste er et gyldigt svar.',
            },
            billedbrief: {
              type: 'string',
              description:
                'Hvad billedet skal vise. Konkret nok til at en fotograf kan arbejde ud fra det.',
            },
            dag: {
              type: 'integer',
              description: 'Antal dage efter kampagnens start. 0 = startdagen.',
            },
            klokke: { type: 'string', description: 'Klokkeslæt som HH:MM, dansk tid.' },
            kanaler: {
              type: 'array',
              items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin'] },
            },
            hvorfor: {
              type: 'string',
              description: 'Én sætning om hvorfor dette opslag på dette tidspunkt.',
            },
          },
          required: ['tekst', 'hashtags', 'billedbrief', 'dag', 'klokke', 'kanaler'],
        },
      },
    },
    required: ['opslag'],
  },
}

const SYSTEM = `Du er content-planlægger for en dansk marketingafdeling.

Du skriver opslag der lyder som om et menneske fra virksomheden har skrevet dem. Det betyder:
- Ingen "🚀 Spændende nyheder!" eller anden LinkedIn-plastik.
- Ingen tomme superlativer. Sig noget konkret eller lad være.
- Variér længde og form hen over serien. Ikke alle opslag skal have samme rytme.
- Skriv på dansk. Undgå anglicismer hvor der findes et dansk ord.

Tilpas til kanalen: Facebook tåler længere tekst og en historie. Instagram er kortere og båret af billedet. LinkedIn er fagligt og henvender sig til beslutningstagere.

Respekter MÅ IKKE-listen absolut. Den er ikke til forhandling.

Spred opslagene fornuftigt over kampagneperioden — ikke alle på samme dag, og på tidspunkter hvor målgruppen faktisk er på.`

function brandBriefing(brand) {
  return [
    `Virksomhed: ${brand.name}`,
    brand.description && `Hvad de laver: ${brand.description}`,
    brand.target_audience && `Målgruppe: ${brand.target_audience}`,
    brand.tone_of_voice && `Tone of voice: ${brand.tone_of_voice}`,
    brand.guardrails && `MÅ IKKE: ${brand.guardrails}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const KLOKKE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Validerer modellens output i stedet for at håbe på det. */
function valider(raa, tilladteKanaler) {
  if (!raa || !Array.isArray(raa.opslag) || raa.opslag.length === 0) {
    throw new Error('Claude returnerede ingen opslag.')
  }

  return raa.opslag.map((o, i) => {
    if (typeof o.tekst !== 'string' || !o.tekst.trim()) {
      throw new Error(`Opslag ${i + 1} har ingen tekst.`)
    }
    if (!KLOKKE.test(o.klokke ?? '')) {
      throw new Error(`Opslag ${i + 1} har ugyldigt klokkeslæt: ${o.klokke}`)
    }

    return {
      tekst: o.tekst.trim(),
      hashtags: Array.isArray(o.hashtags)
        ? o.hashtags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
        : [],
      billedbrief: typeof o.billedbrief === 'string' ? o.billedbrief : '',
      dag: Number.isInteger(o.dag) && o.dag >= 0 ? o.dag : 0,
      klokke: o.klokke,
      // Modellen kan foreslå en platform kunden ikke har. Den frasorteres her.
      kanaler: (Array.isArray(o.kanaler) ? o.kanaler : []).filter((k) =>
        tilladteKanaler.includes(k),
      ),
      hvorfor: typeof o.hvorfor === 'string' ? o.hvorfor : null,
    }
  })
}

export async function genererKampagne({
  brand,
  navn,
  brief,
  maal,
  antal,
  kanaler,
  start,
  slut,
}) {
  const nøgle = process.env.ANTHROPIC_API_KEY
  if (!nøgle) throw new Error('ANTHROPIC_API_KEY mangler i Netlify-miljøet.')

  const besked = `${brandBriefing(brand)}

---

KAMPAGNE: ${navn}
Brief: ${brief}
${maal ? `Mål: ${maal}` : ''}
Periode: ${start}${slut ? ` til ${slut}` : ''}
Kanaler til rådighed: ${kanaler.join(', ')}

Lav ${antal} opslag. Kald værktøjet lever_kampagne med resultatet.`

  const svar = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': nøgle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [VAERKTOEJ],
      tool_choice: { type: 'tool', name: 'lever_kampagne' },
      messages: [{ role: 'user', content: besked }],
    }),
  })

  if (!svar.ok) {
    const tekst = await svar.text()
    throw new Error(`Claude svarede ${svar.status}: ${tekst.slice(0, 300)}`)
  }

  const data = await svar.json()
  const brug = data.content?.find((b) => b.type === 'tool_use')
  if (!brug) throw new Error('Claude kaldte ikke værktøjet.')

  return valider(brug.input, kanaler)
}

/** Regner dag + klokke om til et rigtigt tidspunkt i dansk tid. */
export function tidspunkt(start, dag, klokke) {
  const [t, m] = klokke.split(':').map(Number)
  const d = new Date(`${start}T00:00:00`)
  d.setDate(d.getDate() + dag)
  d.setHours(t, m, 0, 0)
  return d.toISOString()
}
