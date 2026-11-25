import { DEFAULT_BIBLE } from '@studio/avatar';
import { describe, expect, it } from 'vitest';
import { finalizeScript, markupSection, personaSection, styleIssues } from '../src';
import { writerOutput } from './fixtures';

describe('persona do Zeca e guarda de estilo', () => {
  it('o prompt traz o estilo de comentarista, exemplos e as 8 expressões', () => {
    const persona = personaSection(DEFAULT_BIBLE);
    expect(persona).toContain('NÃO é âncora de telejornal');
    expect(persona).toContain('RUIM:');
    expect(persona).toContain('Sem palavrão');
    const markup = markupSection();
    for (const e of ['empolgado', 'desconfiado', 'debochado', 'surpreso']) {
      expect(markup).toContain(`[${e}]`);
    }
    // bíblia antiga (sem estilo) usa o estilo padrão
    const { style: _s, ...semEstilo } = DEFAULT_BIBLE;
    expect(personaSection(semEstilo)).toContain('Comentarista estilo youtuber');
  });

  it('roteiro de telejornal, sem reação e sem conversa recebe a lista para melhorar', () => {
    const jornal = structuredClone(writerOutput);
    jornal.lines = [
      { id: 1, scene: 1, kind: 'abertura', text: '[neutro] Olá, pessoal.', sourceIds: [] },
      {
        id: 2,
        scene: 2,
        kind: 'fato',
        text: '[neutro] De acordo com a Rockstar, nesta quinta-feira saiu o trailer.',
        sourceIds: ['n1'],
      },
      {
        id: 3,
        scene: 3,
        kind: 'fato',
        text: '[serio] Em comunicado, a empresa informou a data.',
        sourceIds: ['n1'],
      },
      { id: 4, scene: 3, kind: 'chamada', text: '[serio] Confira os detalhes.', sourceIds: [] },
    ];
    const issues = styleIssues(finalizeScript(jornal, 'LONG'), 'LONG');
    expect(issues.join(' | ')).toMatch(/telejornal/);
    expect(issues.join(' | ')).toMatch(/expressão/);
    expect(issues.join(' | ')).toMatch(/opini/);
    expect(issues.join(' | ')).toMatch(/você/);
  });

  it('roteiro de amigo comentando passa limpo', () => {
    const amigo = structuredClone(writerOutput);
    amigo.lines = [
      {
        id: 1,
        scene: 1,
        kind: 'abertura',
        text: '[empolgado] [aceno] Mano, para tudo que tem novidade!',
        sourceIds: [],
      },
      {
        id: 2,
        scene: 2,
        kind: 'fato',
        text: '[surpreso] [aponta_tela] A Rockstar confirmou a data no site oficial.',
        sourceIds: ['n1'],
      },
      {
        id: 3,
        scene: 3,
        kind: 'opiniao',
        text: '[debochado] Pra mim, meu chefe que se prepare: vou faltar no dia.',
        sourceIds: [],
      },
      {
        id: 4,
        scene: 3,
        kind: 'chamada',
        text: '[feliz] E você, já marcou no calendário? Me conta!',
        sourceIds: [],
      },
    ];
    expect(styleIssues(finalizeScript(amigo, 'LONG'), 'LONG')).toEqual([]);
  });
});
