import { supabase } from "./supabaseClient";

/* =====================================================================
   Billeder: skabeloner tegnet i browseren, og upload til den offentlige
   bucket.

   Alt tegnes med canvas — ingen server, ingen afhængigheder. Resultatet
   uploades til bucket'en, som er public, fordi Meta selv henter billedet
   fra URL'en og ikke kan logge ind.
   ===================================================================== */

export const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "kampagne-assets";

export const FORMATER = {
  kvadrat: { navn: "Kvadrat 1:1", b: 1080, h: 1080, hint: "Instagram og Facebook" },
  hoej:    { navn: "Stående 4:5", b: 1080, h: 1350, hint: "Fylder mest i Instagram-feedet" },
  bred:    { navn: "Bred 16:9",   b: 1200, h: 630,  hint: "Facebook-link og delinger" },
};

/**
 * Henter et billede så det kan tegnes på canvas OG canvas'et stadig kan
 * eksporteres. Uden crossOrigin bliver canvas'et "tainted", og toBlob
 * fejler med en sikkerhedsfejl der intet siger om årsagen.
 *
 * Supabase storage sender Access-Control-Allow-Origin på public objekter,
 * så det virker for alt der ligger i vores egen bucket.
 */
export function hentBillede(url) {
  return new Promise((klar, fejl) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => klar(img);
    img.onerror = () =>
      fejl(
        new Error(
          "Kunne ikke hente billedet. Ligger det i kampagne-bucket'en, eller er URL'en offentlig?",
        ),
      );
    img.src = url;
  });
}

/** Skalerer og beskærer så billedet dækker hele fladen uden at blive trukket skævt. */
function tegnDaekkende(ctx, img, b, h) {
  const forhold = Math.max(b / img.width, h / img.height);
  const nb = img.width * forhold;
  const nh = img.height * forhold;
  ctx.drawImage(img, (b - nb) / 2, (h - nh) / 2, nb, nh);
}

/**
 * Deler et ord der er bredere end linjen, med bindestreg.
 *
 * Nødvendigt på dansk: "fraflytningsrengøring" og "medlemsindmeldelse" er
 * almindelige ord, og uden det her løber de ud over kanten uden en advarsel.
 */
function delLangtOrd(ctx, ord, maksBredde) {
  const stumper = [];
  let rest = ord;

  while (ctx.measureText(rest).width > maksBredde) {
    let i = 1;
    while (i < rest.length && ctx.measureText(`${rest.slice(0, i + 1)}-`).width <= maksBredde) i++;
    if (i < 2) break; // Selv to tegn er for bredt — så er skriften for stor.
    stumper.push(`${rest.slice(0, i)}-`);
    rest = rest.slice(i);
  }
  stumper.push(rest);
  return stumper;
}

/** Bryder tekst til linjer der passer i bredden. Returnerer linjerne. */
function brydTekst(ctx, tekst, maksBredde) {
  const linjer = [];

  for (const afsnit of tekst.split("\n")) {
    if (!afsnit.trim()) { linjer.push(""); continue; }
    let linje = "";

    for (const raatOrd of afsnit.split(/\s+/)) {
      const ord = ctx.measureText(raatOrd).width > maksBredde
        ? delLangtOrd(ctx, raatOrd, maksBredde)
        : [raatOrd];

      for (const stump of ord) {
        const forsoeg = linje ? `${linje} ${stump}` : stump;
        if (ctx.measureText(forsoeg).width > maksBredde && linje) {
          linjer.push(linje);
          linje = stump;
        } else {
          linje = forsoeg;
        }
        // En stump der endte på bindestreg er en tvungen ombrydning.
        if (stump.endsWith("-") && ord.length > 1) {
          linjer.push(linje);
          linje = "";
        }
      }
    }
    if (linje) linjer.push(linje);
  }
  return linjer;
}

const bredesteLinje = (ctx, linjer) =>
  linjer.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);

/**
 * Finder en skriftstørrelse hvor teksten fylder pænt uden at løbe ud.
 * Starter stort og går ned, i stedet for at gætte — det giver samme visuelle
 * vægt uanset om overskriften er tre ord eller tyve.
 *
 * Både højde OG bredde tjekkes. Kun højde er ikke nok: et enkelt langt ord
 * kan passe på én linje og alligevel stikke ud over kanten.
 */
function passendeSkrift(ctx, tekst, maksBredde, maksHoejde, start, vaegt = 700) {
  const saetFont = (s) => {
    ctx.font = `${vaegt} ${s}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  };

  for (let stoerrelse = start; stoerrelse > 18; stoerrelse -= 2) {
    saetFont(stoerrelse);
    const linjer = brydTekst(ctx, tekst, maksBredde);
    const linjehoejde = stoerrelse * 1.18;

    if (linjer.length * linjehoejde <= maksHoejde && bredesteLinje(ctx, linjer) <= maksBredde) {
      return { stoerrelse, linjer, linjehoejde };
    }
  }

  saetFont(18);
  return { stoerrelse: 18, linjer: brydTekst(ctx, tekst, maksBredde), linjehoejde: 21 };
}

/**
 * Tegner et skabelon-billede.
 *
 * To varianter, styret af om der er en baggrund:
 *   foto   — kundens billede med en mørk gradient forneden, så tekst kan læses
 *   grafik — brandfarven som flade, stor tekst
 */
export async function tegnSkabelon({
  format = "kvadrat",
  baggrundUrl = null,
  baggrundFarve = "#2F5DE0",
  accentFarve = "#FFFFFF",
  overskrift = "",
  underTekst = "",
  logoUrl = null,
}) {
  const { b, h } = FORMATER[format] ?? FORMATER.kvadrat;

  const canvas = document.createElement("canvas");
  canvas.width = b;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const margin = Math.round(b * 0.075);
  const indhold = b - margin * 2;

  // ---- Baggrund ----
  if (baggrundUrl) {
    tegnDaekkende(ctx, await hentBillede(baggrundUrl), b, h);

    // Gradient forneden. Uden den er hvid tekst på et lyst foto ulæselig,
    // og det er den slags man først opdager når opslaget er ude.
    const gradient = ctx.createLinearGradient(0, h * 0.35, 0, h);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.45)");
    gradient.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, b, h);
  } else {
    ctx.fillStyle = baggrundFarve;
    ctx.fillRect(0, 0, b, h);

    // En diskret tone i hjørnet, så fladen ikke er helt død.
    const glans = ctx.createRadialGradient(b * 0.8, h * 0.15, 0, b * 0.8, h * 0.15, b * 0.9);
    glans.addColorStop(0, "rgba(255,255,255,0.14)");
    glans.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glans;
    ctx.fillRect(0, 0, b, h);
  }

  // ---- Logo øverst ----
  let logoBund = margin;
  if (logoUrl) {
    try {
      const logo = await hentBillede(logoUrl);
      const maksH = Math.round(h * 0.075);
      const skala = Math.min(maksH / logo.height, (indhold * 0.5) / logo.width);
      const lb = logo.width * skala;
      const lh = logo.height * skala;
      ctx.drawImage(logo, margin, margin, lb, lh);
      logoBund = margin + lh;
    } catch {
      // Logoet er pynt. Kan det ikke hentes, tegner vi resten alligevel.
    }
  }

  // ---- Tekst forneden ----
  const bund = h - margin;
  let y = bund;

  if (underTekst.trim()) {
    const { stoerrelse, linjer, linjehoejde } = passendeSkrift(
      ctx, underTekst.trim(), indhold, h * 0.16, Math.round(b * 0.042), 500,
    );
    ctx.fillStyle = baggrundUrl ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.82)";
    ctx.font = `500 ${stoerrelse}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

    for (let i = linjer.length - 1; i >= 0; i--) {
      ctx.fillText(linjer[i], margin, y);
      y -= linjehoejde;
    }
    y -= stoerrelse * 0.5;
  }

  if (overskrift.trim()) {
    const maksHoejde = y - logoBund - margin * 0.5;
    const { stoerrelse, linjer, linjehoejde } = passendeSkrift(
      ctx, overskrift.trim(), indhold, Math.max(maksHoejde, h * 0.2), Math.round(b * 0.095),
    );
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${stoerrelse}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

    for (let i = linjer.length - 1; i >= 0; i--) {
      ctx.fillText(linjer[i], margin, y);
      y -= linjehoejde;
    }

    // Accentstreg over overskriften — brandets farve, når baggrunden er et foto.
    ctx.fillStyle = accentFarve;
    ctx.fillRect(margin, y - Math.round(h * 0.022), Math.round(b * 0.09), Math.round(h * 0.008));
  }

  return new Promise((klar, fejl) =>
    canvas.toBlob(
      (blob) => (blob ? klar(blob) : fejl(new Error("Kunne ikke lave billedet."))),
      "image/jpeg",
      0.92,
    ),
  );
}

/** base64 fra AI-funktionen bliver til en blob vi kan uploade. */
export function base64TilBlob(base64, mimeType = "image/png") {
  const raa = atob(base64);
  const bytes = new Uint8Array(raa.length);
  for (let i = 0; i < raa.length; i++) bytes[i] = raa.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const endelse = (type) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[type] ?? "jpg";

/**
 * Lægger et billede i bucket'en og skriver en række i assets.
 *
 * Filnavnet får et tilfældigt led, så to uploads af "logo.png" ikke
 * overskriver hinanden — og så en URL der er sendt til Meta bliver ved at
 * pege på det billede der faktisk blev publiceret.
 */
export async function uploadBillede({
  brandId, blob, kilde = "upload", altTekst = null, opskrift = null, filnavn = null,
}) {
  const type = blob.type || "image/jpeg";
  const id = crypto.randomUUID();
  const sti = `${brandId}/${id}.${endelse(type)}`;

  const { error: uploadFejl } = await supabase.storage
    .from(BUCKET)
    .upload(sti, blob, { contentType: type, upsert: false });

  if (uploadFejl) {
    throw new Error(
      uploadFejl.message?.includes("row-level security")
        ? "Din bruger må ikke uploade. Er migration 0003 kørt, og er du administrator?"
        : `Upload fejlede: ${uploadFejl.message}`,
    );
  }

  const { data: offentlig } = supabase.storage.from(BUCKET).getPublicUrl(sti);
  const url = offentlig.publicUrl;

  const { data: raekke, error: raekkeFejl } = await supabase
    .from("assets")
    .insert({
      brand_id: brandId,
      url,
      storage_path: sti,
      source: kilde,
      alt_text: altTekst,
      opskrift,
      tags: filnavn ? [filnavn.replace(/\.[^.]+$/, "").slice(0, 40)] : [],
    })
    .select()
    .single();

  if (raekkeFejl) throw new Error(`Billedet blev uploadet, men ikke registreret: ${raekkeFejl.message}`);

  return { url, asset: raekke };
}

/** Første linje af opslaget, klippet til noget der kan stå som overskrift. */
export function foersteLinje(tekst, maksTegn = 90) {
  const linje = (tekst ?? "").split("\n").find((l) => l.trim()) ?? "";
  return linje.length > maksTegn ? `${linje.slice(0, maksTegn).trimEnd()}…` : linje;
}
