import { describe, expect, it } from 'vitest';
import { authEnvSchema, baseEnvSchema, ConfigError, parseEnv } from '../src/config';

describe('parseEnv', () => {
  it('aplica padrões seguros (perfil notebook, modo simulado ligado)', () => {
    const env = parseEnv(baseEnvSchema, {});
    expect(env.APP_PROFILE).toBe('notebook');
    expect(env.SIMULATION_MODE).toBe(true);
  });

  it('converte booleanos vindos do ambiente', () => {
    expect(parseEnv(baseEnvSchema, { SIMULATION_MODE: 'false' }).SIMULATION_MODE).toBe(false);
    expect(parseEnv(baseEnvSchema, { SIMULATION_MODE: '1' }).SIMULATION_MODE).toBe(true);
  });

  it('rejeita perfil desconhecido', () => {
    expect(() => parseEnv(baseEnvSchema, { APP_PROFILE: 'gpu' })).toThrow(ConfigError);
  });

  it('não vaza valores de segredos na mensagem de erro', () => {
    const secret = 'curto-demais-mas-secreto';
    try {
      parseEnv(authEnvSchema, { AUTH_SECRET: secret, TOKEN_ENCRYPTION_KEY: 'abc' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('AUTH_SECRET');
      expect((e as Error).message).toContain('TOKEN_ENCRYPTION_KEY');
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
