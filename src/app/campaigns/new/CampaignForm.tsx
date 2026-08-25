'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createCampaign, type CreateResult } from './actions'
import type { Brand } from '@/lib/types'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Claude skriver…' : 'Generér kampagne'}
    </button>
  )
}

export function CampaignForm({ brands }: { brands: Brand[] }) {
  const [state, formAction] = useActionState<CreateResult | null, FormData>(
    createCampaign,
    null,
  )

  const today = new Date().toISOString().slice(0, 10)

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="brand_id">
          Kunde
        </label>
        <select id="brand_id" name="brand_id" className="input" required>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="name">
          Kampagnenavn
        </label>
        <input
          id="name"
          name="name"
          className="input"
          placeholder="fx Hovedrengøring efterår"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="brief">
          Brief
        </label>
        <textarea
          id="brief"
          name="brief"
          rows={4}
          className="input"
          placeholder="Hvad skal kampagnen handle om? Hvilket tilbud, hvilken begivenhed, hvilken sæson?"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="goal">
          Mål (valgfrit)
        </label>
        <input
          id="goal"
          name="goal"
          className="input"
          placeholder="fx 10 nye medlemmer, 5 tilbudsforespørgsler"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="starts_on">
            Start
          </label>
          <input
            id="starts_on"
            name="starts_on"
            type="date"
            className="input"
            defaultValue={today}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="ends_on">
            Slut
          </label>
          <input id="ends_on" name="ends_on" type="date" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="post_count">
            Antal opslag
          </label>
          <input
            id="post_count"
            name="post_count"
            type="number"
            min={1}
            max={20}
            defaultValue={5}
            className="input"
          />
        </div>
      </div>

      <fieldset>
        <legend className="label">Kanaler</legend>
        <div className="flex gap-4 text-sm">
          {(
            [
              ['facebook', 'Facebook'],
              ['instagram', 'Instagram'],
              ['linkedin', 'LinkedIn'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="platforms"
                value={value}
                defaultChecked={value !== 'linkedin'}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {state && !state.ok && state.message && (
        <p className="text-sm text-red-700">{state.message}</p>
      )}

      <SubmitButton />
      <p className="text-xs muted">
        Opslagene oprettes som kladder der afventer godkendelse. Der bliver ikke
        publiceret noget før du godkender dem.
      </p>
    </form>
  )
}
