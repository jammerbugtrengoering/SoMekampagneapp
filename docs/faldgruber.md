# Faldgruber

Fejl der **ikke lignede fejl**. Fælles for dem alle: intet kastede en
exception, intet blev rødt, og alt så rigtigt ud imens.

Det er derfor de står her og ikke bare i en commit-besked. Hver af dem
kostede tid, fordi symptomet pegede det forkerte sted hen.

Tilføj nederst når en ny dukker op — og skriv en test samtidig, hvis den
kan testes.

| # | Symptom | Faktisk årsag | Fanget af nu |
|---|---|---|---|
| 1 | Build grøn, appen tom i browseren | Byggede uden `.env`. Vite indlejrede `undefined`, appens tidlige `return` blev konstant, alt blev bortoptimeret. Bundle 240 kB i stedet for 580 kB | Byg altid med dummy-`.env`, og tjek bundle-størrelsen |
| 2 | `ON CONFLICT` fejlede i appen, migrationen var grøn | Partielle unikke indekser. `ON CONFLICT (kolonne)` kan ikke udlede et partielt indeks, og PostgREST kan ikke sende prædikatet. Migrationen testede skemaet, aldrig appens faktiske forespørgsel | Migration 0008. Test skemaet med den forespørgsel der reelt køres |
| 3 | Gemte retningslinjer forsvandt ved genindlæsning | `hentAlt()` hentede kunder, brands og opslag — men aldrig organisationen. Den blev hentet én gang ved login og stod stille | `hentOrgs()` kaldes nu inde i `hentAlt()` |
| 4 | Gem så ud til at lykkes, men intet blev gemt | Supabase svarer 204 ved både "rettede én række" og "rettede nul". En rækkeadgangsregel der siger nej ser præcis ud som succes | `.select()` på hver update, og en besked når nul rækker kom tilbage |
| 5 | Planlagt funktion "Scheduled", kørte hvert kvarter, 49 ms, gjorde ingenting | Vores egen spærre krævede headeren `x-nf-event: schedule`, som ikke er dokumenteret for v2-funktioner. Netlifys scheduler blev afvist med 403 — og afvisningen loggede ikke | `scripts/test-planlagt.mjs`, 8 tests. **Og hver afvisning logges nu** |
| 6 | Opslag blev sprunget over hvert kvarter, resten af sin levetid | Opslag uden kanalrækker gav en tom liste. `[].every()` er sand, så loggen talte det som *udgivet* | Kaster nu en rigtig fejl. Kortet siger det også |
| 7 | Kopiér-knappen indsatte `[object Object]` | `onClick={kopier}` på en funktion der tager teksten som argument. React sendte klik-hændelsen ind, og `writeText` lavede den om til en streng uden at brokke sig | Typetjek i `kopier()` |
| 8 | "Brug forslaget" gjorde ingenting | Svaret havde et ægte linjeskift inde i en JSON-streng → ugyldig JSON. **Og** fejlen blev vist i dialogens fælles felt i toppen, langt uden for skærmen | Udtræk med regex som fald-tilbage, og et fejlfelt ved selve knappen |
| 9 | Hooks efter et tidligt `return` | Virker i al test. Crasher først når listen skifter mellem tom og ikke-tom, hos brugeren | Gennemgang af komponenterne efter ændringer i `App.jsx`. oxlint fanger det ikke |
| 10 | Krogtjekket så ud til at virke på engelske opslag | Klichéerne og de almene vendinger var kun danske. Ingen falske positive — og heller ingen dækning | Engelske mønstre tilføjet i `kanalregler.js` |
| 11 | Ny kampagne fejlede med `Could not find the 'sprog' column` | Migrationen var ikke kørt. Koden var ude før skemaet | Ventet — se beslutning 3. Beskeden oversættes nu til "kør db:setup" |
| 12 | `db:setup` fejlede dagen efter den virkede | `export SUPABASE_ACCESS_TOKEN=…` lever kun i det ene terminalvindue | Tokenet læses nu også fra `.env` |
| 13 | Topbjælken havde `position: sticky` og rullede alligevel væk | En forfæder (`styles.app`) havde `overflowX: "hidden"`. En forfæder med `overflow` ≠ `visible` bliver selv rullebeholderen, så bjælken klæbede til en kasse der aldrig ruller. Ingen advarsel, hverken i browseren eller i lint | `overflowX` flyttet ned på siden selv. Regel: `overflow` på en forfæder og `sticky` på et barn kan ikke begge dele |

---

## Mønsteret

Tolv af tretten gav **intet signal**. Det er ikke tilfældigt: et system der
fejler højlydt er nemt at rette. Det der koster, er noget der lykkes uden
at gøre det rigtige.

Derfor to regler i dette repo:

1. **En handling der ikke gjorde noget, skal sige det.** Nul rækker rettet
   er ikke succes. En afvist forespørgsel er ikke stilhed.
2. **En spærre der afviser, skal logge.** En sikkerhedsspærre der afviser
   i stilhed er ikke en spærre — det er en fælde man selv falder i.
