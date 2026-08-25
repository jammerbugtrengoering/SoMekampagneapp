'use client'

import { useState, useTransition } from 'react'
import { saveChannel, testChannel } from './actions'
import type { Channel } from '@/lib/types'

function ChannelCard({
  brandId,
  channel,
}: {
  brandId: string
  channel?: Channel
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(true)
  const [platform, setPlatform] = useState(channel?.platform ?? 'facebook')

  return (
    <form
      className="card space-y-3 p-4"
      action={(formData) =>
        startTransition(async () => {
          const result = await saveChannel(brandId, formData)
          setOk(result.ok)
          setMessage(result.message)
        })
      }
    >
      <input type="hidden" name="channel_id" value={channel?.id ?? ''} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Platform</label>
          <select
            name="platform"
            className="input"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Channel['platform'])}
          >
            <option value="facebook">Facebook Side</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn (ikke aktiv endnu)</option>
          </select>
        </div>
        <div>
          <label className="label">Visningsnavn</label>
          <input
            name="display_name"
            className="input"
            defaultValue={channel?.display_name ?? ''}
            placeholder="fx Rengøringsfirmaet A/S"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Page ID</label>
          <input
            name="page_id"
            className="input"
            defaultValue={channel?.page_id ?? ''}
          />
        </div>
        {platform === 'instagram' && (
          <div>
            <label className="label">Instagram Business Account ID</label>
            <input
              name="ig_user_id"
              className="input"
              defaultValue={channel?.ig_user_id ?? ''}
            />
          </div>
        )}
      </div>

      <div>
        <label className="label">
          Access token{' '}
          {channel?.token_ciphertext && (
            <span className="font-normal muted">— gemt, lad feltet stå tomt for at beholde det</span>
          )}
        </label>
        <input
          name="token"
          type="password"
          className="input"
          placeholder={channel?.token_ciphertext ? '••••••••' : 'EAAG…'}
          autoComplete="off"
        />
        <input
          name="token_label"
          className="input mt-2"
          defaultValue={channel?.token_label ?? ''}
          placeholder="Label, fx “system user 2026-08”"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={channel?.active ?? true}
        />
        Aktiv
      </label>

      {channel?.last_error && (
        <p className="text-xs text-red-700">Sidste fejl: {channel.last_error}</p>
      )}
      {channel?.last_verified_at && !channel.last_error && (
        <p className="text-xs text-emerald-700">
          Bekræftet {new Date(channel.last_verified_at).toLocaleString('da-DK')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Gemmer…' : channel ? 'Gem kanal' : 'Tilføj kanal'}
        </button>

        {channel && (
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await testChannel(channel.id)
                setOk(result.ok)
                setMessage(result.message)
              })
            }
          >
            Test forbindelse
          </button>
        )}

        {message && (
          <span className={`text-sm ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {message}
          </span>
        )}
      </div>
    </form>
  )
}

export function ChannelList({
  brandId,
  channels,
}: {
  brandId: string
  channels: Channel[]
}) {
  const [addingNew, setAddingNew] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Kanaler</h2>
        {!addingNew && (
          <button className="btn-ghost" onClick={() => setAddingNew(true)}>
            Tilføj kanal
          </button>
        )}
      </div>

      {channels.map((channel) => (
        <ChannelCard key={channel.id} brandId={brandId} channel={channel} />
      ))}

      {addingNew && <ChannelCard brandId={brandId} />}

      {!channels.length && !addingNew && (
        <p className="text-sm muted">
          Ingen kanaler endnu. Uden en kanal kan kampagnen genereres, men ikke
          publiceres.
        </p>
      )}
    </div>
  )
}
