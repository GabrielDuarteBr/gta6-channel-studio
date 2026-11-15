import { CachedTts, GoogleTts, MediaAudioStore, type CharGuard } from './google-tts';
import {
  FakeTts,
  ProviderError,
  type FetchLike,
  type TtsProvider,
  type TtsProviderId,
} from './tts';

export interface TtsFactoryOptions {
  mediaUrl: string;
  fetchImpl?: FetchLike;
  google?: { apiKey?: string | undefined; voice: string; speakingRate: number; guard?: CharGuard };
}

/** Escolhe o provedor de voz. O Google vem sempre com cache (não paga o mesmo trecho 2 vezes). */
export function createTtsProvider(id: TtsProviderId, opts: TtsFactoryOptions): TtsProvider {
  switch (id) {
    case 'fake':
      return new FakeTts(opts.mediaUrl, opts.fetchImpl);
    case 'google': {
      if (!opts.google?.apiKey) {
        throw new ProviderError('voz do Google sem chave: configure GOOGLE_TTS_API_KEY no .env');
      }
      const store = new MediaAudioStore(opts.mediaUrl, opts.fetchImpl);
      const google = new GoogleTts({
        apiKey: opts.google.apiKey,
        voice: opts.google.voice,
        speakingRate: opts.google.speakingRate,
        store,
        ...(opts.google.guard ? { guard: opts.google.guard } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      return new CachedTts(google, store);
    }
  }
}
