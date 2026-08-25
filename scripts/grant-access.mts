/**
 * Giver en bruger adgang til alle kunder.
 *
 *   npm run db:grant jonn@example.dk
 *
 * Brugeren skal have logget ind i appen mindst én gang — det er dér rækken i
 * auth.users bliver til. Uden en række i brand_members ser man ingenting,
 * fordi al RLS hænger på netop den tabel.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { requireToken, runQuery } from './lib/mgmt.mts'

const ENV_PATH = resolve(process.cwd(), '.env.local')

function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Brug: npm run db:grant <email>')
    process.exitCode = 1
    return
  }

  const token = requireToken()
  const env = readEnvLocal()
  const ref =
    process.env.SUPABASE_PROJECT_REF ??
    env.SUPABASE_PROJECT_REF ??
    env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]

  if (!ref) throw new Error('Kunne ikke finde projektets ref.')

  // Enkelt anførselstegn er det eneste der kan bryde ud af strengen her.
  const safeEmail = email.replace(/'/g, "''")

  const users = await runQuery(
    ref,
    token,
    `select id, email from auth.users where email = '${safeEmail}';`,
  )

  if (!users?.length) {
    console.error(
      `Ingen bruger med e-mailen ${email}.\n` +
        'Log ind i appen én gang først — brugeren oprettes ved første login.',
    )
    process.exitCode = 1
    return
  }

  const userId = users[0].id

  const result = await runQuery(
    ref,
    token,
    `insert into public.brand_members (brand_id, user_id, role)
     select id, '${userId}', 'owner' from public.brands
     on conflict (brand_id, user_id) do nothing
     returning brand_id;`,
  )

  const added = result?.length ?? 0
  console.log(
    added
      ? `${email} har nu adgang til ${added} kunde(r).`
      : `${email} havde allerede adgang til alle kunder.`,
  )
}

main().catch((error) => {
  console.error(`\nFejl: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
