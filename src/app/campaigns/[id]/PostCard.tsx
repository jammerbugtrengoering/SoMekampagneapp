'use client'

import { useState, useTransition } from 'react'
import { deletePost, publishNow, setPostStatus, updatePost } from './actions'
import { StatusBadge } from '@/components/StatusBadge'
import type { Post } from '@/lib/types'

export interface PostWithTargets extends Post {
  targets: {
    id: string
    status: string
    error: string | null
    permalink: string | null
    platform: string
    channel_name: string
  }[]
}

/** ISO → "YYYY-MM-DDTHH:MM" i lokal tid, som datetime-local vil have det. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function PostCard({ post }: { post: PostWithTargets }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(true)
  const [open, setOpen] = useState(false)

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await fn()
      setOk(result.ok)
      setMessage(result.message)
    })

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={post.status} />
        {post.scheduled_at && (
          <span className="text-xs muted">
            {new Date(post.scheduled_at).toLocaleString('da-DK', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        {post.targets.map((target) => (
          <span
            key={target.id}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700"
            title={target.error ?? undefined}
          >
            {target.platform}
            {target.status === 'failed' ? ' ⚠' : ''}
            {target.status === 'published' ? ' ✓' : ''}
          </span>
        ))}
        <button
          className="ml-auto text-xs muted underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Luk' : 'Redigér'}
        </button>
      </div>

      {!open ? (
        <>
          <p className="whitespace-pre-wrap text-sm">{post.body}</p>
          {post.hashtags.length > 0 && (
            <p className="mt-1.5 text-sm text-blue-700">
              {post.hashtags.map((tag) => `#${tag}`).join(' ')}
            </p>
          )}
          {post.image_brief && (
            <p className="mt-2 text-xs muted">
              <strong>Billede:</strong> {post.image_brief}
            </p>
          )}
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image_url}
              alt=""
              className="mt-2 max-h-48 rounded-lg object-cover"
            />
          ) : (
            <p className="mt-2 text-xs text-amber-700">Intet billede tilknyttet.</p>
          )}
        </>
      ) : (
        <form
          className="space-y-3"
          action={(formData) => run(() => updatePost(post.id, formData))}
        >
          <textarea
            name="body"
            rows={6}
            className="input"
            defaultValue={post.body}
          />
          <input
            name="hashtags"
            className="input"
            defaultValue={post.hashtags.join(' ')}
            placeholder="hashtags adskilt af mellemrum"
          />
          <input
            name="image_url"
            className="input"
            defaultValue={post.image_url ?? ''}
            placeholder="Offentlig billed-URL (Meta henter selv billedet)"
          />
          <input
            name="scheduled_at"
            type="datetime-local"
            className="input"
            defaultValue={toLocalInput(post.scheduled_at)}
          />
          <button type="submit" className="btn-primary" disabled={pending}>
            Gem ændringer
          </button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        {post.status !== 'approved' && post.status !== 'published' && (
          <button
            className="btn-ghost"
            disabled={pending}
            onClick={() => run(() => setPostStatus(post.id, 'approved'))}
          >
            Godkend
          </button>
        )}
        {post.status === 'approved' && (
          <button
            className="btn-ghost"
            disabled={pending}
            onClick={() => run(() => setPostStatus(post.id, 'needs_approval'))}
          >
            Træk godkendelse
          </button>
        )}
        {post.status !== 'published' && (
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() => run(() => publishNow(post.id))}
          >
            Publicér nu
          </button>
        )}
        {post.targets.some((t) => t.permalink) && (
          <a
            className="btn-ghost"
            href={post.targets.find((t) => t.permalink)!.permalink!}
            target="_blank"
            rel="noreferrer"
          >
            Se opslaget
          </a>
        )}
        <button
          className="ml-auto text-xs text-red-700 underline"
          disabled={pending}
          onClick={() => run(() => deletePost(post.id))}
        >
          Slet
        </button>
      </div>

      {message && (
        <p className={`mt-2 text-sm ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
