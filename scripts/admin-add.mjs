/**
 * Gør en bruger til administrator i kampagneappen.
 *
 *   npm run admin:add jonn@example.dk
 *   npm run admin:list
 *   npm run admin:remove jonn@example.dk
 *
 * Brugeren skal findes i forvejen. Opret hende i Supabase-dashboardet under
 * Authentication → Users → Add user, hvor hun selv får en adgangskode — den
 * slags hører ikke i et script.
 */

import { findProjektRef, koerSql, kraevToken } from './lib/mgmt.mjs'

const citer = (s) => `'${String(s).replace(/'/g, "''")}'`

async function main() {
  const token = kraevToken()
  const ref = await findProjektRef(token, 'SoMePlanning App')

  const handling = process.argv[2] === '--fjern' ? 'fjern'
    : process.argv[2] === '--liste' ? 'liste'
    : 'tilfoej'

  const email = handling === 'tilfoej' ? process.argv[2] : process.argv[3]

  if (handling === 'liste') {
    const raekker = await koerSql(
      ref,
      token,
      'select email, name, created_at from public.app_admins order by created_at;',
    )
    if (!raekker?.length) {
      console.log('Ingen administratorer endnu. Ingen kan logge ind.')
      return
    }
    console.log('Administratorer:')
    for (const r of raekker) {
      console.log(`  ${r.email ?? '(uden e-mail)'}${r.name ? ` — ${r.name}` : ''}`)
    }
    return
  }

  if (!email) {
    console.error('Brug: npm run admin:add <email>')
    process.exitCode = 1
    return
  }

  const brugere = await koerSql(
    ref,
    token,
    `select id, email from auth.users where lower(email) = lower(${citer(email)});`,
  )

  if (!brugere?.length) {
    console.error(
      `Ingen bruger med e-mailen ${email}.\n\n` +
        'Opret hende først i Supabase-dashboardet:\n' +
        `  https://supabase.com/dashboard/project/${ref}/auth/users\n` +
        '  → Add user → Create new user (sæt en adgangskode, og bed hende skifte den)',
    )
    process.exitCode = 1
    return
  }

  const bruger = brugere[0]

  if (handling === 'fjern') {
    await koerSql(ref, token, `delete from public.app_admins where user_id = ${citer(bruger.id)};`)
    console.log(`${email} er ikke længere administrator.`)
    return
  }

  const res = await koerSql(
    ref,
    token,
    `insert into public.app_admins (user_id, email)
     values (${citer(bruger.id)}, ${citer(bruger.email)})
     on conflict (user_id) do nothing
     returning user_id;`,
  )

  console.log(
    res?.length
      ? `${email} er nu administrator i kampagneappen.`
      : `${email} var allerede administrator.`,
  )
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`)
  process.exitCode = 1
})
