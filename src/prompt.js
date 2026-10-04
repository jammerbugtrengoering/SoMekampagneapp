/* =====================================================================
   Prompten og læsningen af svaret — ét sted.

   Bruges tre steder, og skal give samme resultat alle tre:
     - browseren, når du kopierer prompten manuelt
     - scripts/kampagne.mjs, der kører den gennem dit Claude-abonnement
     - netlify/functions/generer-kampagne.js, når vi skifter til API-nøgle

   Ren JavaScript uden browser-API'er, så Node kan importere den direkte.
   ===================================================================== */

import { REGLER } from "./kanalregler.js";

export const KANALER = ["facebook", "instagram", "linkedin"];

/**
 * Fortæller modellen hvor teksten bliver klippet i feedet.
 *
 * Uden det her skriver den som om hele opslaget bliver læst: stemning
 * først, pointe til sidst. Det er god tekst i et dokument og dårlig tekst i
 * et feed, hvor mobilen folder alt efter 175 tegn på Facebook og 125 på
 * Instagram. Forhåndsvisningen har fanget det bagefter og bedt dig rette i
 * hånden hver gang — det er en regel modellen selv skal kende.
 *
 * Tallene hentes fra kanalregler.js, så de kun står ét sted. Flytter
 * Facebook grænsen, flytter både advarslen og prompten sig med.
 */
function klipRegler(kanaler) {
  const linjer = (kanaler ?? [])
    .map((k) => REGLER[k])
    .filter(Boolean)
    .map((r) => `- ${r.navn}: de første ${r.klipMobil} tegn vises på mobil. Resten ligger bag «Se mere».`);

  if (!linjer.length) return "";

  const mindst = Math.min(
    ...(kanaler ?? []).map((k) => REGLER[k]?.klipMobil).filter(Boolean),
  );

  return `SÅDAN BLIVER TEKSTEN KLIPPET — skriv efter det:
${linjer.join("\n")}

- Opfordringen til handling skal stå INDEN klippet. Skriv, ring, book, tilmeld,
  telefonnummer, mailadresse: det hører til i de første ${mindst} tegn, ikke i sidste afsnit.
- Første sætning skal kunne stå alene og gøre det værd at trykke «Se mere».
- Det der står efter klippet, er uddybningen — ikke pointen.`;
}

/** JSON Schema til `claude -p --json-schema`. Samme form som vi selv validerer. */
export const KAMPAGNE_SKEMA = {
  type: "object",
  properties: {
    opslag: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tekst: { type: "string" },
          krog_alt: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          billedbrief: { type: "string" },
          dag: { type: "integer" },
          klokke: { type: "string" },
          kanaler: { type: "array", items: { type: "string", enum: KANALER } },
        },
        required: ["tekst", "krog_alt", "hashtags", "billedbrief", "dag", "klokke", "kanaler"],
      },
    },
  },
  required: ["opslag"],
};

/**
 * Briefingen om brandet — og om kunden bag.
 *
 * Forbehold findes to steder: brandets egne, og kundens, der gælder alle
 * dens brands. En kundes regel om samtykke til billeder af medarbejdere
 * gælder alle dens brands og skal ikke skrives tre gange. Begge lister sendes med, kundens først.
 */
function brandBriefing(brand) {
  const kunde = brand.customers ?? brand.kunde ?? null;
  const forbud = [kunde?.guardrails, brand.guardrails].filter(Boolean).join("\n");

  return [
    `Virksomhed: ${brand.name}`,
    kunde?.name && kunde.name !== brand.name && `Del af: ${kunde.name}`,
    brand.description && `Hvad de laver: ${brand.description}`,
    brand.target_audience && `Målgruppe: ${brand.target_audience}`,
    // Hvad de VED styrer teksten mere end hvem de er. I et fagligt felt er
    // afstanden mellem indforstået og banal kort, og den afgøres her.
    brand.maalgruppe_ved && `Det ved målgruppen allerede — forklar det ikke forfra:\n${brand.maalgruppe_ved}`,
    brand.maalgruppe_undgaa && `Det er de trætte af at høre — find en anden vinkel:\n${brand.maalgruppe_undgaa}`,
    brand.tone_of_voice && `Tone of voice: ${brand.tone_of_voice}`,
    // Eksempler slår beskrivelser. Et adjektiv som «jordnær» kan betyde
    // hvad som helst; tre rigtige opslag kan kun betyde én ting.
    brand.eksempel_opslag &&
      `SÅDAN LYDER DE, NÅR DET ER GODT. Ram denne stemme — kopiér ikke indholdet:\n${brand.eksempel_opslag}`,
    kunde?.samtykke && `Om samtykke og billeder: ${kunde.samtykke}`,
    forbud && `MÅ IKKE:\n${forbud}`,
  ].filter(Boolean).join("\n");
}

/* ---------------------------------------------------------------------
   Hvad der plejer at blive rettet.

   Appen gemmer både det modellen skrev og det der blev godkendt. Hvor de
   to er forskellige, ligger den mest præcise beskrivelse af stemmen der
   findes — mere præcis end noget adjektiv i en brandprofil, fordi den er
   et rigtigt valg og ikke en hensigt.

   Kun de nyeste, og kun når der faktisk ER rettet: et par hvor de to er
   ens siger intet, og tomme eksempler gør prompten længere uden at gøre
   den bedre.
   --------------------------------------------------------------------- */
export function laerteRettelser(par, maks = 6) {
  const brugbare = (par ?? [])
    .filter((x) => x?.foer && x?.efter && x.foer.trim() !== x.efter.trim())
    .slice(0, maks);

  if (!brugbare.length) return "";

  return `SÅDAN BLIVER DINE UDKAST TYPISK RETTET.
Det er det bedste billede af stemmen vi har. Skriv så rettelserne ikke er nødvendige.

${brugbare
  .map((x, i) => `${i + 1}. Du skrev:\n"${x.foer.trim()}"\n\n   Det blev sendt som:\n"${x.efter.trim()}"`)
  .join("\n\n")}`;
}

export const STANDARD_RETNINGSLINJER = `Du er content-planlægger for en dansk marketingafdeling.

Du skriver opslag der lyder som om et menneske fra virksomheden har skrevet dem:
- Ingen "🚀 Spændende nyheder!" eller anden LinkedIn-plastik.
- Ingen tomme superlativer. Sig noget konkret eller lad være.
- Variér længde og form hen over serien.

VÆLG EN TYPE PER OPSLAG, og brug ikke samme type to gange i træk:
- kundehistorie: noget der faktisk skete, med et konkret udfald
- bag om arbejdet: hvordan noget gøres, og hvorfor sådan
- fagligt tip: noget læseren kan bruge i morgen
- sæsonaktuelt: noget der er relevant lige nu og ikke om tre måneder
- spørgsmål: et ægte et, som nogen ville svare på
- modsvar: en udbredt antagelse der ikke holder
- tal: et resultat, en måling, en pris — noget der kan efterprøves

«Variér» uden en liste bliver til syv opslag der ligner hinanden. Vælg bevidst.

Tilpas til kanalen: Facebook tåler længere tekst og en historie. Instagram er kortere og båret af billedet. LinkedIn er fagligt og henvender sig til beslutningstagere.

Respekter MÅ IKKE-listen absolut. Den er ikke til forhandling.

Spred opslagene fornuftigt over perioden — ikke alle på samme dag, og på tidspunkter hvor målgruppen faktisk er på.`;

export const SPROG = {
  da: { navn: "Dansk", kode: "da" },
  en: { navn: "Engelsk", kode: "en" },
};

/**
 * Sproget opslagene skrives på.
 *
 * Står sidst i prompten, og det er ikke en tilfældighed. Retningslinjerne
 * kan redigeres af brugeren, og en gammel gemt udgave kan sagtens stadig
 * indeholde «skriv på dansk». Kommer sprogkravet efter dem, vinder det —
 * og ellers ville en engelsk kampagne komme tilbage på dansk uden at
 * nogen kunne se hvorfor.
 *
 * Alt andet end selve opslagsteksten bliver på dansk: briefen, brandets
 * profil og appens egne felter. Det er kun det læseren ser der skifter
 * sprog — billedbriefen skal en dansk fotograf kunne læse.
 */
function sprogkrav(sprog) {
  if (sprog === "en") {
    return `SPROG — DETTE OVERTRUMFER ALT ANDET I PROMPTEN.
Write "tekst", "krog_alt" and "hashtags" in ENGLISH. Natural, professional English
as a native speaker would write it — not a translation of a Danish sentence.
Danish idioms rarely survive; find the English way of saying it instead.
Keep proper nouns, company names and product names as they are.

"billedbrief" stays in Danish: it is read by the person taking the picture, not by the audience.`;
  }

  return `SPROG: dansk. Undgå anglicismer hvor der findes et dansk ord.
Det gælder også hashtags.`;
}

/**
 * Hvilke retningslinjer gælder?
 *
 * Kampagnens egne, ellers organisationens, ellers de indbyggede. En tom
 * streng er ikke et valg om at skrive uden retningslinjer — det er et felt
 * ingen har udfyldt, og så er standarden bedre end ingenting.
 */
export function gaeldendeRetningslinjer({ kampagne, org } = {}) {
  return (
    kampagne?.retningslinjer?.trim() ||
    org?.retningslinjer?.trim() ||
    STANDARD_RETNINGSLINJER
  );
}

/**
 * Afsenderen.
 *
 * Den samme viden fortalt af en der har bygget det, en der har ryddet op
 * efter det, og en der ikke tror på det, giver tre forskellige opslag.
 * Arketypen er det valg — og den står før alt andet, fordi den afgør
 * hvilken ret teksten taler med.
 */
function afsender(arketype) {
  const t = typeof arketype === "string" ? arketype : arketype?.beskrivelse;
  if (!t?.trim()) return "";
  return `DU SKRIVER SOM DENNE AFSENDER. Det er ikke en rolle du beskriver — det er den du ER i teksten:
${t.trim()}`;
}

/**
 * Planen for serien, og grebene i det enkelte opslag.
 *
 * To niveauer, fordi det er to forskellige beslutninger. Strategien
 * gaelder de N opslag TILSAMMEN — hvordan de fordeler sig, hvad der kommer
 * foerst, hvornaar der maa bedes om noget. Vinklerne gaelder ét opslag ad
 * gangen.
 *
 * Det er fordelingen der er hele pointen. Beder man om fem opslag uden at
 * sige andet, faar man den samme gode tekst fem gange: modellen har ingen
 * grund til at gribe nummer to anderledes an end nummer et. Listen alene
 * er ikke nok — der skal staa at de skal FORDELES, og at to ens i traek er
 * forkert.
 *
 * Navnene maa ikke ende i teksten. «PAS — problem, agitér, løsning» er en
 * arbejdsanvisning til modellen, ikke en overskrift til laeseren.
 */
function strategiAfsnit({ strategi, vinkler, antal }) {
  const dele = [];

  const plan = typeof strategi === "string" ? strategi : strategi?.beskrivelse;
  if (plan?.trim()) {
    dele.push(`PLANEN FOR SERIEN. Den gælder de ${antal} opslag tilsammen, ikke det enkelte:
${plan.trim()}`);
  }

  const liste = (vinkler ?? []).filter((v) => v?.navn && v?.beskrivelse);
  if (liste.length) {
    // Raekker antallet, skal de alle sammen i brug. Ellers vaelger modellen
    // -- og saa er det bedre at sige det, end at lade den gaette om den maa.
    const daekning =
      liste.length <= antal
        ? "Brug hver vinkel mindst én gang."
        : `Vælg de ${antal} der passer bedst til briefen, og lad resten ligge.`;

    dele.push(`VINKLER. Ét greb per opslag. Fordel dem hen over serien — aldrig samme vinkel to gange i træk.
${daekning}
Navnene er arbejdsanvisninger til dig. De må ikke stå i opslaget.

${liste.map((v) => `- ${v.navn}: ${v.beskrivelse}`).join("\n")}`);
  }

  return dele.join("\n\n");
}

function opgaven({ brand, navn, brief, maal, antal, kanaler, start, slut, rettelser, arketype, strategi, vinkler, sprog }) {
  const laert = laerteRettelser(rettelser);
  const hvem = afsender(arketype);
  const plan = strategiAfsnit({ strategi, vinkler, antal });

  return `${hvem ? `${hvem}\n\n---\n\n` : ""}${brandBriefing(brand)}
${laert ? `\n---\n\n${laert}\n` : ""}
---

KAMPAGNE: ${navn}
Brief: ${brief}
${maal ? `Mål: ${maal}` : ""}
Periode: ${start}${slut ? ` til ${slut}` : ""}
Kanaler til rådighed: ${kanaler.join(", ")}

${klipRegler(kanaler)}
${plan ? `\n---\n\n${plan}\n` : ""}
Lav ${antal} opslag.

"dag" er antal dage efter startdatoen — 0 er startdagen. "klokke" er HH:MM i dansk tid.
"hashtags" er uden havelåge. "billedbrief" beskriver hvad billedet skal vise, konkret nok
til at en fotograf kan arbejde ud fra det.

"krog_alt" er en ANDEN første linje til samme opslag — samme indhold, andet greb.
Ikke en omskrivning med andre ord: en anden måde at komme ind på historien.
Er den første et spørgsmål, så lad den anden være en påstand. Begynder den ét
sted, så begynd den anden et andet. To varianter der ligner hinanden er intet
valg, og så er feltet spildt.

---

${sprogkrav(sprog)}`;
}

/** Til copy/paste i browseren: alt i én tekst, med JSON-formatet forklaret. */
export function byggPrompt(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${opgaven(args)}

Svar KUN med JSON i en \`\`\`json-blok, i præcis dette format:

\`\`\`json
{
  "opslag": [
    {
      "tekst": "Selve opslagsteksten. Uden hashtags.",
      "krog_alt": "En anden første linje til samme opslag.",
      "hashtags": ["uden", "havelåge"],
      "billedbrief": "Hvad billedet skal vise.",
      "dag": 0,
      "klokke": "08:15",
      "kanaler": ["facebook"]
    }
  ]
}
\`\`\``;
}

/** Til `claude -p`: skemaet håndhæver formen, så det skal ikke forklares i teksten. */
export function byggOpgave(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${opgaven(args)}`;
}

/* ---------------------------------------------------------------------
   Læsning af svaret.

   Tager imod ```json-blok, rå JSON, og både {"opslag":[…]} og en bar
   liste — for det er de former man reelt får indsat, og et afvist indsæt
   er mere irriterende end et par ekstra linjer her.
   --------------------------------------------------------------------- */

const KLOKKE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function laesOpslag(raa, tilladteKanaler) {
  const tekst = typeof raa === "string" ? raa.trim() : "";

  // Kommer data allerede som objekt (fx structured_output), springer vi
  // udpakningen over og går direkte til valideringen.
  let data;
  if (raa && typeof raa === "object") {
    data = raa;
  } else {
    if (!tekst) throw new Error("Indsæt Claudes svar først.");

    const blok = tekst.match(/```(?:json)?\s*([\s\S]*?)```/);
    let kandidat = blok ? blok[1].trim() : tekst;

    if (!blok) {
      const start = kandidat.search(/[[{]/);
      const slut = Math.max(kandidat.lastIndexOf("}"), kandidat.lastIndexOf("]"));
      if (start === -1 || slut === -1) {
        throw new Error("Kunne ikke finde JSON i det du indsatte. Kopierede du hele svaret med?");
      }
      kandidat = kandidat.slice(start, slut + 1);
    }

    try {
      data = JSON.parse(kandidat);
    } catch (e) {
      throw new Error(`JSON'en kunne ikke læses: ${e.message}`);
    }
  }

  const liste = Array.isArray(data) ? data : data.opslag;
  if (!Array.isArray(liste) || !liste.length) {
    throw new Error('Fandt ingen opslag. Forventede {"opslag": [ … ]}.');
  }

  return liste.map((o, i) => {
    const nr = i + 1;
    const tekstFelt = o.tekst ?? o.body;
    if (typeof tekstFelt !== "string" || !tekstFelt.trim()) {
      throw new Error(`Opslag ${nr} mangler tekst.`);
    }
    if (!KLOKKE.test(o.klokke ?? "")) {
      throw new Error(`Opslag ${nr} har ugyldigt klokkeslæt: "${o.klokke ?? ""}". Forventede HH:MM.`);
    }

    const kanaler = (Array.isArray(o.kanaler) ? o.kanaler : []).filter((k) =>
      tilladteKanaler.includes(k),
    );
    if (!kanaler.length) {
      throw new Error(`Opslag ${nr} har ingen kanaler der er sat op for kunden.`);
    }

    return {
      tekst: tekstFelt.trim(),
      // Valgfri: en gammel prompt eller en model der sprang feltet over
      // skal ikke få hele indsættelsen til at fejle.
      krogAlt: typeof o.krog_alt === "string" ? o.krog_alt.trim() : "",
      hashtags: (Array.isArray(o.hashtags) ? o.hashtags : [])
        .map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean),
      billedbrief: typeof o.billedbrief === "string" ? o.billedbrief : "",
      dag: Number.isInteger(o.dag) && o.dag >= 0 ? o.dag : 0,
      klokke: o.klokke,
      kanaler,
    };
  });
}

/**
 * Siger fra, naar svaret har et andet antal opslag end der blev bedt om.
 *
 * 4.10.2026: der blev bedt om 10 og oprettet 5 -- uden et ord. Prompten var
 * bygget, mens feltet stadig stod paa 5, og blev ikke bygget om, da tallet
 * blev rettet. Claude kan ogsaa selv levere faerre, hvis svaret bliver langt.
 * Begge dele er usynlige, indtil man taeller opslagene bagefter. Ved «Ny brief»
 * er det vaerre: de gamle opslag slettes, foer de nye oprettes.
 *
 * Returnerer en tom streng, naar antallet passer.
 */
export function antalAfvigelse(fik, badOm) {
  const n = Number(badOm);
  if (!Number.isInteger(n) || n < 1 || fik === n) return "";
  const retning = fik < n
    ? `Bed Claude om de ${n - fik} manglende i samme samtale, og indsæt hele serien igen.`
    : "Slet de overskydende i svaret, eller ret antallet og byg prompten igen.";
  return `Du bad om ${n} opslag, men svaret har ${fik}. ${retning} ` +
    `Vil du bruge de ${fik} alligevel, så tryk på knappen igen.`;
}

/* =====================================================================
   Omskrivning af en eksisterende serie.

   Forskellen fra en ny kampagne: opslagene findes allerede, og de skal
   beholde deres nummer, tidspunkt og kanaler. Kun teksten skal ændres.
   Derfor nummereres de i prompten og skal komme tilbage med samme nummer —
   at stole på rækkefølgen alene ville flytte tekster mellem opslag den dag
   modellen sprang et over.
   ===================================================================== */

export const OMSKRIV_SKEMA = {
  type: "object",
  properties: {
    opslag: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nr: { type: "integer" },
          tekst: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          billedbrief: { type: "string" },
        },
        required: ["nr", "tekst", "hashtags"],
      },
    },
  },
  required: ["opslag"],
};

function opslagsliste(opslag) {
  return opslag
    .map((o, i) => {
      const tags = (o.hashtags ?? []).map((t) => `#${t}`).join(" ");
      const naar = o.scheduled_at
        ? new Date(o.scheduled_at).toLocaleString("da-DK", {
            weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
          })
        : "uden tidspunkt";
      const kanaler = (o.maal ?? []).map((m) => m.platform).join(", ") || "ingen kanal";

      return [
        `--- OPSLAG ${i + 1} (${naar} · ${kanaler}) ---`,
        o.tekst ?? o.body,
        tags && `Hashtags: ${tags}`,
        o.image_brief && `Billedbrief: ${o.image_brief}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function omskrivOpgave({ brand, kampagne, opslag, instruks, arketype, sprog }) {
  const hvem = afsender(arketype);
  // Kanalerne står på opslagene her, ikke i en liste for sig.
  const kanaler = [...new Set(
    opslag.flatMap((o) => (o.maal ?? []).map((m) => m.platform)).filter(Boolean),
  )];

  return `${hvem ? `${hvem}\n\n---\n\n` : ""}${brandBriefing(brand)}

---

KAMPAGNE: ${kampagne.name}
${kampagne.brief ? `Oprindelig brief: ${kampagne.brief}` : ""}
${kampagne.goal ? `Mål: ${kampagne.goal}` : ""}

Her er de ${opslag.length} opslag som de ser ud nu:

${opslagsliste(opslag)}

---

${klipRegler(kanaler)}

---

RET DEM SÅDAN: ${instruks}

Behold nummereringen. Hvert opslag skal komme tilbage med sit eget "nr", så
teksten havner på det rigtige opslag. Tidspunkter og kanaler ændres ikke — de
står kun her, så du kan tage hensyn til dem.

Rører en rettelse ikke et bestemt opslag, så send det uændret tilbage frem for
at udelade det.

---

${sprogkrav(sprog ?? kampagne?.sprog)}`;
}

/** Til copy/paste i browseren. */
export function byggOmskrivPrompt(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${omskrivOpgave(args)}

Svar KUN med JSON i en \`\`\`json-blok:

\`\`\`json
{
  "opslag": [
    { "nr": 1, "tekst": "Den rettede tekst.", "hashtags": ["uden", "havelåge"], "billedbrief": "Valgfri." }
  ]
}
\`\`\``;
}

/** Til `claude -p`, hvor skemaet håndhæver formen. */
export function byggOmskrivOpgave(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${omskrivOpgave(args)}`;
}

/**
 * Læser en omskrivning og parrer den med de opslag der faktisk må rettes.
 *
 * Numre uden for listen kastes væk i stedet for at give en fejl: kommer der et
 * "nr": 9 tilbage på en serie med fem opslag, er det modellen der har regnet
 * forkert, og de øvrige fire skal ikke gå tabt af den grund.
 */
export function laesOmskrivning(raa, antal) {
  let data = raa;

  if (typeof raa === "string") {
    const tekst = raa.trim();
    if (!tekst) throw new Error("Indsæt Claudes svar først.");

    const blok = tekst.match(/```(?:json)?\s*([\s\S]*?)```/);
    let kandidat = blok ? blok[1].trim() : tekst;

    if (!blok) {
      const start = kandidat.search(/[[{]/);
      const slut = Math.max(kandidat.lastIndexOf("}"), kandidat.lastIndexOf("]"));
      if (start === -1 || slut === -1) {
        throw new Error("Kunne ikke finde JSON i det du indsatte.");
      }
      kandidat = kandidat.slice(start, slut + 1);
    }

    try {
      data = JSON.parse(kandidat);
    } catch (e) {
      throw new Error(`JSON'en kunne ikke læses: ${e.message}`);
    }
  }

  const liste = Array.isArray(data) ? data : data?.opslag;
  if (!Array.isArray(liste) || !liste.length) {
    throw new Error('Fandt ingen opslag. Forventede {"opslag": [ … ]}.');
  }

  const rettelser = new Map();

  for (const o of liste) {
    const nr = Number(o.nr);
    if (!Number.isInteger(nr) || nr < 1 || nr > antal) continue;

    const tekst = o.tekst ?? o.body;
    if (typeof tekst !== "string" || !tekst.trim()) continue;

    rettelser.set(nr, {
      nr,
      tekst: tekst.trim(),
      hashtags: (Array.isArray(o.hashtags) ? o.hashtags : [])
        .map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean),
      billedbrief: typeof o.billedbrief === "string" && o.billedbrief.trim()
        ? o.billedbrief.trim()
        : null,
    });
  }

  if (!rettelser.size) {
    throw new Error(
      `Ingen af opslagene havde et gyldigt nummer mellem 1 og ${antal}. ` +
        "Bad du Claude om at beholde nummereringen?",
    );
  }

  return [...rettelser.values()].sort((a, b) => a.nr - b.nr);
}

/* =====================================================================
   Artiklen: serien samlet til ét stykke

   Opslagene blev skåret op for at kunne stå alene i et feed. Artiklen er
   den modsatte bevægelse: at sætte dem sammen igen og skrive det ind som
   ikke var plads til.

   Derfor er det udtrykkeligt IKKE en opsummering. En opsummering af syv
   opslag læses af ingen — den der så dem har set dem, og den der ikke
   gjorde, får en liste over noget han gik glip af. Artiklen skal kunne
   læses af en der aldrig har set et eneste af opslagene, og stadig give
   ham noget.
   ===================================================================== */

export const ARTIKEL_SKEMA = {
  type: "object",
  properties: {
    titel: { type: "string" },
    underrubrik: { type: "string" },
    brødtekst: { type: "string" },
    billedbrief: { type: "string" },
  },
  required: ["titel", "brødtekst", "billedbrief"],
};

function artikelOpgave({ brand, kampagne, opslag, arketype, sprog, instruks }) {
  const hvem = afsender(arketype);

  const serien = (opslag ?? [])
    .map((o, i) => `--- OPSLAG ${i + 1} ---
${o.tekst ?? o.body}`)
    .join("\n\n");

  return `${hvem ? `${hvem}\n\n---\n\n` : ""}${brandBriefing(brand)}

---

KAMPAGNE: ${kampagne.name}
${kampagne.brief ? `Brief: ${kampagne.brief}` : ""}
${kampagne.goal ? `Mål: ${kampagne.goal}` : ""}

Her er de ${(opslag ?? []).length} opslag serien bestod af:

${serien}

---

SKRIV DEM SAMMEN TIL ÉN ARTIKEL.

Opslagene var brudstykker af én pointe, skåret op så hvert stykke kunne stå
alene i et feed. Artiklen er den modsatte bevægelse: sæt dem sammen igen, og
skriv det ind som der ikke var plads til.

Det her er ikke en opsummering. Skriv ikke «i denne serie gennemgik jeg» og
opremser ikke opslagene. En læser der aldrig har set et eneste af dem, skal
kunne læse artiklen fra ende til anden og få noget ud af den.

Det betyder konkret:
- Find den påstand de syv opslag tilsammen argumenterer for, og skriv DEN.
- Rækkefølgen må gerne være en anden end opslagenes. Et argument har en
  anden orden end en kalender.
- Hvor to opslag sagde det samme med forskellige ord, sig det én gang.
- Hvor et opslag stillede et spørgsmål og et andet svarede, saml dem.
- Det der kun gav mening som krog i et feed — «Her er tre ting» — skal væk.
- Tilføj det mellemregningerne manglede. Et opslag har ikke plads til
  forbeholdet eller til hvorfor; en artikel har.

Form:
- 700-1200 ord. Længere er ikke bedre, men kortere bliver til et opslag.
- Mellemrubrikker hvor argumentet skifter. Ikke flere end fem.
- Ingen punktopstillinger med ét ord i. Enten en sætning eller brødtekst.
- Ingen hashtags. Det er en artikel, ikke et opslag.
- Slut hvor argumentet slutter. Ingen opfordring til at kontakte dig,
  medmindre briefen udtrykkeligt bad om det.

"titel" er artiklens overskrift. Den må gerne være tør og konkret —
LinkedIn-artikler læses fordi emnet rammer, ikke fordi overskriften lokker.
"underrubrik" er én linje der siger hvad læseren får. Valgfri.
"brødtekst" er hele artiklen med mellemrubrikker som «## Overskrift» på egen linje.

"billedbrief" beskriver coverbilledet — det brede billede øverst i artiklen, og
det første læseren ser. Skriv hvad det skal VISE, konkret nok til at en fotograf
kunne tage det: sted, lys, hvad der er i billedet. Ingen mennesker, ingen tekst
i billedet, ingen genkendelige varemærker. Det skal passe til artiklens emne
uden at illustrere den bogstaveligt — en artikel om anlægsdata har ikke brug
for et billede af en database.
${instruks?.trim() ? `\n---\n\nSÆRLIGT FOR DENNE ARTIKEL: ${instruks.trim()}` : ""}

---

${sprogkrav(sprog ?? kampagne?.sprog)}`;
}

/** Til copy/paste i browseren. */
export function byggArtikelPrompt(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${artikelOpgave(args)}

Svar KUN med JSON i en \`\`\`json-blok:

\`\`\`json
{
  "titel": "Artiklens overskrift",
  "underrubrik": "Én linje om hvad læseren får. Må udelades.",
  "brødtekst": "Hele artiklen. Mellemrubrikker som ## Overskrift på egen linje.",
  "billedbrief": "Hvad coverbilledet skal vise."
}
\`\`\``;
}

/** Til `claude -p`, hvor skemaet håndhæver formen. */
export function byggArtikelOpgave(args) {
  return `${args.retningslinjer?.trim() || STANDARD_RETNINGSLINJER}

---

${artikelOpgave(args)}`;
}

/**
 * Læser artiklen og samler den til én tekst.
 *
 * Titlen og underrubrikken kommer som egne felter, fordi modellen ellers
 * skriver dem ind i brødteksten på hver sin måde. Her sættes de sammen én
 * gang, så det der kopieres ind i LinkedIn altid ser ens ud.
 */
export function laesArtikel(raa) {
  let data = raa;

  if (typeof raa === "string") {
    const tekst = raa.trim();
    if (!tekst) throw new Error("Indsæt Claudes svar først.");

    const blok = tekst.match(/```(?:json)?\s*([\s\S]*?)```/);
    let kandidat = blok ? blok[1].trim() : tekst;

    if (!blok) {
      const start = kandidat.indexOf("{");
      const slut = kandidat.lastIndexOf("}");
      if (start === -1 || slut === -1) {
        throw new Error("Kunne ikke finde JSON i det du indsatte.");
      }
      kandidat = kandidat.slice(start, slut + 1);
    }

    try {
      data = JSON.parse(kandidat);
    } catch (e) {
      throw new Error(`JSON'en kunne ikke læses: ${e.message}`);
    }
  }

  const titel = typeof data?.titel === "string" ? data.titel.trim() : "";
  const brød = typeof data?.brødtekst === "string" ? data.brødtekst.trim() : "";

  if (!titel) throw new Error("Artiklen mangler en titel.");
  if (!brød) throw new Error("Artiklen mangler brødtekst.");

  const under = typeof data?.underrubrik === "string" ? data.underrubrik.trim() : "";
  // Billedbriefen er ikke afgoerende for artiklen. Kommer den ikke med --
  // fordi prompten er gammel, eller modellen sprang feltet over -- skal
  // hele artiklen ikke afvises af den grund.
  const billedbrief = typeof data?.billedbrief === "string" ? data.billedbrief.trim() : "";

  return {
    titel,
    underrubrik: under,
    brødtekst: brød,
    billedbrief,
    // Den samlede tekst er det man kopierer. Titlen står først, fordi
    // LinkedIns editor har et titelfelt man alligevel skal udfylde.
    //
    // Delene samles med én tom linje imellem, og en manglende underrubrik
    // efterlader ikke et hul. Det lyder småligt, men teksten går direkte
    // ind i en editor — et ekstra linjeskift er noget man selv skal opdage
    // og rette hver eneste gang.
    samlet: [titel, under, brød].filter((x) => x).join("\n\n"),
  };
}

/* ---------------------------------------------------------------------
   Kun coverbriefen.

   Artikelprompten foreslår en brief sammen med teksten, men den vej
   findes kun når artiklen skrives. Har man allerede en artikel -- måske
   rettet i hånden, måske fra før feltet fandtes -- skal man kunne få en
   brief uden at kaste artiklen væk og skrive den om.

   Derfor denne: den læser artiklen og svarer med én ting.
   --------------------------------------------------------------------- */

export const COVER_SKEMA = {
  type: "object",
  properties: { billedbrief: { type: "string" } },
  required: ["billedbrief"],
};

function coverOpgave({ brand, artikel, arketype }) {
  const hvem = afsender(arketype);

  return `${hvem ? `${hvem}\n\n---\n\n` : ""}${brandBriefing(brand)}

---

HER ER ARTIKLEN:

${(artikel ?? "").trim()}

---

FORESLÅ ÉT COVERBILLEDE TIL DEN.

Coveret er det brede billede øverst i artiklen, og det første læseren ser —
før titlen. Skriv hvad det skal VISE, konkret nok til at en fotograf kunne
tage det: sted, lys, hvad der er i billedet, og hvorfra det ses.

Krav:
- Ingen mennesker, ingen ansigter.
- Ingen tekst, tal eller logoer i billedet.
- Ingen genkendelige bygninger eller varemærker.
- Det skal passe til emnet uden at illustrere det bogstaveligt. En artikel
  om anlægsdata har ikke brug for et billede af en database, og en om
  serviceaftaler har ikke brug for et håndtryk.
- Et sted der ser brugt ud slår et der ser iscenesat ud.

Svar med ÉN beskrivelse på to til fire sætninger. Ikke flere forslag, ikke
en begrundelse — kun beskrivelsen.`;
}

/** Til copy/paste i browseren. */
export function byggCoverPrompt(args) {
  return `${coverOpgave(args)}

Svar KUN med JSON i en \`\`\`json-blok:

\`\`\`json
{ "billedbrief": "Hvad coverbilledet skal vise." }
\`\`\``;
}

/** Til `claude -p`, hvor skemaet håndhæver formen. */
export function byggCoverOpgave(args) {
  return coverOpgave(args);
}

/**
 * Læser et coverforslag.
 *
 * Tager også imod en bar tekst. Beder man om én beskrivelse, svarer
 * modellen tit med netop den og ingen JSON — og at afvise et svar der er
 * præcis det man bad om, ville være pedanteri.
 */
export function laesCoverBrief(raa) {
  if (raa && typeof raa === "object" && typeof raa.billedbrief === "string") {
    const ud = raa.billedbrief.trim();
    if (ud) return ud;
    throw new Error("Der kom ingen billedbrief retur.");
  }

  const tekst = typeof raa === "string" ? raa.trim() : "";
  if (!tekst) throw new Error("Indsæt Claudes svar først.");

  const blok = tekst.match(/```(?:json)?\s*([\s\S]*?)```/);
  const kandidat = (blok ? blok[1] : tekst).trim();

  if (kandidat.startsWith("{")) {
    try {
      const data = JSON.parse(kandidat);
      const ud = typeof data?.billedbrief === "string" ? data.billedbrief.trim() : "";
      if (ud) return ud;
    } catch {
      // Falder igennem til udtrækket nedenfor.
    }

    // JSON.parse fejler på noget der ser rigtigt ud men ikke er det, og den
    // hyppigste grund er et ægte linjeskift inde i strengen — modellen
    // skriver en beskrivelse over to linjer, og så er JSON'en ugyldig.
    //
    // Her tages værdien ud med hånden i stedet. Det er ikke en generel
    // JSON-læser og skal ikke være det: vi leder efter præcis ét felt, og
    // alternativet er at afvise et svar hvis indhold er helt i orden.
    const m = kandidat.match(/"billedbrief"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (m) {
      const ud = m[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
      if (ud) return ud;
    }

    throw new Error(
      "Kunne ikke finde en «billedbrief» i svaret. Indsatte du hele svaret med?",
    );
  }

  // Bar tekst. Citationstegn omkring hele svaret klippes væk — modellen
  // sætter dem der, når man beder om «kun beskrivelsen».
  return kandidat.replace(/^["«»]|["«»]$/g, "").trim();
}

/**
 * Flytter en serie i tid med bevaret indbyrdes afstand.
 *
 * Klokkeslæt beholdes som det er, frem for at lægge timer til: rykker man en
 * uge frem, skal et morgenopslag stadig ligge om morgenen — også hen over en
 * sommertidsovergang, hvor et rent millisekund-tillæg ville flytte det en time.
 */
export function flytDage(iso, dage) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setDate(d.getDate() + dage);
  return d.toISOString();
}

/** Regner dag + klokke om til et rigtigt tidspunkt i lokal tid. */
export function tidspunkt(start, dag, klokke) {
  const [t, m] = klokke.split(":").map(Number);
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + dag);
  d.setHours(t, m, 0, 0);
  return d.toISOString();
}
