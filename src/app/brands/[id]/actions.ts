'use server'

import { revalidatePath } from 'next/cache'
import { encryptToken } from '@/lib/crypto'
import { verifyChannel } from '@/lib/publish'
import { serverClient } from '@/lib/supabase/server'
import type { Channel, Platform } from '@/lib/types'

export async function saveBrand(brandId: string, formData: FormData) {
  const supabase = await serverClient()

  const { error } = await supabase
    .from('brands')
    .update({
      name: String(formData.get('name') ?? ''),
      tone_of_voice: String(formData.get('tone_of_voice') ?? ''),
      target_audience: String(formData.get('target_audience') ?? ''),
      description: String(formData.get('description') ?? ''),
      guardrails: String(formData.get('guardrails') ?? ''),
      logo_url: String(formData.get('logo_url') ?? '') || null,
      colors: {
        primary: String(formData.get('color_primary') ?? '#6b7280'),
        secondary: String(formData.get('color_secondary') ?? '#ffffff'),
        accent: String(formData.get('color_accent') ?? '#6b7280'),
      },
    })
    .eq('id', brandId)

  if (error) return { ok: false, message: error.message }

  revalidatePath(`/brands/${brandId}`)
  return { ok: true, message: 'Gemt.' }
}

export async function saveChannel(brandId: string, formData: FormData) {
  const supabase = await serverClient()

  const platform = String(formData.get('platform')) as Platform
  const token = String(formData.get('token') ?? '').trim()
  const channelId = String(formData.get('channel_id') ?? '')

  const payload: Record<string, unknown> = {
    brand_id: brandId,
    platform,
    display_name: String(formData.get('display_name') ?? ''),
    page_id: String(formData.get('page_id') ?? '') || null,
    ig_user_id: String(formData.get('ig_user_id') ?? '') || null,
    active: formData.get('active') === 'on',
  }

  // Tomt token-felt betyder "lad det nuværende token være" — ikke "slet det".
  // Ellers ville et gem af navnet koste adgangen til siden.
  if (token) {
    try {
      payload.token_ciphertext = encryptToken(token)
      payload.token_label = String(formData.get('token_label') ?? '') || 'manuelt'
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const query = channelId
    ? supabase.from('channels').update(payload).eq('id', channelId)
    : supabase.from('channels').insert(payload)

  const { error } = await query
  if (error) return { ok: false, message: error.message }

  revalidatePath(`/brands/${brandId}`)
  return { ok: true, message: 'Kanal gemt.' }
}

/** Slår op mod Meta og bekræfter at tokenet stadig kan se siden. */
export async function testChannel(channelId: string) {
  const supabase = await serverClient()

  const { data: channel, error } = await supabase
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .single()

  if (error || !channel) return { ok: false, message: 'Kanalen findes ikke.' }

  const result = await verifyChannel(channel as Channel)

  await supabase
    .from('channels')
    .update({
      last_verified_at: result.ok ? new Date().toISOString() : null,
      last_error: result.ok ? null : (result.error ?? 'Ukendt fejl'),
    })
    .eq('id', channelId)

  revalidatePath(`/brands/${(channel as Channel).brand_id}`)
  return {
    ok: result.ok,
    message: result.ok ? 'Forbindelsen virker.' : (result.error ?? 'Fejl'),
  }
}
