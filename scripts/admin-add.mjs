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
 *
 * Nøgle: scriptet bruger projektets egen SUPABASE_SECRET_KEY fra .env. Den
 * ligger der allerede, fordi funktionerne skal bruge den, og så slipper du
 * for at hente et personligt adgangstoken hver gang. Findes den ikke, falder
 * scriptet tilbage til Management API'et med SUPABASE_ACCESS_TOKEN.
 */

import { createClient } from '@supabase/supabase-js'
import { findProjektRef, koerSql, kraevToken, laesEnv } from './lib/mgmt.mjs'

const env = { ...laesEnv(), ...process.env }
const citer = (s) => `'${String(s).replace(/'/g, "''")}'`

/**
 * Fanger den nøgle man har kopieret fra en vejledning i stedet for fra
 * dashboardet. Uden dette tjek er svaret "JWT could not be decoded", og så
 * leder man efter fejlen i databasen i stedet for i sin egen kommandolinje.
 */
function seRigtigUd(vaerdi, navn, hvor) {
  if (!vaerdi) return false
  if (vaerdi.includes('...') || vaerdi.includes('…') || vaerdi.length < 25) {
    throw new Error(
      `${navn} ser ud til at være pladsholderen "${vaerdi}" og ikke en rigtig nøgle.\n` +
        `Hent den rigtige her: ${hvor}`,
    )
  }
  return true
}

/* ---------------------------------------------------------------------
   Vej 1: projektets egen secret key (foretrukket)
   --------------------------------------------------------------------- */

function direkteKlient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !noegle) return null
  seRigtigUd(noegle, 'SUPABASE_SECRET_KEY', 'Supabase → Settings → API Keys → Secret keys')
  return createClient(url, noegle, { auth: { persistSession: false } })
}

/**
 * Slår brugeren op via Auth Admin API'et. Der er ikke filtrering på e-mail i
 * alle versioner, så vi bladrer igennem — der er få brugere i denne app.
 */
async function findBruger(db, email) {
  const maal = email.toLowerCase()
  for (let side = 1; side <= 10; side++) {
    const { data, error } = await db.auth.admin.listUsers({ page: side, perPage: 200 })
    if (error) throw new Error(error.message)
    const traef = data.users.find((u) => u.email?.toLowerCase() === maal)
    if (traef) return traef
    if (data.users.length < 200) break
  }
  return null
}

async function viaSecretKey(db, handling, email) {
  if (handling === 'liste') {
    const { data, error } = await db
      .from('app_admins').select('email, name, created_at').order('created_at')
    if (error) throw new Error(error.message)
    if (!data?.length) {
      console.log('Ingen administratorer endnu. Ingen kan logge ind.')
      return
    }
    console.log('Administratorer:')
    for (const r of data) console.log(`  ${r.email ?? '(uden e-mail)'}${r.name ? ` — ${r.name}` : ''}`)
    return
  }

  const bruger = await findBruger(db, email)
  if (!bruger) {
    const ref = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).match(/https:\/\/([a-z0-9]+)\./)?.[1]
    throw new Error(
      `Ingen bruger med e-mailen ${email}.\n\n` +
        'Opret hende først i Supabase-dashboardet:\n' +
        `  https://supabase.com/dashboard/project/${ref}/auth/users\n` +
        '  → Add user → Create new user (sæt en adgangskode, og bed hende skifte den)',
    )
  }

  if (handling === 'fjern') {
    const { error } = await db.from('app_admins').delete().eq('user_id', bruger.id)
    if (error) throw new Error(error.message)
    console.log(`${email} er ikke længere administrator.`)
    return
  }

  // Findes rækken i forvejen, skal vi ikke sige "nu er hun administrator" som
  // om der skete noget — derfor kigger vi efter først.
  const { data: eksisterende } = await db
    .from('app_admins').select('user_id').eq('user_id', bruger.id).maybeSingle()

  if (eksisterende) {
    console.log(`${email} var allerede administrator.`)
    return
  }

  const { error } = await db.from('app_admins').insert({ user_id: bruger.id, email: bruger.email })
  if (error) throw new Error(error.message)
  console.log(`${email} er nu administrator i kampagneappen.`)
}

/* ---------------------------------------------------------------------
   Vej 2: Management API med personligt token (fallback)
   --------------------------------------------------------------------- */

async function viaManagement(handling, email) {
  const token = kraevToken()
  seRigtigUd(token, 'SUPABASE_ACCESS_TOKEN', 'https://supabase.com/dashboard/account/tokens')
  const ref = await findProjektRef(token, 'SoMePlanning App')

  if (handling === 'liste') {
    const raekker = await koerSql(
      ref, token, 'select email, name, created_at from public.app_admins order by created_at;',
    )
    if (!raekker?.length) {
      console.log('Ingen administratorer endnu. Ingen kan logge ind.')
      return
    }
    console.log('Administratorer:')
    for (const r of raekker) console.log(`  ${r.email ?? '(uden e-mail)'}${r.name ? ` — ${r.name}` : ''}`)
    return
  }

  const brugere = await koerSql(
    ref, token, `select id, email from auth.users where lower(email) = lower(${citer(email)});`,
  )

  if (!brugere?.length) {
    throw new Error(
      `Ingen bruger med e-mailen ${email}.\n\n` +
        'Opret hende først i Supabase-dashboardet:\n' +
        `  https://supabase.com/dashboard/project/${ref}/auth/users\n` +
        '  → Add user → Create new user (sæt en adgangskode, og bed hende skifte den)',
    )
  }

  const bruger = brugere[0]

  if (handling === 'fjern') {
    await koerSql(ref, token, `delete from public.app_admins where user_id = ${citer(bruger.id)};`)
    console.log(`${email} er ikke længere administrator.`)
    return
  }

  const res = await koerSql(
    ref, token,
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

async function main() {
  const handling = process.argv[2] === '--fjern' ? 'fjern'
    : process.argv[2] === '--liste' ? 'liste'
    : 'tilfoej'

  const email = handling === 'tilfoej' ? process.argv[2] : process.argv[3]

  if (handling !== 'liste' && !email) {
    console.error('Brug: npm run admin:add <email>')
    process.exitCode = 1
    return
  }

  const db = direkteKlient()
  if (db) return viaSecretKey(db, handling, email)
  return viaManagement(handling, email)
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`)
  process.exitCode = 1
})
