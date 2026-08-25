import type { Config } from '@netlify/functions'

/**
 * Planlagt kørsel. Selve arbejdet ligger i /api/cron/publish, så der kun er
 * ét sted hvor publicering sker — uanset om den udløses af cron eller af et
 * klik på "Publicér nu".
 *
 * Skemaet står i netlify.toml (hvert 15. minut).
 */
export default async function handler(): Promise<Response> {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL
  const secret = process.env.CRON_SECRET

  if (!base || !secret) {
    console.error('URL eller CRON_SECRET mangler — springer over.')
    return new Response('Mangler konfiguration', { status: 500 })
  }

  const response = await fetch(`${base}/api/cron/publish`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  })

  const body = await response.text()
  console.log(`Publicering: ${response.status} ${body.slice(0, 500)}`)

  return new Response(body, { status: response.status })
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
