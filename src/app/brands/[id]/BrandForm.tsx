'use client'

import { useState, useTransition } from 'react'
import { saveBrand } from './actions'
import type { Brand } from '@/lib/types'

export function BrandForm({ brand }: { brand: Brand }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(true)

  return (
    <form
      className="card space-y-4 p-5"
      action={(formData) =>
        startTransition(async () => {
          const result = await saveBrand(brand.id, formData)
          setOk(result.ok)
          setMessage(result.message)
        })
      }
    >
      <h2 className="font-semibold">Brandprofil</h2>
      <p className="text-sm muted">
        Alt herunder sendes med til Claude hver gang der genereres opslag. Jo mere
        præcist det er, jo mindre skal du rette bagefter.
      </p>

      <div>
        <label className="label" htmlFor="name">
          Navn
        </label>
        <input id="name" name="name" className="input" defaultValue={brand.name} />
      </div>

      <div>
        <label className="label" htmlFor="description">
          Hvad laver de
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="input"
          defaultValue={brand.description ?? ''}
        />
      </div>

      <div>
        <label className="label" htmlFor="target_audience">
          Målgruppe
        </label>
        <textarea
          id="target_audience"
          name="target_audience"
          rows={2}
          className="input"
          defaultValue={brand.target_audience ?? ''}
        />
      </div>

      <div>
        <label className="label" htmlFor="tone_of_voice">
          Tone of voice
        </label>
        <textarea
          id="tone_of_voice"
          name="tone_of_voice"
          rows={3}
          className="input"
          defaultValue={brand.tone_of_voice ?? ''}
        />
      </div>

      <div>
        <label className="label" htmlFor="guardrails">
          Må ikke
        </label>
        <textarea
          id="guardrails"
          name="guardrails"
          rows={3}
          className="input"
          defaultValue={brand.guardrails ?? ''}
        />
        <p className="mt-1 text-xs muted">
          Fx samtykke til billeder af børn, forbud mod prisløfter, konkurrenter
          der ikke må nævnes.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="logo_url">
          Logo-URL
        </label>
        <input
          id="logo_url"
          name="logo_url"
          className="input"
          defaultValue={brand.logo_url ?? ''}
          placeholder="https://…"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['color_primary', 'Primær', brand.colors?.primary ?? '#1e4fd8'],
            ['color_secondary', 'Sekundær', brand.colors?.secondary ?? '#ffffff'],
            ['color_accent', 'Accent', brand.colors?.accent ?? '#ff5a36'],
          ] as const
        ).map(([name, label, value]) => (
          <div key={name}>
            <label className="label" htmlFor={name}>
              {label}
            </label>
            <input
              id={name}
              name={name}
              type="color"
              defaultValue={value}
              className="h-10 w-full rounded-lg border"
              style={{ borderColor: 'var(--line)' }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Gemmer…' : 'Gem'}
        </button>
        {message && (
          <span className={`text-sm ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {message}
          </span>
        )}
      </div>
    </form>
  )
}
