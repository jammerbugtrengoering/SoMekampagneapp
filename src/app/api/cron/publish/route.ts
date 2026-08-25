import { NextResponse } from 'next/server'
import { isDryRun, publishDuePosts } from '@/lib/publish'
import { adminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Publicerer alt der er godkendt og forfaldent.
 *
 * Kaldes af netlify/functions/scheduled-publish.ts hvert 15. minut. Kører med
 * service-role, fordi der ikke er nogen bruger-session bag et cron-kald — og er
 * derfor låst bag CRON_SECRET.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET er ikke sat.' }, { status: 500 })
  }

  const provided = request.headers.get('x-cron-secret')
  // Sammenlign i konstant tid ville være pænere, men længden alene er ikke
  // hemmelig her, og timing over HTTP er støjende nok til at det er teater.
  if (provided !== secret) {
    return NextResponse.json({ error: 'Uautoriseret' }, { status: 401 })
  }

  try {
    const results = await publishDuePosts(adminClient())

    const published = results.filter((r) => r.results.every((x) => x.ok)).length
    const failed = results.length - published

    return NextResponse.json({
      ok: true,
      dryRun: isDryRun(),
      processed: results.length,
      published,
      failed,
      details: results,
    })
  } catch (error) {
    console.error('Cron-publicering fejlede:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
