import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

/** Fase 3: Biblioteca (manifesto obrigatório) e produção de um Short de ponta a ponta. */
test.describe.configure({ mode: 'serial' });

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (const b of td) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** PNG de verdade (degradê), 640×360, com uma cor que muda com `seed`. */
function png(seed: number): Buffer {
  const w = 640;
  const h = 360;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = (x + seed * 40) % 256;
      raw[i + 1] = seed % 256;
      raw[i + 2] = (y * 2 + Math.floor(seed / 256)) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(page: Page, title: string, seed: number) {
  const form = page.getByTestId('form-envio');
  await form.getByLabel(/Imagem \(PNG/).setInputFiles({
    name: `arte-${seed}.png`,
    mimeType: 'image/png',
    buffer: png(seed),
  });
  await form.getByLabel('Título').fill(title);
  await form.getByLabel('Prova / de onde veio').fill('arte feita por mim (e2e)');
  await form.getByRole('button', { name: 'Enviar para a Biblioteca' }).click();
  return form;
}

test('biblioteca: envio com manifesto, sem duplicar, e revogação', async ({ page }) => {
  await page.goto('/biblioteca');
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  // Imagem e título novos a cada tentativa (uma repetição do teste não reaproveita a anterior).
  const seed = Date.now() % 997;
  const title = `Arte do dono ${seed}`;
  const form = await upload(page, title, seed);
  await expect(form.getByRole('status')).toContainText(/entrou na Biblioteca|já estava/);

  await page.reload();
  const card = page
    .getByTestId('midia')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('status-direitos')).toHaveText('direitos ok');
  await expect(card).toContainText('Licença: Própria');
  const src = await card.locator('img').getAttribute('src');
  const img = await page.request.get(src!);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');

  // mesmo arquivo de novo: não duplica
  const again = await upload(page, 'De novo', seed);
  await expect(again.getByRole('status')).toContainText('já estava na Biblioteca');

  // revogar: sai dos próximos renders (a página recarrega e o card mostra "revogada")
  await card.getByLabel('Motivo da revogação').fill('teste de revogação');
  await card.getByRole('button', { name: 'Revogar' }).click();
  await expect(async () => {
    await page.reload();
    await expect(
      page
        .getByTestId('midia')
        .filter({ has: page.getByText(title, { exact: true }) })
        .first()
        .getByTestId('status-direitos'),
    ).toHaveText('revogada', { timeout: 1_000 });
  }).toPass({ timeout: 20_000, intervals: [1_000] });
});

test('biblioteca: YouTube e site não oficial são recusados', async ({ page }) => {
  await page.goto('/biblioteca');
  const form = page.getByTestId('form-importar');
  await form.getByLabel('Título').fill('Tentativa do YouTube');
  await form
    .getByLabel('Link direto da imagem no site oficial')
    .fill('https://www.youtube.com/watch?v=abc');
  await form.getByRole('button', { name: 'Importar' }).click();
  await expect(form.getByRole('alert')).toContainText('YouTube');

  // O formulário é limpo depois de cada envio: preenche de novo.
  await form.getByLabel('Título').fill('Tentativa de fã-site');
  await form
    .getByLabel('Link direto da imagem no site oficial')
    .fill('https://fansite.example.com/a.jpg');
  await form.getByRole('button', { name: 'Importar' }).click();
  await expect(form.getByRole('alert')).toContainText('não é um site oficial');
});

test('produção: história da Pauta vira Short (roteiro, imagens, voz, render, revisão)', async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  // Marca a história oficial como Short na Pauta (se uma tentativa anterior já marcou, segue).
  await page.goto(`/pauta?periodo=7d&ver=pauta&tipo=todas&q=${encodeURIComponent('Trailer 3')}`);
  const story = page.getByTestId('historia').filter({ hasText: 'Trailer 3' }).first();
  if (await story.getByRole('button', { name: 'Virar Short' }).isVisible()) {
    await story.getByRole('button', { name: 'Virar Short' }).click();
    await expect(story.getByRole('status')).toContainText('vai virar Short');
  }

  await page.goto('/producao');
  await expect(page.getByRole('heading', { name: 'Produção', exact: true })).toBeVisible();
  await expect(page.getByTestId('limite-diario')).toContainText('de 4 Shorts');
  const queued = page
    .getByTestId('fila-pauta')
    .getByRole('listitem')
    .filter({ hasText: 'Trailer 3' });
  if (await queued.count()) {
    await expect(queued.first()).toContainText('Short 9:16');
    await queued.first().getByRole('button', { name: 'Produzir' }).click();
    // A história sai da fila da Pauta e vira um vídeo na lista "Vídeos".
    await expect(queued).toHaveCount(0);
    await expect(page.getByTestId('producao').first().getByTestId('status-producao')).toBeVisible();
  }

  const prod = page.getByTestId('producao').first();
  await expect(async () => {
    await page.reload();
    await expect(prod.getByTestId('status-producao')).toHaveText(/pronto|falhou|precisa de você/, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 400_000, intervals: [5_000] });
  await expect(prod.getByTestId('status-producao')).toHaveText('pronto');

  const video = await prod.getByTestId('video-producao').getAttribute('src');
  expect(video).toMatch(/^\/api\/media\/productions\/[a-z0-9]+\/r1\/video\.mp4$/);
  const res = await request.get(video!, { headers: { range: 'bytes=0-1023' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toBe('video/mp4');
  await expect(prod.getByTestId('thumbnails').locator('img')).toHaveCount(3);
  const thumb = await prod.getByTestId('thumbnails').locator('img').first().getAttribute('src');
  const t = await request.get(thumb!);
  expect(t.status()).toBe(200);
  expect(t.headers()['content-type']).toBe('image/png');
  await expect(prod.getByTestId('revisao')).toContainText('aprovado');
  await expect(prod.getByTestId('relatorio-render')).toContainText('Render:');

  await prod.getByText(/Roteiro \(\d+ falas\)/).click();
  await expect(prod).toContainText('[fato]');
  await expect(prod).toContainText('Demo Newswire');

  // A imagem gerada entrou na Biblioteca com manifesto e o uso ficou registrado.
  await page.goto('/biblioteca?origem=IMAGE_PROVIDER');
  const gen = page.getByTestId('midia').first();
  await expect(gen).toContainText('Prompt:');
  await expect(gen).toContainText(/em \d+ vídeo/);

  await page.goto('/saude');
  await expect(page.getByRole('cell', { name: 'production.review' }).first()).toBeVisible();
});

test('arte: aprovar cenário e pedir variação (vira mídia nova com manifesto)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/arte');
  await expect(page.getByRole('heading', { name: 'Arte', exact: true })).toBeVisible();
  await expect(page.getByTestId('provedor-imagem')).toContainText('Imagens de teste');
  const first = page.getByTestId('cenario').first();
  await first.getByRole('button', { name: 'Aprovar' }).click();
  await expect(
    page.getByTestId('cenario').first().getByText('aprovada', { exact: true }),
  ).toBeVisible();
  const before = await page.getByTestId('cenario').count();
  await page.getByTestId('cenario').first().getByRole('button', { name: 'Gerar variação' }).click();
  await expect(async () => {
    await page.reload();
    expect(await page.getByTestId('cenario').count()).toBe(before + 1);
  }).toPass({ timeout: 60_000, intervals: [2_000] });
  await expect(page.getByTestId('cenario').first()).toContainText('variação 1');
});

test('mídia: saídas de produção exigem login e caminho estranho é recusado', async ({
  browser,
  request,
}) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const r = await anon.request.get('/api/media/productions/abcdefgh1234/r1/video.mp4', {
    maxRedirects: 0,
  });
  expect([302, 303, 307, 401]).toContain(r.status());
  const lib = await anon.request.get('/api/library/abcdefgh1234', { maxRedirects: 0 });
  expect([302, 303, 307, 401]).toContain(lib.status());
  await anon.close();
  expect((await request.get('/api/media/productions/abcdefgh1234/r1/voz.wav')).status()).toBe(400);
});
