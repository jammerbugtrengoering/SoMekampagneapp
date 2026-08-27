/**
 * Genererer en kampagne gennem dit Claude-abonnement — ingen API-nøgle.
 *
 *   npm run kampagne
 *
 * Kører `claude -p` på din maskine. Claude Code bruger dit almindelige
 * abonnements-login, og opslagene skrives direkte i Supabase. Det er den
 * samme prompt og det samme skema som den automatiske funktion sender, så
 * resultaterne skifter ikke karakter når vi senere går over til API-nøglen.
 *
 * BEMÆRK: det her kan kun køre lokalt. Den deployede app kan ikke låne dit
 * abonnement — en server har ingen adgang til dit login. Derfor er det et
 * byggefase-værktøj, ikke en funktion i appen.
 *
 * Kræver: Claude Code installeret og logget ind (`claude` i din PATH),
 * samt SUPABASE_SECRET_KEY i .env.
 */

import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { laesEnv } from "./lib/mgmt.mjs";
import { spoergClaude } from "./lib/claude.mjs";
import { KAMPAGNE_SKEMA, byggOpgave, laesOpslag, tidspunkt } from "../src/prompt.js";

const env = { ...laesEnv(), ...process.env };

function klient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !noegle) {
    throw new Error("SUPABASE_URL og SUPABASE_SECRET_KEY skal stå i .env.");
  }
  return createClient(url, noegle, { auth: { persistSession: false } });
}

async function main() {
  const db = klient();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const spoerg = async (tekst, standard = "") => {
    const svar = (await rl.question(standard ? `${tekst} [${standard}] ` : `${tekst} `)).trim();
    return svar || standard;
  };

  try {
    const { data: brands, error } = await db.from("brands").select("*").order("name");
    if (error) throw new Error(error.message);
    if (!brands?.length) throw new Error("Ingen kunder i databasen. Kør npm run db:setup.");

    console.log("\nKunder:");
    brands.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
    const valg = Number(await spoerg(`Vælg (1-${brands.length}):`, "1"));
    const brand = brands[valg - 1];
    if (!brand) throw new Error("Ugyldigt valg.");

    const { data: kanalRaekker } = await db
      .from("channels").select("*").eq("brand_id", brand.id).eq("active", true);

    const kanaler = [...new Set((kanalRaekker ?? []).map((k) => k.platform))];
    if (!kanaler.length) {
      throw new Error(
        `${brand.name} har ingen aktive kanaler, så opslagene ved ikke hvor de skal hen.\n` +
          "  Opret dem med:  npm run kanal\n" +
          "  Tokenet kan springes over nu og indsættes senere.",
      );
    }

    const iDag = new Date().toISOString().slice(0, 10);
    const navn = await spoerg("Kampagnenavn:");
    if (!navn) throw new Error("Navn mangler.");
    const brief = await spoerg("Brief (én linje):");
    if (!brief) throw new Error("Brief mangler.");
    const maal = await spoerg("Mål (valgfrit):");
    const start = await spoerg("Startdato:", iDag);
    const slut = await spoerg("Slutdato (valgfrit):");
    const antal = Number(await spoerg("Antal opslag:", "5"));

    console.log(`\nKanaler: ${kanaler.join(", ")}`);
    console.log("Spørger Claude… (det tager typisk 20-40 sekunder)\n");

    const raa = await spoergClaude(
      byggOpgave({ brand, navn, brief, maal, antal, kanaler, start, slut }),
      KAMPAGNE_SKEMA,
      env.CLAUDE_MODEL,
    );

    const opslag = laesOpslag(raa, kanaler);
    console.log(`Fik ${opslag.length} opslag:\n`);
    for (const o of opslag) {
      console.log(`  dag ${o.dag} kl. ${o.klokke} · ${o.kanaler.join(", ")}`);
      console.log(`  ${o.tekst.split("\n")[0].slice(0, 78)}\n`);
    }

    if ((await spoerg("Gem dem som kladder? (ja/nej)", "ja")).toLowerCase() !== "ja") {
      console.log("Afbrudt. Intet gemt.");
      return;
    }

    const { data: kampagne, error: kFejl } = await db
      .from("campaigns")
      .insert({
        brand_id: brand.id, name: navn, brief, goal: maal || null,
        starts_on: start, ends_on: slut || null, status: "draft",
      })
      .select().single();

    if (kFejl || !kampagne) throw new Error(kFejl?.message ?? "Kunne ikke oprette kampagnen.");

    let gemt = 0;
    for (const o of opslag) {
      const { data: raekke } = await db
        .from("posts")
        .insert({
          campaign_id: kampagne.id, brand_id: brand.id, body: o.tekst,
          hashtags: o.hashtags, image_brief: o.billedbrief,
          scheduled_at: tidspunkt(start, o.dag, o.klokke), status: "needs_approval",
        })
        .select().single();

      if (!raekke) continue;
      gemt++;

      const maalRaekker = (kanalRaekker ?? [])
        .filter((k) => o.kanaler.includes(k.platform))
        .map((k) => ({ post_id: raekke.id, channel_id: k.id }));

      if (maalRaekker.length) await db.from("post_targets").insert(maalRaekker);
    }

    console.log(`\n${gemt} opslag gemt som kladder. Godkend dem i appen.`);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`);
  process.exitCode = 1;
});
