# Orientering

Læs denne først. Den er skrevet til den der starter forfra — en ny
samtale med en assistent, eller dig selv om tre måneder.

**Hvad det er:** en kampagneapp der planlægger og publicerer opslag til
LinkedIn, Facebook og Instagram. Claude skriver udkastene, du godkender,
og en planlagt kørsel sender dem ud.

**Hvem bruger den:** Jammerbugt Rengøring (Charlotte) til virksomhedens egne
Facebook- og Instagram-sider. Dette er **Jammerbugts egen kopi** — med egen
database og eget Netlify-site, så Jammerbugt ejer sine data og kan fortsætte uden
Jonn.

**Hvor koden kommer fra:** kopieret 4.10.2026 fra Jonns
`jonntholstrup-spec/somelinkedin-app` (commit `2c67211`). Den holdes ikke synkron
af sig selv. Skal Jonns nyere ændringer hertil, så hent dem som en ny kopi på en
gren, og kør nye migrationer mod Jammerbugts database FØR grenen flettes.

| | |
|---|---|
| Kildekode | `jammerbugtrengoering/SoMekampagneapp`, gren `main` |
| Drift | Netlify → Jammerbugts eget site (navn skal skrives ind her) |
| Database | Supabase, projekt `phloauxphbyewwjnaxcv` (Jammerbugts) |
| Sprog | JavaScript som ES-moduler. Ingen TypeScript |
| Stak | React 19 · Vite 8 · Postgres 16 · Netlify Functions v2 (Node 22) |

Uddybende: [`docs/beslutninger.md`](docs/beslutninger.md) (hvorfor tingene
er som de er), [`docs/faldgruber.md`](docs/faldgruber.md) (fejl der ikke
ligner fejl), [`docs/status.md`](docs/status.md) (hvor vi er nu),
[`README.md`](README.md) (den lange gennemgang).

---

## Regler der koster tid at lære på den hårde måde

**Byg aldrig uden en `.env`.** Vite indlejrer `VITE_*` ved build. Mangler
de, bliver `opsaetningsfejl` konstant sand, hele appen bliver
bortoptimeret — og bygget siger stadig `✓ built`. En grøn build uden
miljøvariabler beviser ingenting. Bundlen skal være omkring 580 kB;
bliver den 240 kB, er appen forsvundet.

**Migrationer køres i hånden.** `npm run db:setup` fra din Mac, aldrig fra
et deploy. Koden kan være ude før skemaet er — det er med vilje, se
beslutningerne.

**Netlify læser miljøvariabler ved BUILD.** En ændret nøgle eller
`PUBLISH_DRY_RUN` gør ingenting før der er udrullet igen.

**`PUBLISH_DRY_RUN` skal være præcis strengen `false`.** Alt andet, også
tom, betyder tørkørsel: der sendes intet nogen steder hen, og databasen
røres ikke.

**Ingen `Co-Authored-By: Claude`-trailer i commits.** Netlify afviser
deployet med "unrecognized Git contributor" på et privat repo. Dette repo er
offentligt, men reglen holdes, så de to kopier opfører sig ens. Det har
kostet en `git filter-branch` én gang.

**Byg og lint kan ikke køre i den lokale VM.** `node_modules` indeholder
binære pakker til macOS. Kør `npm run build` og `npm run lint` på Jonns
Mac, eller i skyen med en frisk `npm install` og en dummy-`.env`.

**Hooks må ikke stå efter et tidligt `return`.** oxlint fanger det ikke.
Det virker i test og crasher først hos brugeren. Tjek det ved at kigge
komponenterne igennem efter ændringer i `src/App.jsx`.

---

## Kommandoer

```
npm test                 alle syv suiter
npm run test:adskillelse 52 tjek af at organisationer er adskilt (kræver lokal Postgres)
npm run db:setup         kører nye migrationer mod Supabase
npm run org:opret        opretter en organisation og dens ejer
npm run dev              udviklingsserver
npm run dev:api          samme, men `Kør i Claude` kalder `claude -p` lokalt
npm run lint             oxlint
```

`SUPABASE_ACCESS_TOKEN` skal stå i `.env` for at `db:setup` virker. Filen
er gitignoreret.

---

## Sådan ser koden ud

```
src/
  App.jsx          hele brugerfladen. ~5.000 linjer, ét styles-objekt
  prompt.js        alle prompter + læsning af svarene. Ingen browser-API'er,
                   så Node kan importere den — det er hele pointen
  hjaelp.js        hjælpeteksten til hver side. Skrevet til brugeren:
                   ingen kommandoer, ingen tabelnavne. En test håndhæver det
  kanalregler.js   klipgrænser, klichéer, krogtjek (dansk OG engelsk)
  billeder.js      canvas: skabeloner, beskæring, upload
netlify/functions/ 9 funktioner. _lib/ har det delte
supabase/
  migrations/      15 filer, køres i rækkefølge, aldrig redigeres bagud
  tests/           adskillelse.sql — 52 tjek af rækkeadgang
scripts/           kommandolinje + syv testsuiter
```

---

## Når du har lært noget nyt

Skriv det ned i samme commit som ændringen. En rettelse uden en note om
hvorfor, bliver lavet om igen om et halvt år.

- Et **valg** med konsekvenser → `docs/beslutninger.md`
- En **fejl der ikke lignede en fejl** → `docs/faldgruber.md` og en test
- Noget der er **færdigt eller udestående** → `docs/status.md`
- En regel der gælder hver gang → her i `CLAUDE.md`

Kommentarer i koden forklarer **hvorfor**, ikke hvad. Det er en bevidst
stil i dette repo; hold den.
