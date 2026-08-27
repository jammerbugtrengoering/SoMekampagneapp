# Kampagneapp

Planlægger og publicerer opslag for flere kunder på Facebook og Instagram.
Claude skriver udkastene ud fra kundens brandprofil, du godkender dem, og en
planlagt kørsel sender dem ud på det aftalte tidspunkt.

**Stack:** Vite + React 19 · Supabase · Netlify — samme opbygning som
Planning-App og Medarbejder-App.

---

## Sådan hænger det sammen

```
Brandprofil (tone, målgruppe, må-ikke)
        │
        ▼
Kampagnebrief ──► appen bygger en prompt ──► du kører den i Claude
        │                                    og indsætter JSON'en tilbage
        ▼
opslag med tekst, hashtags, billedbrief, tidspunkt
        │
        ▼
Du redigerer og godkender     (intet går ud uden dette skridt)
        │
        ▼
Netlify cron hvert 15. min ──► Facebook / Instagram
```

Browseren taler kun med Supabase gennem anon-nøglen. Alt der kræver en
hemmelighed går gennem en Netlify-funktion:

| Funktion | Gør | Hvorfor på serveren |
|---|---|---|
| `generer-kampagne` | Kalder Claude automatisk | **Ikke i brug.** Kræver `ANTHROPIC_API_KEY`. Se nedenfor |
| `gem-kanal` | Krypterer og gemmer Meta-tokens, tester forbindelsen | Krypteringsnøglen findes kun på serveren |
| `publicer-opslag` | "Publicér nu" | Tokens dekrypteres her; browseren ser dem aldrig |
| `planlagt-publicering` | Cron hvert 15. min | Ingen brugersession bag et cron-kald |
| `ai-baggrund` | Genererer en abstrakt baggrund | `GEMINI_API_KEY` maa ikke i klient-JS |

Al publicering går gennem `publicerTilKanal()` i
`netlify/functions/_lib/meta.js`. Skal du senere skifte til en aggregator som
Ayrshare, er det den ene funktion du udskifter.

---

## Adgang

Ét niveau: administrator. Står din bruger i `app_admins`, kan du alt. Gør den
ikke, kan du ingenting — og det er håndhævet i databasen, ikke i
skærmbilledet. Funktionerne kører med service-role og tjekker derfor selv
`app_admins`, så et POST med curl falder på samme sten som en uautoriseret
bruger i browseren.

```bash
npm run admin:add din@mail.dk      # gør en eksisterende bruger administrator
npm run admin:list                 # hvem har adgang
npm run admin:remove din@mail.dk   # fjern igen
```

Brugere oprettes i Supabase-dashboardet under **Authentication → Users → Add
user**. Adgangskoder hører ikke i et script.

---

## Kom i gang

```bash
npm install
cp .env.example .env

export SUPABASE_ACCESS_TOKEN=sbp_...   # supabase.com/dashboard/account/tokens
npm run db:setup                       # tabeller, RLS, de to kunder, storage-bucket

npm run dev
```

`db:setup` kan køres igen — anvendte migrationer noteres i
`schema_migrations`, og seed springes over hvis der allerede er kunder.

Access tokenet hører i din shell, ikke i `.env`. Det giver adgang til alle dine
Supabase-projekter, mens appen kun har brug for anon-nøglen.

### Nøgler

Supabase udfaser `anon` og `service_role` ved udgangen af 2026. Denne app
bruger afløserne:

| Ny | Afløser | Hører |
|---|---|---|
| `sb_publishable_…` → `VITE_SUPABASE_PUBLISHABLE_KEY` | `anon` | I browseren. Offentlig — RLS er grænsen, ikke nøglen |
| `sb_secret_…` → `SUPABASE_SECRET_KEY` | `service_role` | Kun i Netlify-funktionerne. Bypasser RLS |

Hentes under **Settings → API Keys**. De gamle navne læses stadig som
fallback, så Planning-App og Medarbejder-App kan migrere i deres eget tempo.

En detalje der bider: de nye nøgler må **ikke** stå alene i en
`Authorization: Bearer`-header — kun hvis `apikey` har samme værdi.
`createClient` klarer det selv, men skriver du et `fetch` mod Supabase i
hånden, skal du sætte begge headere. Se storage-kaldet i `scripts/setup-db.mjs`.

### Miljøvariabler

`VITE_`-variabler bundles ind i browseren og må kun indeholde offentlige
værdier. Alt andet skal stå **uden** præfiks, ellers ender hemmeligheden i
klient-JS'en.

Modsat de to andre apps er `.env` **ikke** committet her, fordi filen
indeholder `ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY` og `CRON_SECRET`. Sæt
dem i Netlify UI under **Site settings → Environment variables**.

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

Lad `PUBLISH_DRY_RUN=true` stå indtil du har set opslagene i funktionsloggen.
Så kan du ikke komme til at publicere ved et uheld.

---

## Meta-opsætning

Du skal have en Meta-app, men **ikke** app review — så længe du selv er admin
på de sider der publiceres til. Meta kræver kun Advanced Access (og dermed
review og business-verifikation) når appen betjener konti du ikke
administrerer.

1. [developers.facebook.com](https://developers.facebook.com) → ny app af typen **Business**
2. Tilføj **Facebook Login for Business** og **Instagram Graph API**
3. **Meta Business Suite → Indstillinger → Systembrugere** → opret systembruger med rollen Admin
4. Tildel den de sider og Instagram-konti der skal publiceres til
5. Generér token med `pages_manage_posts`, `pages_read_engagement`,
   `instagram_basic`, `instagram_content_publish`

Systembruger-tokens udløber ikke. Har hver kunde sin egen Business-portefølje,
får du **ét token per kunde** — tokenet ligger på kanalen, ikke på kunden, så
det er der ikke noget at lave om for.

```bash
# Dine sider
curl "https://graph.facebook.com/v21.0/me/accounts?access_token=TOKEN"

# Instagram-kontoen der hænger på en side
curl "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=TOKEN"
```

Indsæt page-id, ig-id og token under kunden i appen, og brug **Test
forbindelse** før du stoler på det.

### Ting der driller

| Symptom | Årsag |
|---|---|
| `(#200) Permissions error` | Tokenet mangler `pages_manage_posts`, eller systembrugeren har ikke fået tildelt siden |
| Instagram-container bliver ved `IN_PROGRESS` | Billed-URL'en kræver login, eller formatet er ikke JPEG |
| Token holdt op med at virke | Du mistede admin-rollen på siden, eller systembrugeren blev fjernet |

**Instagram kan ikke publicere uden billede.** Appen fanger det ved
godkendelse i stedet for at lade det fejle under cron-kørslen.

---

## Deploy til Netlify

Build `npm run build`, publish `dist`, functions `netlify/functions` — det
står i `netlify.toml`, så Netlify finder det selv. Sæt miljøvariablerne i UI'en.

`/api/*` peger på funktionerne, og alt andet på `index.html`. Rækkefølgen af
redirects i `netlify.toml` er betydende: sluger SPA-reglen kommer først,
forsvinder API-kaldene.

Den planlagte funktion kører hvert 15. minut og publicerer alt der er
**godkendt** og hvis tidspunkt er passeret. Kladder røres ikke.

---

## Test

```bash
npm run test:publicering   # kryptering, tørkørsel, Instagram-regler — intet netværk
npm run lint
npm run build
```

`test:publicering` kaprer `fetch` under tørkørsel-testen, så testen fejler hvis
koden alligevel prøver at ringe til Meta.

---

## Automatisk generering

I dag bygger appen en prompt, du kører den i Claude, og indsætter svaret
tilbage. Det koster ingenting og kræver ingen API-nøgle.

Vil du have den automatisk, findes funktionen allerede i
`netlify/functions/generer-kampagne.js`. Sæt `ANTHROPIC_API_KEY` i Netlify og
kald `kaldApi("generer-kampagne", …)` fra `NyKampagne` i stedet for
indsæt-feltet. Prompten i `byggPrompt()` er ordret den samme som funktionen
sender, så resultaterne skifter ikke karakter når du gør det.

Koster cirka 0,20 kr per kampagne med fem opslag.

## Billeder

Fire veje til et billede, under **Vaelg billede** paa hvert opslag:

| Fane | Goer | Koster |
|---|---|---|
| Arkiv | Genbrug et billede kunden allerede har | - |
| Upload | Kundens egne fotos ind i den offentlige bucket | - |
| Skabelon | Tegner i browseren: brandfarve eller foto, overskrift, logo | - |
| AI-baggrund | Abstrakt baggrund fra Gemini | 0,30-1 kr |

**AI laver kun baggrunde** - flader, teksturer, stemninger. Aldrig mennesker,
lokaler eller tekst i billedet. Det er et bevidst valg: begge kunder saelger
paa at vaere aegte og lokale, og et opdigtet foto af "vores folk" arbejder imod
det. For foreningen ville AI-boern desuden omgaa samtykke-spoergsmaalet paa den
forkerte maade. Vil du have tekst paa en AI-baggrund, saa gem den i arkivet og
vaelg den som baggrund under Skabelon.

Skabelonerne tegnes med canvas - ingen server, ingen afhaengigheder. Billedet
uploades til bucket'en, som **skal** vaere public: Meta henter selv billedet fra
URL'en og kan ikke logge ind.

To ting i tegnekoden der er vaerd at kende, hvis du retter i den: billeder
hentes med `crossOrigin = "anonymous"`, ellers bliver canvas'et tainted og
`toBlob` fejler med en sikkerhedsfejl der intet siger om aarsagen. Og lange
danske ord som "fraflytningsrengoering" brydes med bindestreg - uden det loeb
de ud over kanten.

## Hvad der ikke er med endnu
- **LinkedIn.** Kaster en tydelig fejl. LinkedIn vil have billedet uploadet til
  sig først, modsat Meta der selv henter fra en URL — det er reelt arbejde.
- **Retry.** `kanGentages` skelner allerede mellem rate limits og rigtige fejl,
  men der er ingen kø der bruger det.
- **Godkendelse hos kunden.** I dag godkender administratorer. Skal kunden selv
  godkende, kræver det et ekstra adgangsniveau.
