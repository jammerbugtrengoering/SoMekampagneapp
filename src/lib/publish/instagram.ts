import type { Channel } from '../types'
import { GraphError, graphGet, graphPost, sleep } from './graph'
import type { Publisher, PublishRequest, PublishResult } from './types'

/**
 * Instagram publicerer i to trin:
 *   1. Opret en "media container" med billed-URL og caption
 *   2. Publicér containeren
 *
 * Mellem de to trin skal Meta selv hente og behandle billedet. For fotos går
 * det som regel med det samme, men containeren kan stå i IN_PROGRESS et par
 * sekunder — derfor polles der. Publicerer man for tidligt, får man en fejl
 * der ligner en rettighedsfejl, men bare er utålmodighed.
 *
 * Kræver: instagram_basic + instagram_content_publish + pages_read_engagement.
 * Kontoen skal være Business eller Creator og koblet til en Facebook-side.
 * Instagram kan IKKE publiceres uden billede.
 */

const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 15

async function waitForContainer(
  containerId: string,
  token: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const result = await graphGet(containerId, {
      fields: 'status_code,status',
      access_token: token,
    })

    switch (result.status_code) {
      case 'FINISHED':
        return
      case 'ERROR':
        throw new GraphError(
          `Instagram kunne ikke behandle billedet: ${result.status ?? 'ukendt årsag'}. ` +
            'Tjek at URL\'en er offentligt tilgængelig og at billedet er JPEG.',
        )
      case 'EXPIRED':
        throw new GraphError('Media container udløb før publicering.')
      default:
        await sleep(POLL_INTERVAL_MS)
    }
  }
  throw new GraphError(
    `Instagram blev ikke færdig med billedet inden for ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} sekunder.`,
  )
}

export const instagramPublisher: Publisher = {
  platform: 'instagram',

  async publish(
    channel: Channel,
    token: string,
    request: PublishRequest,
  ): Promise<PublishResult> {
    const base = { ok: false as const, platform: 'instagram' as const, channelId: channel.id }

    if (!channel.ig_user_id) {
      return { ...base, error: 'Kanalen mangler ig_user_id.' }
    }
    if (!request.imageUrl) {
      return { ...base, error: 'Instagram kræver et billede — opslaget har ingen image_url.' }
    }

    try {
      const container = await graphPost(`${channel.ig_user_id}/media`, {
        image_url: request.imageUrl,
        caption: request.message,
        ...(request.altText ? { alt_text: request.altText } : {}),
        access_token: token,
      })

      await waitForContainer(container.id, token)

      const published = await graphPost(`${channel.ig_user_id}/media_publish`, {
        creation_id: container.id,
        access_token: token,
      })

      let permalink: string | undefined
      try {
        const meta = await graphGet(published.id, {
          fields: 'permalink',
          access_token: token,
        })
        permalink = meta.permalink
      } catch {
        // Ikke kritisk.
      }

      return {
        ok: true,
        platform: 'instagram',
        channelId: channel.id,
        externalId: published.id,
        permalink,
      }
    } catch (error) {
      return {
        ...base,
        error:
          error instanceof GraphError
            ? `${error.message}${error.code ? ` (kode ${error.code})` : ''}`
            : String(error),
      }
    }
  },

  async verify(channel: Channel, token: string) {
    if (!channel.ig_user_id) return { ok: false, error: 'Mangler ig_user_id.' }
    try {
      await graphGet(channel.ig_user_id, {
        fields: 'id,username',
        access_token: token,
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) }
    }
  },
}
