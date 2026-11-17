import { assertMediaImportAllowed, isBlockedMediaHost } from './media-source';
import { isInternalHost } from './network';
import { PolicyViolation } from './rules';

/**
 * Regras 2 e 3 (Fase 4): parceiros, permissões, links de arquivos e o Short de react.
 * Funções puras: a tela e as ferramentas chamam antes de agir, e os workers de import e de
 * render conferem de novo com os dados do banco.
 */

const strip = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9#@]+/g, ' ')
    .trim()} `;

// ---------------------------------------------------------------------------------------------
// Permissão

export const PERMISSION_TYPES = ['REACT_CLIPS'] as const;
export type PermissionTypeId = (typeof PERMISSION_TYPES)[number];
export const PERMISSION_TYPE_LABEL: Record<PermissionTypeId, string> = {
  REACT_CLIPS: 'Cortes em Shorts de react (com comentário do Zeca)',
};

export const PROOF_KINDS = ['EMAIL', 'DIRECT_MESSAGE', 'CONTRACT', 'OTHER'] as const;
export type ProofKindId = (typeof PROOF_KINDS)[number];
export const PROOF_KIND_LABEL: Record<ProofKindId, string> = {
  EMAIL: 'E-mail',
  DIRECT_MESSAGE: 'Mensagem direta (Instagram, Discord, WhatsApp...)',
  CONTRACT: 'Contrato ou termo assinado',
  OTHER: 'Outro registro escrito',
};

export const MONETIZATION = ['allowed', 'not_allowed'] as const;
export type Monetization = (typeof MONETIZATION)[number];

/** Condições do parceiro, aplicadas em cada Short (regra 2). */
export interface PartnerConditions {
  /** Crédito na tela durante o clipe e na descrição (ex.: "Canal do Fulano"). */
  credit: string;
  /** Link na descrição (canal, Instagram...). */
  link?: string | null;
  /** Hashtag obrigatória na descrição (ex.: #fulanogames). */
  hashtag?: string | null;
  /** O Short pode ser monetizado? */
  monetization: Monetization;
  /** Teto de segundos de clipe por Short (além do limite de 50%). */
  maxClipSec?: number | null;
  /** Outras condições combinadas (texto livre, aparece na revisão). */
  notes?: string | null;
}

/**
 * Frases vagas que aparecem em descrições de canal ("cortes liberados", "free to use"). Elas
 * viram EVIDÊNCIA para um candidato a parceiro, nunca permissão (regra 2).
 */
const VAGUE_PHRASES = [
  'cortes liberados',
  'corte liberado',
  'cortes liberado',
  'cortes estao liberados',
  'liberado para cortes',
  'liberado pra cortes',
  'pode cortar',
  'podem cortar',
  'pode usar',
  'podem usar',
  'pode postar',
  'uso livre',
  'livre para usar',
  'livre pra usar',
  'sem direitos autorais',
  'clips liberados',
  'clipes liberados',
  'free to use',
  'feel free to use',
  'clips allowed',
  'clipping allowed',
  'no copyright',
  'copyright free',
];

/** Frases de "liberação" encontradas num texto (descrição do canal, mensagem...). */
export function findPermissionHints(text: string): string[] {
  const t = strip(text);
  const found = VAGUE_PHRASES.filter((p) => t.includes(` ${p} `));
  // "free to use" dentro de "feel free to use" conta uma vez só.
  return found.filter((p) => !found.some((o) => o !== p && o.includes(p)));
}

const FILLER = new Set(
  'a o as os e de do da dos das um uma que pra para por com sem no na nos nas em eu voce voces vc vcs meu meus minha seu sua ok sim pode podem usar the to and of you my your is are it'.split(
    ' ',
  ),
);

export interface PermissionInput {
  type: PermissionTypeId;
  proofKind: ProofKindId;
  /** O que o criador escreveu, quando e onde (texto colado ou resumo fiel). */
  proof: string;
  /** Há print/arquivo da conversa anexado. */
  hasProofFile: boolean;
  grantedAt: Date;
  expiresAt?: Date | null;
  conditions: PartnerConditions;
  /** O dono confirma que o criador autorizou o Radar Neon, por escrito, para este uso. */
  explicitConfirmation: boolean;
}

const HASHTAG = /^#[\p{L}\p{N}_]{2,40}$/u;

/** Confere a permissão antes de gravar (regra 2). Lança PolicyViolation com o motivo. */
export function assertPermissionInput(p: PermissionInput, now: Date = new Date()): void {
  const fail = (msg: string) => {
    throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', msg);
  };
  if (!PERMISSION_TYPES.includes(p.type)) fail('Tipo de permissão desconhecido.');
  if (!PROOF_KINDS.includes(p.proofKind)) fail('Tipo de prova desconhecido.');
  if (!p.explicitConfirmation) {
    fail('Confirme que o criador autorizou o Radar Neon, por escrito, para este uso.');
  }
  const proof = p.proof.trim();
  if (proof.length < 30) {
    fail('Descreva a prova: o que o criador escreveu, quando e onde (pelo menos 30 letras).');
  }
  // Sem as frases vagas e as palavras de ligação, sobra conteúdo de verdade?
  let rest = strip(proof);
  for (const phrase of VAGUE_PHRASES) rest = rest.replaceAll(` ${phrase} `, ' ');
  const meaningful = rest.split(' ').filter((w) => w.length > 2 && !FILLER.has(w));
  if (meaningful.length < 5 && !p.hasProofFile) {
    fail(
      'Frase vaga como "cortes liberados" não é permissão. Registre a mensagem em que o criador autoriza o Radar Neon (quem, quando, onde) ou anexe o print.',
    );
  }
  if (p.grantedAt.getTime() > now.getTime() + 86_400_000) {
    fail('A data da permissão está no futuro.');
  }
  if (p.expiresAt && p.expiresAt.getTime() <= p.grantedAt.getTime()) {
    fail('A validade termina antes de a permissão começar.');
  }
  assertConditions(p.conditions);
}

export function assertConditions(c: PartnerConditions): void {
  const fail = (msg: string) => {
    throw new PolicyViolation('PARTNER_CONDITIONS', msg);
  };
  if (!c.credit || c.credit.trim().length < 2 || c.credit.trim().length > 60) {
    fail('Informe o crédito que aparece na tela e na descrição (2 a 60 letras).');
  }
  if (c.link) {
    let u: URL | null = null;
    try {
      u = new URL(c.link);
    } catch {
      fail('Link do parceiro inválido.');
    }
    if (u && (u.protocol !== 'https:' || u.username || u.password || isInternalHost(u.hostname))) {
      fail('O link do parceiro precisa ser https e público.');
    }
  }
  if (c.hashtag && !HASHTAG.test(c.hashtag.trim())) {
    fail('Hashtag inválida (ex.: #fulanogames, sem espaços).');
  }
  if (!MONETIZATION.includes(c.monetization)) fail('Diga se o Short pode ser monetizado.');
  if (c.maxClipSec != null && !(c.maxClipSec >= 3 && c.maxClipSec <= 60)) {
    fail('Teto de clipe por Short entre 3 e 60 segundos.');
  }
}

export interface PermissionState {
  id: string;
  type: PermissionTypeId;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  expiresAt?: Date | null;
}

/** Permissão vale agora para este uso? (null = pode usar). */
export function permissionProblem(
  perm: PermissionState | null | undefined,
  use: PermissionTypeId,
  now: Date = new Date(),
): string | null {
  if (!perm) return 'sem permissão registrada';
  if (perm.status === 'REVOKED') return 'permissão revogada';
  if (perm.status === 'SUSPENDED') return 'permissão suspensa';
  if (perm.expiresAt && perm.expiresAt.getTime() <= now.getTime()) return 'permissão vencida';
  if (perm.type !== use) return 'a permissão não cobre este uso';
  return null;
}

/** Regra 2 na hora de usar material de parceiro (import, corte e render). */
export function assertPartnerPermission(
  perm: PermissionState | null | undefined,
  use: PermissionTypeId,
  now: Date = new Date(),
): void {
  const problem = permissionProblem(perm, use, now);
  if (problem) {
    throw new PolicyViolation(
      'PARTNER_PERMISSION_ACTIVE',
      `Material de parceiro bloqueado: ${problem}. Registre ou reative a permissão em Parceiros.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Links de arquivos (Dropbox e Google Drive; nunca YouTube)

export type ShareLink =
  | { provider: 'dropbox'; url: string; folder: boolean }
  | { provider: 'gdrive'; id: string; folder: boolean };

/** Hosts para onde um download pode ser redirecionado (cada salto é conferido). */
const DOWNLOAD_HOST_SUFFIXES = [
  'dropbox.com',
  'dropboxusercontent.com',
  'googleapis.com',
  'googleusercontent.com',
];

export function isAllowedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isBlockedMediaHost(host) || isInternalHost(host)) return false;
  return DOWNLOAD_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Link de pasta/arquivo compartilhado pelo parceiro → como baixar. YouTube é recusado
 * (regra 1); qualquer outro site também (arquivos de parceiro só por Dropbox ou Drive).
 */
export function parseShareLink(raw: string): ShareLink {
  const url = assertMediaImportAllowed(raw.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'dropbox.com') {
    const kind = url.pathname.split('/')[1] ?? '';
    const folder = kind === 'sh' || url.pathname.startsWith('/scl/fo/');
    const file = kind === 's' || url.pathname.startsWith('/scl/fi/');
    if (!folder && !file) {
      throw new PolicyViolation(
        'PARTNER_PERMISSION_ACTIVE',
        'Link do Dropbox não reconhecido: use "Copiar link" do arquivo ou da pasta.',
      );
    }
    const clean = new URL(`https://www.dropbox.com${url.pathname}`);
    const rlkey = url.searchParams.get('rlkey');
    if (rlkey) clean.searchParams.set('rlkey', rlkey);
    clean.searchParams.set('dl', '1');
    return { provider: 'dropbox', url: clean.toString(), folder };
  }
  if (host === 'drive.google.com') {
    const file = /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1];
    const folder = /\/folders\/([^/?]+)/.exec(url.pathname)?.[1];
    const query = url.searchParams.get('id');
    const id = file ?? folder ?? query;
    if (!id || !DRIVE_ID.test(id)) {
      throw new PolicyViolation(
        'PARTNER_PERMISSION_ACTIVE',
        'Link do Google Drive não reconhecido: use "Compartilhar → Copiar link".',
      );
    }
    return { provider: 'gdrive', id, folder: Boolean(folder) };
  }
  throw new PolicyViolation(
    'PARTNER_PERMISSION_ACTIVE',
    `Arquivos de parceiro só entram por link do Dropbox ou do Google Drive (recebido: ${url.hostname}), ou pelo envio no painel.`,
  );
}

// ---------------------------------------------------------------------------------------------
// Short de react (regra 3)

/** Clipe do parceiro no máximo 50% do Short; comentário substantivo no mínimo 50%. */
export const MAX_CLIP_RATIO = 0.5;
export const MIN_COMMENT_RATIO = 0.5;
/** Palavras de conteúdo para um comentário contar (fora as reações genéricas). */
export const MIN_SUBSTANTIVE_WORDS = 4;

const GENERIC_REACTIONS = [
  'olha so isso',
  'olha isso',
  'olha so',
  'olha ai',
  'que isso',
  'meu deus',
  'nao acredito',
  'uau',
  'uou',
  'wow',
  'nossa',
  'caramba',
  'eita',
  'vixe',
  'cara',
  'mano',
  'gente',
  'incrivel',
  'sensacional',
  'demais',
  'top',
  'show',
  'insano',
  'brabo',
  'lindo',
  'massa',
  'irado',
];
const LAUGH = /^(k{2,}|(ha){2,}h?|(he){2,}|rs+|lol|kkk+)$/;

/** Palavras de conteúdo de uma fala, sem reações genéricas ("uau", "olha isso") nem risadas. */
export function substantiveWords(spoken: string): string[] {
  let t = strip(spoken);
  for (const r of GENERIC_REACTIONS) t = t.replaceAll(` ${r} `, ' ');
  return t
    .split(' ')
    .filter((w) => w.length > 2 && !FILLER.has(w) && !LAUGH.test(w) && !/^[#@]/.test(w));
}

export function isSubstantiveComment(spoken: string): boolean {
  return substantiveWords(spoken).length >= MIN_SUBSTANTIVE_WORDS;
}

export interface ReactBlock {
  kind: 'clip' | 'comment';
  start: number;
  end: number;
  /** Fala do Zeca no bloco de comentário (sem marcações). */
  spoken?: string;
  /** Crédito exibido durante o bloco (obrigatório nos blocos de clipe). */
  credit?: string | null;
}

export interface ReactStats {
  totalSec: number;
  clipSec: number;
  commentSec: number;
  substantiveCommentSec: number;
  clipRatio: number;
  commentRatio: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function reactStats(blocks: ReactBlock[]): ReactStats {
  let clip = 0;
  let comment = 0;
  let substantive = 0;
  for (const b of blocks) {
    const d = Math.max(0, b.end - b.start);
    if (b.kind === 'clip') clip += d;
    else {
      comment += d;
      if (isSubstantiveComment(b.spoken ?? '')) substantive += d;
    }
  }
  const total = blocks.length ? Math.max(...blocks.map((b) => b.end)) : 0;
  return {
    totalSec: r3(total),
    clipSec: r3(clip),
    commentSec: r3(comment),
    substantiveCommentSec: r3(substantive),
    clipRatio: total > 0 ? r3(clip / total) : 0,
    commentRatio: total > 0 ? r3(substantive / total) : 0,
  };
}

export interface ReactIssue {
  rule: 'REACT_RATIO' | 'PARTNER_CONDITIONS';
  message: string;
}

/**
 * Regra 3 na linha do tempo do Short: clipe ≤ 50% (ou o teto do parceiro), comentário
 * substantivo ≥ 50%, comentário sempre com o clipe pausado (blocos sem sobreposição e nunca
 * dois clipes seguidos) e crédito visível em todo bloco de clipe.
 */
export function checkReactTimeline(
  blocks: ReactBlock[],
  opts: { maxClipRatio?: number; maxClipSec?: number | null; credit: string },
): ReactIssue[] {
  const issues: ReactIssue[] = [];
  const maxRatio = Math.min(MAX_CLIP_RATIO, opts.maxClipRatio ?? MAX_CLIP_RATIO);
  const s = reactStats(blocks);
  if (!blocks.some((b) => b.kind === 'clip')) {
    issues.push({ rule: 'REACT_RATIO', message: 'o Short não tem clipe do parceiro' });
  }
  if (s.clipRatio > maxRatio + 1e-6) {
    issues.push({
      rule: 'REACT_RATIO',
      message: `clipe ocupa ${(s.clipRatio * 100).toFixed(0)}% do Short (máximo ${(maxRatio * 100).toFixed(0)}%)`,
    });
  }
  if (s.commentRatio < MIN_COMMENT_RATIO - 1e-6) {
    issues.push({
      rule: 'REACT_RATIO',
      message: `comentário do Zeca com conteúdo ocupa ${(s.commentRatio * 100).toFixed(0)}% (mínimo 50%; "uau" e "olha isso" não contam)`,
    });
  }
  if (opts.maxClipSec != null && s.clipSec > opts.maxClipSec + 1e-6) {
    issues.push({
      rule: 'PARTNER_CONDITIONS',
      message: `o parceiro permite até ${opts.maxClipSec} s de clipe por Short (este tem ${s.clipSec.toFixed(1)} s)`,
    });
  }
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  sorted.forEach((b, i) => {
    const prev = sorted[i - 1];
    if (prev && b.start < prev.end - 1e-3) {
      issues.push({
        rule: 'REACT_RATIO',
        message: 'comentário e clipe se sobrepõem: o clipe precisa pausar enquanto o Zeca fala',
      });
    }
    if (prev && prev.kind === 'clip' && b.kind === 'clip') {
      issues.push({
        rule: 'REACT_RATIO',
        message: 'dois clipes seguidos sem comentário do Zeca entre eles',
      });
    }
    if (b.kind === 'clip' && (b.credit ?? '').trim() !== opts.credit.trim()) {
      issues.push({
        rule: 'PARTNER_CONDITIONS',
        message: `crédito "${opts.credit}" precisa ficar visível durante todo clipe`,
      });
    }
  });
  return issues;
}

export function assertReactTimeline(
  blocks: ReactBlock[],
  opts: { maxClipRatio?: number; maxClipSec?: number | null; credit: string },
): ReactStats {
  const issues = checkReactTimeline(blocks, opts);
  if (issues.length) {
    throw new PolicyViolation(issues[0]!.rule, issues.map((i) => i.message).join('; '));
  }
  return reactStats(blocks);
}

/** Linhas que as condições do parceiro exigem na descrição do Short. */
export function partnerDescriptionLines(
  c: PartnerConditions,
  partnerName: string,
): { lines: string[]; hashtags: string[] } {
  const lines = [`Clipe: ${c.credit.trim()}${c.link ? ` — ${c.link.trim()}` : ''}`];
  if (partnerName.trim() && partnerName.trim() !== c.credit.trim()) {
    lines.push(`Usado com permissão de ${partnerName.trim()}.`);
  } else {
    lines.push('Usado com permissão do criador.');
  }
  const hashtags = c.hashtag ? [c.hashtag.trim()] : [];
  return { lines, hashtags };
}

/** A descrição traz o crédito, o link e a hashtag que o parceiro pediu? */
export function checkDescriptionConditions(description: string, c: PartnerConditions): string[] {
  const missing: string[] = [];
  if (!description.includes(c.credit.trim())) missing.push(`crédito "${c.credit}"`);
  if (c.link && !description.includes(c.link.trim())) missing.push(`link ${c.link}`);
  if (c.hashtag && !description.includes(c.hashtag.trim())) missing.push(`hashtag ${c.hashtag}`);
  return missing;
}
