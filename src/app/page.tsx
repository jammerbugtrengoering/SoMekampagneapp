import Link from 'next/link'
import { CalendarGrid, type CalendarPost } from '@/components/CalendarGrid'
import { serverClient } from '@/lib/supabase/server'
import { isDryRun } from '@/lib/publish'

export const dynamic = 'force-dynamic'

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const from = new Date(year, monthNumber - 1, 1)
  // Tag en uge til hver side med, så opslag i randen af kalendergitteret
  // også kommer med.
  from.setDate(from.getDate() - 7)
  const to = new Date(year, monthNumber, 1)
  to.setDate(to.getDate() + 7)
  return { from: from.toISOString(), to: to.toISOString() }
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const now = new Date()
  const month =
    params.month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const supabase = await serverClient()
  const { from, to } = monthBounds(month)

  const { data, error } = await supabase
    .from('posts')
    .select('id, body, scheduled_at, status, campaign_id, brands(name, colors)')
    .gte('scheduled_at', from)
    .lt('scheduled_at', to)
    .order('scheduled_at', { ascending: true })

  const posts: CalendarPost[] = (data ?? []).map((row: any) => ({
    id: row.id,
    body: row.body,
    scheduled_at: row.scheduled_at,
    status: row.status,
    campaign_id: row.campaign_id,
    brand_name: row.brands?.name ?? 'Ukendt',
    brand_color: row.brands?.colors?.primary ?? '#6b7280',
  }))

  const heading = new Date(`${month}-01T00:00:00`).toLocaleDateString('da-DK', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-5">
      {isDryRun() && (
        <div className="card border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Dry-run er slået til.</strong> Opslag bliver logget i stedet for
          publiceret. Sæt <code>PUBLISH_DRY_RUN=false</code> når du er klar.
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold capitalize">{heading}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/?month=${shiftMonth(month, -1)}`} className="btn-ghost">
            ←
          </Link>
          <Link href={`/?month=${shiftMonth(month, 1)}`} className="btn-ghost">
            →
          </Link>
          <Link href="/campaigns/new" className="btn-primary ml-2">
            Ny kampagne
          </Link>
        </div>
      </div>

      {error && (
        <div className="card border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Kunne ikke hente opslag: {error.message}
        </div>
      )}

      <CalendarGrid month={month} posts={posts} />

      {!error && posts.length === 0 && (
        <p className="muted text-sm">
          Ingen planlagte opslag i {heading}.{' '}
          <Link href="/campaigns/new" className="underline">
            Lav en kampagne
          </Link>
          .
        </p>
      )}
    </div>
  )
}
