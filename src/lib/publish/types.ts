import type { Channel, Platform } from '../types'

export interface PublishRequest {
  /** Færdig tekst inkl. hashtags — publishers formaterer ikke selv. */
  message: string
  /**
   * Offentlig URL. Meta henter selv billedet fra denne adresse, så den må
   * ikke kræve login. Supabase-bucket'en skal være public.
   */
  imageUrl?: string
  altText?: string
}

export interface PublishResult {
  ok: boolean
  platform: Platform
  channelId: string
  externalId?: string
  permalink?: string
  error?: string
  /** true når PUBLISH_DRY_RUN er slået til — intet blev sendt til Meta. */
  dryRun?: boolean
}

export interface Publisher {
  platform: Platform
  publish(
    channel: Channel,
    token: string,
    request: PublishRequest,
  ): Promise<PublishResult>
  /** Tjekker at token stadig virker og at kanalen kan tilgås. */
  verify(channel: Channel, token: string): Promise<{ ok: boolean; error?: string }>
}
