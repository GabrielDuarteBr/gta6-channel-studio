/**
 * Regras inegociáveis do canal. Cada regra tem um identificador estável
 * usado em PolicyViolation, no AuditLog e nos relatórios de Conformidade.
 * As verificações são implementadas como funções puras neste pacote e
 * aplicadas em três camadas: ferramenta MCP, hook PreToolUse do Agent SDK
 * e worker (render/upload) antes de executar.
 */
export const POLICY_RULES = {
  NO_YOUTUBE_DOWNLOAD:
    'Nunca baixar vídeo/áudio/imagem do YouTube. Pesquisa no YouTube é só de metadados via Data API.',
  ASSET_REQUIRES_MANIFEST: 'Asset sem manifesto de direitos não entra em render.',
  PARTNER_PERMISSION_ACTIVE:
    'Material de terceiros só de parceiros com permissão registrada, com prova e status ativo.',
  PARTNER_CONDITIONS: 'Condições do parceiro (crédito, link, hashtag, monetização) aplicadas em cada Short.',
  REACT_RATIO: 'React: clipe do parceiro no máximo 50% do Short; comentário do personagem no mínimo 50%.',
  ROCKSTAR_POLICY:
    'Bloquear vazamentos, cópias pré-lançamento, cutscenes isoladas, entretenimento in-game isolado, trapaças e mods não autorizados.',
  ANTI_SPOILER: 'Após o lançamento, nada de final ou grandes reviravoltas dentro da janela configurada.',
  ORIGINAL_COMMENTARY: 'Narração/comentário original em pelo menos 70% dos vídeos de notícia.',
  DAILY_LIMITS: 'Respeitar os limites diários de publicação.',
  FACTS_HAVE_SOURCES: 'Toda afirmação tem fonte; rumor rotulado e com pelo menos 2 fontes independentes.',
  AI_DISCLOSURE: 'Marcar conteúdo sintético/alterado; o personagem nunca afirma ser humano.',
  HUMAN_APPROVAL: 'Nada vira público sem aprovação do dono (salvo piloto automático ligado por ele).',
  NO_OUTBOUND_MESSAGES: 'Mensagens para criadores são só rascunhos; o sistema nunca envia.',
  SECRETS_HYGIENE: 'Segredos só em .env/cofre; nunca no código, repositório ou logs.',
} as const;

export type PolicyRule = keyof typeof POLICY_RULES;

export class PolicyViolation extends Error {
  override name = 'PolicyViolation';
  constructor(
    public readonly rule: PolicyRule,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
  }
}
