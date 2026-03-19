import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

/**
 * Deriva la clave AES-32 bytes desde CREDENTIALS_ENCRYPTION_KEY (hex 64 chars, base64, o scrypt).
 * @returns Buffer de 32 bytes para AES-256-GCM.
 */
function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be set (openssl rand -base64 32)');
  }
  // Si es hex 64 chars o base64 ~44 chars -> usar como key directa
  const hexMatch = raw.match(/^[a-fA-F0-9]{64}$/);
  if (hexMatch) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length >= 32) return b64.subarray(0, 32);
  return scryptSync(raw, 'relic-credentials', 32);
}

/**
 * Encripta texto plano con AES-256-GCM. Requiere CREDENTIALS_ENCRYPTION_KEY.
 * @param {string} plaintext - Texto a encriptar.
 * @returns {string} Base64(IV || authTag || ciphertext).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Desencripta un payload base64(IV || authTag || ciphertext) a texto plano.
 * @param {string} encryptedBase64 - String en base64 generado por encrypt().
 * @returns {string} Texto plano.
 */
export function decrypt(encryptedBase64: string): string {
  const key = getKey();
  const buf = Buffer.from(encryptedBase64, 'base64');
  if (buf.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error('Invalid encrypted payload');
  }
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
