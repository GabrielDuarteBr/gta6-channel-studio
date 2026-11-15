import type { WriterOutput } from '../src';

export const writerOutput: WriterOutput = {
  title: 'GTA 6: Rockstar confirma novidade e tem rumor no ar',
  description: 'O Zeca conta o que a Rockstar confirmou hoje e o que ainda é só rumor.',
  thumbnailTexts: ['Rockstar confirmou!', 'é verdade?', 'novidade no ar'],
  thumbnailExpression: 'surpreso',
  scenes: [
    { id: 1, visual: 'zeca', libraryAssetId: null, imagePrompt: null, headline: null },
    {
      id: 2,
      visual: 'gerar',
      libraryAssetId: null,
      imagePrompt: 'Neon tropical city skyline at dusk with palm trees and wet streets',
      headline: 'O que foi confirmado',
    },
    { id: 3, visual: 'biblioteca', libraryAssetId: 'asset1', imagePrompt: null, headline: 'Rumor' },
  ],
  lines: [
    {
      id: 1,
      scene: 1,
      kind: 'abertura',
      text: '[feliz] [aceno] Fala, galera do Radar!',
      sourceIds: [],
    },
    {
      id: 2,
      scene: 2,
      kind: 'fato',
      text: '[serio] A Rockstar confirmou a data no site oficial. [pausa] Anota aí.',
      sourceIds: ['n1'],
    },
    {
      id: 3,
      scene: 3,
      kind: 'rumor',
      text: '[debochado] E tem rumor, não confirmado, de edição especial.',
      sourceIds: ['n2', 'n3'],
    },
    {
      id: 4,
      scene: 3,
      kind: 'chamada',
      text: 'Fontes na descrição. Até a próxima!',
      sourceIds: [],
    },
  ],
};
