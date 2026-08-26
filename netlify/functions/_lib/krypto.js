import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Kundernes Meta-tokens giver fuld skriveadgang til deres sider. De ligger
 * derfor krypteret i databasen — et databaselæk alene er ikke nok til at
 * overtage en kundes Facebook-side.
 *
 * AES-256-GCM. Format: base64(iv[12] || authTag[16] || ciphertext)
 *
 * Nøglen findes kun i Netlify-funktionernes miljø. Browseren kan hverken
 * kryptere eller dekryptere, og det er meningen.
 */

const IV_LEN = 12
const TAG_LEN = 16

function noegle() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY mangler. Generér med: openssl rand -base64 32')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY skal være 32 byte base64 (fik ${buf.length}).`)
  }
  return buf
}

export function krypter(klartekst) {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', noegle(), iv)
  const data = Buffer.concat([cipher.update(klartekst, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

export function dekrypter(pakket) {
  const buf = Buffer.from(pakket, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Ugyldigt token-ciphertext.')

  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const data = buf.subarray(IV_LEN + TAG_LEN)

  const decipher = createDecipheriv('aes-256-gcm', noegle(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Til visning i UI: "EAAG…9xQ2" — nok til at genkende, ikke nok til at bruge. */
export function maskeer(token) {
  if (!token || token.length <= 12) return '••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}
