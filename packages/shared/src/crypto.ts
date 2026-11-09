import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

/** Carrega a chave AES-256 (base64, 32 bytes) do TOKEN_ENCRYPTION_KEY. */
export function loadEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY precisa ter 32 bytes em base64');
  }
  return key;
}

/**
 * Cifra um segredo (token OAuth, segredo TOTP) com AES-256-GCM.
 * `context` (AAD) amarra o texto cifrado ao seu uso, ex.: "user:abc:totp";
 * decifrar com outro contexto falha.
 * Formato: v1:<iv>:<tag>:<ciphertext> (base64url).
 */
export function encryptSecret(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload: string, key: Buffer, context: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error('Segredo cifrado em formato desconhecido');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
