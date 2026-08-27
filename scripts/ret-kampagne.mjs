/**
 * Retter en eksisterende kampagne gennem dit Claude-abonnement.
 *
 *   npm run ret
 *
 * Samme fire tilstande som i appen: skriv om, flyt i tid, ret felter, ny
 * brief. Forskellen er at Claude kaldes direkte i stedet for copy/paste.
 *
 * To regler, de samme som i appen:
 *   - publicerede opslag røres aldrig
 *   - godkendte opslag spørges der om, og godkendelsen trækkes hvis de rettes
 */

import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { laesEnv } from "./lib/mgmt.mjs";
import { spoergClaude } from "./lib/claude.mjs";
import {
  KAMPAGNE_SKEMA, OMSKRIV_SKEMA, byggOmskrivOpgave, byggOpgave,
  flytDage, laesOmskrivning, laesOpslag, tidspunkt,
} from "../src/prompt.js";

const env = { ...laesEnv(), ...process.env };

function klient() {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const noegle = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !noegle) throw new Error("SUPABASE_URL og SUPABASE_SECRET_KEY skal stå i .env.");
  return createClient(url, noegle, { auth: { persistSession: false } });
}

const visTid = (iso) =>
  iso
    ? new Date(iso).toLocaleString("da-DK", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "uden tidspunkt";

async function main() {
  const db = klient();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const spoerg = async (t, standard = "") => {
    const s = (await rl.question(standard ? `${t} [${standard}] ` : `${t} `)).trim();
    return s || standard;
  };
  const jaTak = async (t, standard = "nej") =>
    (await spoerg(`${t} (ja/nej)`, standard)).toLowerCase().startsWith("j");

  try {
    // ---- Vælg kampagne ----
    const { data: kampagner } = await db
      .from("campaigns").select("*, brands(*)").order("created_at", { ascending: false }).limit(20);

    if (!kampagner?.length) throw new Error("Ingen kampagner endnu. Kør npm run kampagne.");

    console.log("\nKampagner:");
    kampagner.forEach((k, i) =>
      console.log(`  ${i + 1}. ${k.brands?.name} — ${k.name}${k.starts_on ? ` (fra ${k.starts_on})` : ""}`),
    );
    const kampagne = kampagner[Number(await spoerg(`Vælg (1-${kampagner.length}):`, "1")) - 1];
    if (!kampagne) throw new Error("Ugyldigt valg.");

    const brand = kampagne.brands;

    // ---- Hent opslagene ----
    const { data: raa } = await db
      .from("posts")
      .select("*, post_targets(id, channel_id, status, channels(platform))")
      .eq("campaign_id", kampagne.id)
      .order("scheduled_at", { ascending: true });

    const alle = (raa ?? []).map((o) => ({
      ...o,
      maal: (o.post_targets ?? []).map((m) => ({
        id: m.id, kanalId: m.channel_id, status: m.status,
        platform: m.channels?.platform,
      })),
    }));

    if (!alle.length) throw new Error("Kampagnen har ingen opslag.");

    const publicerede = alle.filter((o) => o.status === "published");
    const godkendte = alle.filter((o) => o.status === "approved");
    const frie = alle.filter((o) => !["published", "approved"].includes(o.status));

    console.log(`\n${kampagne.name} — ${alle.length} opslag`);
    alle.forEach((o, i) =>
      console.log(`  ${i + 1}. [${o.status}] ${visTid(o.scheduled_at)} · ${o.body.split("\n")[0].slice(0, 58)}`),
    );

    if (publicerede.length) {
      console.log(`\n${publicerede.length} publiceret — de røres ikke.`);
    }

    let beroerte = frie;
    if (godkendte.length) {
      console.log(`\n${godkendte.length} opslag er godkendt.`);
      if (await jaTak("Skal de rettes med? Godkendelsen trækkes så")) {
        beroerte = [...frie, ...godkendte].sort(
          (a, b) => new Date(a.scheduled_at ?? 0) - new Date(b.scheduled_at ?? 0),
        );
      }
    }

    if (!beroerte.length) throw new Error("Ingen opslag at rette.");
    console.log(`\nRetter ${beroerte.length} opslag.`);

    // ---- Vælg tilstand ----
    const TILSTANDE = [
      ["omskriv", "Skriv teksterne om efter en instruks"],
      ["kanaler", "Ret hvilke kanaler opslagene går til"],
      ["flytbrand", "Flyt hele kampagnen til et andet brand"],
      ["tid", "Flyt serien i tid"],
      ["felter", "Ret navn, brief, mål og periode"],
      ["ny", "Ny brief — skriv serien forfra (sletter de berørte)"],
    ];
    console.log("\nHvad vil du?");
    TILSTANDE.forEach(([, mrk], i) => console.log(`  ${i + 1}. ${mrk}`));
    const tilstand = TILSTANDE[Number(await spoerg(`Vælg (1-${TILSTANDE.length}):`, "1")) - 1]?.[0];
    if (!tilstand) throw new Error("Ugyldigt valg.");

    // ---- Ret felter ----
    if (tilstand === "felter") {
      const navn = await spoerg("Navn:", kampagne.name);
      const brief = await spoerg("Brief:", kampagne.brief ?? "");
      const maal = await spoerg("Mål:", kampagne.goal ?? "");
      const start = await spoerg("Start:", kampagne.starts_on ?? "");
      const slut = await spoerg("Slut:", kampagne.ends_on ?? "");

      const { error } = await db.from("campaigns").update({
        name: navn, brief: brief || null, goal: maal || null,
        starts_on: start || null, ends_on: slut || null,
      }).eq("id", kampagne.id);

      if (error) throw new Error(error.message);
      console.log("\nKampagnen er rettet. Opslagene er urørte.");
      return;
    }

    // ---- Kanaler ----
    if (tilstand === "kanaler") {
      const { data: kanaler } = await db
        .from("channels").select("*").eq("brand_id", kampagne.brand_id).eq("active", true)
        .order("platform");

      if (!kanaler?.length) throw new Error("Kunden har ingen aktive kanaler. Kør npm run kanal.");

      const daekning = new Map();
      for (const o of alle) for (const m of o.maal) {
        daekning.set(m.kanalId, (daekning.get(m.kanalId) ?? 0) + 1);
      }

      console.log("\nKanaler:");
      kanaler.forEach((k, i) => {
        const n = daekning.get(k.id) ?? 0;
        console.log(`  ${i + 1}. ${k.platform} · ${k.display_name}` +
          `  (${n} af ${alle.length} opslag bruger den)`);
      });

      const svar = await spoerg(
        `Hvilke skal ALLE ${beroerte.length} berørte opslag ud på? Numre adskilt af komma:`,
        kanaler.map((k, i) => (daekning.get(k.id) ? i + 1 : null)).filter(Boolean).join(",") || "1",
      );

      const valgte = svar.split(/[\s,]+/).map(Number)
        .filter((n) => n >= 1 && n <= kanaler.length)
        .map((n) => kanaler[n - 1].id);

      if (!valgte.length) throw new Error("Ingen gyldige numre valgt.");

      // Instagram afviser opslag uden billede — sig det før, ikke bagefter.
      const igValgt = valgte.some((id) => kanaler.find((k) => k.id === id)?.platform === "instagram");
      const udenBillede = beroerte.filter((o) => !o.image_url).length;
      if (igValgt && udenBillede) {
        console.log(`\nBEMÆRK: ${udenBillede} af opslagene har intet billede. Instagram afviser dem.`);
      }

      console.log("\nVælger: " + valgte.map((id) => {
        const k = kanaler.find((x) => x.id === id);
        return `${k.platform}/${k.display_name}`;
      }).join(", "));

      if (!(await jaTak("Gem?", "ja"))) { console.log("Afbrudt."); return; }

      let tilfoejet = 0, fjernet = 0, bevaret = 0;
      for (const o of beroerte) {
        const nuvaerende = new Map(o.maal.map((m) => [m.kanalId, m]));

        for (const id of valgte) {
          if (nuvaerende.has(id)) continue;
          const { error } = await db.from("post_targets")
            .insert({ post_id: o.id, channel_id: id });
          if (error) throw new Error(error.message);
          tilfoejet++;
        }

        for (const [id, m] of nuvaerende) {
          if (valgte.includes(id)) continue;
          // Publicerede mål slettes ikke: opslaget ER ude på den kanal.
          if (m.status === "published") { bevaret++; continue; }
          const { error } = await db.from("post_targets").delete().eq("id", m.id);
          if (error) throw new Error(error.message);
          fjernet++;
        }
      }

      console.log(`\n${tilfoejet} tilføjet, ${fjernet} fjernet` +
        (bevaret ? `, ${bevaret} beholdt fordi de allerede er publiceret` : "") + ".");
      return;
    }

    // ---- Flyt til et andet brand ----
    //
    // Hele kampagnen flytter, ikke et udsnit: en kampagne der står halvt på to
    // brands giver ingen mening. Kanalmålene oversættes på platform, fordi et
    // kanal-id hører til ét brand og ellers ville pege på den forkerte side.
    if (tilstand === "flytbrand") {
      if (publicerede.length) {
        throw new Error(
          `${publicerede.length} opslag er publiceret under ${brand?.name}. En publiceret ` +
          "kampagne kan ikke flyttes — opret en ny på det rigtige brand i stedet.",
        );
      }

      const { data: brands } = await db
        .from("brands").select("*, customers(name)").order("name");

      const andre = (brands ?? []).filter((b) => b.id !== kampagne.brand_id);
      if (!andre.length) throw new Error("Der findes ikke andre brands at flytte til.");

      console.log(`\nStår nu på: ${brand?.name}`);
      console.log("\nFlyt til:");
      andre.forEach((b, i) =>
        console.log(`  ${i + 1}. ${b.customers?.name ?? "Uden kunde"} — ${b.name}`),
      );

      const valg = andre[Number(await spoerg(`Vælg (1-${andre.length}):`, "1")) - 1];
      if (!valg) throw new Error("Ugyldigt valg.");

      const { data: modtagerKanaler } = await db
        .from("channels").select("*").eq("brand_id", valg.id).eq("active", true);

      const brugte = [...new Set(alle.flatMap((o) => o.maal.map((m) => m.platform)).filter(Boolean))];
      const mangler = brugte.filter((p) => !(modtagerKanaler ?? []).some((k) => k.platform === p));

      if (mangler.length) {
        console.log(`\nBEMÆRK: ${valg.name} har ingen aktiv kanal på ${mangler.join(" og ")}.`);
        console.log("Opslagene flyttes alligevel, men står uden kanal der.");
      }
      console.log(`\nTeksterne er skrevet til ${brand?.name}s tone — overvej en omskrivning bagefter.`);

      if (!(await jaTak(`Flyt alle ${alle.length} opslag til ${valg.name}?`))) {
        console.log("Afbrudt."); return;
      }

      // Nye mål bygges før de gamle slettes, så en fejl ikke efterlader
      // opslagene uden kanaler overhovedet.
      const nyeMaal = [];
      for (const o of alle) {
        const platforme = [...new Set(o.maal.map((m) => m.platform))];
        for (const k of modtagerKanaler ?? []) {
          if (platforme.includes(k.platform)) nyeMaal.push({ post_id: o.id, channel_id: k.id });
        }
      }
      const gamle = alle.flatMap((o) => o.maal.map((m) => m.id));

      for (const t of [
        db.from("campaigns").update({ brand_id: valg.id }).eq("id", kampagne.id),
        db.from("posts").update({ brand_id: valg.id }).eq("campaign_id", kampagne.id),
      ]) {
        const { error } = await t;
        if (error) throw new Error(error.message);
      }

      if (gamle.length) {
        const { error } = await db.from("post_targets").delete().in("id", gamle);
        if (error) throw new Error(error.message);
      }
      if (nyeMaal.length) {
        const { error } = await db.from("post_targets").insert(nyeMaal);
        if (error) throw new Error(error.message);
      }

      console.log(`\n${alle.length} opslag flyttet til ${valg.name}` +
        (nyeMaal.length
          ? `, med ${nyeMaal.length} kanalmål.`
          : ". Sæt kanaler med tilstand 2."));
      return;
    }

    // ---- Flyt i tid ----
    if (tilstand === "tid") {
      const dage = Number(await spoerg("Antal dage (negativt for tilbage):", "7"));
      if (!Number.isInteger(dage) || dage === 0) throw new Error("Skriv et helt tal forskelligt fra 0.");

      const foerste = beroerte.find((o) => o.scheduled_at);
      if (foerste) {
        console.log(
          `\nFørste opslag: ${visTid(foerste.scheduled_at)} → ${visTid(flytDage(foerste.scheduled_at, dage))}`,
        );
      }
      if (!(await jaTak(`Flyt ${beroerte.length} opslag?`, "ja"))) {
        console.log("Afbrudt."); return;
      }

      for (const o of beroerte) {
        if (!o.scheduled_at) continue;
        const { error } = await db.from("posts")
          .update({ scheduled_at: flytDage(o.scheduled_at, dage) }).eq("id", o.id);
        if (error) throw new Error(error.message);
      }

      const skub = (d) => (d ? flytDage(`${d}T12:00:00`, dage).slice(0, 10) : null);
      await db.from("campaigns")
        .update({ starts_on: skub(kampagne.starts_on), ends_on: skub(kampagne.ends_on) })
        .eq("id", kampagne.id);

      console.log(`\n${beroerte.length} opslag flyttet ${Math.abs(dage)} dage ${dage < 0 ? "tilbage" : "frem"}.`);
      return;
    }

    // ---- Skriv om ----
    if (tilstand === "omskriv") {
      const instruks = await spoerg("Hvad skal rettes?");
      if (!instruks) throw new Error("Instruks mangler.");

      console.log("\nSpørger Claude…\n");
      const svar = await spoergClaude(
        byggOmskrivOpgave({
          brand, kampagne, instruks,
          opslag: beroerte.map((o) => ({ ...o, tekst: o.body })),
        }),
        OMSKRIV_SKEMA,
        env.CLAUDE_MODEL,
      );

      const rettelser = laesOmskrivning(svar, beroerte.length);
      console.log(`Fik ${rettelser.length} rettelser:\n`);
      for (const r of rettelser) {
        const gammel = beroerte[r.nr - 1];
        console.log(`  ${r.nr}. FØR: ${gammel.body.split("\n")[0].slice(0, 66)}`);
        console.log(`     EFTER: ${r.tekst.split("\n")[0].slice(0, 66)}\n`);
      }

      if (!(await jaTak("Gem rettelserne?", "ja"))) { console.log("Afbrudt."); return; }

      let rettet = 0;
      for (const r of rettelser) {
        const maal = beroerte[r.nr - 1];
        if (!maal) continue;

        const felter = { body: r.tekst, hashtags: r.hashtags };
        if (r.billedbrief) felter.image_brief = r.billedbrief;
        // Teksten er en anden nu — godkendelsen skal gives på ny.
        if (maal.status === "approved") felter.status = "needs_approval";

        const { error } = await db.from("posts").update(felter).eq("id", maal.id);
        if (error) throw new Error(error.message);
        rettet++;
      }

      console.log(`\n${rettet} opslag omskrevet.`);
      return;
    }

    // ---- Ny brief ----
    const { data: kanalRaekker } = await db
      .from("channels").select("*").eq("brand_id", kampagne.brand_id).eq("active", true);

    const kanaler = [...new Set((kanalRaekker ?? []).map((k) => k.platform))];
    if (!kanaler.length) throw new Error("Kunden har ingen aktive kanaler. Kør npm run kanal.");

    const nyBrief = await spoerg("Ny brief:", kampagne.brief ?? "");
    if (!nyBrief) throw new Error("Brief mangler.");
    const antal = Number(await spoerg("Antal opslag:", String(beroerte.length)));
    const start = kampagne.starts_on ?? new Date().toISOString().slice(0, 10);

    console.log("\nSpørger Claude…\n");
    const svar = await spoergClaude(
      byggOpgave({
        brand, navn: kampagne.name, brief: nyBrief, maal: kampagne.goal ?? "",
        antal, kanaler, start, slut: kampagne.ends_on ?? "",
      }),
      KAMPAGNE_SKEMA,
      env.CLAUDE_MODEL,
    );

    const nye = laesOpslag(svar, kanaler);
    console.log(`Fik ${nye.length} nye opslag:\n`);
    for (const o of nye) {
      console.log(`  dag ${o.dag} kl. ${o.klokke} · ${o.kanaler.join(", ")}`);
      console.log(`  ${o.tekst.split("\n")[0].slice(0, 74)}\n`);
    }

    console.log(`Det ERSTATTER ${beroerte.length} eksisterende opslag, som slettes.`);
    if (!(await jaTak("Fortsæt?"))) { console.log("Afbrudt. Intet slettet."); return; }

    for (const o of beroerte) {
      const { error } = await db.from("posts").delete().eq("id", o.id);
      if (error) throw new Error(error.message);
    }

    let oprettede = 0;
    for (const o of nye) {
      const { data: raekke } = await db.from("posts").insert({
        campaign_id: kampagne.id, brand_id: kampagne.brand_id, body: o.tekst,
        hashtags: o.hashtags, image_brief: o.billedbrief,
        scheduled_at: tidspunkt(start, o.dag, o.klokke), status: "needs_approval",
      }).select().single();

      if (!raekke) continue;
      oprettede++;

      const maalRaekker = (kanalRaekker ?? [])
        .filter((k) => o.kanaler.includes(k.platform))
        .map((k) => ({ post_id: raekke.id, channel_id: k.id }));
      if (maalRaekker.length) await db.from("post_targets").insert(maalRaekker);
    }

    await db.from("campaigns").update({ brief: nyBrief }).eq("id", kampagne.id);
    console.log(`\n${beroerte.length} gamle opslag erstattet af ${oprettede} nye kladder.`);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(`\nFejl: ${e.message}`);
  process.exitCode = 1;
});
