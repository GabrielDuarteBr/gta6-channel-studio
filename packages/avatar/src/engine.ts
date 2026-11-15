import type { Expression, Gesture, MouthShape } from './spec';
import {
  breathAt,
  expressionAt,
  eyeOpennessAt,
  gestureAt,
  mouthAt,
  type CharacterTimeline,
} from './timeline';

/**
 * Motores de avatar atrás de uma interface única (plano: Caminho A Rive, Caminho B camadas).
 * O render escolhe o motor; a linha do tempo e o estado de cada quadro são os mesmos.
 */
export type AvatarEngineId = 'layers' | 'rive';

export interface AvatarEngineInfo {
  id: AvatarEngineId;
  label: string;
  status: 'padrão' | 'prova de conceito';
  description: string;
}

export const AVATAR_ENGINES: Record<AvatarEngineId, AvatarEngineInfo> = {
  layers: {
    id: 'layers',
    label: 'Camadas (SVG)',
    status: 'padrão',
    description:
      'Partes do personagem em camadas (corpo, cabeça, olhos, sobrancelhas, 9 bocas, braço). ' +
      'Totalmente determinístico e sem custo de licença.',
  },
  rive: {
    id: 'rive',
    label: 'Rive',
    status: 'prova de conceito',
    description:
      'Arquivo .riv animado no editor do Rive. Em teste: controle quadro a quadro dentro do ' +
      'Remotion e resultado idêntico entre renders.',
  },
};

/** Tudo que o desenho precisa saber num quadro. */
export interface AvatarFrameState {
  expression: Expression;
  mouth: MouthShape;
  /** 1 = olho aberto, 0 = fechado. */
  eyeOpen: number;
  gesture: { id: Gesture; amount: number; phase: number } | null;
  /** -1..1 (respiração). */
  breath: number;
}

export const IDLE_STATE: AvatarFrameState = {
  expression: 'neutro',
  mouth: 'X',
  eyeOpen: 1,
  gesture: null,
  breath: 0,
};

export function frameState(
  tl: CharacterTimeline,
  frame: number,
  fps: number,
  blinks: number[],
): AvatarFrameState {
  const t = frame / fps;
  const g = gestureAt(tl, t);
  return {
    expression: expressionAt(tl, t),
    mouth: mouthAt(tl.mouthCues, t),
    eyeOpen: eyeOpennessAt(blinks, frame, fps),
    gesture: g ? { id: g.gesture, amount: g.amount, phase: g.phase } : null,
    breath: breathAt(frame, fps),
  };
}
