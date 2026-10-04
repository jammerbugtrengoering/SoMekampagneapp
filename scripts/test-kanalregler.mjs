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
import { REGLER, foersteSaetning, fuldTekst, harQr, klip, tekstTilKanal, tjekKrog, tjekOpslag } from "../src/kanalregler.js";

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

console.log("\nKrogen");

const grader = (t, p = "facebook") => tjekKrog(t, p).map((a) => a.grad);
const tekster = (t, p = "facebook") => tjekKrog(t, p).map((a) => a.tekst).join(" ");

test("første sætning findes uanset tegnsætning", () => {
  assert.equal(foersteSaetning("Vi kom klokken seks. Så gik vi i gang."), "Vi kom klokken seks.");
  assert.equal(foersteSaetning("Hvem tager fugerne?\nDet gør vi."), "Hvem tager fugerne?");
  assert.equal(foersteSaetning("Uden punktum overhovedet"), "Uden punktum overhovedet");
  assert.equal(foersteSaetning(""), "");
});

test("standardåbninger fanges", () => {
  assert.ok(grader("Vidste du at gulve slides hurtigere om vinteren? Det gør de.").includes("advarsel"));
  assert.ok(grader("I en verden hvor alle har travlt, glemmer man rengøringen.").includes("advarsel"));
  assert.ok(grader("Vi er glade for at kunne fortælle at vi har fået ny bil.").includes("advarsel"));
});

// Den vigtigste: en konkret krog må ikke give udslag, ellers bliver
// advarslerne støj man lærer at klikke væk.
test("en konkret krog giver ingen advarsler", () => {
  assert.deepEqual(grader("Vi gjorde 400 kvadratmeter rent i Hjørring på en aften."), []);
  assert.deepEqual(grader("Synsrapporten faldt over fugerne bag toilettet."), []);
});

test("en krog der er længere end klippet fanges", () => {
  const lang = `${"Vi gør rent for kontorer i hele Nordjylland og omegn og har gjort det siden 1998 ".repeat(3)}.`;
  assert.ok(tekster(lang).includes("klippet midt over"));
});

test("en krog uden holdepunkt giver en note, ikke en advarsel", () => {
  const g = grader("det handler i sidste ende om at man skal kunne stole på den man lukker ind");
  assert.ok(g.includes("note"));
  assert.ok(!g.includes("advarsel"));
});

test("krogtjekket kommer med ud af tjekOpslag", () => {
  const a = tjekOpslag(
    { body: "Vidste du at gulve slides? Ring 43 22 18 04.", hashtags: [], image_url: "x" },
    "facebook",
  );
  assert.ok(a.some((x) => /standardåbning/.test(x.tekst)));
});

console.log("\nTekst pr. kanal (links)");

// Teksten fra Jammerbugts kampagne: links til en bestillingsside og Messenger.
const MED_LINKS = {
  body:
    "Når du ringer på 61 60 87 20, er det Karen eller Charlotte, der tager den.\n\n" +
    "Bliv ringet op: https://jammerbugtrengoering-kundeportal.netlify.app/bestil?k=facebook\n" +
    "Skriv til Karen og Charlotte på Messenger: https://m.me/jammerbugtrengoering\n" +
    "Telefonen er åben mandag til fredag kl. 8–15.",
  hashtags: ["jammerbugt"],
  image_url: "https://eksempel.dk/a.jpg",
};
const MED_QR = { ...MED_LINKS, image_url: "https://eksempel.dk/b/abc-qr.jpg" };

test("Facebook beholder linkene, de bliver klikbare", () => {
  const t = tekstTilKanal(MED_LINKS, "facebook");
  assert.ok(t.includes("/bestil?k=facebook"));
  assert.ok(t.includes("https://m.me/jammerbugtrengoering"));
});

test("Instagram tager linjer med links ud, også etiketten foran", () => {
  const t = tekstTilKanal(MED_LINKS, "instagram");
  assert.ok(!/https?:\/\//.test(t), "et link slap igennem");
  assert.ok(!t.includes("Bliv ringet op"), "en etiket uden sit link blev stående");
  assert.ok(!t.includes("Messenger"));
  assert.ok(t.includes("Telefonen er åben"), "linjer uden link skal blive");
  assert.ok(t.endsWith("#jammerbugt"));
});

test("uden QR i billedet påstår Instagram-teksten ikke, at der er en", () => {
  assert.ok(!/scan/i.test(tekstTilKanal(MED_LINKS, "instagram")));
});

test("med QR i billedet peger Instagram-teksten på koden, hvor linket stod", () => {
  const t = tekstTilKanal(MED_QR, "instagram");
  assert.equal(t.match(/Scan koden i billedet/g)?.length, 1, "præcis én gang, ikke én pr. link");
  assert.ok(t.indexOf("Scan koden") < t.indexOf("Telefonen er åben"));
});

test("tre tomme linjer i træk bliver aldrig til et hul i opslaget", () => {
  const t = tekstTilKanal({ body: "A\n\nhttps://x.dk\n\nB", hashtags: [] }, "instagram");
  assert.equal(t, "A\n\nB");
});

test("tekst uden links er uændret på Instagram", () => {
  assert.equal(tekstTilKanal(KORT, "instagram"), fuldTekst(KORT));
});

test("LinkedIn røres ikke", () => {
  assert.equal(tekstTilKanal(MED_LINKS, "linkedin"), fuldTekst(MED_LINKS));
});

test("harQr genkender mærket, og kun mærket", () => {
  assert.equal(harQr("https://x.supabase.co/storage/v1/object/public/b/1/abc-qr.jpg"), true);
  assert.equal(harQr("https://x.supabase.co/storage/v1/object/public/b/1/abc.jpg"), false);
  assert.equal(harQr("https://x.dk/mit-qr-foto.jpg"), false, "«-qr» midt i et navn tæller ikke");
  assert.equal(harQr(undefined), false);
});

test("Instagram-tjekket siger fra, når linkene er væk og der ingen kode er", () => {
  const uden = tjekOpslag(MED_LINKS, "instagram").find((a) => /taget ud af Instagram/.test(a.tekst));
  assert.equal(uden?.grad, "advarsel");
  const med = tjekOpslag(MED_QR, "instagram").find((a) => /taget ud af Instagram/.test(a.tekst));
  assert.equal(med?.grad, "note");
  assert.ok(!tjekOpslag(MED_LINKS, "facebook").some((a) => /taget ud af Instagram/.test(a.tekst)));
});

console.log(fejlede === 0 ? "\nAlle tests bestået.\n" : `\n${fejlede} test(s) fejlede.\n`);
process.exit(fejlede === 0 ? 0 : 1);
