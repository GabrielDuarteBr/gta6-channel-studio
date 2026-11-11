import { expect, test, type Page } from '@playwright/test';

/** Dados de demonstração criados por seed-demo-pauta.ts (make e2e). Os testes dependem da ordem. */
test.describe.configure({ mode: 'serial' });

async function findStory(page: Page, text: string) {
  await page.goto(`/pauta?periodo=7d&ver=pauta&tipo=todas&q=${encodeURIComponent(text)}`);
  return page.getByTestId('historia').filter({ hasText: text }).first();
}

test('pauta: história oficial agrupada com as 3 fontes e links', async ({ page }) => {
  const story = await findStory(page, 'Trailer 3');
  await expect(story).toBeVisible();
  await expect(story.getByText('Oficial', { exact: true })).toBeVisible();
  await expect(story.getByText('3 fontes', { exact: false }).first()).toBeVisible();
  await expect(story.getByRole('link', { name: /Watch Trailer 3/ })).toHaveAttribute(
    'target',
    '_blank',
  );
});

test('pauta: virar longo, aparecer na fila e desfazer (com auditoria)', async ({ page }) => {
  const story = await findStory(page, 'Trailer 3');
  await story.getByRole('button', { name: 'Virar longo' }).click();
  await expect(story.getByRole('status')).toContainText('vai virar vídeo longo');

  await page.goto('/pauta?periodo=7d&ver=fila&tipo=todas');
  const queued = page.getByTestId('historia').filter({ hasText: 'Trailer 3' }).first();
  await expect(queued.getByText('Vídeo longo')).toBeVisible();
  await queued.getByRole('button', { name: 'Desfazer' }).click();
  await expect(queued.getByRole('status')).toContainText('voltou para novas');

  await page.goto('/saude');
  await expect(page.getByRole('cell', { name: 'story.status' }).first()).toBeVisible();
});

test('pauta: rumor de fonte única e vazamento ficam bloqueados com o motivo', async ({ page }) => {
  const rumor = await findStory(page, '$80');
  await expect(rumor.getByText(/Rumor · 1 fonte/)).toBeVisible();
  await expect(rumor.getByRole('button', { name: 'Virar longo' })).toBeDisabled();
  await expect(rumor.getByText('Rumor com menos de 2 fontes independentes.')).toBeVisible();

  const leak = await findStory(page, 'leaked footage');
  await expect(leak.getByText('Vazamento', { exact: true })).toBeVisible();
  await expect(leak.getByRole('button', { name: 'Virar Short' })).toBeDisabled();
  await expect(leak.getByText(/vazamento ou cópia pré-lançamento/)).toBeVisible();
});

test('fontes: lista, desativa/ativa e recusa endereço do YouTube', async ({ page }) => {
  await page.goto('/pauta/fontes');
  const row = page.getByTestId('fonte-demo-press');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('status-fonte')).toHaveText('ok');
  await expect(page.getByTestId('fonte-ign')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('reddit.com');

  await row.getByTestId('alternar-demo-press').click();
  await expect(page.getByTestId('fonte-demo-press').getByTestId('alternar-demo-press')).toHaveText(
    'Ativar',
  );
  await page.getByTestId('fonte-demo-press').getByTestId('alternar-demo-press').click();
  await expect(page.getByTestId('fonte-demo-press').getByTestId('alternar-demo-press')).toHaveText(
    'Desativar',
  );

  const form = page.getByTestId('form-nova-fonte');
  await form.getByLabel('Nome').fill('Canal pirata');
  await form
    .getByLabel('Endereço (https)')
    .fill('https://www.youtube.com/feeds/videos.xml?channel_id=x');
  await form.getByRole('button', { name: 'Adicionar' }).click();
  await expect(form.getByRole('alert')).toContainText('YouTube');

  await form.getByLabel('Nome').fill('Site de teste');
  await form.getByLabel('Endereço (https)').fill('https://noticias.exemplo.invalid/feed');
  await form.getByRole('button', { name: 'Adicionar' }).click();
  await expect(form.getByRole('status')).toContainText('adicionada');
});

// Por último: a coleta manual roda de verdade na pilha de testes e muda o status das fontes demo.
test('pauta: coletar agora enfileira a coleta', async ({ page }) => {
  await page.goto('/pauta');
  await page.getByTestId('coletar-agora').click();
  await expect(page.getByText('Coleta enfileirada')).toBeVisible();
});
