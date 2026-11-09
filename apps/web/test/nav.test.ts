import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV } from '../src/lib/nav';

const appDir = join(import.meta.dirname, '../src/app/(painel)');

describe('menu do painel', () => {
  it('tem rotas únicas', () => {
    const hrefs = NAV.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('cada item do menu tem uma página', () => {
    for (const item of NAV) {
      const page =
        item.href === '/' ? join(appDir, 'page.tsx') : join(appDir, item.href.slice(1), 'page.tsx');
      expect(existsSync(page), `${item.href} → ${page}`).toBe(true);
    }
  });

  it('cobre todas as telas pedidas no documento do projeto', () => {
    const labels = NAV.map((n) => n.label);
    for (const required of [
      'Visão geral',
      'Pauta',
      'Parceiros',
      'Personagem',
      'Arte',
      'Produção',
      'Aprovação',
      'Biblioteca',
      'Calendário',
      'Comando',
      'Configurações',
      'Saúde e custos',
    ]) {
      expect(labels).toContain(required);
    }
  });
});
