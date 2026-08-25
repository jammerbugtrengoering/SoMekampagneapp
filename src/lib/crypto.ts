import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Kundernes Meta-tokens giver fuld skriveadgang til deres sider. De ligger
 * derfor krypteret i databasen — et databaselæk alene er ikke nok til at
 * overtage en kundes Facebook-side.
 *
 * AES-256-GCM. Format: base64(iv[12] || authTag[16] || ciphertext)
 */

const IV_LENGTH = 12
const TAG_LENGTH = 16

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY mangler. Generér med: openssl rand -base64 32',
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY skal være 32 bytes base64 (fik ${buf.length}).`,
    )
  }
  return buf
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptToken(packed: string): string {
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ugyldigt token-ciphertext.')
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

/** Til visning i UI: "EAAG…9xQ2" — nok til at genkende, ikke nok til at bruge. */
export function maskToken(token: string): string {
  if (token.length <= 12) return '••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}
