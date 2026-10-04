/**
 * Tester at QR-koden i billedskabelonen kan scannes.
 *
 *   npm run test:qr
 *
 * En kode, der ser rigtig ud men ikke kan aflæses, er værre end ingen kode:
 * den opdages først, når en kunde holder telefonen op for den. Derfor tegnes
 * matrixen op i pixels, præcis som billeder.js gør det (hele moduler og fire
 * moduler hvid luft), og afkodes med en uafhængig læser (jsQR).
 *
 * Det beviser matrixen og tegnereglerne. At lærredet placerer koden uden at
 * dække tekst, ses i forhåndsvisningen.
 */

import assert from "node:assert/strict";
import jsQR from "jsqr";
import { qrModuler } from "../src/qr.js";

let fejlede = 0;
const test = (navn, fn) => {
  try { fn(); console.log(`  ✓ ${navn}`); }
  catch (e) { fejlede++; console.error(`  ✗ ${navn}\n    ${e.message}`); }
};

function tilPixels(moduler, modul, luft = 4) {
  const felter = moduler.length + luft * 2;
  const side = felter * modul;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < moduler.length; r++) {
    for (let c = 0; c < moduler.length; c++) {
      if (!moduler[r][c]) continue;
      for (let y = 0; y < modul; y++) {
        for (let x = 0; x < modul; x++) {
          const i = (((r + luft) * modul + y) * side + (c + luft) * modul + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, side };
}

const LINKS = [
  "https://jammerbugtrengoering-kundeportal.netlify.app/bestil?k=facebook",
  "https://jammerbugtrengoering-kundeportal.netlify.app/bestil?k=instagram",
  "https://m.me/jammerbugtrengoering",
];

console.log("\nQR-kode");

for (const link of LINKS) {
  test(`kan aflæses: ${link.slice(8, 60)}`, () => {
    const { data, side } = tilPixels(qrModuler(link), 5);
    const svar = jsQR(data, side, side);
    assert.ok(svar, "læseren fandt ingen kode");
    assert.equal(svar.data, link);
  });
}

test("kan aflæses i det mindste modul, skabelonen tillader (3 px)", () => {
  const { data, side } = tilPixels(qrModuler(LINKS[0]), 3);
  assert.equal(jsQR(data, side, side)?.data, LINKS[0]);
});

test("et lille link giver en mindre kode end et langt", () => {
  assert.ok(qrModuler(LINKS[2]).length < qrModuler(LINKS[0]).length);
});

console.log(fejlede === 0 ? "\nAlle tests bestået.\n" : `\n${fejlede} test(s) fejlede.\n`);
process.exit(fejlede === 0 ? 0 : 1);
