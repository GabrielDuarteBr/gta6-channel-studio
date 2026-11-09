import { describe, expect, it } from 'vitest';
import { scrubSecrets } from '../src/logger';

describe('scrubSecrets', () => {
  it('mascara chaves e tokens conhecidos', () => {
    const text =
      'falhou com sk-ant-api03-abcdefghijklmnop e AIzaSyA1234567890abcdefghijklmnopqrstu e ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxx';
    const out = scrubSecrets(text);
    expect(out).not.toContain('sk-ant-api03');
    expect(out).not.toContain('AIzaSy');
    expect(out).not.toContain('ya29.');
    expect(out).toContain('[REDACTED]');
  });

  it('mascara senhas em URLs de banco e Redis mantendo o resto', () => {
    const out = scrubSecrets('postgresql://studio:SenhaForte123@postgres:5432/studio');
    expect(out).toBe('postgresql://studio:[REDACTED]@postgres:5432/studio');
    expect(scrubSecrets('redis://:abc123def@redis:6379')).toBe('redis://:[REDACTED]@redis:6379');
  });

  it('mascara Bearer', () => {
    expect(scrubSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });
});
