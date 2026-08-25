import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Brand, Platform } from './types'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

/**
 * Formen på det Claude skal levere. Vi validerer output i stedet for at
 * håbe — modellen får skemaet som tool, så den er tvunget til at ramme det.
 */
const generatedPostSchema = z.object({
  body: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  image_brief: z.string().min(1),
  /** Dag 0 = kampagnens startdato */
  day_offset: z.number().int().min(0),
  /** Lokalt klokkeslæt, "HH:MM" */
  time_of_day: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  platforms: z.array(z.enum(['facebook', 'instagram', 'linkedin'])).min(1),
  rationale: z.string().optional(),
})

const generatedCampaignSchema = z.object({
  posts: z.array(generatedPostSchema).min(1),
})

export type GeneratedPost = z.infer<typeof generatedPostSchema>

const POST_TOOL = {
  name: 'levér_kampagne',
  description: 'Aflever den færdige serie af opslag.',
  input_schema: {
    type: 'object' as const,
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            body: {
              type: 'string',
              description:
                'Selve opslagsteksten på dansk. Uden hashtags — de hører i hashtags-feltet.',
            },
            hashtags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Uden #-tegn. Maks 5. Tom liste er et gyldigt svar.',
            },
            image_brief: {
              type: 'string',
              description:
                'Hvad billedet skal vise. Konkret nok til at en fotograf eller en billedmodel kan arbejde ud fra det.',
            },
            day_offset: {
              type: 'integer',
              description: 'Dage efter kampagnens start. 0 = startdagen.',
            },
            time_of_day: {
              type: 'string',
              description: 'Klokkeslæt i formatet HH:MM, dansk tid.',
            },
            platforms: {
              type: 'array',
              items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin'] },
            },
            rationale: {
              type: 'string',
              description: 'Én sætning om hvorfor dette opslag på dette tidspunkt.',
            },
          },
          required: [
            'body',
            'hashtags',
            'image_brief',
            'day_offset',
            'time_of_day',
            'platforms',
          ],
        },
      },
    },
    required: ['posts'],
  },
}

function brandBriefing(brand: Brand): string {
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

export interface GenerateArgs {
  brand: Brand
  campaignName: string
  brief: string
  goal?: string
  postCount: number
  platforms: Platform[]
  startsOn: string
  endsOn?: string
}

export async function generateCampaign(args: GenerateArgs): Promise<GeneratedPost[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY mangler.')

  const client = new Anthropic({ apiKey })

  const system = `Du er content-planlægger for en dansk marketingafdeling.

Du skriver opslag der lyder som om et menneske fra virksomheden har skrevet dem. Det betyder:
- Ingen "🚀 Spændende nyheder!" eller anden LinkedIn-plastik.
- Ingen tomme superlativer. Sig noget konkret eller lad være.
- Variér længde og form hen over serien. Ikke alle opslag skal have samme rytme.
- Skriv på dansk. Undgå anglicismer hvor der findes et dansk ord.

Tilpas til kanalen: Facebook tåler længere tekst og en historie. Instagram er kortere og båret af billedet. LinkedIn er fagligt og henvender sig til beslutningstagere.

Respekter MÅ IKKE-listen absolut. Den er ikke til forhandling.

Spred opslagene fornuftigt over kampagneperioden — ikke alle på samme dag, og på tidspunkter hvor målgruppen faktisk er på.`

  const user = `${brandBriefing(args.brand)}

---

KAMPAGNE: ${args.campaignName}
Brief: ${args.brief}
${args.goal ? `Mål: ${args.goal}` : ''}
Periode: ${args.startsOn}${args.endsOn ? ` til ${args.endsOn}` : ''}
Kanaler til rådighed: ${args.platforms.join(', ')}

Lav ${args.postCount} opslag. Kald værktøjet levér_kampagne med resultatet.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    tools: [POST_TOOL],
    tool_choice: { type: 'tool', name: 'levér_kampagne' },
    messages: [{ role: 'user', content: user }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude returnerede ikke et kampagne-resultat.')
  }

  const parsed = generatedCampaignSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new Error(`Ugyldigt kampagne-output: ${parsed.error.message}`)
  }

  // Filtrér platforme fra som brandet ikke har en kanal på — modellen kan
  // finde på at foreslå LinkedIn selvom kunden ikke er der.
  return parsed.data.posts.map((post) => ({
    ...post,
    platforms: post.platforms.filter((p) => args.platforms.includes(p)),
  }))
}

/** Regner day_offset + time_of_day om til et rigtigt tidspunkt. */
export function resolveScheduledAt(
  startsOn: string,
  dayOffset: number,
  timeOfDay: string,
): string {
  const [hours, minutes] = timeOfDay.split(':').map(Number)
  const date = new Date(`${startsOn}T00:00:00`)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}
