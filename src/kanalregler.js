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
