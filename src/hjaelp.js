/* =====================================================================
   Hjælpeteksterne — én pr. side.

   Skrevet til den der bruger appen, ikke til den der har bygget den.
   Ingen kommandoer, ingen tabelnavne, ingen miljøvariabler: rammer man
   noget der kræver en terminal, er svaret «sig til ejeren», for det er
   sandheden for alle andre end Jonn.

   De ligger i koden og ikke i databasen med vilje. De handler om hvordan
   appen virker, ikke om den enkelte organisation — og en tekst der kan
   redigeres to steder bliver forkert ét af dem.

   Formen er fast: et svar på «hvad er det her for en side», nogle
   punkter om det man faktisk gør, og til sidst det folk render ind i.
   ===================================================================== */

export const HJAELP = {
  kalender: {
    titel: "Kalenderen",
    intro:
      "Alle planlagte opslag på tværs af kampagner, måned for måned. Det er stedet " +
      "hvor du ser rytmen: om der er huller, og om tre opslag ligger oven i hinanden.",
    punkter: [
      ["Klik på et opslag", "åbner kampagnen det hører til, så du kan rette eller godkende det."],
      ["Farven", "er brandets. Har du flere kunder, kan du se hvem der fylder hvornår."],
      ["Pilene ved måneden", "bladrer frem og tilbage. Opslag i fortiden bliver stående."],
    ],
    bemaerk:
      "Et opslag i kalenderen er ikke det samme som et opslag der bliver sendt. " +
      "Det skal være godkendt først — se «Kampagner».",
  },

  ny: {
    titel: "Ny kampagne",
    intro:
      "Her beskriver du hvad en serie opslag skal handle om, og får Claude til at " +
      "skrive udkastene. Der bliver ikke publiceret noget — alt kommer ind som kladder.",
    punkter: [
      ["Brief", "det vigtigste felt. Skriv det som du ville sige det til en kollega, i hele sætninger. Jo mere konkret, jo mindre generisk bliver teksten."],
      ["Afsender", "hvem der skriver. Den samme viden fortalt af en der har bygget noget og en der har ryddet op efter det giver to forskellige opslag."],
      ["Strategi og vinkler", "planen for serien som helhed, og grebene i de enkelte opslag. Vælger du ingen, vælger Claude selv."],
      ["Sprog", "dansk eller engelsk. Fagligt indhold på LinkedIn når typisk længere på engelsk."],
      ["Gem uden at køre", "lægger briefen til side, så du kan skrive den færdig nu og generere senere."],
      ["Antal opslag", "retter du noget i briefen efter at have bygget prompten, forsvinder prompten, og du bygger den igen. Har Claudes svar ikke det antal opslag, du bad om, siger appen det, før noget bliver oprettet."],
    ],
    bemaerk:
      "Det du skriver bliver husket i browseren, indtil kampagnen er gemt. " +
      "Lukker du fanen ved et uheld, er briefen der stadig.",
  },

  kampagner: {
    titel: "Kampagner",
    intro:
      "Her læser, retter og godkender du opslagene. Intet bliver sendt før du har " +
      "godkendt det — og robotten sender det først på det tidspunkt der står.",
    punkter: [
      ["Fanerne", "Alle, Afventer, Godkendt, Publiceret. «Afventer» er alt det der ikke er sluppet igennem endnu."],
      ["Markér flere", "sæt flueben og godkend dem samlet. Opslag der mangler et billede til Instagram springes over, og du får det at vide."],
      ["Forhåndsvis", "viser opslaget som det ser ud i feedet, inklusive hvor teksten bliver klippet på mobil."],
      ["Links og QR-kode", "på Facebook kan man trykke på et link i teksten. På Instagram kan man ikke, så linjer med links tages ud dér, og forhåndsvisningen viser det. Vil du have en vej ind fra Instagram, så lav billedet under «Skabelon» med en QR-kode — den kommer nederst til højre."],
      ["Ret kampagnen", "skriv serien om, flyt den i tid, skift kanaler, lav en artikel — eller slet den."],
      ["Artikel", "samler hele serien til ét stykke du kan lægge i LinkedIns «Write article»."],
    ],
    bemaerk:
      "Under hvert godkendt opslag står hvornår det sendes. Står der at det skulle " +
      "være sendt, men ligger der endnu, er der noget galt i opsætningen — sig til ejeren.",
  },

  kunder: {
    titel: "Kunder",
    intro:
      "Kunden er den du skriver for. Under kunden ligger et eller flere brands, og " +
      "under brandet ligger kanalerne — den Facebook-side eller LinkedIn-profil der " +
      "faktisk bliver publiceret til.",
    punkter: [
      ["Kunde", "stamkortet: kontaktperson, aftale, og de regler der gælder alle kundens brands."],
      ["Brand", "tone, målgruppe, og hvad der ikke må skrives. Det er her teksterne får deres stemme."],
      ["Må ikke", "udfyld den. Er den tom, har Claude ingen grænser at holde sig indenfor."],
      ["Eksempel-opslag", "tre rigtige opslag siger mere om tonen end alle adjektiver tilsammen."],
      ["Kanaler", "forbind Facebook, Instagram eller LinkedIn. Uden en kanal kan et opslag ikke sendes nogen steder hen."],
    ],
    bemaerk:
      "Har du ingen brands endnu, kan du ikke lave en kampagne. Opret kunden først, " +
      "så brandet under den.",
  },

  afsender: {
    titel: "Afsender",
    intro:
      "Det der gælder på tværs af alle kampagner: hvem der skriver, hvad planen kan " +
      "være, og hvordan der skrives. Ret det her, og det slår igennem næste gang du " +
      "laver en kampagne.",
    punkter: [
      ["Arketyper", "roller du kan skrive fra. Skriv beskrivelsen i anden person — det er den rolle Claude skal VÆRE, ikke en den skal beskrive."],
      ["Strategi", "kampagnestrategier fordeler serien; vinkler er grebene i det enkelte opslag. Begge kan rettes og udvides."],
      ["Sprog", "udgangspunktet for nye kampagner. Eksisterende kampagner beholder deres eget."],
      ["Retningslinjer", "står først i hver eneste prompt. Lad feltet stå tomt for at bruge de indbyggede."],
    ],
    bemaerk:
      "Kun ejeren kan gemme her. Sker der ingenting når du trykker Gem, er det " +
      "som regel det der er på spil.",
  },

  medlemmer: {
    titel: "Medlemmer",
    intro:
      "Hvem der har adgang, og hvad de må. En person ser kun data i de organisationer " +
      "hun er medlem af — det håndhæves i databasen, ikke af skærmbilledet.",
    punkter: [
      ["Ejer", "alt: kunder, tokens, medlemmer, retningslinjer."],
      ["Redaktør", "skriver og retter indhold. Rører ikke kanaler og adgangskoder."],
      ["Godkender", "må kun godkende eller afvise — ikke omskrive teksten først."],
    ],
    bemaerk:
      "Findes personen ikke i forvejen, sender Supabase en invitation, og hun vælger " +
      "selv sin adgangskode. Du får den aldrig at se, og det er med vilje.",
  },
};

/** Faldback, så en ny side aldrig giver en tom hjælpeboks. */
export const HJAELP_STANDARD = {
  titel: "Hjælp",
  intro: "Der er ingen hjælpetekst til denne side endnu.",
  punkter: [],
  bemaerk: "",
};
