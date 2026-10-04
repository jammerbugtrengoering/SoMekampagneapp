/* =====================================================================
   Hvad hver kanal gør ved din tekst.

   Det interessante ved en forhåndsvisning er ikke at den ligner et feed.
   Det er at den viser HVOR teksten bliver klippet — for det er dér en
   opfordring til handling forsvinder uden at nogen opdager det.

   Tallene er platformenes, ikke vores. De flytter sig med jævne mellemrum;
   står de her ét sted, er de til at rette.
   ===================================================================== */

export const REGLER = {
  facebook: {
    navn: "Facebook",
    maks: 63206,
    // Desktop klipper omkring 477 tegn, mobil allerede ved 150-200.
    // Vi viser mobilgrænsen som standard, fordi det er dér de fleste læser.
    klipMobil: 175,
    klipDesktop: 477,
    maksHashtags: 30,
    kraeverBillede: false,
    billedformater: ["kvadrat", "hoej", "bred"],
  },
  instagram: {
    navn: "Instagram",
    maks: 2200,
    klipMobil: 125,
    klipDesktop: 125,
    // Content Publishing API afviser opslag med flere end 30 hashtags.
    maksHashtags: 30,
    kraeverBillede: true,
    billedformater: ["kvadrat", "hoej", "bred"],
  },
  linkedin: {
    navn: "LinkedIn",
    maks: 3000,
    klipMobil: 210,
    klipDesktop: 210,
    maksHashtags: 30,
    kraeverBillede: false,
    billedformater: ["kvadrat", "bred"],
  },
};

/** Teksten som den faktisk står i opslaget: brødtekst plus hashtags. */
export function fuldTekst(opslag) {
  const tags = (opslag.hashtags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`));
  return tags.length ? `${opslag.body}\n\n${tags.join(" ")}` : opslag.body ?? "";
}

/**
 * Deler teksten hvor kanalen klipper.
 *
 * Klipper på nærmeste ordgrænse frem for midt i et ord, ligesom
 * platformene selv gør. Er der intet mellemrum tæt på, klippes hårdt.
 */
export function klip(tekst, graense) {
  if (!tekst || tekst.length <= graense) {
    return { synlig: tekst ?? "", skjult: "", klippet: false };
  }

  const raat = tekst.slice(0, graense);
  const sidsteMellemrum = raat.lastIndexOf(" ");
  const skaer = sidsteMellemrum > graense * 0.7 ? sidsteMellemrum : graense;

  return {
    synlig: tekst.slice(0, skaer),
    skjult: tekst.slice(skaer),
    klippet: true,
  };
}

/* ---------------------------------------------------------------------
   Krogen: den første sætning.

   Den afgør om resten bliver læst, og den er samtidig det eneste stykke
   tekst der med sikkerhed bliver vist. Alligevel er den ofte opvarmning
   — en generel betragtning der kunne stå over ethvert opslag fra enhver
   branche.

   Tjekket er groft med vilje. Det kan ikke afgøre om en krog er god, kun
   om den har nogen af de træk der plejer at gøre den dårlig. Det er
   stadig bedre end ingenting, for det er altid den samme slags fejl.
   --------------------------------------------------------------------- */

// Åbninger der ikke siger noget. Fælles for dem: de kunne stå foran hvad
// som helst, og læseren ved efter dem præcis lige så meget som før.
const KLICHEER = [
  /^vidste du/i,
  /^i en (verden|tid) hvor/i,
  /^som (de fleste|mange) ved/i,
  /^der er ingen tvivl om/i,
  /^vi er (glade|stolte) (for|over)/i,
  /^hos os (er|har|tror)/i,
  /^det er vigtigt at/i,
  /^i dagens/i,
  /^når det kommer til/i,
  // De engelske. Uden dem ville en engelsk kampagne se ud til at blive
  // kontrolleret uden at blive det: reglerne ovenfor rammer aldrig, og en
  // krog der starter «Did you know» ville gå igennem uden en bemærkning.
  /^did you know/i,
  /^in a (world|time) where/i,
  /^as (most|many) (of you )?know/i,
  /^there('s| is) no doubt/i,
  /^we('re| are) (excited|proud|thrilled)/i,
  /^at .{2,30}, we (believe|know|think)/i,
  /^it('s| is) important to/i,
  /^in today('s)?/i,
  /^when it comes to/i,
  /^let('s| us) (be honest|face it|talk about)/i,
];

/** Første sætning — punktum, spørgsmålstegn, udråb eller linjeskift. */
export function foersteSaetning(tekst) {
  const t = (tekst ?? "").trim();
  if (!t) return "";
  const m = t.match(/^[\s\S]*?[.!?](\s|$)|^[^\n]+/);
  return (m ? m[0] : t).trim();
}

/**
 * Har krogen noget at holde fast i?
 *
 * Et tal, et navn, et sted, et citat. Første ord tæller ikke: det står
 * altid med stort.
 */
function harHoldepunkt(saetning) {
  if (/\d/.test(saetning)) return true;
  if (/[«»""\u201C\u201D]/.test(saetning)) return true;
  const efterFoerste = saetning.split(/\s+/).slice(1).join(" ");
  return /[A-ZÆØÅ]/.test(efterFoerste);
}

/**
 * Ord der gør en sætning almen.
 *
 * Fraværet af et tal eller et navn er IKKE i sig selv et problem —
 * «Synsrapporten faldt over fugerne bag toilettet» har ingen af delene og
 * er alligevel så konkret som det bliver. Det der gør en krog til en
 * betragtning, er at den taler om alle og ingen. Derfor kræves begge dele
 * før der siges noget: intet holdepunkt OG et alment greb.
 */
const ALMENT = /\b(man|alle|enhver|ingen|altid|aldrig|ofte|som regel|i sidste ende|når det gælder|det handler om|de fleste|everyone|anyone|no one|nobody|always|never|often|usually|at the end of the day|when it comes to|it('s| is) all about|most people)\b/i;

/** Advarsler om krogen alene. Bruges af tjekOpslag. */
export function tjekKrog(tekst, platform) {
  const r = REGLER[platform];
  const krog = foersteSaetning(tekst);
  const ud = [];
  if (!krog) return ud;

  if (KLICHEER.some((k) => k.test(krog))) {
    ud.push({
      grad: "advarsel",
      tekst: "Krogen er en standardåbning. Den kunne stå foran et hvilket som helst opslag — begynd hellere med det konkrete.",
    });
  }

  // Er selve krogen længere end klippet, når læseren ikke engang frem til
  // dens pointe før «Se mere».
  if (r && krog.length > r.klipMobil) {
    ud.push({
      grad: "advarsel",
      tekst: `Første sætning fylder ${krog.length} tegn — mere end de ${r.klipMobil} der vises. Den bliver klippet midt over.`,
    });
  }

  if (!harHoldepunkt(krog) && ALMENT.test(krog) && krog.length > 45) {
    ud.push({
      grad: "note",
      tekst: "Krogen taler om alle og ingen, og har hverken tal, navn eller sted at holde fast i. Den læses som en generel betragtning.",
    });
  }

  return ud;
}

/**
 * Ting der er værd at vide før opslaget går ud.
 *
 * Sorteret så det der stopper publiceringen står først, og det der bare er
 * ærgerligt står sidst.
 */
export function tjekOpslag(opslag, platform) {
  const r = REGLER[platform];
  if (!r) return [];

  const tekst = fuldTekst(opslag);
  const antalTags = (opslag.hashtags ?? []).length;
  const advarsler = [];

  if (r.kraeverBillede && !opslag.image_url) {
    advarsler.push({
      grad: "stop",
      tekst: `${r.navn} afviser opslag uden billede.`,
    });
  }

  if (tekst.length > r.maks) {
    advarsler.push({
      grad: "stop",
      tekst: `${tekst.length} tegn — ${r.navn} tillader højst ${r.maks}.`,
    });
  }

  if (antalTags > r.maksHashtags) {
    advarsler.push({
      grad: "stop",
      tekst: `${antalTags} hashtags — højst ${r.maksHashtags} er tilladt.`,
    });
  }

  // Det klassiske: telefonnummer eller opfordring havner efter klippet.
  const { skjult, klippet } = klip(tekst, r.klipMobil);
  if (klippet) {
    const opfordring = /\b(ring|skriv|kontakt|tilmeld|book|besøg|se mere på|læs mere)\b/i;
    const nummer = /\b\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}\b/;
    const mail = /[\w.+-]+@[\w-]+\.\w{2,}/;

    if (opfordring.test(skjult) || nummer.test(skjult) || mail.test(skjult)) {
      advarsler.push({
        grad: "advarsel",
        tekst: `Din opfordring til handling ligger efter «Se mere» — de fleste på mobil ser den aldrig. Flyt den op over de første ${r.klipMobil} tegn.`,
      });
    }
  }

  advarsler.push(...tjekKrog(opslag.body, platform));

  if (platform === "instagram" && !antalTags) {
    advarsler.push({
      grad: "note",
      tekst: "Ingen hashtags. På Instagram er det dem der giver rækkevidde ud over dine følgere.",
    });
  }

  if (platform === "facebook" && antalTags > 5) {
    advarsler.push({
      grad: "note",
      tekst: "Mange hashtags. På Facebook gør de sjældent nogen forskel, og de gør opslaget tungere at læse.",
    });
  }

  return advarsler;
}
