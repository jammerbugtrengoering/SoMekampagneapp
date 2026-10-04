import qrcode from "qrcode-generator";

/**
 * QR-matrix til en tekst: et kvadrat af true (mørk) og false (lys).
 *
 * Står for sig selv og uden browser-API'er, så Node kan importere den og
 * testen kan afkode resultatet. billeder.js tegner den på canvas.
 *
 * Fejlretning M (15 %): en kode på en skærm eller et opslag bliver set på
 * skrå, i dårligt lys og med fingeraftryk. L er mindre, men tilgiver
 * ingenting. Typenummer 0 lader biblioteket vælge den mindste, der kan rummet.
 */
export function qrModuler(tekst) {
  const q = qrcode(0, "M");
  q.addData(tekst);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}
