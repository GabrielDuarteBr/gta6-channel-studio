import type { SourceDefinition } from './types';

/**
 * Fontes padrão (editáveis na tela Pauta → Fontes). As URLs de feed vêm das páginas
 * dos próprios sites/diretórios de feeds; as que não têm feed conhecido usam a
 * autodescoberta (<link rel="alternate">) ou um padrão de links de artigo.
 * A coleta real no notebook mostra o estado de cada uma.
 *
 * Reddit: fora. Desde 31/10/2026 o Reddit não aceita novos acessos à API e os feeds
 * RSS públicos são desligados em 13/11/2026.
 */
export const DEFAULT_SOURCES: SourceDefinition[] = [
  // Oficiais (prioridade máxima)
  {
    key: 'rockstar-newswire',
    name: 'Rockstar Newswire',
    kind: 'PAGE',
    tier: 'OFFICIAL',
    url: 'https://www.rockstargames.com/newswire',
    language: 'en',
    config: { linkPattern: '/newswire/article/', gtaOnly: true },
  },
  {
    key: 'rockstar-youtube',
    name: 'Rockstar Games (YouTube)',
    kind: 'YOUTUBE_CHANNEL',
    tier: 'OFFICIAL',
    url: '@RockstarGames',
    language: 'en',
    config: { gtaOnly: true },
  },
  {
    key: 'take-two-ir',
    name: 'Take-Two — Investidores',
    kind: 'PAGE',
    tier: 'OFFICIAL',
    url: 'https://www.take2games.com/ir/news',
    language: 'en',
    config: { linkPattern: '/ir/news/' },
  },

  // Imprensa (EN)
  {
    key: 'ign',
    name: 'IGN',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.ign.com/rss/v2/articles/feed',
    language: 'en',
  },
  {
    key: 'gamespot',
    name: 'GameSpot',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.gamespot.com/feeds/game-news/',
    language: 'en',
  },
  {
    key: 'eurogamer',
    name: 'Eurogamer',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.eurogamer.net/feed',
    language: 'en',
  },
  {
    key: 'polygon',
    name: 'Polygon',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.polygon.com/rss/index.xml',
    language: 'en',
  },
  {
    key: 'pcgamer',
    name: 'PC Gamer',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.pcgamer.com/feeds.xml',
    language: 'en',
  },
  {
    key: 'gamesradar',
    name: 'GamesRadar+',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.gamesradar.com/feeds.xml',
    language: 'en',
  },
  {
    key: 'vgc',
    name: 'Video Games Chronicle',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.videogameschronicle.com/feed/',
    language: 'en',
  },

  // Imprensa (PT-BR) — autodescoberta do feed a partir da página
  {
    key: 'ign-brasil',
    name: 'IGN Brasil',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://br.ign.com/',
    language: 'pt-BR',
  },
  {
    key: 'tecmundo-voxel',
    name: 'Voxel (TecMundo)',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://www.tecmundo.com.br/voxel',
    language: 'pt-BR',
  },
  {
    key: 'adrenaline',
    name: 'Adrenaline',
    kind: 'RSS',
    tier: 'PRESS',
    url: 'https://adrenaline.com.br/',
    language: 'pt-BR',
  },

  // Comunidade (rumores aparecem aqui; precisam de 2 fontes independentes)
  {
    key: 'rockstar-intel',
    name: 'Rockstar Intel',
    kind: 'RSS',
    tier: 'COMMUNITY',
    url: 'https://www.rockstarintel.com/feed',
    language: 'en',
    config: { gtaOnly: true },
  },
  {
    key: 'gtaboom',
    name: 'GTA BOOM',
    kind: 'RSS',
    tier: 'COMMUNITY',
    url: 'https://www.gtaboom.com/feed',
    language: 'en',
    config: { gtaOnly: true },
  },
  {
    key: 'youtube-busca-gta6',
    name: 'YouTube — busca "GTA 6"',
    kind: 'YOUTUBE_SEARCH',
    tier: 'COMMUNITY',
    url: 'GTA 6',
    language: 'en',
  },
];
