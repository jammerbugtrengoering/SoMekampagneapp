/**
 * Gør en bruger til ejer i en organisation.
 *
 *   npm run admin:add jonn@example.dk
 *   npm run admin:list
 *   npm run admin:remove jonn@example.dk
 *
 * Efter migration 0005 findes der ikke længere én global administrator-liste:
 * adgang er medlemskab af en organisation, med en rolle. Kommandoerne her
 * bliver stående, fordi de sidder i fingrene — men de peger nu på
 * scripts/org.mjs, som kan sige "ejer i PGU" frem for bare "administrator".
 *
 * Findes der mere end én organisation, kan dette script ikke gætte hvilken,
 * og henviser til org.mjs i stedet for at vælge på må og få.
 */

import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { laesEnv } from './lib/mgmt.mjs'

const env = { ...laesEnv(), ...process.env }

function klient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !noegle) throw new Error('SUPABASE_URL og SUPABASE_SECRET_KEY skal stå i .env.')
  if (noegle.includes('...') || noegle.length < 25) {
    throw new Error(
      `SUPABASE_SECRET_KEY ser ud til at være pladsholderen "${noegle}".\n` +
        'Hent den rigtige i Supabase → Settings → API Keys → Secret keys.',
    )
  }
  return createClient(url, noegle, { auth: { persistSession: false } })
}

/** Videresender til org.mjs, så der kun findes én udgave af logikken. */
function videre(argv) {
  const res = spawnSync(process.execPath, ['scripts/org.mjs', ...argv], { stdio: 'inherit' })
  process.exitCode = res.status ?? 1
}

async function main() {
  const handling = process.argv[2] === '--fjern' ? 'fjern'
    : process.argv[2] === '--liste' ? 'liste'
    : 'tilfoej'

  if (handling === 'liste') return videre(['--liste'])

  const email = handling === 'tilfoej' ? process.argv[2] : process.argv[3]
  if (!email) {
    console.error('Brug: npm run admin:add <email>')
    process.exitCode = 1
    return
  }

  const { data: orgs, error } = await klient()
    .from('organisations').select('slug, name').order('name')
  if (error) throw new Error(error.message)

  if (!orgs?.length) {
    throw new Error(
      'Der findes ingen organisationer endnu. Opret den første:\n' +
        '  npm run org:opret "Jammerbugt Rengøring"',
    )
  }

  if (orgs.length > 1) {
    throw new Error(
      'Der er flere organisationer, så jeg vil ikke gætte hvilken.\n\n' +
        orgs.map((o) => `  npm run org:medlem ${o.slug} ${email} ejer   (${o.name})`).join('\n'),
    )
  }

  videre(handling === 'fjern'
    ? ['--fjern', orgs[0].slug, email]
    : ['--medlem', orgs[0].slug, email, 'ejer'])
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`)
  process.exitCode = 1
})
