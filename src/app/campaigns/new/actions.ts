'use server'

import { redirect } from 'next/navigation'
import { generateCampaign, resolveScheduledAt } from '@/lib/claude'
import { serverClient } from '@/lib/supabase/server'
import type { Brand, Channel, Platform } from '@/lib/types'

export interface CreateResult {
  ok: boolean
  message?: string
}

export async function createCampaign(
  _prev: CreateResult | null,
  formData: FormData,
): Promise<CreateResult> {
  const supabase = await serverClient()

  const brandId = String(formData.get('brand_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const brief = String(formData.get('brief') ?? '').trim()
  const goal = String(formData.get('goal') ?? '').trim()
  const startsOn = String(formData.get('starts_on') ?? '')
  const endsOn = String(formData.get('ends_on') ?? '')
  const postCount = Number(formData.get('post_count') ?? 5)
  const platforms = formData.getAll('platforms').map(String) as Platform[]

  if (!brandId || !name || !brief || !startsOn) {
    return { ok: false, message: 'Udfyld kunde, navn, brief og startdato.' }
  }
  if (!platforms.length) {
    return { ok: false, message: 'Vælg mindst én kanal.' }
  }

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (brandError || !brand) {
    return { ok: false, message: 'Kunden findes ikke.' }
  }

  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .eq('brand_id', brandId)
    .eq('active', true)

  const activeChannels = (channels ?? []) as Channel[]

  let generated
  try {
    generated = await generateCampaign({
      brand: brand as Brand,
      campaignName: name,
      brief,
      goal: goal || undefined,
      postCount: Math.min(Math.max(postCount, 1), 20),
      platforms,
      startsOn,
      endsOn: endsOn || undefined,
    })
  } catch (error) {
    return {
      ok: false,
      message: `Generering fejlede: ${error instanceof Error ? error.message : error}`,
    }
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      brand_id: brandId,
      name,
      brief,
      goal: goal || null,
      starts_on: startsOn,
      ends_on: endsOn || null,
      status: 'draft',
    })
    .select()
    .single()

  if (campaignError || !campaign) {
    return { ok: false, message: campaignError?.message ?? 'Kunne ikke oprette kampagne.' }
  }

  for (const post of generated) {
    const { data: inserted, error: postError } = await supabase
      .from('posts')
      .insert({
        campaign_id: campaign.id,
        brand_id: brandId,
        body: post.body,
        hashtags: post.hashtags,
        image_brief: post.image_brief,
        scheduled_at: resolveScheduledAt(startsOn, post.day_offset, post.time_of_day),
        status: 'needs_approval',
      })
      .select()
      .single()

    if (postError || !inserted) continue

    // Ét target pr. kanal opslaget skal ud på. Kanaler brandet ikke har,
    // springes over — modellen kan foreslå en platform der ikke er sat op.
    const targets = activeChannels
      .filter((channel) => post.platforms.includes(channel.platform))
      .map((channel) => ({ post_id: inserted.id, channel_id: channel.id }))

    if (targets.length) {
      await supabase.from('post_targets').insert(targets)
    }
  }

  redirect(`/campaigns/${campaign.id}`)
}
