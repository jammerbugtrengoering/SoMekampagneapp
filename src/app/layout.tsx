import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kampagneapp',
  description: 'Planlæg og publicér kampagner på tværs af kunder og kanaler',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="da">
      <body>
        <header className="border-b" style={{ borderColor: 'var(--line)' }}>
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Kampagneapp
            </Link>
            <div className="flex gap-5 text-sm muted">
              <Link href="/" className="hover:opacity-70">
                Kalender
              </Link>
              <Link href="/campaigns/new" className="hover:opacity-70">
                Ny kampagne
              </Link>
              <Link href="/brands" className="hover:opacity-70">
                Kunder
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
