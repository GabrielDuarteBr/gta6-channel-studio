import { expect, test } from '@playwright/test';
import { totpAt } from './owner';

/**
 * Etapa final (Fases 5–7): Comando, Conformidade → Aprovação → envio simulado → Calendário,
 * Configurações do YouTube, produção diária e piloto automático. Roda depois de producao.spec
 * e parceiros.spec (ordem alfabética), que deixam vídeos prontos.
 */
test.describe.configure({ mode: 'serial' });

test('comando: o Diretor usa as ferramentas e publicar vira um pedido para você', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/comando');
  await expect(page.getByRole('heading', { name: 'Comando', exact: true })).toBeVisible();

  const ask = async (text: string) => {
    const before = await page.getByTestId('msg-diretor').count();
    await page.getByTestId('campo-chat').fill(text);
    await page.getByTestId('enviar-chat').click();
    await expect(page.getByTestId('msg-diretor')).toHaveCount(before + 1, { timeout: 20_000 });
    const reply = page.getByTestId('msg-diretor').last();
    await expect(reply).toContainText('(modo simulado)', { timeout: 30_000 });
    return reply;
  };

  const pauta = await ask('Como está a pauta hoje?');
  await expect(pauta.getByTestId('ferramentas')).toContainText('viu a pauta');

  const custos = await ask('Quanto gastei hoje?');
  await expect(custos.getByTestId('ferramentas')).toContainText('leu os custos');
  await expect(custos).toContainText('R$');
  await expect(page.locator('body')).not.toContainText('US$');

  // Publicar é ação no canal: vira pedido; aqui o dono recusa (nada é enviado).
  const pub = await ask('Pode publicar o vídeo pronto');
  const tools = await pub.getByTestId('ferramentas').innerText();
  if (tools.includes('pediu publicação')) {
    const pedido = page.getByTestId('pedido').first();
    await expect(pedido).toContainText('sobe privado e agendado');
    await pedido.getByRole('button', { name: 'Recusar' }).click();
    await expect(page.getByTestId('pedido-decidido').first()).toContainText('recusado', {
      timeout: 15_000,
    });
  }
});

test('aprovação: Conformidade aprova, dono edita o título e agenda (envio simulado)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/aprovacao');
  const item = page.getByTestId('item-aprovacao').filter({ hasText: 'Trailer 3' }).first();
  await expect(async () => {
    await page.reload();
    await expect(item.getByTestId('conformidade-status')).toHaveText('Conformidade: aprovada', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 90_000, intervals: [3_000] });

  const report = item.getByTestId('relatorio-conformidade');
  await expect(report).toContainText('Aviso de IA na descrição');
  await expect(item.getByLabel(/Descrição/)).toHaveValue(/Fontes:/);
  await expect(item.getByLabel(/Descrição/)).toHaveValue(/voz sintética \(IA\)/);

  // Edita o título: a Conformidade confere de novo antes de liberar.
  const title = item.getByLabel(/^Título/);
  await title.fill('Trailer 3 do GTA 6: o que a Rockstar confirmou');
  await item.getByRole('button', { name: 'Salvar e conferir de novo' }).click();
  await expect(item.getByTestId('form-metadados').getByRole('status')).toContainText('Salvo');
  await expect(async () => {
    await page.reload();
    await expect(item.getByTestId('conformidade-status')).toHaveText('Conformidade: aprovada', {
      timeout: 1_000,
    });
    await expect(item.getByLabel(/^Título/)).toHaveValue(/o que a Rockstar confirmou/);
  }).toPass({ timeout: 60_000, intervals: [2_000] });

  // Data no passado é recusada; a sugerida (próximo horário livre) é aceita.
  const when = item.getByLabel('Publicar em (horário de Brasília)');
  const suggested = await when.inputValue();
  await when.fill('2026-01-01T12:00');
  await item.getByTestId('aprovar').click();
  await expect(item.getByTestId('form-aprovar').getByRole('alert')).toContainText('30 minutos');
  await when.fill(suggested);
  await item.getByTestId('aprovar').click();
  await expect(item.getByTestId('form-aprovar').getByRole('status')).toContainText('Modo simulado');

  const pub = page
    .getByTestId('publicacao')
    .filter({ hasText: 'o que a Rockstar confirmou' })
    .first();
  await expect(async () => {
    await page.reload();
    await expect(pub.getByTestId('status-publicacao')).toHaveText('agendado (privado)', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 60_000, intervals: [2_000] });
  await expect(pub).toContainText('simulado');

  await page.goto('/calendario');
  await expect(
    page.getByTestId('calendario').getByTestId('evento').filter({ hasText: 'Rockstar confirmou' }),
  ).toBeVisible();

  await page.goto('/producao');
  await expect(page.getByTestId('kanban')).toBeVisible();
  await expect(page.getByTestId('coluna-agendado')).toContainText('1');

  await page.goto('/saude');
  await expect(page.getByRole('cell', { name: 'publish.approve' }).first()).toBeVisible();
});

test('configurações: YouTube sem cliente OAuth, produção diária e piloto automático com 2FA', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/api/youtube/connect');
  await expect(page).toHaveURL(/\/configuracoes\?youtube=sem-chaves/);
  const card = page.getByTestId('cartao-youtube');
  await expect(card.getByTestId('youtube-status')).toHaveText('Não conectado');
  await expect(card).toContainText('GOOGLE_OAUTH_CLIENT_ID');

  const daily = page.getByTestId('form-schedule.daily');
  await expect(daily.getByLabel('Horário')).toHaveValue('07:41');
  await daily.getByTestId('rodar-diaria').click();
  await expect(daily.getByText('Na fila. Veja em Produção.')).toBeVisible();

  // Ligar o piloto automático exige o código do app autenticador.
  const pilot = page.getByTestId('form-mode.autopilot');
  await pilot.getByTestId('toggle-piloto').check({ force: true });
  await pilot.getByLabel(/Código do app autenticador/).fill('000000');
  await pilot.getByRole('button', { name: 'Salvar' }).click();
  await expect(pilot.getByRole('alert')).toContainText('Código do app autenticador inválido');

  // Código válido (passo seguinte ao do login, que não pode ser reutilizado).
  await pilot.getByLabel(/Código do app autenticador/).fill(await totpAt(30));
  await pilot.getByRole('button', { name: 'Salvar' }).click();
  await expect(pilot.getByRole('status')).toContainText('Salvo');
  await page.reload();
  await expect(page.getByTestId('form-mode.autopilot').getByTestId('toggle-piloto')).toBeChecked();

  // Desligar não pede código.
  const again = page.getByTestId('form-mode.autopilot');
  await again.getByTestId('toggle-piloto').uncheck({ force: true });
  await again.getByRole('button', { name: 'Salvar' }).click();
  await expect(again.getByRole('status')).toContainText('Salvo');
});

test('visão geral: indicadores, gráfico e por formato', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('indicadores')).toContainText('Esperando aprovação');
  await expect(page.getByTestId('indicadores')).toContainText('R$');
  await expect(page.getByTestId('grafico-views')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('US$');
});
