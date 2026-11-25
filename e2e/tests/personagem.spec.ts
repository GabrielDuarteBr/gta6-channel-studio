import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/** Tela Personagem (Fase 2). O clipe é gerado de verdade na pilha de testes. */
test.describe.configure({ mode: 'serial' });

/**
 * O mesmo roteiro no mesmo minuto vira o mesmo job (proteção contra clique duplo). Numa nova
 * tentativa do Playwright, o texto muda para gerar um clipe novo de verdade.
 */
const attempt = () => (test.info().retry ? ` Tentativa ${test.info().retry + 1}.` : '');

test('personagem: galeria com 8 expressões, 9 bocas e voz de teste', async ({ page }) => {
  await page.goto('/personagem');
  await expect(page.getByRole('heading', { name: 'Personagem', exact: true })).toBeVisible();
  await expect(page.getByTestId('galeria-expressoes').locator('svg')).toHaveCount(8);
  await expect(page.getByTestId('galeria-expressoes')).toContainText('Empolgado');
  await expect(page.getByTestId('galeria-expressoes')).toContainText('Desconfiado');
  await expect(page.getByTestId('galeria-bocas').locator('svg')).toHaveCount(9);
  await expect(page.getByTestId('voz-atual')).toContainText('Google Chirp 3 HD');
  await expect(page.getByTestId('voz-atual')).toContainText('Modo simulado ligado');
  await expect(page.getByTestId('cota-voz')).toContainText('/ 1.000.000');
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
      `[feliz] Fala, galera do Radar! [surpreso] [aponta_tela] Novidade! [serio] Calma, é rumor.${attempt()}`,
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

test('clipe com a voz do Google sem chave: falha com a mensagem do que configurar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/personagem');
  const form = page.getByTestId('form-clipe');
  await form.getByLabel('O que o Zeca fala').fill(`[feliz] Teste da voz do Google.${attempt()}`);
  await form.getByLabel('Voz').selectOption('google');
  await form.getByRole('button', { name: 'Gerar clipe de teste' }).click();
  await expect(form.getByRole('status')).toContainText('Clipe na fila');
  const first = page.getByTestId('clipe').first();
  await expect(async () => {
    await page.reload();
    await expect(first.getByTestId('status-clipe')).toHaveText('falhou', { timeout: 1_000 });
  }).toPass({ timeout: 100_000, intervals: [3_000] });
  await expect(first).toContainText('GOOGLE_TTS_API_KEY');
});

test('configurações: voz do Zeca salva (com auditoria)', async ({ page }) => {
  await page.goto('/configuracoes');
  const form = page.getByTestId('form-character');
  await expect(form.getByLabel('Voz do Google', { exact: true })).toHaveValue(
    'pt-BR-Chirp3-HD-Puck',
  );
  await form.getByLabel('Velocidade (0,75 a 1,5)').fill('1.1');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByRole('status')).toContainText('Salvo');
  await page.reload();
  await expect(
    page.getByTestId('form-character').getByLabel('Velocidade (0,75 a 1,5)'),
  ).toHaveValue('1.1');
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

const ARTE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/arte-zeca');
const camadas = (sem: string[] = []) =>
  readdirSync(ARTE)
    .filter((f) => f.endsWith('.svg') && !sem.includes(f))
    .map((f) => ({ name: f, mimeType: 'image/svg+xml', buffer: readFileSync(path.join(ARTE, f)) }));

test('arte do artista: confere o pacote, testa no clipe e passa a ser usada', async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  await page.goto('/personagem');
  const form = page.getByTestId('form-arte');
  await expect(page.getByRole('link', { name: /Baixar modelo para o artista/ })).toBeVisible();
  const modelo = await request.get('/modelo-arte-zeca.zip');
  expect(modelo.status()).toBe(200);

  // frase vaga não é prova de direitos
  await form.getByLabel(/Camadas/).setInputFiles(camadas());
  await form.getByLabel('Artista').fill('Artista E2E');
  await form.getByLabel('Prova de direitos').fill('liberado');
  await form.getByRole('button', { name: 'Enviar arte' }).click();
  await expect(form.getByRole('alert')).toContainText('prova de direitos');

  // sem a cabeça: recusado com a lista do que falta
  await form.getByLabel(/Camadas/).setInputFiles(camadas(['cabeca.svg']));
  await form.getByLabel('Artista').fill('Artista E2E');
  await form
    .getByLabel('Prova de direitos')
    .fill('Contrato de cessão de direitos assinado em 20/11/2026 com o Artista E2E.');
  await form.getByRole('button', { name: 'Enviar arte' }).click();
  await expect(form.getByRole('alert')).toContainText('falta a camada obrigatória: cabeca');

  // pacote completo: vira rascunho com prévia
  await form.getByLabel(/Camadas/).setInputFiles(camadas());
  await form.getByLabel('Artista').fill('Artista E2E');
  await form
    .getByLabel('Prova de direitos')
    .fill('Contrato de cessão de direitos assinado em 20/11/2026 com o Artista E2E.');
  await form.getByRole('button', { name: 'Enviar arte' }).click();
  await expect(form.getByRole('status')).toContainText('(rascunho)');
  await page.reload();
  const arte = page.getByTestId('arte').filter({ hasText: 'Artista E2E' }).first();
  await expect(arte.getByTestId('status-arte')).toContainText('rascunho');
  const camada = await arte.locator('img').first().getAttribute('src');
  expect(camada).toMatch(/^\/api\/character-art\/v\d+\/[a-z0-9_-]+\.svg$/);
  const svg = await request.get(camada!);
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-security-policy']).toContain('sandbox');
  const version = Number(/v(\d+)/.exec(camada!)![1]);

  // clipe de teste com o rascunho (render com as camadas)
  const clip = page.getByTestId('form-clipe');
  await clip
    .getByLabel('O que o Zeca fala')
    .fill(`[empolgado] Bora! [desconfiado] [aponta_tela] Isso é rumor, hein.${attempt()}`);
  await clip.getByLabel('Voz').selectOption('fake');
  await clip.getByLabel('Arte').selectOption(String(version));
  await clip.getByRole('button', { name: 'Gerar clipe de teste' }).click();
  await expect(clip.getByRole('status')).toContainText('Clipe na fila');
  const first = page.getByTestId('clipe').first();
  await expect(async () => {
    await page.reload();
    await expect(first.getByTestId('status-clipe')).toHaveText(/pronto|falhou/, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 280_000, intervals: [5_000] });
  await expect(first.getByTestId('status-clipe')).toHaveText('pronto');
  await expect(first).toContainText('expressões empolgado, desconfiado');

  // usar esta arte: os próximos vídeos saem com ela
  await page
    .getByTestId('arte')
    .filter({ hasText: 'Artista E2E' })
    .first()
    .getByTestId('usar-arte')
    .click();
  await expect(page.getByTestId('arte-em-uso')).toContainText(`Arte de Artista E2E (v${version})`);
  await expect(page.getByTestId('galeria-expressoes').locator('img').first()).toBeVisible();
});
