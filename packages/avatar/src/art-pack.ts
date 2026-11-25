import { z } from 'zod';
import type { AvatarFrameState } from './engine';
import { EXPRESSIONS, GESTURES, MOUTH_SHAPES, type Expression } from './spec';

/**
 * Pacote de arte do personagem (arte autoral do ilustrador) em camadas PNG ou SVG, todas do
 * MESMO tamanho de tela, com nomes fixos. O painel confere o pacote; o render monta cada quadro
 * trocando camadas (boca do Rhubarb, olhos, sobrancelhas da expressão, braço do gesto).
 * Guia para o artista: docs/guia-arte-zeca.md.
 */

export const MOUTH_LAYERS = MOUTH_SHAPES.map((m) => `boca-${m}`);

/** Sem estas o pacote não entra. */
export const REQUIRED_LAYERS = [
  'corpo',
  'cabeca',
  'olhos-aberto',
  'olhos-fechado',
  'sobrancelhas-neutro',
  ...MOUTH_LAYERS,
] as const;

/** Opcionais (quando faltam, usa a camada neutra/aberta e o painel avisa). */
export const OPTIONAL_LAYERS = [
  'costas',
  'frente',
  'olhos-meio',
  'braco-repouso',
  ...GESTURES.map((g) => `braco-${g}`),
  ...EXPRESSIONS.filter((e) => e !== 'neutro').map((e) => `sobrancelhas-${e}`),
  ...EXPRESSIONS.map((e) => `olhos-${e}`),
  ...EXPRESSIONS.map((e) => `rosto-${e}`),
] as const;

const KNOWN = new Set<string>([...REQUIRED_LAYERS, ...OPTIONAL_LAYERS]);

export const ART_LIMITS = {
  maxFiles: 80,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
};

/** Pontos de giro (em % da tela): cabeça (pescoço) e braço (ombro). */
export const pivotsSchema = z.object({
  head: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
  arm: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
});
export type ArtPivots = z.infer<typeof pivotsSchema>;
export const DEFAULT_PIVOTS: ArtPivots = { head: [50, 55], arm: [66, 62] };

/** O que o render recebe (vai nas props das composições). */
export const artPackRefSchema = z.object({
  version: z.number().int().positive(),
  canvas: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  /** camada → caminho relativo à base (pasta de trabalho no render; /api no painel). */
  files: z.record(z.string(), z.string().regex(/^[a-z0-9/_.-]+$/i)),
  pivots: pivotsSchema,
});
export type ArtPackRef = z.infer<typeof artPackRefSchema>;

/** "Cabeça.PNG", "boca-a.png", "boca_A.svg" → camada conhecida (ou null). */
export function layerNameOf(filename: string): { layer: string; ext: 'png' | 'svg' } | null {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const m = /^(.+)\.(png|svg)$/i.exec(base);
  if (!m) return null;
  let name = m[1]!
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-');
  const mouth = /^boca-([a-hx])$/.exec(name);
  if (mouth) name = `boca-${mouth[1]!.toUpperCase()}`;
  name = name.replace(/^braco-aponta-tela$/, 'braco-aponta_tela');
  return KNOWN.has(name) ? { layer: name, ext: m[2]!.toLowerCase() as 'png' | 'svg' } : null;
}

function pngSize(b: Uint8Array): { w: number; h: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/** SVG que pode rodar código ou buscar coisas de fora é recusado. */
const SVG_DANGER =
  /<script|<foreignobject|<!entity|<!doctype|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|webp);base64,)/i;

function svgSize(text: string): { w: number; h: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
  const w = /\swidth\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
  const h = /\sheight\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
  return w && h ? { w: Math.round(Number(w[1])), h: Math.round(Number(h[1])) } : null;
}

export interface ArtFileInput {
  name: string;
  bytes: Uint8Array;
}

export interface ArtCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  canvas: { w: number; h: number } | null;
  layers: Array<{ layer: string; ext: 'png' | 'svg'; mime: string; file: ArtFileInput }>;
}

/** Confere o pacote: nomes, tipo pelos bytes, SVG seguro, mesmo tamanho, camadas obrigatórias. */
export function checkArtFiles(files: ArtFileInput[]): ArtCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const layers: ArtCheck['layers'] = [];
  if (files.length === 0) errors.push('nenhum arquivo enviado');
  if (files.length > ART_LIMITS.maxFiles)
    errors.push(`arquivos demais (máximo ${ART_LIMITS.maxFiles})`);
  const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
  if (total > ART_LIMITS.maxTotalBytes) {
    errors.push(`pacote grande demais (${Math.round(total / 1048576)} MB; máximo 24 MB)`);
  }
  const sizes: Array<{ layer: string; w: number; h: number; svg: boolean }> = [];
  const seen = new Set<string>();
  for (const f of files) {
    const id = layerNameOf(f.name);
    if (!id) {
      warnings.push(`ignorado (nome fora do padrão): ${f.name}`);
      continue;
    }
    if (seen.has(id.layer)) {
      errors.push(`camada repetida: ${id.layer} (envie só um arquivo por camada)`);
      continue;
    }
    seen.add(id.layer);
    if (f.bytes.byteLength > ART_LIMITS.maxFileBytes) {
      errors.push(`${f.name}: maior que 8 MB`);
      continue;
    }
    if (id.ext === 'png') {
      const size = pngSize(f.bytes);
      if (!size) {
        errors.push(`${f.name}: não é um PNG de verdade`);
        continue;
      }
      sizes.push({ layer: id.layer, ...size, svg: false });
      layers.push({ layer: id.layer, ext: 'png', mime: 'image/png', file: f });
    } else {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(f.bytes);
      if (!/<svg\b/i.test(text)) {
        errors.push(`${f.name}: não é um SVG`);
        continue;
      }
      if (SVG_DANGER.test(text)) {
        errors.push(
          `${f.name}: SVG com script, link externo ou conteúdo embutido não permitido (exporte de novo como SVG simples ou PNG)`,
        );
        continue;
      }
      const size = svgSize(text);
      if (!size) {
        errors.push(`${f.name}: SVG sem viewBox (ou largura/altura)`);
        continue;
      }
      sizes.push({ layer: id.layer, ...size, svg: true });
      layers.push({ layer: id.layer, ext: 'svg', mime: 'image/svg+xml', file: f });
    }
  }

  // Todas as camadas na MESMA tela: PNGs com o mesmo tamanho exato; SVGs com a mesma proporção.
  // Referência = o tamanho da maioria (PNGs têm prioridade): só o arquivo diferente é apontado.
  const pool = sizes.some((s) => !s.svg) ? sizes.filter((s) => !s.svg) : sizes;
  const counts = new Map<string, number>();
  for (const s of pool) counts.set(`${s.w}x${s.h}`, (counts.get(`${s.w}x${s.h}`) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ref = pool.find((s) => `${s.w}x${s.h}` === top);
  let canvas: ArtCheck['canvas'] = null;
  if (ref) {
    canvas = { w: ref.w, h: ref.h };
    for (const s of sizes) {
      const same = s.svg
        ? Math.abs(s.w / s.h - ref.w / ref.h) < 0.005
        : s.w === ref.w && s.h === ref.h;
      if (!same) {
        errors.push(
          `${s.layer}: tamanho ${s.w}×${s.h} diferente da tela ${ref.w}×${ref.h} (todas as camadas precisam ter o mesmo tamanho)`,
        );
      }
    }
    if (Math.min(ref.w, ref.h) < 500 && !ref.svg) {
      warnings.push(`tela pequena (${ref.w}×${ref.h}); recomendado pelo menos 1500 px de altura`);
    }
  }

  for (const r of REQUIRED_LAYERS)
    if (!seen.has(r)) errors.push(`falta a camada obrigatória: ${r}`);
  const missingBrows = EXPRESSIONS.filter((e) => e !== 'neutro' && !seen.has(`sobrancelhas-${e}`));
  if (missingBrows.length) {
    warnings.push(`sem sobrancelhas para: ${missingBrows.join(', ')} (usa a neutra)`);
  }
  for (const g of GESTURES) {
    if (!seen.has(`braco-${g}`)) warnings.push(`sem braco-${g}: o gesto não aparece`);
  }
  if ((seen.has('braco-aponta_tela') || seen.has('braco-aceno')) && !seen.has('braco-repouso')) {
    warnings.push('sem braco-repouso: fora dos gestos o braço fica como no corpo');
  }
  return { ok: errors.length === 0, errors, warnings, canvas, layers };
}

/** Inclinação da cabeça por expressão (graus), igual à arte provisória. */
export const HEAD_TILT: Record<Expression, number> = {
  neutro: 0,
  feliz: 2,
  empolgado: 4,
  debochado: -4,
  desconfiado: 3,
  surpreso: 0,
  serio: 0,
  bravo: -1,
};

export interface LayerFrame {
  /** Camada mostrada em cada lugar neste quadro (as outras ficam carregadas, invisíveis). */
  back: string | null;
  body: string;
  arm: string | null;
  head: string;
  eyes: string;
  brows: string;
  mouth: string;
  face: string | null;
  front: string | null;
  /** Transformações em % do tamanho da tela e graus. */
  bodyShiftY: number;
  headShiftY: number;
  headTilt: number;
  armRotate: number;
}

/** Quais camadas aparecem num quadro (função pura: o mesmo estado dá o mesmo quadro). */
export function layerFrame(state: AvatarFrameState, available: ReadonlySet<string>): LayerFrame {
  const has = (l: string) => available.has(l);
  const e = state.expression;
  const eyes =
    state.eyeOpen < 0.35
      ? 'olhos-fechado'
      : state.eyeOpen < 0.75 && has('olhos-meio')
        ? 'olhos-meio'
        : has(`olhos-${e}`)
          ? `olhos-${e}`
          : 'olhos-aberto';
  const g = state.gesture;
  let arm = has('braco-repouso') ? 'braco-repouso' : null;
  let armRotate = 0;
  if (g && g.amount > 0.5 && has(`braco-${g.id}`)) {
    arm = `braco-${g.id}`;
    if (g.amount > 0.99) {
      armRotate =
        g.id === 'aceno'
          ? Math.sin(g.phase * Math.PI * 6) * 7
          : Math.sin(g.phase * Math.PI * 6) * 1.5;
    }
  }
  return {
    back: has('costas') ? 'costas' : null,
    body: 'corpo',
    arm,
    head: 'cabeca',
    eyes,
    brows: has(`sobrancelhas-${e}`) ? `sobrancelhas-${e}` : 'sobrancelhas-neutro',
    mouth: `boca-${state.mouth}`,
    face: has(`rosto-${e}`) ? `rosto-${e}` : null,
    front: has('frente') ? 'frente' : null,
    bodyShiftY: state.breath * 0.25,
    headShiftY: state.breath * 0.4,
    headTilt: HEAD_TILT[e],
    armRotate,
  };
}
