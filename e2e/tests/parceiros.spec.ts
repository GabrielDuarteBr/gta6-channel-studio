import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Fase 4: parceiro de teste + arquivo → Short de react dentro dos limites, com crédito e
 * condições; frase vaga não vira permissão; YouTube recusado; sem permissão ativa, para.
 */
test.describe.configure({ mode: 'serial' });

const video = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../fixtures/parceiro-teste.mp4'),
);

test('parceiros: candidato com indício e rascunho; frase vaga não vira permissão', async ({
  page,
}) => {
  await page.goto('/parceiros');
  const card = page.getByTestId('candidato').filter({ hasText: 'Canal Demo GTA' });
  await expect(card.getByTestId('indicio')).toContainText('cortes liberados');
  await card.getByText('Rascunho da mensagem').click();
  await expect(card.getByTestId('rascunho-mensagem')).toHaveValue(/voz sintética/);
  await expect(card.getByTestId('rascunho-mensagem')).toHaveValue(/não baixamos nada do YouTube/);

  await card.getByText('Ele autorizou? Registrar permissão').click();
  const form = card.getByTestId('form-permissao');
  await form
    .getByLabel(/Prova \(o que ele escreveu/)
    .fill('Na descrição do canal: cortes liberados!!');
  await form.getByLabel('Crédito (na tela e na descrição)').fill('Canal Demo GTA');
  await form.getByLabel(/Hashtag pedida/).fill('#canaldemo');
  await form.getByLabel(/Confirmo que o criador autorizou/).check();
  await form.getByRole('button', { name: 'Registrar permissão' }).click();
  await expect(form.getByTestId('retorno-permissao')).toContainText('não é permissão');

  await form
    .getByLabel(/Prova \(o que ele escreveu/)
    .fill(
      'E-mail de contato@canaldemo.example em 15/11/2026: "Autorizo o Radar Neon a usar cortes dos meus vídeos em Shorts de react, com crédito e link do canal."',
    );
  await form.getByRole('button', { name: 'Registrar permissão' }).click();
  await expect(form.getByTestId('retorno-permissao')).toContainText('Permissão registrada');
  await page.reload();
  await expect(
    page
      .getByTestId('parceiro')
      .filter({ hasText: 'Canal Demo GTA' })
      .getByTestId('status-permissao'),
  ).toHaveText('permissão ativa');
});

test('parceiros: link do YouTube é recusado e o vídeo enviado vira transcrição', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/parceiros');
  const partner = page.getByTestId('parceiro').filter({ hasText: 'Canal Demo GTA' });
  const link = partner.getByTestId('form-importar-link');
  await link
    .getByLabel(/Link do Dropbox ou do Google Drive/)
    .fill('https://www.youtube.com/watch?v=abc123');
  await link.getByRole('button', { name: 'Importar' }).click();
  await expect(link.getByTestId('retorno-importar')).toContainText('YouTube');

  const upload = partner.getByTestId('form-enviar-video');
  await upload.getByLabel(/Ou envie o arquivo/).setInputFiles({
    name: 'perseguicao-na-ponte.mp4',
    mimeType: 'video/mp4',
    buffer: video,
  });
  await upload.getByLabel('Título do envio').fill('Perseguição na ponte');
  await upload.getByRole('button', { name: 'Enviar' }).click();
  await expect(upload.getByTestId('retorno-envio')).toContainText('Arquivo recebido');

  await expect(async () => {
    await page.reload();
    const v = page.getByTestId('video-parceiro').filter({ hasText: 'Perseguição na ponte' });
    await expect(v.getByTestId('status-analise')).toHaveText('transcrição pronta', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 280_000, intervals: [5_000] });
  const v = page.getByTestId('video-parceiro').filter({ hasText: 'Perseguição na ponte' });
  await expect(v).toContainText('trecho(s) de fala');
  await expect(v.locator('video')).toHaveAttribute(
    'src',
    /\/api\/media\/partners\/[0-9a-f]{64}\.mp4/,
  );
});

test('react: Short com clipe ≤ 45%, pausado nos comentários, crédito e descrição; revogar lista o vídeo', async ({
  page,
}) => {
  test.setTimeout(480_000);
  await page.goto('/parceiros');
  const v = page.getByTestId('video-parceiro').filter({ hasText: 'Perseguição na ponte' });
  await v.getByRole('button', { name: 'Produzir Short de react' }).click();
  await expect(v.getByTestId('retorno-react')).toContainText('na fila');

  await page.goto('/producao');
  const prod = page
    .getByTestId('producao')
    .filter({ has: page.getByTestId('tipo-react') })
    .first();
  await expect(async () => {
    await page.reload();
    await expect(
      page
        .getByTestId('producao')
        .filter({ has: page.getByTestId('tipo-react') })
        .first()
        .getByTestId('status-producao'),
    ).toHaveText('pronto', { timeout: 1_000 });
  }).toPass({ timeout: 450_000, intervals: [5_000] });
  await expect(prod.getByTestId('video-producao')).toHaveAttribute('src', /react\.mp4$/);
  const dados = prod.getByTestId('dados-react');
  const pct = Number(/Clipe do parceiro: (\d+)%/.exec((await dados.textContent()) ?? '')?.[1]);
  expect(pct).toBeGreaterThan(0);
  expect(pct).toBeLessThanOrEqual(45);
  await dados.getByText(/Descrição \(com crédito/).click();
  await expect(prod.getByTestId('descricao-react')).toContainText('Clipe: Canal Demo GTA');
  await expect(prod.getByTestId('descricao-react')).toContainText('#canaldemo');
  await expect(prod.getByTestId('descricao-react')).toContainText('voz sintética (IA)');

  // Revogar: o vídeo aparece na lista de afetados e o botão de react trava.
  await page.goto('/parceiros');
  const partner = page.getByTestId('parceiro').filter({ hasText: 'Canal Demo GTA' });
  const status = partner.getByTestId('form-status-permissao').first();
  await status.getByLabel('Motivo').fill('pedido do parceiro (teste)');
  await status.getByRole('button', { name: 'Revogar' }).click();
  await expect(status.getByTestId('retorno-status-permissao')).toContainText('1 vídeo(s)');
  await expect(status.getByTestId('videos-afetados')).toContainText('READY');
  await page.reload();
  const again = page.getByTestId('parceiro').filter({ hasText: 'Canal Demo GTA' });
  await expect(again.getByTestId('status-permissao').first()).toHaveText('permissão revogada');
  await expect(
    again.getByRole('button', { name: 'Produzir Short de react' }).first(),
  ).toBeDisabled();
  await expect(again).toContainText('Sem permissão ativa');
});
