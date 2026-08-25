import Link from 'next/link'
import { serverClient } from '@/lib/supabase/server'
import type { Brand } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function BrandsPage() {
  const supabase = await serverClient()
  const { data: brands, error } = await supabase
    .from('brands')
    .select('*')
    .order('name')

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Kunder</h1>

      {error && (
        <div className="card border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error.message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(brands as Brand[] | null)?.map((brand) => (
          <Link
            key={brand.id}
            href={`/brands/${brand.id}`}
            className="card block p-4 hover:opacity-90"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-8 w-8 shrink-0 rounded-lg"
                style={{ background: brand.colors?.primary ?? '#6b7280' }}
              />
              <div className="min-w-0">
                <div className="font-medium">{brand.name}</div>
                <div className="truncate text-sm muted">
                  {brand.kind === 'association' ? 'Forening' : 'Virksomhed'}
                  {brand.target_audience ? ` · ${brand.target_audience}` : ''}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {!error && !brands?.length && (
        <p className="muted text-sm">
          Ingen kunder endnu. Kør <code>supabase/seed.sql</code> for at oprette de
          to første.
        </p>
      )}
    </div>
  )
}
