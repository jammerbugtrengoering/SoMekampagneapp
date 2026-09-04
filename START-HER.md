# Start her

Overleveringsnotat, så en ny samtale kan fortsætte uden at starte forfra.
Skrevet 3. september 2026.

Åbn en ny chat, vedhæft eller peg på denne fil, og skriv fx:

> Læs START-HER.md i ~/SoMekampagneapp. Vi fortsætter derfra — næste opgave er …

---

## Hvad appen er

Kampagneapp til sociale medier for to kunder: **Jammerbugt Rengøring**
(erhverv, nøgtern tone) og **PGU** (forening, varm tone). Den planlægger
kampagner, skriver opslag med Claude, sætter billeder på, viser en
forhåndsvisning der ligner feedet, og publicerer til Facebook og Instagram.

Ejeren er Jonn Tholstrup, Team Pearl. Charlotte Thorsager Kronborg er med som
bruger. Ambitionen er at kunne sælge løsningen til andre foreninger og
virksomheder — derfor er den bygget om til at kunne rumme flere kunder i
samme installation.

**Alt i appen er på dansk.** Kode, variabelnavne, kommentarer, fejlbeskeder.
Det er bevidst og skal holdes.

## Hvor tingene er

| | |
|---|---|
| Kode | `~/SoMekampagneapp` på Jonns Mac |
| Git | `github.com/jammerbugtrengoering/SoMekampagneapp` |
| Hosting | Netlify — `jammerbugtsomeplanningapp.netlify.app` |
| Database | Supabase-projekt **SoMePlanning App**, ref `phloauxphbyewwjnaxcv` |

Andre apps efter samme mønster: `~/planapp` og `~/medarbejder-app`.

## Sådan er den bygget

Vite 8 + React 19 + **almindelig JSX, ingen TypeScript**. `src/App.jsx` er én
stor fil på ~3.400 linjer med alle komponenter og et `styles`-objekt nederst
— samme mønster som de andre apps, og det skal det blive ved med at være.
oxlint kører før build. Backend er Netlify-funktioner i `netlify/functions/`.

Delt logik ligger i:

- `src/prompt.js` — prompten, skemaerne og læsningen af Claudes svar. Bruges
  af browseren, scripterne og funktionerne, så de tre veje giver samme
  resultat.
- `src/kanalregler.js` — hvad hver platform gør ved teksten (klipgrænser,
  hashtag-lofter, billedkrav). Ét sted, så prompt og advarsler ikke kan
  komme til at sige noget forskelligt.
- `src/billeder.js` — canvas-skabeloner og upload.

## Datamodellen

```
organisation → kunde → brand → kanal
```

Organisationen har abonnementet og brugerne. Kunden er den, der laves opslag
for. Brandet har sin egen stemme (rengøring taler ikke som hundevask).
Kanalen er én Facebook-side eller én Instagram-konto.

Meta-tokenet ligger på **kunden**, fordi et systemtoken hører til en
Business-portefølje og dækker alle de sider det er tildelt. En enkelt kanal
kan overstyre med sit eget.

### Roller

| Rolle | Må |
|---|---|
| `ejer` | Alt: kunder, tokens, medlemmer, publicering |
| `redaktoer` | Kampagner, opslag, billeder. Ikke tokens, ikke medlemmer |
| `godkender` | Se alt, og kun godkende eller afvise. Kan ikke rette teksten |

Håndhæves i databasen gennem fem funktioner — `har_org_adgang`,
`kan_redigere`, `er_ejer`, `org_for_brand`, `has_brand_access` — som alle
politikker kalder. Skal modellen ændres, ændres funktionerne, ikke fyrre
politikker. Godkenderens begrænsning er desuden en trigger på `posts`, for en
RLS-politik kan ikke se hvilke felter der ændrede sig.

Netlify-funktionerne kører med secret key uden om RLS og spørger derfor selv
gennem `kraevOrgRolle()` i `netlify/functions/_lib/supabase.js`.

Migrationer ligger i `supabase/migrations/`, senest `0005_organisationer.sql`.

## Kommandoer

```bash
npm run dev                  # lokalt
npm run dev:api              # med Netlify-funktioner (kræver netlify-cli)
npm run build                # oxlint + vite build
npm test                     # kryptering, tørkørsel, kanalregler, omskrivning

npm run db:setup             # kører migrationer — kræver SUPABASE_ACCESS_TOKEN
npm run org                  # organisationer, kunder og medlemmer
npm run org:medlem <slug|alle> <mail> <ejer|redaktoer|godkender>
npm run kampagne             # ny kampagne gennem Claude-abonnementet
npm run ret                  # ret en eksisterende kampagne
npm run kanal                # kanaler fra terminalen

# mod en engangsbase, ALDRIG produktion
TEST_DATABASE_URL=postgres://... npm run test:adskillelse
```

`test:adskillelse` bygger basen op fra migrationerne og prøver derefter at
bryde ind: kan den ene kunde læse eller skrive den andens data? 29
kontroller. Den fangede en rigtig fejl første gang den kørte, og skal køres
igen hver gang adgangsmodellen røres.

## Sikkerhed — det der faktisk holder publiceringen i skak

1. `PUBLISH_DRY_RUN` i miljøet. Under tørkørsel skrives **intet** til
   databasen og der sendes intet til Meta. Der er en regressionstest for det,
   fordi tørkørsel på et tidspunkt fejlagtigt markerede opslag som
   publicerede.
2. Kun godkendte opslag publiceres.
3. Kanaler skal testes mod Meta før de virker.
4. Tokens krypteres med `TOKEN_ENCRYPTION_KEY` og forlader aldrig serveren.

**Fælde værd at kende:** en almindelig visning i Postgres kører med *ejerens*
rettigheder og går uden om RLS. `kanal_med_token` udleverede derfor alle
kunders tokens til enhver der var logget ind. Rettet med
`security_invoker = on` i 0005. Laves der nye visninger, skal de have det
samme.

## Hvad der er gjort for nylig

- Organisationer, roller og medlemskab (migration 0005) med adskillelsestest
- Organisationsvælger, rollebadge og medlemsside i appen
- Alle funktioner lagt om til `kraevOrgRolle`; `kraevAdmin` og app_admins
  bruges ikke længere til adgang
- `npm run org` og `org:medlem` i terminalen
- Ret en hel kampagne: felter, kanaler, flyt til anden kunde, flyt i tid,
  skriv om, ny brief
- Klipgrænsen (Facebook 175 tegn, Instagram 125) er nu med i prompten, ikke
  kun i advarslen bagefter
- Forhåndsvisningen folder som feedet, med klikbart «Se mere»
- Kalendergitteret rettet (`minmax(0, 1fr)` — `1fr` lod en dag med indhold
  skubbe sin kolonne bredere)
- Nyt ikon: taleboble med ur, i `public/favicon.svg`
- Slet kunde, slet tomt brand, slet kanal — alle med optælling og med
  publiceret indhold som stopklods

## Hvad der udestår

**Nu:**

1. Ryd op i dubletterne under Jammerbugt Rengøring. Brandet "Jammerbugt
   Rengøring slet" skal have sin kanal slettet først, derefter brandet.
   Slutmålet er tre brands — rengøring, hundevask, vaskeri — med hver en
   Facebook- og en Instagram-kanal.
2. Charlotte skal have rolle i de organisationer hun skal arbejde i.
   Overvej `redaktoer` frem for `ejer`, hvis hendes arbejde er indholdet og
   ikke Meta-adgangen.
3. `netlify/functions/scheduled-publish.ts` er en rest fra første udgave og
   bruges ikke. Den bør slettes.

**Før der publiceres for alvor:**

4. Meta-systemtokens sat op per kunde og testet mod alle kanaler.
5. `PUBLISH_DRY_RUN=false` — men først efter proceduren i README under
   "Før du går live".
6. `GEMINI_API_KEY` hvis AI-baggrunde skal bruges. Uden den virker upload og
   skabeloner stadig.

**Før løsningen sælges:**

7. **Meta App Review og virksomhedsverificering.** I dag slipper vi for det,
   fordi Jonn selv er administrator på siderne. Fremmede kunders sider kræver
   Advanced Access. Tager uger — bør startes parallelt med alt andet.
8. Databehandleraftale med hver kunde.
9. `TOKEN_ENCRYPTION_KEY` er fælles for alle organisationer. Holder til to
   kunder, skal være en nøgle per organisation inden der er tyve.
10. Abonnement og fakturering. `organisations` har allerede `plan`,
    `maks_kunder` og `maks_opslag`, men intet håndhæver dem endnu.
11. AI-forbrug per organisation. Jonns eget Claude-abonnement kan ikke bære
    andres brug.

**Sikkerhedsgæld fra tidligere:**

12. Rotér Brevo-nøglen, der ligger i Planning-Apps git-historik (commits
    7ff7276 og f958963).
13. Rotér det `SUPABASE_ACCESS_TOKEN` der blev delt i chatten.
14. Overvej at regenerere `TOKEN_ENCRYPTION_KEY`; den har været på et
    skærmbillede.

## Sådan arbejder vi

- Filer bygges og testes i skyen, pakkes som `.tgz` og lægges over på Macen,
  hvor Jonn selv kører `npm run build`, `npm test` og `git push`.
- Kør ikke `git` i Jonns mapper fra en sandkasse — det har efterladt en
  `.git/index.lock` før.
- Jonn spørger gerne "er alt det her nødvendigt". Svar ærligt, og skær væk
  hvad der ikke bæres af en grund.
- Fejlbeskeder skal sige hvad man gør, ikke hvad der gik galt teknisk.
- macOS' `tar` er bsdtar og kender ikke `--overwrite`.
- zsh læser ikke `#` som kommentar i en interaktiv linje — send aldrig
  kommandoer med efterstillede kommentarer.
