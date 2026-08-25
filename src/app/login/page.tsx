'use client'

import { useState } from 'react'
import { browserClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const supabase = browserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    })

    setPending(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <h1 className="mb-1 text-xl font-semibold">Log ind</h1>
      <p className="mb-5 text-sm muted">
        Du får et link på mail. Ingen adgangskode at huske.
      </p>

      {sent ? (
        <div className="card p-4 text-sm">
          Linket er sendt til <strong>{email}</strong>. Åbn det på denne enhed.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card space-y-3 p-5">
          <div>
            <label className="label" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? 'Sender…' : 'Send login-link'}
          </button>
        </form>
      )}
    </div>
  )
}
