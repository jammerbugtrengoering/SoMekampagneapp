# Status

Hvor projektet står. **Opdateres ved hver ændring der flytter noget her.**

_Sidst opdateret: 2026-10-04 (Jammerbugts kopi)_

> **Jammerbugts kopi, 4.10.2026.** Koden er Jonns udgave (`somelinkedin-app`
> @ `2c67211`). Jammerbugts database (`phloauxphbyewwjnaxcv`) har migration
> 0001–0005 og mangler **0006–0015**, som skal køres med `npm run db:setup` FØR
> denne kode går i drift. Afsnittene nedenfor beskriver Jonns egen drift og gælder
> ikke nødvendigvis her — fx kører Jammerbugt ikke LinkedIn.

---

## Virker i drift

- Kampagner: brief → prompt → opslag som kladder
- Arketyper (hvem skriver), strategier (planen for serien), vinkler (greb
  per opslag), retningslinjer — alle redigerbare per organisation
- Dansk eller engelsk per kampagne
- Godkendelse, også markér-flere-og-godkend, med filtrering
- Publicering til LinkedIn (personlig profil), Facebook, Instagram
- Planlagt kørsel hvert 15. minut
- Billeder: arkiv, upload, skabelon tegnet i browseren, AI-baggrund og
  -motiv via Cloudflare (gratis, ~500/døgn)
- Artikel: hele serien samlet til ét stykke, med coverbillede
- To organisationer på samme kodebase, adskilt i databasen
- Slutbrugerhjælp: en «?»-knap på hver side med hjælp til netop den side

## Miljø

| | |
|---|---|
| `PUBLISH_DRY_RUN` | `false` — appen sender rigtigt |
| Planlagt funktion | Aktiveret, kører hvert 15. minut |
| Migrationer | 15, alle kørt |
| Cloudflare | Sat op. Token bør rulles, det har været i klartekst i en chat |
| Gemini | Ikke sat op. Cloudflare bruges |

## Udestående

- **Fornyelse af LinkedIn-token.** Adgangstokenet holder 60 dage,
  fornyelsestokenet 365 og nulstilles ikke. Der er ingen kørsel der
  fornyer, og ingen advarsel når året nærmer sig. Appen holder op med at
  publicere uden varsel.
- **Mærkning af AI-genereret indhold.** Fra august 2026 kræver
  AI-forordningen maskinlæsbar mærkning. Hverken FLUX eller Cloudflare
  sætter metadata på.
- **Uverificeret:** om en LinkedIn-app i udviklingstilstand kun tillader
  appens egne teammedlemmer at godkende. Betyder noget hvis Bo skal
  forbinde sin egen profil.
- `SUPABASE_ACCESS_TOKEN` og Cloudflare-tokenet har været i klartekst i en
  chat. Bør rulles.

## Bevidst udeladt

- Ingen CI. Tests og linter køres lokalt før push
- Ingen TypeScript
- Ingen router, ingen state-pakke, ingen CSS-framework
- Ingen automatisk publicering af LinkedIn-artikler — API'et kan det ikke
