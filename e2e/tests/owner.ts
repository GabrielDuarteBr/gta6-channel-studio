import { generate } from 'otplib';

/** Dono de teste criado pelo `make e2e` (só na pilha isolada de teste). */
export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'dono-e2e@radarneon.local',
  password: process.env.E2E_OWNER_PASSWORD ?? 'senha-e2e-muito-forte',
  totpSecret: process.env.E2E_OWNER_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

export function totpAt(offsetSeconds = 0): Promise<string> {
  return generate({
    secret: OWNER.totpSecret,
    epoch: Math.floor(Date.now() / 1000) + offsetSeconds,
  });
}
