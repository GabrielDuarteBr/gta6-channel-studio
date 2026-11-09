import { expect, test as setup } from '@playwright/test';
import { OWNER, totpAt } from './owner';

const STATE = 'playwright/.auth/dono.json';

setup('rotas exigem login', async ({ page }) => {
  await page.goto('/configuracoes');
  await expect(page).toHaveURL(/\/login/);
});

setup('código errado é recusado com mensagem genérica', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(OWNER.email);
  await page.getByLabel('Senha').fill(OWNER.password);
  await page.getByLabel('Código do app autenticador').fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail, senha ou código inválidos.')).toBeVisible();
});

setup('login com senha + TOTP', async ({ page }) => {
  // O mesmo código não pode ser usado duas vezes; tenta o período atual, o próximo e,
  // se a suíte rodou há menos de 30 s, espera o período virar.
  for (const offset of [0, 30, 60]) {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(OWNER.email);
    await page.getByLabel('Senha').fill(OWNER.password);
    await page.getByLabel('Código do app autenticador').fill(await totpAt(offset));
    await page.getByRole('button', { name: 'Entrar' }).click();
    const ok = await page
      .getByRole('heading', { name: 'Visão geral' })
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
    if (offset === 30) await page.waitForTimeout(31_000);
  }
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await page.context().storageState({ path: STATE });
});
