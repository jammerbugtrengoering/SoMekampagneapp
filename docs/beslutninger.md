# Beslutninger

Hvorfor tingene er som de er. Tilføj nederst; ret aldrig en gammel post —
skriv en ny der afløser den, og lad den gamle stå med en note.

Hver post svarer på: hvad blev valgt, hvad var alternativet, og hvad ville
gå galt hvis nogen lavede det om uden at vide det.

---

## 1 · Browseren taler direkte med databasen

Der er ingen API foran Postgres. Browseren læser og skriver gennem
Supabase, og rækkeadgangsregler i databasen afgør hvad brugeren må se.
Netlify-funktionerne er ikke et lag foran databasen — de er en sidevej til
det der kræver en hemmelighed.

**Alternativet** var en server foran alting. Den ville skulle gentage
adgangsreglerne i kode, og så findes de to steder der kan blive uenige.
Her står de ét sted, i den eneste instans der ikke kan omgås.

**Hvis nogen laver det om:** hver ny tabel skal have RLS slået til og en
politik fra dag ét. En tabel uden politik er enten usynlig eller åben —
aldrig det man troede.

---

## 2 · Adgang gives kun ét sted

`org_members` er det eneste sted et menneske får adgang. Alt andet udledes
ned gennem kæden: organisation → kunde → brand → kanaler, kampagner,
opslag, billeder. Fem funktioner i databasen oversætter kæden til ja/nej:
`har_org_adgang`, `kan_redigere`, `er_ejer`, `org_for_brand`,
`has_brand_access`.

**Hvorfor det betyder noget:** det var kravet om at Bo skulle kunne bruge
samme kodebase uden at se Jonns data. Havde det stået i appen i stedet for
i databasen, ville ét glemt filter have lækket alt.

`supabase/tests/adskillelse.sql` holder øje — 52 tjek.

---

## 3 · Migrationer kører ikke som del af et deploy

`npm run db:setup` køres i hånden fra din Mac mod Supabases
management-API.

**Alternativet** var at køre dem ved hvert build. Så ville databasen ændre
sig på et tidspunkt ingen havde valgt, og et rullet build ville efterlade
et skema der ikke passer til koden.

**Prisen** er at koden kan være ude før skemaet er. Symptomet er
`Could not find the 'x' column ... in the schema cache`. Appen oversætter
den fejl til "kør db:setup" — se `manglerMigration()` i `src/App.jsx`.

---

## 4 · Tørkørsel er standard

`PUBLISH_DRY_RUN !== 'false'` betyder tørkørsel. Man skal aktivt slå
sikringen fra for at sende noget.

Og en tørkørsel **efterlader ingen spor i databasen**. Markerede den
opslaget som publiceret, ville kalenderen lyve, og opslaget ville blive
sprunget over den dag man går live. Det er den detalje der gør en
tørkørsel gentagelig i det uendelige.

---

## 5 · Tokens krypteres i databasen

LinkedIn- og Meta-tokens ligger som AES-256-GCM med
`TOKEN_ENCRYPTION_KEY`, der kun findes i Netlify. Læses rækkerne ud, er de
stadig ulæselige.

---

## 6 · LinkedIns OAuth-state ER adgangskontrollen

Callbacket fra LinkedIn er et redirect uden session. Alligevel skriver det
et token ind hos en bestemt kunde. Derfor bærer `state` en HMAC-signatur
med ti minutters levetid og en nonce. Kunne den forfalskes, kunne enhver
få sit eget LinkedIn-token skrevet ind hos en fremmed kunde og derefter
publicere på dennes vegne.

`scripts/test-linkedin-state.mjs` — 11 tests står vagt om netop det.

---

## 7 · Prompterne ligger i `src/prompt.js`, fri for platform-API'er

Samme fil importeres af browseren, af Netlify-funktionerne og af
kommandolinjescripts. Det er kun muligt fordi den hverken bruger
browser-API'er eller Node-API'er.

**Hvis nogen laver det om:** et enkelt `window.` eller `fs` i den fil
brækker to af de tre kaldere, og først når de køres.

---

## 8 · Sproget står som sit eget felt, ikke i retningslinjerne

`campaigns.sprog` og `organisations.sprog`, ikke en linje i den
redigerbare retningslinjetekst.

Sproget er et valg per kampagne, ikke én gang for alle. Og det må ikke
kunne redigeres væk ved et uheld: skriver man sine egne retningslinjer og
glemmer linjen, får man pludselig opslag på det sprog briefen tilfældigvis
var skrevet på.

Derfor står sprogkravet **sidst** i prompten, efter retningslinjerne — så
det vinder over en gammel gemt tekst der stadig siger "skriv på dansk".

---

## 9 · FLUX får engelsk, Gemini får dansk

Cloudflares billedmodel bruger T5 som tekstencoder, trænet på et
overvejende engelsk korpus. Dansk virker delvist og svigter på de konkrete
substantiver der bærer billedet. Derfor oversættes beskrivelsen af en
lille sprogmodel på samme konto og samme gratis kvote, før den går til
FLUX.

Billedbriefen på opslaget bliver **ikke** rørt — den er skrevet på dansk
med vilje, fordi det er fotografen der læser den. Det er kun prompten der
skifter sprog.

Fejler oversættelsen, går den danske tekst videre uændret. Et lidt ringere
billede slår intet billede.

---

## 10 · Artiklen er et felt på kampagnen, ikke en række i `posts`

LinkedIns artikelplatform kan ikke skrives til gennem API'et — Posts API
kan tekst, billeder, video, dokumenter og *links* til artikler, men ikke
"Write article". Artiklen kopieres derfor i hånden.

Den er heller ikke et opslag: den publiceres aldrig af appen, har ingen
kanal, intet tidspunkt og ingen godkendelse. Et felt på kampagnen
fortæller sandheden om hvad det er.

---

## 11 · Fem afhængigheder i drift

React, react-dom, `@supabase/supabase-js`, lucide-react og
`qrcode-generator` (siden 4.10.2026). Krypteringen, LinkedIn-klienten,
Meta-klienten, billedbehandlingen og prompterne er skrevet i projektet.

Det er et valg. Hver pakke er noget der skal holdes ved lige, og appen har
ikke brug for flere. Overvej det samme før den næste tilføjes.

QR-koder kom med, fordi en QR-kode ikke er noget man skriver selv: Reed-Solomon
og maskevalg er præcis den slags, der ser rigtigt ud og ikke kan scannes.
`qrcode-generator` er valgt, fordi den har ingen egne afhængigheder og er
synkron. Til tests ligger `jsqr` som dev-afhængighed, så en kode afkodes af en
uafhængig læser og ikke af den, der lavede den.

---

## 12 · Links og QR-kode: teksten er pr. kanal, billedet er fælles (4.10.2026)

Et opslag har én tekst og ét billede, men kanalerne kan ikke det samme.
Facebook gør links i teksten klikbare. Instagram gør det ikke, så et link dér
er støj, og en etiket som «Bliv ringet op:» uden sit link er værre.

`tekstTilKanal` i `kanalregler.js` bruges både af forhåndsvisningen og af
publiceringen. Facebook og LinkedIn får teksten uændret. Instagram får alle
linjer med et link taget ud (hele linjen, ikke kun linket). Er der en QR-kode i
billedet, står der «Scan koden i billedet.» der, hvor den første linje stod.
Teksten i databasen røres ikke.

Om billedet har en kode, står i **filnavnet**: `…-qr.jpg` (`harQr`). Det er en
navngivning og ikke en kolonne, fordi forhåndsvisning og server kun har
`image_url`, og fordi en kolonne kræver en migration, der køres i hånden mod
Jammerbugts database. Prisen er, at et billede, der omdøbes i bucket'en, mister
mærket. Skabelonen (Billede → Skabelon) lægger koden nederst til højre med
linket fra opslagsteksten som udgangspunkt.

Facebook får samme billede og dermed også koden. Det er overflødigt men
harmløst, og alternativet var to billeder pr. opslag.

