import { expect, test } from '@playwright/test';

test('visão geral mostra o canal, o personagem e o modo simulado', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Radar Neon').first()).toBeVisible();
  await expect(page.getByText('Zeca Neon').first()).toBeVisible();
  await expect(page.getByTestId('badge-simulacao')).toBeVisible();
});

test('todas as telas do menu abrem', async ({ page }) => {
  for (const path of [
    '/pauta',
    '/pauta/fontes',
    '/personagem',
    '/producao',
    '/biblioteca',
    '/arte',
    '/parceiros',
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  for (const [path, heading] of [
    ['/aprovacao', 'Aprovação'],
    ['/calendario', 'Calendário'],
    ['/comando', 'Comando'],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(/Chega na Fase \d/)).toHaveCount(0);
  }
});

test('configurações: desligar e religar o modo simulado (com auditoria)', async ({ page }) => {
  await page.goto('/configuracoes');
  const form = page.getByTestId('form-mode.simulation');
  const toggle = form.getByTestId('toggle-simulacao');

  await toggle.uncheck({ force: true });
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByRole('status')).toContainText('Salvo');
  await page.reload();
  await expect(page.getByText('Modo real')).toBeVisible();

  await page
    .getByTestId('form-mode.simulation')
    .getByTestId('toggle-simulacao')
    .check({ force: true });
  await page.getByTestId('form-mode.simulation').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByTestId('form-mode.simulation').getByRole('status')).toContainText('Salvo');
  await page.reload();
  await expect(page.getByTestId('badge-simulacao')).toBeVisible();

  await page.goto('/saude');
  await expect(page.getByRole('cell', { name: 'settings.update' }).first()).toBeVisible();
});

test('configurações: valor inválido é recusado', async ({ page }) => {
  await page.goto('/configuracoes');
  const form = page.getByTestId('form-limits.daily');
  await form.getByLabel('Vídeos longos').fill('99');
  // Ignora a validação do navegador para testar a do servidor.
  await form.evaluate((f) => f.setAttribute('novalidate', ''));
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
});

test('saúde: banco e filas operando', async ({ page }) => {
  await page.goto('/saude');
  await expect(page.getByTestId('status-postgres')).toHaveText('ok');
  await expect(page.getByTestId('status-redis')).toHaveText('ok');
});

test('/api/health é público e não expõe detalhes', async ({ request }) => {
  const res = await request.get('/api/health', { headers: { cookie: '' } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
});

test('sair encerra a sessão', async ({ browser }) => {
  // Contexto próprio para não invalidar a sessão compartilhada dos outros testes.
  const ctx = await browser.newContext({ storageState: 'playwright/.auth/dono.json' });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

test('valores em reais: teto em R$, cotação do dólar e Visão geral', async ({ page }) => {
  await page.goto('/configuracoes');
  const budget = page.getByTestId('form-budget');
  await expect(budget.getByLabel('Teto diário (R$)')).toHaveValue('5');
  await expect(budget.getByLabel('Teto mensal (R$)')).toHaveValue('150');
  const currency = page.getByTestId('form-currency');
  await expect(currency.getByLabel('Fonte')).toHaveValue('bcb');
  await expect(currency.getByLabel('IOF do cartão (%)')).toHaveValue('3.5');
  await expect(currency).toContainText('R$ 5,5606');
  await expect(page.locator('body')).not.toContainText('US$');

  await page.goto('/saude');
  // Pilha de testes sem internet: ainda sem cotação do Banco Central, usa a de reserva.
  await expect(page.getByTestId('cotacao')).toContainText('R$ 5,5606');
  await expect(page.getByTestId('cotacao')).toContainText('reserva');
  await expect(page.locator('body')).not.toContainText('US$');

  await page.goto('/');
  await expect(page.getByText('R$ 5,00').first()).toBeVisible();
  await expect(page.getByText('R$ 150,00').first()).toBeVisible();
});
