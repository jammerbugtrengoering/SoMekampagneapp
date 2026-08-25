export type Platform = 'facebook' | 'instagram' | 'linkedin'

export type BrandKind = 'business' | 'association'

export interface Brand {
  id: string
  slug: string
  name: string
  kind: BrandKind
  logo_url: string | null
  colors: { primary?: string; secondary?: string; accent?: string }
  tone_of_voice: string | null
  target_audience: string | null
  description: string | null
  guardrails: string | null
  created_at: string
  updated_at: string
}

export interface Channel {
  id: string
  brand_id: string
  platform: Platform
  display_name: string
  page_id: string | null
  ig_user_id: string | null
  token_ciphertext: string | null
  token_label: string | null
  active: boolean
  last_verified_at: string | null
  last_error: string | null
  created_at: string
}

export interface Asset {
  id: string
  brand_id: string
  url: string
  storage_path: string | null
  source: 'upload' | 'ai' | 'template'
  alt_text: string | null
  tags: string[]
  created_at: string
}

export type CampaignStatus = 'draft' | 'active' | 'done' | 'archived'

export interface Campaign {
  id: string
  brand_id: string
  name: string
  brief: string | null
  goal: string | null
  starts_on: string | null
  ends_on: string | null
  status: CampaignStatus
  created_at: string
  updated_at: string
}

export type PostStatus =
  | 'draft'
  | 'needs_approval'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'failed'

export interface Post {
  id: string
  campaign_id: string | null
  brand_id: string
  body: string
  hashtags: string[]
  image_brief: string | null
  asset_id: string | null
  image_url: string | null
  scheduled_at: string | null
  status: PostStatus
  created_at: string
  updated_at: string
}

export type TargetStatus =
  | 'pending'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'skipped'

export interface PostTarget {
  id: string
  post_id: string
  channel_id: string
  status: TargetStatus
  external_id: string | null
  permalink: string | null
  error: string | null
  attempts: number
  published_at: string | null
  created_at: string
}
