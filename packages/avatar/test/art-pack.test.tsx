import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  checkArtFiles,
  DEFAULT_PIVOTS,
  IDLE_STATE,
  layerFrame,
  layerNameOf,
  REQUIRED_LAYERS,
  type ArtFileInput,
  type ArtPackRef,
} from '../src';
import { LayeredArt } from '../src/art';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(here, '../../../docs/modelo-arte-zeca');
const model = (): ArtFileInput[] =>
  readdirSync(modelDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(path.join(modelDir, f))) }));

/** PNG mínimo com o tamanho pedido (só o cabeçalho importa para a conferência). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

describe('pacote de arte do artista (camadas)', () => {
  it('nomes do Windows viram camadas conhecidas', () => {
    expect(layerNameOf('Cabeça.PNG')).toEqual({ layer: 'cabeca', ext: 'png' });
    expect(layerNameOf('boca_a.svg')).toEqual({ layer: 'boca-A', ext: 'svg' });
    expect(layerNameOf('C:\\arte\\Braco Aponta Tela.png')).toEqual({
      layer: 'braco-aponta_tela',
      ext: 'png',
    });
    expect(layerNameOf('sobrancelhas-Desconfiado.png')?.layer).toBe('sobrancelhas-desconfiado');
    expect(layerNameOf('foto-do-gato.png')).toBeNull();
    expect(layerNameOf('corpo.jpg')).toBeNull();
  });

  it('o modelo do repositório passa e tem todas as camadas obrigatórias', () => {
    const r = checkArtFiles(model());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.canvas).toEqual({ w: 1500, h: 1800 });
    for (const l of REQUIRED_LAYERS) expect(r.layers.map((x) => x.layer)).toContain(l);
  });

  it('falta de camada, tamanho diferente, PNG falso e SVG perigoso são recusados', () => {
    const files: ArtFileInput[] = REQUIRED_LAYERS.map((l) => ({
      name: `${l}.png`,
      bytes: png(1500, 1800),
    }));
    expect(checkArtFiles(files).ok).toBe(true);
    const semBoca = files.filter((f) => f.name !== 'boca-D.png');
    expect(checkArtFiles(semBoca).errors).toContain('falta a camada obrigatória: boca-D');
    const torto = files.map((f) => (f.name === 'corpo.png' ? { ...f, bytes: png(1400, 1800) } : f));
    expect(checkArtFiles(torto).errors.join()).toMatch(/corpo: tamanho 1400×1800 diferente/);
    const falso = [...files.slice(1), { name: 'corpo.png', bytes: new Uint8Array([1, 2, 3]) }];
    expect(checkArtFiles(falso).errors.join()).toMatch(/não é um PNG de verdade/);
    const enc = (t: string) => new TextEncoder().encode(t);
    for (const evil of [
      '<svg viewBox="0 0 1500 1800"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 1500 1800" onload="x()"></svg>',
      '<svg viewBox="0 0 1500 1800"><image href="https://exemplo.com/x.png"/></svg>',
    ]) {
      const bad = [...files.slice(1), { name: 'corpo.svg', bytes: enc(evil) }];
      expect(checkArtFiles(bad).errors.join()).toMatch(/SVG com script/);
    }
    const repetida = [
      ...files,
      { name: 'corpo.svg', bytes: enc('<svg viewBox="0 0 1500 1800"/>') },
    ];
    expect(checkArtFiles(repetida).errors.join()).toMatch(/camada repetida: corpo/);
  });

  it('cada quadro mostra a boca, os olhos e o braço certos', () => {
    const all = new Set(model().map((f) => layerNameOf(f.name)!.layer));
    const f = layerFrame(
      { ...IDLE_STATE, expression: 'desconfiado', mouth: 'D', eyeOpen: 0.1 },
      all,
    );
    expect(f).toMatchObject({
      mouth: 'boca-D',
      eyes: 'olhos-fechado',
      brows: 'sobrancelhas-desconfiado',
      arm: 'braco-repouso',
      front: 'frente',
    });
    const wave = layerFrame(
      { ...IDLE_STATE, gesture: { id: 'aceno', amount: 1, phase: 0.1 } },
      all,
    );
    expect(wave.arm).toBe('braco-aceno');
    expect(wave.armRotate).not.toBe(0);
    // sem a camada da expressão, usa a neutra
    const minimal = new Set<string>(REQUIRED_LAYERS);
    expect(layerFrame({ ...IDLE_STATE, expression: 'bravo' }, minimal).brows).toBe(
      'sobrancelhas-neutro',
    );
  });

  it('a arte em camadas é determinística e só a camada da vez aparece', () => {
    const files = Object.fromEntries(
      model().map((f) => {
        const id = layerNameOf(f.name)!;
        return [id.layer, `v1/${id.layer}.${id.ext}`];
      }),
    );
    const pack: ArtPackRef = {
      version: 1,
      canvas: { w: 1500, h: 1800 },
      files,
      pivots: DEFAULT_PIVOTS,
    };
    const html = (mouth: 'A' | 'D') =>
      renderToStaticMarkup(
        <LayeredArt pack={pack} baseUrl="/arte" state={{ ...IDLE_STATE, mouth }} />,
      );
    expect(html('D')).toBe(html('D'));
    expect(html('D')).not.toBe(html('A'));
    const visible = [
      ...html('D').matchAll(/src="\/arte\/v1\/(boca-[A-HX])\.svg"[^>]*opacity:1/g),
    ].map((m) => m[1]);
    expect(visible).toEqual(['boca-D']);
    expect((html('D').match(/<img/g) ?? []).length).toBe(Object.keys(files).length);
  });
});
