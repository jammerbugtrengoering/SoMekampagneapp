/* =====================================================================
   Prompten og læsningen af svaret — ét sted.

   Bruges tre steder, og skal give samme resultat alle tre:
     - browseren, når du kopierer prompten manuelt
     - scripts/kampagne.mjs, der kører den gennem dit Claude-abonnement
     - netlify/functions/generer-kampagne.js, når vi skifter til API-nøgle

   Ren JavaScript uden browser-API'er, så Node kan importere den direkte.
   ===================================================================== */

export const KANALER = ["facebook", "instagram", "linkedin"];

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
          hashtags: { type: "array", items: { type: "string" } },
          billedbrief: { type: "string" },
          dag: { type: "integer" },
          klokke: { type: "string" },
          kanaler: { type: "array", items: { type: "string", enum: KANALER } },
        },
        required: ["tekst", "hashtags", "billedbrief", "dag", "klokke", "kanaler"],
      },
    },
  },
  required: ["opslag"],
};

function brandBriefing(brand) {
  return [
    `Virksomhed: ${brand.name}`,
    brand.description && `Hvad de laver: ${brand.description}`,
    brand.target_audience && `Målgruppe: ${brand.target_audience}`,
    brand.tone_of_voice && `Tone of voice: ${brand.tone_of_voice}`,
    brand.guardrails && `MÅ IKKE: ${brand.guardrails}`,
  ].filter(Boolean).join("\n");
}

const RETNINGSLINJER = `Du er content-planlægger for en dansk marketingafdeling.

Du skriver opslag der lyder som om et menneske fra virksomheden har skrevet dem:
- Ingen "🚀 Spændende nyheder!" eller anden LinkedIn-plastik.
- Ingen tomme superlativer. Sig noget konkret eller lad være.
- Variér længde og form hen over serien.
- Skriv på dansk. Undgå anglicismer hvor der findes et dansk ord.

Tilpas til kanalen: Facebook tåler længere tekst og en historie. Instagram er kortere og båret af billedet. LinkedIn er fagligt og henvender sig til beslutningstagere.

Respekter MÅ IKKE-listen absolut. Den er ikke til forhandling.

Spred opslagene fornuftigt over perioden — ikke alle på samme dag, og på tidspunkter hvor målgruppen faktisk er på.`;

function opgaven({ brand, navn, brief, maal, antal, kanaler, start, slut }) {
  return `${brandBriefing(brand)}

---

KAMPAGNE: ${navn}
Brief: ${brief}
${maal ? `Mål: ${maal}` : ""}
Periode: ${start}${slut ? ` til ${slut}` : ""}
Kanaler til rådighed: ${kanaler.join(", ")}

Lav ${antal} opslag.

"dag" er antal dage efter startdatoen — 0 er startdagen. "klokke" er HH:MM i dansk tid.
"hashtags" er uden havelåge. "billedbrief" beskriver hvad billedet skal vise, konkret nok
til at en fotograf kan arbejde ud fra det.`;
}

/** Til copy/paste i browseren: alt i én tekst, med JSON-formatet forklaret. */
export function byggPrompt(args) {
  return `${RETNINGSLINJER}

---

${opgaven(args)}

Svar KUN med JSON i en \`\`\`json-blok, i præcis dette format:

\`\`\`json
{
  "opslag": [
    {
      "tekst": "Selve opslagsteksten. Uden hashtags.",
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
  return `${RETNINGSLINJER}

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
      hashtags: (Array.isArray(o.hashtags) ? o.hashtags : [])
        .map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean),
      billedbrief: typeof o.billedbrief === "string" ? o.billedbrief : "",
      dag: Number.isInteger(o.dag) && o.dag >= 0 ? o.dag : 0,
      klokke: o.klokke,
      kanaler,
    };
  });
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

function omskrivOpgave({ brand, kampagne, opslag, instruks }) {
  return `${brandBriefing(brand)}

---

KAMPAGNE: ${kampagne.name}
${kampagne.brief ? `Oprindelig brief: ${kampagne.brief}` : ""}
${kampagne.goal ? `Mål: ${kampagne.goal}` : ""}

Her er de ${opslag.length} opslag som de ser ud nu:

${opslagsliste(opslag)}

---

RET DEM SÅDAN: ${instruks}

Behold nummereringen. Hvert opslag skal komme tilbage med sit eget "nr", så
teksten havner på det rigtige opslag. Tidspunkter og kanaler ændres ikke — de
står kun her, så du kan tage hensyn til dem.

Rører en rettelse ikke et bestemt opslag, så send det uændret tilbage frem for
at udelade det.`;
}

/** Til copy/paste i browseren. */
export function byggOmskrivPrompt(args) {
  return `${RETNINGSLINJER}

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
  return `${RETNINGSLINJER}

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
