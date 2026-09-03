/**
 * Organisationer og medlemmer fra terminalen.
 *
 *   npm run org                                   viser organisationer og medlemmer
 *   npm run org:opret "PGU"                       opretter en organisation
 *   npm run org:medlem pgu jonn@mail.dk ejer      giver adgang, eller retter rollen
 *   npm run org:fjern  pgu jonn@mail.dk           fjerner adgangen
 *
 * Hvorfor et script, når appen kan det samme? Fordi den første ejer i en ny
 * organisation ikke kan inviteres af nogen — der er ingen ejer endnu. Det er
 * hønen og ægget, og det løses her.
 *
 * Bruger SUPABASE_SECRET_KEY fra .env, samme som de øvrige scripts. Nøglen
 * går uden om RLS, så dette script ER adgangskontrollen: har du filen, kan
 * du alt. Derfor ligger den ikke i appen.
 */

import { createClient } from '@supabase/supabase-js'
import { laesEnv } from './lib/mgmt.mjs'

const ROLLER = ['ejer', 'redaktoer', 'godkender']
const env = { ...laesEnv(), ...process.env }

function klient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !noegle) {
    throw new Error('SUPABASE_URL og SUPABASE_SECRET_KEY skal stå i .env.')
  }
  if (noegle.includes('...') || noegle.length < 25) {
    throw new Error(
      `SUPABASE_SECRET_KEY ser ud til at være pladsholderen "${noegle}".\n` +
        'Hent den rigtige i Supabase → Settings → API Keys → Secret keys.',
    )
  }
  return createClient(url, noegle, { auth: { persistSession: false } })
}

/** Slår brugeren op på e-mail. Der bladres, for Auth Admin API'et
 *  understøtter ikke filtrering i alle udgaver. */
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

/** Finder organisationen ud fra slug, navn eller id — det man nu har ved hånden. */
async function findOrg(db, noegle) {
  const { data, error } = await db.from('organisations').select('id, slug, name')
  if (error) throw new Error(error.message)

  const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '')
  const traef = (data ?? []).filter(
    (o) => o.id === noegle || o.slug === noegle || norm(o.name) === norm(noegle),
  )

  if (traef.length === 1) return traef[0]
  if (!traef.length) {
    throw new Error(
      `Ingen organisation der matcher "${noegle}". Kendte:\n` +
        (data ?? []).map((o) => `  ${o.slug}  (${o.name})`).join('\n'),
    )
  }
  throw new Error(`"${noegle}" passer på flere. Brug slug eller id.`)
}

function lavSlug(navn) {
  const s = String(navn ?? '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || `org-${Date.now().toString(36)}`
}

/* ------------------------------------------------------------------ */

async function visAlt(db) {
  const { data: orgs, error } = await db
    .from('organisations').select('*').order('name')
  if (error) throw new Error(error.message)

  if (!orgs?.length) {
    console.log('Ingen organisationer. Opret den første:\n  npm run org:opret "Jammerbugt Rengøring"')
    return
  }

  for (const o of orgs) {
    const [{ data: medlemmer }, { data: kunder }] = await Promise.all([
      db.from('org_members').select('email, name, rolle').eq('org_id', o.id).order('rolle'),
      db.from('customers').select('name').eq('organisation_id', o.id).order('name'),
    ])

    console.log(`\n${o.name}  (${o.slug})${o.aktiv ? '' : '  — SAT PÅ PAUSE'}`)
    console.log(`  plan: ${o.plan}`)
    console.log(`  kunder: ${kunder?.length ? kunder.map((k) => k.name).join(', ') : 'ingen'}`)

    if (!medlemmer?.length) {
      console.log('  medlemmer: INGEN — ingen kan logge ind her')
    } else {
      console.log('  medlemmer:')
      for (const m of medlemmer) {
        console.log(`    ${(m.rolle + ' ').padEnd(11)} ${m.email ?? '(uden e-mail)'}${m.name ? ` — ${m.name}` : ''}`)
      }
      if (!medlemmer.some((m) => m.rolle === 'ejer')) {
        console.log('    BEMÆRK: ingen ejer. Ingen kan rette tokens eller invitere.')
      }
    }
  }
  console.log()
}

async function opret(db, navn) {
  if (!navn) throw new Error('Brug: npm run org:opret "Navn på organisationen"')

  const grundslug = lavSlug(navn)
  let sidste = null

  for (let forsoeg = 0; forsoeg < 5; forsoeg++) {
    const slug = forsoeg === 0 ? grundslug : `${grundslug}-${forsoeg + 1}`
    const { data, error } = await db
      .from('organisations').insert({ slug, name: navn }).select().single()

    if (!error) {
      console.log(`${navn} oprettet  (${slug})`)
      console.log('\nNæste skridt — organisationen kan ingenting uden en ejer:')
      console.log(`  npm run org:medlem ${slug} <e-mail> ejer`)
      return data
    }
    sidste = error
    if (error.code !== '23505') break
  }
  throw new Error(sidste?.message ?? 'Kunne ikke oprette organisationen.')
}

async function medlem(db, orgNoegle, email, rolle = 'redaktoer') {
  if (!orgNoegle || !email) {
    throw new Error('Brug: npm run org:medlem <organisation> <e-mail> [ejer|redaktoer|godkender]')
  }
  if (!ROLLER.includes(rolle)) {
    throw new Error(`Ukendt rolle "${rolle}". Vælg: ${ROLLER.join(', ')}.`)
  }

  const org = await findOrg(db, orgNoegle)
  const bruger = await findBruger(db, email)

  if (!bruger) {
    const ref = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\./)?.[1]
    throw new Error(
      `Ingen bruger med e-mailen ${email}.\n\n` +
        'Opret hende først i Supabase-dashboardet:\n' +
        `  https://supabase.com/dashboard/project/${ref}/auth/users\n` +
        '  → Add user (sæt en adgangskode, og bed hende skifte den)\n\n' +
        'Eller invitér hende inde fra appen under Medlemmer, hvis du allerede er ejer.',
    )
  }

  const { data: fandtes } = await db
    .from('org_members').select('rolle')
    .eq('org_id', org.id).eq('user_id', bruger.id).maybeSingle()

  const { error } = await db.from('org_members').upsert(
    { org_id: org.id, user_id: bruger.id, rolle, email: bruger.email },
    { onConflict: 'org_id,user_id' },
  )
  if (error) throw new Error(error.message)

  if (!fandtes) console.log(`${email} er nu ${rolle} i ${org.name}.`)
  else if (fandtes.rolle === rolle) console.log(`${email} var allerede ${rolle} i ${org.name}.`)
  else console.log(`${email} er gået fra ${fandtes.rolle} til ${rolle} i ${org.name}.`)
}

async function fjern(db, orgNoegle, email) {
  if (!orgNoegle || !email) throw new Error('Brug: npm run org:fjern <organisation> <e-mail>')

  const org = await findOrg(db, orgNoegle)
  const bruger = await findBruger(db, email)
  if (!bruger) throw new Error(`Ingen bruger med e-mailen ${email}.`)

  const { data: medlemmer } = await db
    .from('org_members').select('user_id, rolle').eq('org_id', org.id)

  const denne = medlemmer?.find((m) => m.user_id === bruger.id)
  if (!denne) {
    console.log(`${email} er ikke medlem af ${org.name}.`)
    return
  }

  // Den sidste ejer må ikke fjernes: så kan ingen invitere, rette tokens
  // eller rydde op, og organisationen er låst.
  if (denne.rolle === 'ejer' && medlemmer.filter((m) => m.rolle === 'ejer').length === 1) {
    throw new Error(
      `${email} er den sidste ejer i ${org.name}. Gør en anden til ejer først:\n` +
        `  npm run org:medlem ${org.slug} <anden e-mail> ejer`,
    )
  }

  const { error } = await db
    .from('org_members').delete().eq('org_id', org.id).eq('user_id', bruger.id)
  if (error) throw new Error(error.message)

  console.log(`${email} har ikke længere adgang til ${org.name}.`)
  console.log('Brugeren findes stadig og kan være medlem af andre organisationer.')
}

/* ------------------------------------------------------------------ */

async function main() {
  const db = klient()
  const [flag, ...rest] = process.argv.slice(2)

  if (flag === '--opret') return opret(db, rest.join(' ').trim())
  if (flag === '--medlem') return medlem(db, rest[0], rest[1], rest[2])
  if (flag === '--fjern') return fjern(db, rest[0], rest[1])
  if (!flag || flag === '--liste') return visAlt(db)

  throw new Error(
    `Ukendt tilvalg "${flag}".\n\n` +
      '  npm run org                              viser alt\n' +
      '  npm run org:opret "Navn"                 opretter en organisation\n' +
      '  npm run org:medlem <org> <mail> <rolle>  giver adgang eller retter rollen\n' +
      '  npm run org:fjern <org> <mail>           fjerner adgangen',
  )
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`)
  process.exitCode = 1
})
