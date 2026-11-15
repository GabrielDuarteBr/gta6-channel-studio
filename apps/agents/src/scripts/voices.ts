/**
 * Vozes do Google (Chirp 3 HD, pt-BR) disponíveis para a sua chave, com amostras para ouvir.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/voices.ts [--amostras] [--todas]
 * --amostras gera vozes/<Nome>.wav na pasta de trabalho (só vozes masculinas; --todas = todas).
 * Cada amostra tem ~100 caracteres e entra na cota grátis do mês (registrada no ledger).
 * A última linha é um JSON {"vozes": [...], "amostras": [...]} lido pelo rodar-fase-2.bat.
 */
import { getAllSettings, getPrisma } from '@studio/db';
import { GoogleTts, listGoogleChirpVoices, MediaAudioStore } from '@studio/providers';
import { parseEnv, serviceUrlsEnvSchema } from '@studio/shared';
import { googleCharsThisMonth, recordTts, TtsQuotaError } from '../character/tts';

const SAMPLE =
  'Fala, galera do Radar! Aqui é o Zeca Neon, e hoje tem notícia quente de GTA 6. Isso é rumor, hein!';

const env = parseEnv(serviceUrlsEnvSchema);
const prisma = getPrisma();
const apiKey = process.env.GOOGLE_TTS_API_KEY;
let code = 0;
try {
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY não configurada no .env');
  const settings = await getAllSettings(prisma);
  const voices = await listGoogleChirpVoices(apiKey, 'pt-BR');
  console.log(`Vozes Chirp 3 HD em pt-BR: ${voices.length}`);
  for (const v of voices) {
    const atual = v.name === settings.character.googleVoice ? '  ← atual' : '';
    console.log(
      `  ${v.name.padEnd(34)} ${v.gender === 'MALE' ? 'masculina' : v.gender === 'FEMALE' ? 'feminina' : v.gender}${atual}`,
    );
  }
  const samples: string[] = [];
  if (process.argv.includes('--amostras')) {
    const chosen = process.argv.includes('--todas')
      ? voices
      : voices.filter((v) => v.gender === 'MALE');
    const store = new MediaAudioStore(env.MEDIA_URL);
    const free = settings.character.freeCharsPerMonth;
    const needed = chosen.length * [...SAMPLE].length;
    const used = await googleCharsThisMonth(prisma);
    if (!settings.character.allowPaid && used + needed > free * 0.95) {
      throw new TtsQuotaError(
        `as amostras passariam da cota grátis (${used} + ${needed} de ${free})`,
      );
    }
    console.log(
      `\nGerando ${chosen.length} amostras (${needed} caracteres; já usados no mês: ${used})...`,
    );
    for (const v of chosen) {
      const tts = new GoogleTts({
        apiKey,
        voice: v.name,
        speakingRate: settings.character.speakingRate,
        store,
      });
      const name = v.name.split('-').pop()!;
      const r = await tts.synthesize({ text: SAMPLE, out: `vozes/${name}.wav` });
      await recordTts(prisma, tts, r, 'character:voice-sample', v.name);
      samples.push(r.path);
      console.log(`  ✓ ${name} (${r.durationSec.toFixed(1)} s)`);
    }
  }
  console.log(JSON.stringify({ vozes: voices.map((v) => v.name), amostras: samples }));
} catch (err) {
  code = 1;
  console.error(`❌ ${(err as Error).message}`);
  console.log(JSON.stringify({ erro: (err as Error).message.slice(0, 300) }));
} finally {
  await prisma.$disconnect();
}
process.exit(code);
