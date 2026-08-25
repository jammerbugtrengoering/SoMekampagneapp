# Kampagneapp

Planlægger og publicerer kampagner for flere kunder på Facebook og Instagram.
Claude skriver opslagene ud fra kundens brandprofil, du godkender dem, og en
planlagt kørsel sender dem ud på det aftalte tidspunkt.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres, auth, storage) · Netlify

---

## Sådan hænger det sammen

```
Brandprofil (tone, målgruppe, må-ikke)
        │
        ▼
Kampagnebrief ──► Claude ──► opslag med tekst, hashtags, billedbrief, tidspunkt
        │
        ▼
Du redigerer + godkender  (intet går ud uden dette skridt)
        │
        ▼
Netlify cron hvert 15. min ──► /api/cron/publish ──► Facebook / Instagram
```

Alt publicering går gennem `publishToChannel()` i `src/lib/publish/index.ts`.
Skal du senere skifte fra egne Meta-kald til en aggregator som Ayrshare, er det
den ene funktion du udskifter.

---

## Kom i gang

### 1. Afhængigheder

```bash
npm install
cp .env.example .env.local
```

### 2. Supabase

Opret et projekt på [supabase.com](https://supabase.com), og kør derefter i
SQL-editoren:

1. `supabase/migrations/0001_init.sql`
2. `supabase/seed.sql` (opretter de to kunder — ret navnene til)

Opret en **public** storage bucket, fx `kampagne-assets`. Den skal være public:
Meta henter selv billedet fra URL'en og kan ikke logge ind.

Log ind i appen én gang, find dit bruger-id under Authentication → Users, og
giv dig selv adgang til begge kunder:

```sql
insert into brand_members (brand_id, user_id, role)
select id, '<dit-auth-uid>', 'owner' from brands;
```

### 3. Nøgler i `.env.local`

```bash
# Krypteringsnøgle til Meta-tokens
openssl rand -base64 32

# Hemmelighed der beskytter cron-endpointet
openssl rand -hex 32
```

Lad `PUBLISH_DRY_RUN=true` stå indtil du har set opslagene i loggen og er
tilfreds. Så er der ingen vej til at komme til at publicere ved et uheld.

### 4. Kør

```bash
npm run dev
```

---

## Meta-opsætning

Du skal have en Meta-app, men **ikke** app review — så længe du selv er admin
på de sider der publiceres til. Meta kræver kun Advanced Access (og dermed
review + business-verifikation) når appen betjener konti du ikke administrerer.

### Sådan får du tokenet

1. [developers.facebook.com](https://developers.facebook.com) → opret app af
   typen **Business**
2. Tilføj produkterne **Facebook Login for Business** og **Instagram Graph API**
3. Gå til **Meta Business Suite → Indstillinger → Systembrugere**
4. Opret en systembruger med rollen *Admin*
5. Tildel den de sider og Instagram-konti der skal publiceres til
6. **Generér token** med disse rettigheder:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`

Systembruger-tokens udløber ikke. Det er hele pointen med dem.

### Sådan finder du id'erne

```bash
# Dine sider
curl "https://graph.facebook.com/v21.0/me/accounts?access_token=TOKEN"

# Instagram-kontoen der hænger på en side
curl "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=TOKEN"
```

Indsæt page-id, ig-id og token under kunden i appen. Tokenet krypteres
(AES-256-GCM) før det rører databasen. Brug **Test forbindelse** til at
bekræfte at det virker, før du stoler på det.

### Ting der driller

| Symptom | Årsag |
|---|---|
| `(#200) Permissions error` | Tokenet mangler `pages_manage_posts`, eller systembrugeren har ikke fået tildelt siden |
| Instagram-container bliver ved `IN_PROGRESS` | Billed-URL'en kræver login, eller formatet er ikke JPEG |
| `Media ID is not available` | Der blev publiceret før containeren var færdig — koden poller, så det bør ikke ske |
| Token holdt op med at virke | Du mistede admin-rollen på siden, eller systembrugeren blev fjernet |

**Instagram kan ikke publicere uden billede.** Appen fanger det ved godkendelse
i stedet for at lade det fejle under cron-kørslen.

---

## Deploy til Netlify

```bash
netlify init
netlify deploy --prod
```

Sæt alle variabler fra `.env.example` under **Site settings → Environment
variables**. `URL` sættes automatisk af Netlify og bruges af den planlagte
funktion.

Den planlagte funktion kører hvert 15. minut og publicerer alt der er
**godkendt** og hvis tidspunkt er passeret. Kladder og opslag der afventer
godkendelse røres ikke.

---

## Test

```bash
npm run test:publish   # kryptering, dry-run, Instagram-regler — intet netværk
npm run typecheck
npm run build
```

`test:publish` kaprer `fetch` under dry-run-testen, så testen fejler hvis koden
alligevel prøver at ringe til Meta.

---

## Hvad der ikke er med endnu

- **Billedgenerering.** `image_brief` beskriver hvad billedet skal vise, men
  billedet laves ikke. `image_url` udfyldes manuelt indtil videre.
- **LinkedIn.** Stub i `src/lib/publish/linkedin.ts`. LinkedIn vil have
  billedet uploadet til sig først, i modsætning til Meta — det er reelt arbejde,
  ikke bare en ekstra streng.
- **Retry.** `GraphError.retryable` skelner allerede mellem rate limits og
  rigtige fejl, men der er ingen kø der bruger det endnu.
- **Godkendelse hos kunden.** I dag godkender du. Skal kunden selv godkende,
  skal `brand_members.role = 'viewer'` bruges til at gate handlingerne.

---

## Sikkerhed

- Meta-tokens ligger krypteret. Databasen alene er ikke nok til at overtage en
  kundes side.
- `SUPABASE_SERVICE_ROLE_KEY` bruges kun i cron-endpointet, som er låst bag
  `CRON_SECRET`. Alt brugerinitieret går gennem RLS.
- RLS er slået til på alle tabeller og hænger på `brand_members`. En bruger kan
  kun se de kunder de er tilknyttet.
