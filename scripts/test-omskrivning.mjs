/**
 * Tester rettelse af en hel kampagne.
 *
 *   npm run test:omskrivning
 *
 * De to risikable dele: at en omskrivning havner på det RIGTIGE opslag, og
 * at en tidsforskydning ikke flytter klokkeslættet hen over sommertid.
 */

import assert from "node:assert/strict";
import { byggOmskrivPrompt, flytDage, laesOmskrivning } from "../src/prompt.js";

let fejlede = 0;
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`); }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`); }
};

const svar = (opslag) => JSON.stringify({ opslag });

console.log("\nOmskrivning parres med rigtigt opslag");

test("numre bevares, ikke rækkefølge", () => {
  const r = laesOmskrivning(svar([
    { nr: 3, tekst: "Tredje", hashtags: [] },
    { nr: 1, tekst: "Første", hashtags: ["a"] },
  ]), 3);

  assert.equal(r.length, 2);
  assert.equal(r[0].nr, 1, "skal sorteres på nummer");
  assert.equal(r[0].tekst, "Første");
  assert.equal(r[1].nr, 3);
  assert.equal(r[1].tekst, "Tredje");
});

test("numre uden for serien kastes væk — resten går ikke tabt", () => {
  const r = laesOmskrivning(svar([
    { nr: 1, tekst: "Beholdes", hashtags: [] },
    { nr: 9, tekst: "Findes ikke", hashtags: [] },
    { nr: 0, tekst: "Nul findes ikke", hashtags: [] },
  ]), 2);

  assert.equal(r.length, 1);
  assert.equal(r[0].tekst, "Beholdes");
});

test("kun ugyldige numre giver en forklarende fejl", () => {
  assert.throws(
    () => laesOmskrivning(svar([{ nr: 9, tekst: "x", hashtags: [] }]), 2),
    /nummer mellem 1 og 2/,
  );
});

test("opslag uden tekst springes over", () => {
  const r = laesOmskrivning(svar([
    { nr: 1, tekst: "   ", hashtags: [] },
    { nr: 2, tekst: "Har tekst", hashtags: [] },
  ]), 2);

  assert.equal(r.length, 1);
  assert.equal(r[0].nr, 2);
});

test("hashtags renses for havelåge", () => {
  const r = laesOmskrivning(svar([{ nr: 1, tekst: "x", hashtags: ["#rengøring", " klub "] }]), 1);
  assert.deepEqual(r[0].hashtags, ["rengøring", "klub"]);
});

test("tomt billedbrief bliver null i stedet for tom streng", () => {
  const r = laesOmskrivning(svar([{ nr: 1, tekst: "x", hashtags: [], billedbrief: "  " }]), 1);
  assert.equal(r[0].billedbrief, null);
});

test("kodeblok og løs snak omkring virker", () => {
  const r = laesOmskrivning(
    "Her er rettelserne:\n```json\n" + svar([{ nr: 1, tekst: "Rettet", hashtags: [] }]) + "\n```\nSig til!",
    1,
  );
  assert.equal(r[0].tekst, "Rettet");
});

test("objekt direkte fra structured_output virker", () => {
  const r = laesOmskrivning({ opslag: [{ nr: 1, tekst: "Rettet", hashtags: [] }] }, 1);
  assert.equal(r[0].tekst, "Rettet");
});

console.log("\nPrompten indeholder det Claude skal have");

test("de nuværende opslag og instruksen kommer med", () => {
  const p = byggOmskrivPrompt({
    brand: { name: "Rengøringsfirmaet", tone_of_voice: "tør", guardrails: "ingen prisløfter" },
    kampagne: { name: "Efterår", brief: "Fraflytning", goal: "5 leads" },
    instruks: "gør dem kortere",
    opslag: [
      { tekst: "Første opslag", hashtags: ["fuger"], scheduled_at: "2026-09-09T08:15:00.000Z",
        maal: [{ platform: "facebook" }] },
      { tekst: "Andet opslag", hashtags: [], scheduled_at: null, maal: [] },
    ],
  });

  assert.match(p, /OPSLAG 1/);
  assert.match(p, /OPSLAG 2/);
  assert.match(p, /Første opslag/);
  assert.match(p, /gør dem kortere/);
  assert.match(p, /ingen prisløfter/, "guardrails skal med");
  assert.match(p, /facebook/);
  assert.match(p, /uden tidspunkt/, "manglende tidspunkt skal ikke give 'Invalid Date'");
  assert.ok(!p.includes("Invalid Date"));
});

console.log("\nTidsforskydning");

test("syv dage frem beholder klokkeslættet", () => {
  const foer = new Date("2026-09-09T08:15:00");
  const efter = new Date(flytDage(foer.toISOString(), 7));
  assert.equal(efter.getDate(), 16);
  assert.equal(efter.getHours(), foer.getHours());
  assert.equal(efter.getMinutes(), foer.getMinutes());
});

test("negativt tal flytter tilbage", () => {
  const efter = new Date(flytDage(new Date("2026-09-09T08:15:00").toISOString(), -7));
  assert.equal(efter.getDate(), 2);
});

test("hen over sommertid flytter klokkeslættet ikke", () => {
  // Sommertid slutter i Danmark sidste søndag i oktober 2026 = 25. oktober.
  // Et rent millisekund-tillæg ville flytte et morgenopslag en time.
  const foer = new Date("2026-10-22T08:00:00");
  const efter = new Date(flytDage(foer.toISOString(), 7));
  assert.equal(efter.getDate(), 29);
  assert.equal(efter.getHours(), 8, "08:00 skal stadig være 08:00 efter tidsomstillingen");
});

test("hen over månedsskifte regner rigtigt", () => {
  const efter = new Date(flytDage(new Date("2026-09-28T10:00:00").toISOString(), 7));
  assert.equal(efter.getMonth(), 9, "skal være oktober");
  assert.equal(efter.getDate(), 5);
});

test("uden tidspunkt giver null i stedet for at kaste", () => {
  assert.equal(flytDage(null, 7), null);
});

console.log(fejlede === 0 ? "\nAlle tests bestået.\n" : `\n${fejlede} test(s) fejlede.\n`);
process.exit(fejlede === 0 ? 0 : 1);
