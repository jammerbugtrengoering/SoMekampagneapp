import Link from 'next/link'
import { StatusBadge } from './StatusBadge'
import type { PostStatus } from '@/lib/types'

export interface CalendarPost {
  id: string
  body: string
  scheduled_at: string | null
  status: PostStatus
  brand_name: string
  brand_color: string
  campaign_id: string | null
}

const WEEKDAYS = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']

/** Mandag i ugen som `date` ligger i. */
function startOfWeek(date: Date): Date {
  const copy = new Date(date)
  const day = (copy.getDay() + 6) % 7 // 0 = mandag
  copy.setDate(copy.getDate() - day)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function localKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function CalendarGrid({
  month,
  posts,
}: {
  /** "YYYY-MM" */
  month: string
  posts: CalendarPost[]
}) {
  const [year, monthNumber] = month.split('-').map(Number)
  const firstOfMonth = new Date(year, monthNumber - 1, 1)
  const gridStart = startOfWeek(firstOfMonth)

  // Gruppér på lokal dato, ikke UTC — ellers lander et opslag kl. 01:00
  // dansk tid på dagen før.
  const byDay = new Map<string, CalendarPost[]>()
  for (const post of posts) {
    if (!post.scheduled_at) continue
    const key = localKey(new Date(post.scheduled_at))
    const list = byDay.get(key)
    if (list) list.push(post)
    else byDay.set(key, [post])
  }

  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    cells.push(date)
  }
  // Klip den sidste uge væk hvis den er helt uden for måneden.
  const trimmed =
    cells[35].getMonth() === monthNumber - 1 ? cells : cells.slice(0, 35)

  const todayKey = localKey(new Date())

  return (
    <div className="card overflow-hidden">
      <div
        className="grid grid-cols-7 border-b text-xs font-medium muted"
        style={{ borderColor: 'var(--line)' }}
      >
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {trimmed.map((date, index) => {
          const key = localKey(date)
          const inMonth = date.getMonth() === monthNumber - 1
          const dayPosts = byDay.get(key) ?? []

          return (
            <div
              key={key}
              className="min-h-[110px] border-b border-r p-1.5"
              style={{
                borderColor: 'var(--line)',
                opacity: inMonth ? 1 : 0.4,
                borderRight: (index + 1) % 7 === 0 ? 'none' : undefined,
              }}
            >
              <div
                className={`mb-1 text-xs ${key === todayKey ? 'font-bold' : 'muted'}`}
              >
                {date.getDate()}
              </div>

              <div className="space-y-1">
                {dayPosts.map((post) => (
                  <Link
                    key={post.id}
                    href={post.campaign_id ? `/campaigns/${post.campaign_id}` : '/'}
                    className="block rounded px-1.5 py-1 text-[11px] leading-tight hover:opacity-80"
                    style={{
                      background: `${post.brand_color}14`,
                      borderLeft: `3px solid ${post.brand_color}`,
                    }}
                  >
                    <div className="font-medium">
                      {new Date(post.scheduled_at!).toLocaleTimeString('da-DK', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      {post.brand_name}
                    </div>
                    <div className="line-clamp-2 muted">{post.body}</div>
                    <div className="mt-0.5">
                      <StatusBadge status={post.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
