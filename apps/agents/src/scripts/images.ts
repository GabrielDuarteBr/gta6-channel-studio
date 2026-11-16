/**
 * Comparativo de imagens do Google (Fase 3): lista os modelos de imagem que a sua chave
 * enxerga e, com --comparar, gera as mesmas 3 imagens de teste em cada modelo escolhido.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/images.ts [--comparar] [--modelos=a,b]
 * As amostras vão para comparativo-imagens/<modelo>/<n>.png na pasta de trabalho (não entram
 * na Biblioteca). Cada imagem é paga (preço aproximado na tabela) e entra no teto de gasto.
 * A última linha é um JSON {"modelos": [...], "amostras": [...], "custoUsd": n} para o .bat.
 */
import { currentFx, getAllSettings, getPrisma } from '@studio/db';
import { assertWithinBudget } from '@studio/llm';
import {
  GoogleImageProvider,
  listGoogleImageModels,
  ProviderError,
  type GoogleImageModel,
} from '@studio/providers';
import { channelDay, parseEnv, serviceUrlsEnvSchema } from '@studio/shared';
import { MediaService } from '../character/services';
import { budgetStatus } from '../research/ledger';

const PROMPTS = [
  'Neon-lit tropical city skyline at dusk seen from the beach, palm trees in the foreground',
  'Retro sports car on an empty coastal highway at sunset, synthwave sky, ocean on the side',
  'Busy downtown street at night with colorful neon signs reflected on wet asphalt, no faces visible',
];

/** Escolha padrão: o Imagen mais barato, um Gemini "lite" e um Gemini "flash" de imagem. */
function pickDefault(models: GoogleImageModel[]): GoogleImageModel[] {
  const pick = (re: RegExp) => models.find((m) => re.test(m.id));
  const chosen = [
    pick(/^imagen.*fast/) ?? pick(/^imagen/),
    pick(/lite.*image|image.*lite/),
    pick(/flash.*image(?!.*lite)/),
  ].filter((m): m is GoogleImageModel => Boolean(m));
  return [...new Map(chosen.map((m) => [m.id, m])).values()];
}

const env = parseEnv(serviceUrlsEnvSchema);
const prisma = getPrisma();
const apiKey = process.env.GEMINI_API_KEY;
let code = 0;
try {
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no .env');
  const settings = await getAllSettings(prisma);
  const fx = await currentFx(prisma);
  const models = await listGoogleImageModels(apiKey);
  console.log(`Modelos de imagem disponíveis para a chave: ${models.length}`);
  for (const m of models) {
    const atual = m.id === settings.images.model ? '  ← atual' : '';
    console.log(`  ${m.id.padEnd(40)} ~${fx.formatUsd(m.priceUsd)}/imagem${atual}`);
  }
  const samples: Array<Record<string, unknown>> = [];
  let total = 0;
  if (process.argv.includes('--comparar')) {
    const arg = process.argv.find((a) => a.startsWith('--modelos='));
    const wanted = arg ? arg.slice('--modelos='.length).split(',').filter(Boolean) : null;
    const chosen = wanted ? models.filter((m) => wanted.includes(m.id)) : pickDefault(models);
    if (chosen.length === 0) throw new Error('nenhum modelo de imagem para comparar');
    const projected = chosen.reduce((n, m) => n + m.priceUsd * PROMPTS.length, 0);
    const b = await budgetStatus(prisma);
    assertWithinBudget({
      ...b,
      spentTodayUsd: b.spentTodayUsd + projected,
      spentMonthUsd: b.spentMonthUsd + projected,
    });
    console.log(
      `\nComparando ${chosen.map((m) => m.id).join(', ')} (${PROMPTS.length} imagens cada; ~${fx.formatUsd(projected)})...`,
    );
    const media = new MediaService(env.MEDIA_URL);
    for (const m of chosen) {
      const provider = new GoogleImageProvider(apiKey, m.id);
      for (const [i, prompt] of PROMPTS.entries()) {
        const started = performance.now();
        try {
          const img = await provider.generate({
            prompt: `${prompt}. ${settings.images.style}`,
            aspectRatio: '16:9',
          });
          const ext =
            img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
          const out = `comparativo-imagens/${m.id}/${i + 1}.${ext}`;
          await media.importImage(out, img.bytes);
          await prisma.costLedger.create({
            data: {
              dayKey: channelDay(),
              provider: 'image',
              model: m.id,
              task: 'image:comparativo',
              units: 1,
              costUsd: img.costUsd,
            },
          });
          total += img.costUsd;
          const seconds = Number(((performance.now() - started) / 1000).toFixed(1));
          samples.push({
            modelo: m.id,
            n: i + 1,
            arquivo: out,
            segundos: seconds,
            custoUsd: img.costUsd,
            custoBrl: Number(fx.usdToBrl(img.costUsd).toFixed(4)),
          });
          console.log(`  ✓ ${m.id} #${i + 1} (${seconds} s)`);
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err;
          samples.push({ modelo: m.id, n: i + 1, erro: err.message });
          console.log(`  ✗ ${m.id} #${i + 1}: ${err.message}`);
        }
      }
    }
    console.log(
      `\nAmostras em comparativo-imagens/ (pasta de trabalho). Custo aproximado: ${fx.formatUsd(total)}.`,
    );
    console.log('Escolha o modelo em Configurações → Imagens.');
  }
  console.log(
    JSON.stringify({
      modelos: models.map((m) => ({
        id: m.id,
        precoUsd: m.priceUsd,
        precoBrl: Number(fx.usdToBrl(m.priceUsd).toFixed(4)),
      })),
      amostras: samples,
      custoUsd: Number(total.toFixed(4)),
      custoBrl: Number(fx.usdToBrl(total).toFixed(4)),
    }),
  );
} catch (err) {
  console.error(`Erro: ${(err as Error).message}`);
  code = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(code);
