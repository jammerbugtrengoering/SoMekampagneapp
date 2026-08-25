import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PostCard, type PostWithTargets } from './PostCard'
import { serverClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await serverClient()

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*, brands(name, colors)')
    .eq('id', id)
    .single()

  if (!campaign) notFound()

  const { data: rows } = await supabase
    .from('posts')
    .select('*, post_targets(id, status, error, permalink, channels(platform, display_name))')
    .eq('campaign_id', id)
    .order('scheduled_at', { ascending: true })

  const posts: PostWithTargets[] = (rows ?? []).map((row: any) => ({
    ...row,
    targets: (row.post_targets ?? []).map((target: any) => ({
      id: target.id,
      status: target.status,
      error: target.error,
      permalink: target.permalink,
      platform: target.channels?.platform ?? '?',
      channel_name: target.channels?.display_name ?? '',
    })),
  }))

  const awaiting = posts.filter((p) => p.status === 'needs_approval').length

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm muted hover:opacity-70">
          ← Kalender
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{(campaign as any).name}</h1>
        <p className="text-sm muted">
          {(campaign as any).brands?.name}
          {(campaign as any).starts_on && ` · fra ${(campaign as any).starts_on}`}
          {` · ${posts.length} opslag`}
          {awaiting > 0 && ` · ${awaiting} afventer godkendelse`}
        </p>
      </div>

      {(campaign as any).brief && (
        <div className="card p-4 text-sm">
          <div className="mb-1 font-medium">Brief</div>
          <p className="muted whitespace-pre-wrap">{(campaign as any).brief}</p>
        </div>
      )}

      <div className="space-y-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      {!posts.length && (
        <p className="text-sm muted">Kampagnen har ingen opslag.</p>
      )}
    </div>
  )
}
