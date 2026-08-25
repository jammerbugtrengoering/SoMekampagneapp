'use server'

import { revalidatePath } from 'next/cache'
import { publishPost } from '@/lib/publish'
import { serverClient } from '@/lib/supabase/server'

export async function updatePost(postId: string, formData: FormData) {
  const supabase = await serverClient()

  const hashtags = String(formData.get('hashtags') ?? '')
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)

  const scheduledAt = String(formData.get('scheduled_at') ?? '')

  const { error } = await supabase
    .from('posts')
    .update({
      body: String(formData.get('body') ?? ''),
      hashtags,
      image_url: String(formData.get('image_url') ?? '') || null,
      // datetime-local giver lokal tid uden zone — Date tolker det som lokal,
      // hvilket er præcis det vi vil have.
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    })
    .eq('id', postId)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/campaigns')
  revalidatePath('/')
  return { ok: true, message: 'Gemt.' }
}

export async function setPostStatus(
  postId: string,
  status: 'draft' | 'needs_approval' | 'approved',
) {
  const supabase = await serverClient()

  // Instagram kan ikke publicere uden billede. Bedre at fange det her end
  // klokken 08:00 når cron'en kører.
  if (status === 'approved') {
    const { data: post } = await supabase
      .from('posts')
      .select('image_url, post_targets(channels(platform))')
      .eq('id', postId)
      .single()

    const needsImage = (post as any)?.post_targets?.some(
      (target: any) => target.channels?.platform === 'instagram',
    )

    if (needsImage && !(post as any)?.image_url) {
      return {
        ok: false,
        message: 'Opslaget skal ud på Instagram og mangler et billede.',
      }
    }
  }

  const { error } = await supabase.from('posts').update({ status }).eq('id', postId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/campaigns')
  revalidatePath('/')
  return { ok: true, message: status === 'approved' ? 'Godkendt.' : 'Opdateret.' }
}

/** Publicerer med det samme i stedet for at vente på det planlagte tidspunkt. */
export async function publishNow(postId: string) {
  const supabase = await serverClient()

  try {
    const results = await publishPost(supabase, postId)
    revalidatePath('/campaigns')
    revalidatePath('/')

    if (!results.length) {
      return { ok: false, message: 'Opslaget har ingen kanaler at publicere til.' }
    }

    const failed = results.filter((result) => !result.ok)
    if (failed.length) {
      return { ok: false, message: failed.map((f) => f.error).join(' · ') }
    }

    return {
      ok: true,
      message: results[0].dryRun
        ? 'Dry-run: opslaget blev logget, ikke publiceret.'
        : 'Publiceret.',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function deletePost(postId: string) {
  const supabase = await serverClient()
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/campaigns')
  revalidatePath('/')
  return { ok: true, message: 'Slettet.' }
}
