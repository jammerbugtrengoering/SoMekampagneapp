/**
 * Tester hvad forhåndsvisningen fortæller dig.
 *
 *   npm run test:kanalregler
 *
 * Det er ikke feed-attrappen der har værdi — det er om vi rammer rigtigt,
 * når vi siger hvor teksten bliver klippet, og advarer om at opfordringen
 * til handling forsvinder bag «Se mere».
 */

import assert from "node:assert/strict";
import { REGLER, fuldTekst, klip, tjekOpslag } from "../src/kanalregler.js";

let fejlede = 0;
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`); }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`); }
};

// Det rigtige opslag fra Rengøringsfirmaet. Nummeret står til sidst — præcis
// det tilfælde forhåndsvisningen skal fange.
const RENGOERING = {
  body:
    "Efteråret er den travleste tid for fraflytningsrengøring. Lejemål skal afleveres, " +
    "og der er sjældent tid til at gøre det om.\n\n" +
    "Vi går efter afleveringsstandard: vinduer, hvidevarer indvendigt, fuger, radiatorer " +
    "bag ribberne. Det er de steder en synsrapport falder over.\n\n" +
    "Skal vi se på et lejemål? Ring 43 22 18 04, så aftaler vi en gennemgang.",
  hashtags: ["fraflytningsrengøring", "erhvervsrengøring"],
  image_url: "https://eksempel.dk/a.jpg",
};

const KORT = {
  body: "Ring 43 22 18 04 hvis du vil have et tilbud. Vi er i Storkøbenhavn.",
  hashtags: [],
  image_url: "https://eksempel.dk/a.jpg",
};

console.log("\nTekst og klip");

test("fuldTekst sætter hashtags på til sidst", () => {
  assert.ok(fuldTekst(RENGOERING).endsWith("#fraflytningsrengøring #erhvervsrengøring"));
});

test("kort tekst klippes ikke", () => {
  const r = klip("Kort nok.", 125);
  assert.equal(r.klippet, false);
  assert.equal(r.synlig, "Kort nok.");
  assert.equal(r.skjult, "");
});

test("klip skærer på ordgrænse, ikke midt i et ord", () => {
  const r = klip(RENGOERING.body, 125);
  assert.equal(r.klippet, true);
  assert.ok(!r.synlig.endsWith(" "), "må ikke ende på mellemrum");
  assert.ok(r.skjult.startsWith(" ") || /^\S/.test(r.skjult));
  // Intet ord må være delt: sidste tegn i synlig + første i skjult må ikke
  // begge være bogstaver.
  const delt = /\w$/.test(r.synlig) && /^\w/.test(r.skjult);
  assert.equal(delt, false, `ordet blev delt: "…${r.synlig.slice(-12)}|${r.skjult.slice(0, 12)}…"`);
});

test("synlig + skjult giver teksten tilbage uden tab", () => {
  const r = klip(RENGOERING.body, 175);
  assert.equal(r.synlig + r.skjult, RENGOERING.body);
});

test("hårdt klip når der ikke er mellemrum i nærheden", () => {
  const langt = "a".repeat(300);
  const r = klip(langt, 125);
  assert.equal(r.synlig.length, 125);
});

console.log("\nAdvarsler");

test("Instagram uden billede stopper", () => {
  const a = tjekOpslag({ ...RENGOERING, image_url: null }, "instagram");
  assert.ok(a.some((x) => x.grad === "stop" && /billede/i.test(x.tekst)));
});

test("telefonnummer efter klippet giver advarsel", () => {
  const a = tjekOpslag(RENGOERING, "instagram");
  const advarsel = a.find((x) => x.grad === "advarsel");
  assert.ok(advarsel, "forventede en advarsel om opfordringen");
  assert.match(advarsel.tekst, /Se mere/);
});

test("opfordring før klippet giver INGEN advarsel", () => {
  const a = tjekOpslag(KORT, "instagram");
  assert.equal(a.some((x) => x.grad === "advarsel"), false,
    `forventede ingen advarsel, fik: ${a.map((x) => x.tekst).join(" | ")}`);
});

test("for mange hashtags stopper", () => {
  const mange = { ...RENGOERING, hashtags: Array.from({ length: 31 }, (_, i) => `tag${i}`) };
  const a = tjekOpslag(mange, "instagram");
  assert.ok(a.some((x) => x.grad === "stop" && /hashtags/i.test(x.tekst)));
});

test("for lang tekst stopper", () => {
  const lang = { ...RENGOERING, body: "x".repeat(REGLER.instagram.maks + 1) };
  const a = tjekOpslag(lang, "instagram");
  assert.ok(a.some((x) => x.grad === "stop" && /tegn/i.test(x.tekst)));
});

test("Instagram uden hashtags giver en note, ikke et stop", () => {
  const a = tjekOpslag({ ...KORT, hashtags: [] }, "instagram");
  const note = a.find((x) => /hashtags/i.test(x.tekst));
  assert.equal(note?.grad, "note");
});

test("Facebook kræver ikke billede", () => {
  const a = tjekOpslag({ ...RENGOERING, image_url: null }, "facebook");
  assert.equal(a.some((x) => x.grad === "stop"), false);
});

test("ukendt platform giver ingen advarsler i stedet for at kaste", () => {
  assert.deepEqual(tjekOpslag(RENGOERING, "tiktok"), []);
});

console.log("\nGrænserne");

test("mobil klipper tidligere end computer på Facebook", () => {
  assert.ok(REGLER.facebook.klipMobil < REGLER.facebook.klipDesktop);
});

test("Instagram klipper ved 125 tegn", () => {
  assert.equal(REGLER.instagram.klipMobil, 125);
});

console.log(fejlede === 0 ? "\nAlle tests bestået.\n" : `\n${fejlede} test(s) fejlede.\n`);
process.exit(fejlede === 0 ? 0 : 1);
