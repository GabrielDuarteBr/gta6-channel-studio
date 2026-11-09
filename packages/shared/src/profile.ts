import type { AppProfile } from './config';

/** Ajustes técnicos que mudam entre o notebook (testes) e a VPS (produção). */
export interface ProfileDefaults {
  label: string;
  /** Altura padrão do render (16:9 → 1280x720 ou 1920x1080). */
  renderHeight: 720 | 1080;
  /** Renders simultâneos (o render é o job mais pesado). */
  renderConcurrency: number;
  /** Modelo do faster-whisper (CPU, int8). */
  whisperModel: 'tiny' | 'base' | 'small' | 'medium';
  /** Horas até apagar arquivos temporários. */
  tempRetentionHours: number;
  /** Concorrência por fila. */
  queueConcurrency: {
    research: number;
    llm: number;
    tts: number;
    image: number;
    render: number;
    upload: number;
    media: number;
    system: number;
  };
}

export const PROFILES: Record<AppProfile, ProfileDefaults> = {
  notebook: {
    label: 'Notebook (testes)',
    renderHeight: 720,
    renderConcurrency: 1,
    whisperModel: 'small',
    tempRetentionHours: 6,
    queueConcurrency: {
      research: 2,
      llm: 2,
      tts: 1,
      image: 1,
      render: 1,
      upload: 1,
      media: 1,
      system: 1,
    },
  },
  vps: {
    label: 'VPS (produção 24 h)',
    renderHeight: 1080,
    renderConcurrency: 1,
    whisperModel: 'small',
    tempRetentionHours: 24,
    queueConcurrency: {
      research: 4,
      llm: 4,
      tts: 2,
      image: 2,
      render: 1,
      upload: 1,
      media: 2,
      system: 1,
    },
  },
};

export function profileDefaults(profile: AppProfile): ProfileDefaults {
  return PROFILES[profile];
}

/** Dimensões de render para um formato e uma altura base. */
export function renderDimensions(
  format: 'landscape' | 'vertical',
  height: 720 | 1080,
): { width: number; height: number } {
  const long = height === 1080 ? 1920 : 1280;
  return format === 'landscape' ? { width: long, height } : { width: height, height: long };
}
