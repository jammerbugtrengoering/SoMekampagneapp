import type { PostStatus } from '@/lib/types'

const LABELS: Record<PostStatus, string> = {
  draft: 'Kladde',
  needs_approval: 'Afventer godkendelse',
  approved: 'Godkendt',
  publishing: 'Publicerer',
  published: 'Publiceret',
  failed: 'Fejlet',
}

const STYLES: Record<PostStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  needs_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  publishing: 'bg-indigo-100 text-indigo-800',
  published: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
}

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  )
}

export const statusLabel = (status: PostStatus) => LABELS[status]
