import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../src/crypto';

const key = randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  it('faz ida e volta', () => {
    const c = encryptSecret('refresh-token-123', key, 'oauth:google');
    expect(c.startsWith('v1:')).toBe(true);
    expect(c).not.toContain('refresh-token-123');
    expect(decryptSecret(c, key, 'oauth:google')).toBe('refresh-token-123');
  });

  it('gera textos cifrados diferentes para o mesmo valor (IV aleatório)', () => {
    expect(encryptSecret('x', key, 'c')).not.toBe(encryptSecret('x', key, 'c'));
  });

  it('falha com contexto diferente (AAD)', () => {
    const c = encryptSecret('segredo', key, 'user:1:totp');
    expect(() => decryptSecret(c, key, 'user:2:totp')).toThrow();
  });

  it('falha com chave diferente ou texto adulterado', () => {
    const c = encryptSecret('segredo', key, 'ctx');
    expect(() => decryptSecret(c, randomBytes(32), 'ctx')).toThrow();
    const parts = c.split(':');
    const tampered = [parts[0], parts[1], parts[2], 'AAAA' + (parts[3] ?? '')].join(':');
    expect(() => decryptSecret(tampered, key, 'ctx')).toThrow();
  });

  it('valida o tamanho da chave', () => {
    expect(() => loadEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(loadEncryptionKey(key.toString('base64')).length).toBe(32);
  });
});
