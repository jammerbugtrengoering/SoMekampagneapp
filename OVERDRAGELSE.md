# Overdragelse af kampagneappen

Fra **Team Pearl** (Jonn Tholstrup) til **Jammerbugt Rengøring**.
Version 1.0 — 12. september 2026.

Dokumentet beskriver hvad der overdrages, hvad der skal skifte ejer, hvad der
koster penge, og hvad den der overtager udviklingen skal vide for at kunne
arbejde videre uden at bryde noget.

---

## 1. Hvad appen gør

Appen planlægger, godkender og publicerer opslag på Facebook og Instagram.

En **kampagne** er en brief — fx "hovedrengøring til efteråret" — som Claude
laver et antal opslag ud fra, fordelt over en periode. Hvert opslag får tekst,
hashtags, et billede og et tidspunkt. Opslagene skal godkendes af et menneske,
og først derefter kan de publiceres. Publiceringen kan ske manuelt eller på
det planlagte tidspunkt.

Undervejs holder appen øje med det man ellers opdager for sent: at
opfordringen til handling ligger efter «Se mere» og derfor aldrig bliver læst,
at et Instagram-opslag mangler et billede og derfor vil blive afvist, at en
kanal aldrig er blevet testet.

**Alt i appen er på dansk** — kode, variabelnavne, kommentarer, fejlbeskeder.
Det er et bevidst valg. Den der overtager, bør holde fast i det; en halvt
engelsk kodebase er værre end begge dele.

---

## 2. Det der overdrages

| Del | Hvor | Bemærkning |
|---|---|---|
| Kildekode | `github.com/jammerbugtrengoering/SoMekampagneapp` | Ligger allerede under Jammerbugts GitHub-organisation |
| Hosting | Netlify — `jammerbugtsomeplanningapp.netlify.app` | Bygger automatisk ved push til `main` |
| Database og login | Supabase-projekt **SoMePlanning App** (`phloauxphbyewwjnaxcv`) | Postgres, brugerlogin og filarkiv |
| Meta-adgang | Business-portefølje med systembruger og token | Tokenet er ikke i koden — se afsnit 4 |
| Dokumentation | `README.md`, `START-HER.md` og dette dokument | Ligger i repoet |

Der er **ingen tredjepartslicenser** at overtage. Alt der bruges, er frit:
React, Vite, Supabase-klienten og lucide-ikoner.

---

## 3. Sådan er den bygget

Vite 8 + React 19 i **almindelig JSX — ingen TypeScript**. `src/App.jsx` er én
fil med alle skærmbilleder og et `styles`-objekt nederst. Det er med vilje:
appen følger samme mønster som Jammerbugts øvrige apps, så den der kender én
af dem kender dem alle. Der er ingen komponentbibliotek, ingen CSS-rammeværk
og ingen tilstandsbibliotek at sætte sig ind i.

Backend er små Netlify-funktioner i `netlify/functions/`. De findes kun fordi
tre ting ikke må ligge i browseren: Meta-tokens (krypteres serverside),
publicering (skal kunne afvises) og AI-nøgler.

Delt logik ligger tre steder, og det er værd at kende:

- **`src/prompt.js`** — prompten til Claude, formatet på svaret, og læsningen
  af det. Bruges af browseren, terminalscripterne og funktionerne, så de tre
  veje giver samme resultat. Ændrer man tonen ét sted, ændrer man den alle
  steder.
- **`src/kanalregler.js`** — hvad hver platform gør ved teksten: hvor den
  klippes, hvor mange hashtags der er tilladt, om billede er påkrævet. Både
  prompten og advarslerne læser herfra, så de ikke kan komme til at sige
  noget forskelligt.
- **`src/billeder.js`** — billedskabeloner tegnet på canvas, og upload.

### Datamodellen

```
organisation → kunde → brand → kanal
```

**Organisationen** har abonnementet og brugerne. **Kunden** er den, der laves
opslag for. **Brandet** har sin egen stemme — rengøring taler ikke som
hundevask, selvom de er samme firma. **Kanalen** er én Facebook-side eller én
Instagram-konto.

Meta-tokenet ligger på **kunden**, ikke på kanalen, fordi ét systemtoken
dækker alle sider i samme Business-portefølje. Én ting at rotere i stedet for
seks. En enkelt kanal kan overstyre, hvis en side ligger et andet sted.

### Roller og adgang

| Rolle | Må |
|---|---|
| `ejer` | Alt: kunder, tokens, medlemmer, publicering |
| `redaktoer` | Kampagner, opslag, billeder. Ikke tokens, ikke medlemmer |
| `godkender` | Se alt, og kun godkende eller afvise. Kan ikke rette teksten |

Adgangen håndhæves **i databasen**, ikke i skærmbilledet. Fem funktioner —
`har_org_adgang`, `kan_redigere`, `er_ejer`, `org_for_brand` og
`has_brand_access` — afgør alt, og samtlige regler kalder kun dem. Skal
modellen laves om, laves funktionerne om; ikke fyrre regler.

Godkenderens begrænsning er derudover en trigger på `posts`, fordi en
almindelig adgangsregel ikke kan se hvilke felter der blev ændret. Uden den
kunne en godkender omskrive teksten og godkende sin egen version.

---

## 4. Nøgler og hemmeligheder

**Ingen hemmeligheder står i dette dokument, og ingen står i koden.** De
ligger to steder: i `.env` på udviklerens maskine (filen er i `.gitignore`),
og som miljøvariabler i Netlify.

| Variabel | Hvad den gør | Hvor den hentes |
|---|---|---|
| `VITE_SUPABASE_URL` | Adressen på databasen | Supabase → Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Offentlig nøgle, må gerne stå i browseren | Samme sted |
| `SUPABASE_SECRET_KEY` | Serverside, går uden om al adgangskontrol | Supabase → Settings → API Keys |
| `TOKEN_ENCRYPTION_KEY` | Krypterer Meta-tokens i databasen | Genereres: `openssl rand -base64 32` |
| `CRON_SECRET` | Beskytter den planlagte publicering mod kald udefra | Genereres: `openssl rand -hex 32` |
| `PUBLISH_DRY_RUN` | `true` = intet sendes til Meta og intet skrives | Sættes manuelt |
| `GEMINI_API_KEY` | AI-baggrunde. Valgfri — upload og skabeloner virker uden | aistudio.google.com |
| `ANTHROPIC_API_KEY` | Kun hvis generering skal køre serverside | console.anthropic.com |

> **`TOKEN_ENCRYPTION_KEY` må aldrig skiftes uden plan.** Mister man den, kan
> ingen gemte Meta-tokens dekrypteres, og de skal indtastes forfra for hver
> kunde. Skal den udskiftes, skal tokens først læses ud, nøglen skiftes, og
> tokens gemmes igen.

**Ved overdragelsen skal alle hemmeligheder roteres.** Ikke fordi nogen har
gjort noget forkert, men fordi den afgående part har kendt dem. Se
tjeklisten i afsnit 8.

---

## 5. Sådan arbejder man med den

```bash
npm install
npm run dev          # lokalt, mod den rigtige database
npm run dev:api      # med Netlify-funktionerne (kræver netlify-cli)
npm run build        # oxlint + vite build. Fejler ved lint-fejl
npm test             # kryptering, tørkørsel, kanalregler, omskrivning
```

Node 22 eller nyere. Deploy sker ved `git push` til `main`; Netlify bygger
selv.

**Miljøvariabler i Netlify kræver et nyt build.** Alt med `VITE_` bages ind i
browserkoden på byggetidspunktet, så en ændret nøgle virker først efter et
deploy — ikke ved at genindlæse siden.

### Databaseændringer

Migrationer ligger i `supabase/migrations/` og køres med:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...    # personligt token fra Supabase
npm run db:setup
```

Scriptet holder styr på hvad der er kørt, så det kan gentages uden skade.
Nye ændringer laves som en **ny fil** med næste nummer — gamle migrationer
rettes aldrig, for de er allerede kørt hos alle.

### Administration fra terminalen

```bash
npm run org                                     # organisationer og medlemmer
npm run org:opret "Navn"                        # ny organisation
npm run org:medlem <slug|alle> <mail> <rolle>   # giv adgang eller ret rolle
npm run org:fjern <slug> <mail>                 # fjern adgang
```

Den første ejer i en ny organisation **skal** laves fra terminalen — der er
ingen ejer endnu til at invitere hende. Derefter foregår det i appen under
Medlemmer.

---

## 6. Sikkerhed — det der holder publiceringen i skak

Appen kan sende ting ud i verden på kundens vegne. Fire lag forhindrer at det
sker ved et uheld:

1. **`PUBLISH_DRY_RUN`.** Under tørkørsel skrives intet til databasen og
   sendes intet til Meta. Der findes en test for netop dette, fordi
   tørkørslen på et tidspunkt fejlagtigt markerede opslag som publicerede.
2. **Kun godkendte opslag publiceres.** Aldrig kladder, aldrig afviste.
3. **Kanaler skal testes** mod Meta før de virker.
4. **Tokens krypteres** og forlader aldrig serveren.

### To fælder, der har kostet tid

**Visninger går uden om adgangskontrollen.** En almindelig `view` i Postgres
kører med ejerens rettigheder, ikke brugerens. Visningen `kanal_med_token`
udleverede derfor alle kunders tokens til enhver der var logget ind. Det
kunne ikke ses ved at læse reglerne — kun ved at prøve. Rettet med
`security_invoker = on`. **Nye visninger skal have det samme.**

**Adgangskontrollen skal også ligge i funktionerne.** Netlify-funktionerne
kører med en nøgle der går uden om databasens regler. Beskytter man kun
browseren, er en redaktør reelt ejer i det øjeblik hun kalder API'et direkte.
Derfor spørger hver funktion selv gennem `kraevOrgRolle()`.

### Testen der skal køres efter enhver ændring i adgang

```bash
# mod en engangsdatabase — ALDRIG mod produktion
docker run --rm -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres npm run test:adskillelse
```

Den bygger databasen op fra migrationerne og forsøger derefter at bryde ind:
kan den ene kunde læse eller skrive den andens data? 29 kontroller, og de
skal alle afvises af databasen. Den fandt en rigtig fejl første gang den
kørte.

---

## 7. Meta — det vigtigste forbehold

Appen publicerer i dag uden at have været gennem Metas app-godkendelse. Det
er tilladt, **fordi den der ejer Meta-appen selv er administrator på de sider
der publiceres til**.

Det har to konsekvenser for overdragelsen:

1. **Meta-appen og systembrugeren skal flyttes** til Jammerbugts egen
   Business-portefølje, eller oprettes på ny der. Sker det ikke, hænger
   publiceringen i en konto Jammerbugt ikke styrer.
2. **Skal appen en dag bruges til sider I ikke selv administrerer** — fx hvis
   den sælges videre til andre foreninger eller virksomheder — kræver det
   Advanced Access, app review og virksomhedsverificering hos Meta. Regn med
   uger, ikke dage. Det bør startes i god tid før der er en kunde der venter.

Modellen i appen er allerede bygget til det: flere organisationer kan bo i
samme installation uden at kunne se hinanden, og det er afprøvet. Det er
alene Metas godkendelse der mangler.

---

## 8. Tjekliste til selve overdragelsen

Rækkefølgen er med vilje: adgang først, så nøgler, så afsked.

**GitHub**
- [ ] Jammerbugt har ejerrollen i organisationen `jammerbugtrengoering`
- [ ] Team Pearls adgang fjernes, når resten er gennemført

**Netlify**
- [ ] Sitet overføres til Jammerbugts Netlify-konto (Site settings → Transfer)
- [ ] Betalingsoplysninger skiftes
- [ ] Alle miljøvariabler er sat i den nye konto, og et build er kørt

**Supabase**
- [ ] Projektet overføres til Jammerbugts organisation, eller Jammerbugt får
      ejerrollen i den nuværende
- [ ] Betalingsoplysninger skiftes
- [ ] `SUPABASE_SECRET_KEY` og publishable key roteres, og Netlify opdateres
- [ ] Personlige adgangstokens tilhørende Team Pearl tilbagekaldes

**Meta**
- [ ] Business-portefølje, app og systembruger ejes af Jammerbugt
- [ ] Nyt systemtoken genereres og indsættes på kunden i appen
- [ ] **Test alle kanaler** giver grønt lys for hver side

**Nøgler der skal roteres ved overdragelsen**
- [ ] `SUPABASE_SECRET_KEY`
- [ ] `CRON_SECRET`
- [ ] Meta-systemtoken
- [ ] `GEMINI_API_KEY` og `ANTHROPIC_API_KEY`, hvis de er i brug
- [ ] `TOKEN_ENCRYPTION_KEY` — **kun** efter proceduren i afsnit 4

**Brugere i appen**
- [ ] Jammerbugts egne folk er oprettet og har roller
- [ ] Team Pearls brugere fjernes: `npm run org:fjern <slug> <mail>`
- [ ] Mindst én ejer tilbage i hver organisation (appen nægter at fjerne den
      sidste)

**Efter overdragelsen**
- [ ] `npm run build && npm test` kører grønt hos den nye ejer
- [ ] Et testopslag er publiceret med `PUBLISH_DRY_RUN=true` og set i loggen
- [ ] Først derefter sættes `PUBLISH_DRY_RUN=false`

---

## 9. Kendt gæld og næste skridt

Intet af det følgende forhindrer drift, men det bør kendes.

**Oprydning**
- To dublerede brands under Jammerbugt Rengøring skal ryddes op. Kanalen
  slettes først, derefter brandet.
- `netlify/functions/scheduled-publish.ts` er en rest fra første udgave og
  bruges ikke. Kan slettes.
- Tabellen `app_admins` bruges ikke længere til adgang. Den kan fjernes i en
  fremtidig migration, når man er sikker på at intet læser den.

**Teknisk gæld**
- `TOKEN_ENCRYPTION_KEY` er fælles for alle organisationer. Det holder til to
  kunder; skal appen sælges bredt, bør hver organisation have sin egen nøgle.
- `organisations` har felterne `plan`, `maks_kunder` og `maks_opslag`, men
  intet håndhæver dem endnu. Der er ingen fakturering.
- Fem advarsler fra oxlint af typen "setState i en effect". De er bevidste —
  det er datahentning — men bør ses igennem hvis React skifter adfærd.

**Muligheder**
- LinkedIn er forberedt i `kanalregler.js`, men ikke implementeret.
- Statistik efter publicering (rækkevidde, reaktioner) findes ikke. Meta kan
  levere det; det er ikke bygget.

---

## 10. Support og ansvar

Team Pearl har bygget appen frem til denne dato. Efter overdragelsen ligger
drift, videreudvikling og ansvar for publiceret indhold hos Jammerbugt
Rengøring.

Aftal skriftligt, hvad der gælder efter overdragelsen: om der er en periode
med spørgsmål, hvem der kan kontaktes, og hvornår adgangen i afsnit 8
lukkes. Dette dokument beskriver løsningen — ikke aftalen om den.

Den der overtager udviklingen, bør starte med `README.md` og
`START-HER.md` i repoet. De to går i dybden med henholdsvis opsætning og den
løbende udvikling.
