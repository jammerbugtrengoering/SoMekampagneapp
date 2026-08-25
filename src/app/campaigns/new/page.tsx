import Link from 'next/link'
import { CampaignForm } from './CampaignForm'
import { serverClient } from '@/lib/supabase/server'
import type { Brand } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewCampaignPage() {
  const supabase = await serverClient()
  const { data: brands } = await supabase.from('brands').select('*').order('name')

  if (!brands?.length) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Ny kampagne</h1>
        <p className="text-sm muted">
          Du skal have mindst én kunde først.{' '}
          <Link href="/brands" className="underline">
            Gå til kunder
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">Ny kampagne</h1>
      <CampaignForm brands={brands as Brand[]} />
    </div>
  )
}
