import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BrandForm } from './BrandForm'
import { ChannelList } from './ChannelList'
import { serverClient } from '@/lib/supabase/server'
import type { Brand, Channel } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function BrandPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await serverClient()

  const [{ data: brand }, { data: channels }] = await Promise.all([
    supabase.from('brands').select('*').eq('id', id).single(),
    supabase.from('channels').select('*').eq('brand_id', id).order('platform'),
  ])

  if (!brand) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/brands" className="text-sm muted hover:opacity-70">
          ← Kunder
        </Link>
        <h1 className="text-xl font-semibold">{(brand as Brand).name}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BrandForm brand={brand as Brand} />
        <ChannelList brandId={id} channels={(channels ?? []) as Channel[]} />
      </div>
    </div>
  )
}
