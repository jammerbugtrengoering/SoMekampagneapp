import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '../crypto'
import type { Channel, Platform, Post } from '../types'
import { facebookPublisher } from './facebook'
import { instagramPublisher } from './instagram'
import { linkedinPublisher } from './linkedin'
import type { Publisher, PublishRequest, PublishResult } from './types'

export type { PublishRequest, PublishResult } from './types'

const PUBLISHERS: Record<Platform, Publisher> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  linkedin: linkedinPublisher,
}

export function isDryRun(): boolean {
  return process.env.PUBLISH_DRY_RUN !== 'false'
}

/** Tekst + hashtags samlet til det der faktisk står i opslaget. */
export function renderMessage(post: Pick<Post, 'body' | 'hashtags'>): string {
  if (!post.hashtags.length) return post.body
  const tags = post.hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ')
  return `${post.body}\n\n${tags}`
}

/**
 * Sender ét opslag til én kanal.
 *
 * Hele resten af appen taler kun med denne funktion. Skal du senere skifte
 * fra egne Meta-kald til en aggregator som Ayrshare, er det her — og kun her —
 * du laver om.
 */
export async function publishToChannel(
  channel: Channel,
  request: PublishRequest,
): Promise<PublishResult> {
  if (isDryRun()) {
    console.log(
      `[DRY RUN] ${channel.platform}/${channel.display_name}:`,
      JSON.stringify({ message: request.message, imageUrl: request.imageUrl }, null, 2),
    )
    return {
      ok: true,
      platform: channel.platform,
      channelId: channel.id,
      externalId: `dryrun_${channel.id}`,
      dryRun: true,
    }
  }

  if (!channel.active) {
    return {
      ok: false,
      platform: channel.platform,
      channelId: channel.id,
      error: 'Kanalen er slået fra.',
    }
  }

  if (!channel.token_ciphertext) {
    return {
      ok: false,
      platform: channel.platform,
      channelId: channel.id,
      error: 'Kanalen har intet token.',
    }
  }

  let token: string
  try {
    token = decryptToken(channel.token_ciphertext)
  } catch (error) {
    return {
      ok: false,
      platform: channel.platform,
      channelId: channel.id,
      error: `Kunne ikke dekryptere token: ${error instanceof Error ? error.message : error}`,
    }
  }

  return PUBLISHERS[channel.platform].publish(channel, token, request)
}

export async function verifyChannel(channel: Channel) {
  if (!channel.token_ciphertext) return { ok: false, error: 'Intet token.' }
  try {
    const token = decryptToken(channel.token_ciphertext)
    return PUBLISHERS[channel.platform].verify(channel, token)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Publicerer ét opslag til alle dets kanaler og skriver resultatet tilbage.
 *
 * Hver kanal håndteres for sig: fejler Instagram, skal Facebook stadig ud.
 * Opslaget markeres kun 'published' hvis alle kanaler lykkedes.
 */
export async function publishPost(
  supabase: SupabaseClient,
  postId: string,
): Promise<PublishResult[]> {
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .single()

  if (postError || !post) {
    throw new Error(`Opslag ${postId} findes ikke: ${postError?.message}`)
  }

  const { data: targets, error: targetError } = await supabase
    .from('post_targets')
    .select('*, channels(*)')
    .eq('post_id', postId)
    .in('status', ['pending', 'failed'])

  if (targetError) throw new Error(targetError.message)
  if (!targets?.length) return []

  await supabase.from('posts').update({ status: 'publishing' }).eq('id', postId)

  const message = renderMessage(post)
  const results: PublishResult[] = []

  for (const target of targets) {
    const channel = (target as any).channels as Channel
    if (!channel) continue

    await supabase
      .from('post_targets')
      .update({ status: 'publishing', attempts: target.attempts + 1 })
      .eq('id', target.id)

    const result = await publishToChannel(channel, {
      message,
      imageUrl: post.image_url ?? undefined,
    })
    results.push(result)

    await supabase
      .from('post_targets')
      .update({
        status: result.ok ? 'published' : 'failed',
        external_id: result.externalId ?? null,
        permalink: result.permalink ?? null,
        error: result.error ?? null,
        published_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', target.id)
  }

  const allOk = results.every((r) => r.ok)
  await supabase
    .from('posts')
    .update({ status: allOk ? 'published' : 'failed' })
    .eq('id', postId)

  return results
}

/**
 * Finder og publicerer alt der er godkendt og forfaldent.
 * Kaldes af den planlagte Netlify-funktion.
 */
export async function publishDuePosts(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ postId: string; results: PublishResult[] }[]> {
  const { data: due, error } = await supabase
    .from('posts')
    .select('id')
    .eq('status', 'approved')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(25)

  if (error) throw new Error(error.message)
  if (!due?.length) return []

  const output = []
  for (const row of due) {
    try {
      output.push({ postId: row.id, results: await publishPost(supabase, row.id) })
    } catch (err) {
      console.error(`Publicering af ${row.id} fejlede:`, err)
      output.push({
        postId: row.id,
        results: [
          {
            ok: false,
            platform: 'facebook' as Platform,
            channelId: '',
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      })
    }
  }
  return output
}
