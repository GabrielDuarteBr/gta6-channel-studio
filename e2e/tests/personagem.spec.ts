import { expect, test } from '@playwright/test';

/** Tela Personagem (Fase 2). O clipe é gerado de verdade na pilha de testes. */
test.describe.configure({ mode: 'serial' });

test('personagem: galeria com 6 expressões, 9 bocas e voz de teste', async ({ page }) => {
  await page.goto('/personagem');
  await expect(page.getByRole('heading', { name: 'Personagem', exact: true })).toBeVisible();
  await expect(page.getByTestId('galeria-expressoes').locator('svg')).toHaveCount(6);
  await expect(page.getByTestId('galeria-bocas').locator('svg')).toHaveCount(9);
  await expect(page.getByTestId('voz-atual')).toContainText('Voz de teste');
  await expect(page.getByText('Arte provisória').first()).toBeVisible();
});

test('clipe: recusa marcação desconhecida e o Zeca dizendo que é humano', async ({ page }) => {
  await page.goto('/personagem');
  const form = page.getByTestId('form-clipe');
  await form.getByLabel('O que o Zeca fala').fill('[dancando] Fala, galera!');
  await form.getByRole('button', { name: 'Gerar clipe de teste' }).click();
  await expect(form.getByRole('alert')).toContainText('marcação desconhecida [dancando]');

  await form.getByLabel('O que o Zeca fala').fill('[feliz] Relaxa, eu sou humano igual a você.');
  await form.getByRole('button', { name: 'Gerar clipe de teste' }).click();
  await expect(form.getByRole('alert')).toContainText('não pode dizer que é humano');
});

test('clipe: gera de verdade (voz, bocas, render) e o vídeo toca no painel', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  await page.goto('/personagem');
  const form = page.getByTestId('form-clipe');
  await form
    .getByLabel('O que o Zeca fala')
    .fill(
      '[feliz] Fala, galera do Radar! [surpreso] [aponta_tela] Novidade! [serio] Calma, é rumor.',
    );
  await form.getByRole('button', { name: 'Gerar clipe de teste' }).click();
  await expect(form.getByRole('status')).toContainText('Clipe na fila');

  const first = page.getByTestId('clipe').first();
  await expect(async () => {
    await page.reload();
    await expect(first.getByTestId('status-clipe')).toHaveText('pronto', { timeout: 1_000 });
  }).toPass({ timeout: 280_000, intervals: [5_000] });

  await expect(first).toContainText('expressões feliz, surpreso, serio');
  const src = await first.locator('video').getAttribute('src');
  expect(src).toMatch(/^\/api\/media\/clips\/[0-9a-f]{16}\/clipe\.mp4$/);
  const res = await request.get(src!, { headers: { range: 'bytes=0-1023' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toBe('video/mp4');
  expect(res.headers()['content-range']).toMatch(/^bytes 0-1023\//);
});

test('mídia: sem login não entrega e caminho estranho é recusado', async ({ browser, request }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const res = await anon.request.get('/api/media/clips/0123456789abcdef/clipe.mp4', {
    maxRedirects: 0,
  });
  expect([302, 303, 307, 401]).toContain(res.status());
  await anon.close();
  expect((await request.get('/api/media/clips/../../etc/passwd')).status()).toBeGreaterThanOrEqual(
    400,
  );
  expect((await request.get('/api/media/poc/rive-a.mp4')).status()).toBe(400);
});

test('bíblia: salvar cria versão nova; restaurar também; regras fixas ficam', async ({ page }) => {
  await page.goto('/personagem');
  const before = Number((await page.getByTestId('versao-biblia').innerText()).match(/\d+/)?.[0]);
  const form = page.getByTestId('form-biblia');
  await expect(form).toContainText('Nunca afirma ser humano');
  const bordoes = form.getByLabel('Bordões');
  const original = await bordoes.inputValue();
  const marca = `Bordão de teste ${Date.now()}`;
  await bordoes.fill(`${original}\n${marca}`);
  await form.getByLabel('O que mudou (opcional)').fill('bordão novo (e2e)');
  await form.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(form.getByRole('status')).toContainText(`versão ${before + 1}`);

  await page.reload();
  await expect(page.getByTestId('versao-biblia')).toContainText(`versão ${before + 1}`);
  await expect(page.getByLabel('Bordões')).toHaveValue(new RegExp(marca));
  // Restaura a versão de antes da edição: o formulário volta ao texto original.
  await page.getByTestId(`versao-${before}`).getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByTestId('versao-biblia')).toContainText(`versão ${before + 2}`);
  await expect(page.getByLabel('Bordões')).toHaveValue(original);

  await page.goto('/saude');
  await expect(page.getByRole('cell', { name: 'bible.version' }).first()).toBeVisible();
});
