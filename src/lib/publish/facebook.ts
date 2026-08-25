import type { Channel } from '../types'
import { GraphError, graphGet, graphPost } from './graph'
import type { Publisher, PublishRequest, PublishResult } from './types'

/**
 * Facebook Page.
 *
 * Med billede: POST /{page-id}/photos — Meta henter selv billedet fra url'en.
 * Uden billede: POST /{page-id}/feed.
 *
 * Kræver pages_manage_posts + pages_read_engagement på tokenet.
 */
export const facebookPublisher: Publisher = {
  platform: 'facebook',

  async publish(
    channel: Channel,
    token: string,
    request: PublishRequest,
  ): Promise<PublishResult> {
    const base = { ok: false as const, platform: 'facebook' as const, channelId: channel.id }

    if (!channel.page_id) {
      return { ...base, error: 'Kanalen mangler page_id.' }
    }

    try {
      let postId: string

      if (request.imageUrl) {
        const result = await graphPost(`${channel.page_id}/photos`, {
          url: request.imageUrl,
          caption: request.message,
          access_token: token,
        })
        // /photos returnerer både photo id og post_id. Vi vil have post_id'et,
        // for det er opslaget i feedet — ikke billedobjektet.
        postId = result.post_id ?? result.id
      } else {
        const result = await graphPost(`${channel.page_id}/feed`, {
          message: request.message,
          access_token: token,
        })
        postId = result.id
      }

      let permalink: string | undefined
      try {
        const meta = await graphGet(postId, {
          fields: 'permalink_url',
          access_token: token,
        })
        permalink = meta.permalink_url
      } catch {
        // Opslaget er ude — vi kunne bare ikke hente linket. Ikke en fejl.
      }

      return {
        ok: true,
        platform: 'facebook',
        channelId: channel.id,
        externalId: postId,
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
    if (!channel.page_id) return { ok: false, error: 'Mangler page_id.' }
    try {
      await graphGet(channel.page_id, { fields: 'id,name', access_token: token })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) }
    }
  },
}
