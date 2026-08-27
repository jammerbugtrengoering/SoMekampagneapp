/**
 * Opretter eller opdaterer en kanal for en kunde.
 *
 *   npm run kanal          # opret
 *   npm run kanal --liste  # se hvad der findes
 *
 * En kanal kan oprettes UDEN token. Så kan du planlægge og godkende opslag
 * med det samme, og indsætte tokenet når Meta-opsætningen er på plads.
 * Med tørkørsel slået til bliver der alligevel ikke sendt noget.
 *
 * Tokenet krypteres inden det gemmes, ligesom i appen. Det kræver
 * TOKEN_ENCRYPTION_KEY i .env — springer du tokenet over, kræves den ikke.
 */

import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { laesEnv } from "./lib/mgmt.mjs";

const env = { ...laesEnv(), ...process.env };

const PLATFORME = {
  facebook: "Facebook Side",
  instagram: "Instagram",
  linkedin: "LinkedIn (ikke aktiv endnu)",
};

function klient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !noegle) throw new Error("SUPABASE_URL og SUPABASE_SECRET_KEY skal stå i .env.");
  return createClient(url, noegle, { auth: { persistSession: false } });
}

async function liste(db) {
  const { data } = await db
    .from("channels")
    .select("platform, display_name, page_id, ig_user_id, active, token_ciphertext, brands(name)")
    .order("brand_id");

  if (!data?.length) {
    console.log("Ingen kanaler endnu. Kør: npm run kanal");
    return;
  }

  let sidste = null;
  for (const k of data) {
    const kunde = k.brands?.name ?? "?";
    if (kunde !== sidste) { console.log(`\n${kunde}`); sidste = kunde; }
    console.log(
      `  ${PLATFORME[k.platform] ?? k.platform}` +
        ` · ${k.display_name}` +
        ` · ${k.active ? "aktiv" : "slået fra"}` +
        ` · ${k.token_ciphertext ? "token gemt" : "INTET TOKEN"}` +
        (k.page_id ? ` · side ${k.page_id}` : "") +
        (k.ig_user_id ? ` · ig ${k.ig_user_id}` : ""),
    );
  }
  console.log();
}

async function main() {
  const db = klient();

  if (process.argv.includes("--liste")) return liste(db);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const spoerg = async (t, standard = "") => {
    const s = (await rl.question(standard ? `${t} [${standard}] ` : `${t} `)).trim();
    return s || standard;
  };

  try {
    const { data: brands } = await db.from("brands").select("*").order("name");
    if (!brands?.length) throw new Error("Ingen kunder. Kør npm run db:setup.");

    console.log("\nKunder:");
    brands.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
    const brand = brands[Number(await spoerg(`Vælg (1-${brands.length}):`, "1")) - 1];
    if (!brand) throw new Error("Ugyldigt valg.");

    const noegler = Object.keys(PLATFORME);
    console.log("\nPlatform:");
    noegler.forEach((p, i) => console.log(`  ${i + 1}. ${PLATFORME[p]}`));
    const platform = noegler[Number(await spoerg(`Vælg (1-${noegler.length}):`, "1")) - 1];
    if (!platform) throw new Error("Ugyldigt valg.");

    const visningsnavn = await spoerg("Visningsnavn:", brand.name);
    const pageId = await spoerg("Page ID (kan udfyldes senere):");
    const igUserId = platform === "instagram"
      ? await spoerg("Instagram Business Account ID (kan udfyldes senere):")
      : "";

    console.log("\nToken kan springes over nu og indsættes i appen senere.");
    const token = await spoerg("Access token (Enter for at springe over):");

    const felter = {
      brand_id: brand.id,
      platform,
      display_name: visningsnavn,
      page_id: pageId || null,
      ig_user_id: igUserId || null,
      active: true,
    };

    if (token) {
      // Importeres først her, så et manglende TOKEN_ENCRYPTION_KEY kun
      // rammer dem der faktisk indsætter et token.
      const { krypter } = await import("../netlify/functions/_lib/krypto.js");
      felter.token_ciphertext = krypter(token);
      felter.token_label = await spoerg("Label:", "system user");
    }

    const { error } = await db
      .from("channels")
      .upsert(felter, { onConflict: "brand_id,platform,page_id" });

    if (error) throw new Error(error.message);

    console.log(
      `\n${PLATFORME[platform]} oprettet for ${brand.name}` +
        (token ? " med token." : " uden token — indsæt det i appen når Meta er sat op."),
    );
    console.log("\nAlle kanaler:");
    await liste(db);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`);
  process.exitCode = 1;
});
