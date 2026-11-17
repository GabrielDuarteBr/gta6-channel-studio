import { claimsToBeHuman } from './character';
import { detectContentFlags, isSpoilerWindowActive, type SpoilerWindow } from './content';
import { assertMediaImportAllowed } from './media-source';
import { assertPartnerPermission, type PermissionState } from './partner';
import { PolicyViolation } from './rules';

/**
 * Regras da produção de vídeos (Fase 3): manifesto de direitos, prompt de imagem, fatos com
 * fonte, rumor rotulado, comentário próprio e limites diários. Funções puras: o agents chama
 * antes de agir e o worker de render confere de novo com os dados do banco.
 */

export const ASSET_ORIGINS = [
  'OFFICIAL_PRESS',
  'PARTNER',
  'IMAGE_PROVIDER',
  'OWNER_UPLOAD',
  'CHANNEL_OWN',
] as const;
export type AssetOriginId = (typeof ASSET_ORIGINS)[number];

/** Domínios aceitos como "imprensa oficial" (Rockstar e Take-Two). */
export const OFFICIAL_PRESS_DOMAINS = ['rockstargames.com', 'take2games.com'] as const;

export function isOfficialPressHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return OFFICIAL_PRESS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export interface ManifestInput {
  origin: AssetOriginId;
  license: string;
  sourceUrl?: string | null | undefined;
  proof?: string | null | undefined;
  credit?: string | null | undefined;
  provider?: string | null | undefined;
  prompt?: string | null | undefined;
  /** Permissão do parceiro (origem PARTNER). */
  permission?: PermissionState | null | undefined;
}

/** Confere um manifesto antes de gravar (regra 1 e 2). Lança PolicyViolation com o motivo. */
export function assertManifestInput(m: ManifestInput): void {
  if (m.license.trim().length < 3) {
    throw new PolicyViolation('ASSET_REQUIRES_MANIFEST', 'Informe a licença ou base de uso.');
  }
  if (m.sourceUrl) assertMediaImportAllowed(m.sourceUrl);
  switch (m.origin) {
    case 'OFFICIAL_PRESS': {
      if (!m.sourceUrl) {
        throw new PolicyViolation(
          'ASSET_REQUIRES_MANIFEST',
          'Imprensa oficial precisa do link da página oficial de onde a imagem veio.',
        );
      }
      const host = new URL(m.sourceUrl).hostname;
      if (!isOfficialPressHost(host)) {
        throw new PolicyViolation(
          'ASSET_REQUIRES_MANIFEST',
          `${host} não é um site oficial da Rockstar ou da Take-Two. Use outra origem.`,
        );
      }
      break;
    }
    case 'PARTNER':
      // Regra 2: só com permissão registrada, ativa e que cubra o uso (cortes para react).
      assertPartnerPermission(m.permission, 'REACT_CLIPS');
      if (!m.credit || m.credit.trim().length < 2) {
        throw new PolicyViolation(
          'PARTNER_CONDITIONS',
          'Material de parceiro precisa do crédito combinado no manifesto.',
        );
      }
      break;
    case 'IMAGE_PROVIDER':
      if (!m.provider || !m.prompt) {
        throw new PolicyViolation(
          'ASSET_REQUIRES_MANIFEST',
          'Imagem gerada precisa do provedor/modelo e do prompt no manifesto.',
        );
      }
      assertImagePromptAllowed(m.prompt);
      break;
    case 'OWNER_UPLOAD':
      if (!m.proof || m.proof.trim().length < 3) {
        throw new PolicyViolation(
          'ASSET_REQUIRES_MANIFEST',
          'Diga de onde vem o arquivo (ex.: "arte feita por mim", "foto minha").',
        );
      }
      break;
    case 'CHANNEL_OWN':
      break;
  }
}

export interface RenderableAsset {
  id: string;
  origin: AssetOriginId;
  manifest: {
    origin: AssetOriginId;
    license: string;
    status: 'ACTIVE' | 'REVOKED';
    expiresAt?: Date | null;
  } | null;
  /** Permissão do parceiro (origem PARTNER), lida do banco na hora do render. */
  permission?: PermissionState | null;
}

/** Regra 1/2 no render: sem manifesto ativo (ou de parceiro sem permissão), não entra. */
export function assertAssetRenderable(asset: RenderableAsset, now: Date = new Date()): void {
  const m = asset.manifest;
  if (!m) {
    throw new PolicyViolation(
      'ASSET_REQUIRES_MANIFEST',
      `Mídia ${asset.id} sem manifesto de direitos.`,
    );
  }
  if (m.status !== 'ACTIVE') {
    throw new PolicyViolation(
      'ASSET_REQUIRES_MANIFEST',
      `Direitos da mídia ${asset.id} revogados.`,
    );
  }
  if (m.expiresAt && m.expiresAt.getTime() <= now.getTime()) {
    throw new PolicyViolation('ASSET_REQUIRES_MANIFEST', `Direitos da mídia ${asset.id} vencidos.`);
  }
  if (m.origin !== asset.origin || m.license.trim().length < 3) {
    throw new PolicyViolation(
      'ASSET_REQUIRES_MANIFEST',
      `Manifesto da mídia ${asset.id} incompleto ou de outra origem.`,
    );
  }
  if (asset.origin === 'PARTNER') {
    assertPartnerPermission(asset.permission, 'REACT_CLIPS', now);
  }
}

/**
 * Prompt de imagem: nada de personagens, marcas ou lugares da Rockstar (a imagem tem de ser
 * original). Instruções negativas do guia de estilo ("no logos, no real people") são
 * bem-vindas, então palavras genéricas como "logo" não entram aqui.
 */
const BLOCKED_IMAGE_TERMS =
  /\b(gta|grand theft auto|rockstar|take ?two|take-two|vice city|leonida|lucia|jason duval|niko bellic|trevor philips|franklin clinton|michael de santa|carl johnson|tommy vercetti)\b/i;

export function assertImagePromptAllowed(prompt: string): void {
  const p = prompt.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const hit = BLOCKED_IMAGE_TERMS.exec(p);
  if (hit) {
    throw new PolicyViolation(
      'ROCKSTAR_POLICY',
      `Prompt de imagem cita "${hit[0]}": a imagem precisa ser original (sem marcas, personagens ou lugares do jogo).`,
    );
  }
  if (prompt.trim().length < 12) {
    throw new PolicyViolation('ROCKSTAR_POLICY', 'Prompt de imagem curto demais.');
  }
}

/** Tipos de fala do roteiro. Os de afirmação precisam de fonte. */
export const LINE_KINDS = ['abertura', 'fato', 'rumor', 'contexto', 'opiniao', 'chamada'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const CLAIM_KINDS: readonly LineKind[] = ['fato', 'rumor', 'contexto'];

export interface ScriptLineForCheck {
  id: number;
  kind: LineKind;
  /** Texto falado (sem marcações). */
  spoken: string;
  sourceIds: string[];
}

export interface SourceForCheck {
  id: string;
  domain: string;
  official: boolean;
}

export interface ScriptCheckInput {
  lines: ScriptLineForCheck[];
  sources: SourceForCheck[];
  storyIsRumor: boolean;
  spoilerWindow: SpoilerWindow;
  now?: Date;
}

export interface ScriptIssue {
  rule: 'FACTS_HAVE_SOURCES' | 'AI_DISCLOSURE' | 'ROCKSTAR_POLICY' | 'ANTI_SPOILER';
  lineId?: number;
  message: string;
}

/**
 * Regras 4, 6 e 7 no roteiro: toda afirmação com fonte da própria história; rumor rotulado e
 * com 2 fontes independentes; o Zeca não diz que é humano; nada de vazamento, trapaça, mods ou
 * spoiler na janela. Devolve a lista de problemas (vazia = ok), para o roteirista corrigir.
 */
export function checkScript(input: ScriptCheckInput): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  for (const line of input.lines) {
    const known = line.sourceIds.filter((id) => byId.has(id));
    if (known.length !== line.sourceIds.length) {
      issues.push({
        rule: 'FACTS_HAVE_SOURCES',
        lineId: line.id,
        message: `fala ${line.id} cita fonte que não está na história`,
      });
    }
    if (CLAIM_KINDS.includes(line.kind) && known.length === 0) {
      issues.push({
        rule: 'FACTS_HAVE_SOURCES',
        lineId: line.id,
        message: `fala ${line.id} (${line.kind}) sem fonte`,
      });
    }
    if (line.kind === 'rumor') {
      const domains = new Set(known.map((id) => byId.get(id)!.domain));
      if (domains.size < 2) {
        issues.push({
          rule: 'FACTS_HAVE_SOURCES',
          lineId: line.id,
          message: `rumor na fala ${line.id} precisa de 2 fontes independentes (tem ${domains.size})`,
        });
      }
      if (
        !/\b(rumor|boato|n[aã]o confirmad|ainda n[aã]o|segundo|diz(em)? que)/i.test(line.spoken)
      ) {
        issues.push({
          rule: 'FACTS_HAVE_SOURCES',
          lineId: line.id,
          message: `fala ${line.id} é rumor e precisa dizer isso em voz alta ("rumor", "não confirmado")`,
        });
      }
    }
    if (input.storyIsRumor && line.kind === 'fato') {
      const officialBacked = known.some((id) => byId.get(id)!.official);
      if (!officialBacked) {
        issues.push({
          rule: 'FACTS_HAVE_SOURCES',
          lineId: line.id,
          message: `fala ${line.id} trata rumor como fato (sem fonte oficial): marque como rumor`,
        });
      }
    }
  }
  const spoken = input.lines.map((l) => l.spoken).join(' ');
  if (claimsToBeHuman(spoken)) {
    issues.push({ rule: 'AI_DISCLOSURE', message: 'o Zeca não pode dizer que é humano' });
  }
  const flags = detectContentFlags(spoken);
  if (flags.leak || flags.onlineCheats || flags.mods) {
    issues.push({
      rule: 'ROCKSTAR_POLICY',
      message: 'roteiro fala de vazamento, trapaça online ou mods (proibido)',
    });
  }
  if (flags.spoilerRisk && isSpoilerWindowActive(input.spoilerWindow, input.now)) {
    issues.push({
      rule: 'ANTI_SPOILER',
      message: 'possível spoiler de história dentro da janela anti-spoiler',
    });
  }
  return issues;
}

/** Regra 5: pelo menos 70% de narração/comentário próprio nos vídeos de notícia. */
export const MIN_ORIGINAL_RATIO = 0.7;

export function originalRatio(totalSec: number, thirdPartySec: number): number {
  if (totalSec <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - thirdPartySec / totalSec));
}

export function assertOriginalCommentary(totalSec: number, thirdPartySec: number): void {
  const ratio = originalRatio(totalSec, thirdPartySec);
  if (ratio < MIN_ORIGINAL_RATIO) {
    throw new PolicyViolation(
      'ORIGINAL_COMMENTARY',
      `Só ${(ratio * 100).toFixed(0)}% de comentário próprio (mínimo 70%).`,
    );
  }
}

export interface DailyLimits {
  long: number;
  shorts: number;
}

/** Regra 5: limites diários (padrão 1 longo + 4 Shorts), contados por dia de Brasília. */
export function assertDailyLimit(
  format: 'LONG' | 'SHORT',
  startedToday: number,
  limits: DailyLimits,
): void {
  const max = format === 'LONG' ? limits.long : limits.shorts;
  if (startedToday >= max) {
    throw new PolicyViolation(
      'DAILY_LIMITS',
      `Limite diário de ${format === 'LONG' ? 'vídeos longos' : 'Shorts'} atingido (${max}). Mude em Configurações → Limites.`,
    );
  }
}
