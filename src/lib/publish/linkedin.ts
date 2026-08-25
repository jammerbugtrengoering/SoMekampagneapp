import type { Channel } from '../types'
import type { Publisher, PublishRequest, PublishResult } from './types'

/**
 * Pladsholder. LinkedIn er ikke med i fase 1.
 *
 * Når den skal med: LinkedIn bruger sin egen /rest/posts API med et
 * organization-token, og billeder skal uploades til LinkedIn først (i
 * modsætning til Meta, der selv henter fra en URL). Det er derfor et
 * reelt stykke arbejde, ikke bare en ekstra platform-streng.
 */
export const linkedinPublisher: Publisher = {
  platform: 'linkedin',

  async publish(channel: Channel, _token: string, _request: PublishRequest): Promise<PublishResult> {
    return {
      ok: false,
      platform: 'linkedin',
      channelId: channel.id,
      error: 'LinkedIn-publicering er ikke implementeret endnu.',
    }
  },

  async verify() {
    return { ok: false, error: 'LinkedIn er ikke implementeret endnu.' }
  },
}
