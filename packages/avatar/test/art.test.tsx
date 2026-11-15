import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXPRESSIONS, IDLE_STATE, MOUTH_SHAPES, type AvatarFrameState } from '../src';
import { ZecaArt } from '../src/art';

const svg = (state: Partial<AvatarFrameState>, provisional = true) =>
  renderToStaticMarkup(<ZecaArt state={{ ...IDLE_STATE, ...state }} provisional={provisional} />);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

describe('arte em camadas do Zeca', () => {
  it('mesmo estado, mesmo SVG (determinístico)', () => {
    const state = { expression: 'surpreso', mouth: 'D', eyeOpen: 0.5, breath: 0.3 } as const;
    expect(hash(svg(state))).toBe(hash(svg(state)));
  });

  it('cada expressão e cada forma de boca desenham algo diferente', () => {
    const byExpression = new Set(EXPRESSIONS.map((expression) => hash(svg({ expression }))));
    expect(byExpression.size).toBe(EXPRESSIONS.length);
    const byMouth = new Set(MOUTH_SHAPES.map((mouth) => hash(svg({ mouth }))));
    expect(byMouth.size).toBe(MOUTH_SHAPES.length);
  });

  it('piscada, gesto e respiração mudam o desenho', () => {
    const base = svg({});
    expect(svg({ eyeOpen: 0 })).not.toBe(base);
    expect(svg({ gesture: { id: 'aponta_tela', amount: 1, phase: 0.5 } })).not.toBe(base);
    expect(svg({ breath: 1 })).not.toBe(base);
  });

  it('marca a arte como provisória (e some quando a arte final chegar)', () => {
    expect(svg({})).toContain('ARTE PROVISÓRIA');
    expect(svg({}, false)).not.toContain('ARTE PROVISÓRIA');
  });
});
