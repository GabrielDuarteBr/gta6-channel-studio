import { describe, expect, it } from 'vitest';
import {
  assertAssetRenderable,
  assertManifestInput,
  assertPartnerPermission,
  assertPermissionInput,
  assertReactTimeline,
  checkDescriptionConditions,
  checkReactTimeline,
  findPermissionHints,
  isAllowedDownloadHost,
  isSubstantiveComment,
  parseShareLink,
  partnerDescriptionLines,
  PolicyViolation,
  reactStats,
  type PartnerConditions,
  type PermissionInput,
  type ReactBlock,
} from '../src';

const conditions: PartnerConditions = {
  credit: 'Canal do Fulano',
  link: 'https://www.youtube.com/@fulano',
  hashtag: '#fulanogames',
  monetization: 'allowed',
};

const goodPermission: PermissionInput = {
  type: 'REACT_CLIPS',
  proofKind: 'EMAIL',
  proof:
    'E-mail de fulano@exemplo.com em 10/11/2026: "Autorizo o Radar Neon a usar cortes dos meus vídeos de GTA 6 em Shorts de react, com crédito e link do canal."',
  hasProofFile: false,
  grantedAt: new Date('2026-11-10T12:00:00Z'),
  conditions,
  explicitConfirmation: true,
};
const now = new Date('2026-11-17T12:00:00Z');

describe('permissão de parceiro (regra 2)', () => {
  it('aceita permissão explícita, com prova e condições', () => {
    expect(() => assertPermissionInput(goodPermission, now)).not.toThrow();
  });

  it('frase vaga vira candidato, não permissão', () => {
    expect(findPermissionHints('Canal de GTA! Cortes liberados, só dar os créditos 😎')).toEqual([
      'cortes liberados',
    ]);
    expect(findPermissionHints('Clips allowed — feel free to use with credit')).toEqual([
      'feel free to use',
      'clips allowed',
    ]);
    expect(() =>
      assertPermissionInput(
        { ...goodPermission, proof: 'Na descrição do canal: cortes liberados!!' },
        now,
      ),
    ).toThrow(/não é permissão/);
    // Com o print anexado, a descrição curta basta (o print é a prova).
    expect(() =>
      assertPermissionInput(
        {
          ...goodPermission,
          proof: 'Print da conversa no Instagram: cortes liberados',
          hasProofFile: true,
        },
        now,
      ),
    ).not.toThrow();
  });

  it('exige confirmação do dono, data coerente e condições válidas', () => {
    expect(() =>
      assertPermissionInput({ ...goodPermission, explicitConfirmation: false }, now),
    ).toThrow(/Confirme/);
    expect(() =>
      assertPermissionInput({ ...goodPermission, grantedAt: new Date('2026-12-30') }, now),
    ).toThrow(/futuro/);
    expect(() =>
      assertPermissionInput(
        { ...goodPermission, expiresAt: new Date('2026-11-01T00:00:00Z') },
        now,
      ),
    ).toThrow(/validade/);
    expect(() =>
      assertPermissionInput({ ...goodPermission, conditions: { ...conditions, credit: '' } }, now),
    ).toThrow(/crédito/);
    expect(() =>
      assertPermissionInput(
        { ...goodPermission, conditions: { ...conditions, hashtag: 'sem cerquilha' } },
        now,
      ),
    ).toThrow(/Hashtag/);
    expect(() =>
      assertPermissionInput(
        { ...goodPermission, conditions: { ...conditions, link: 'http://10.0.0.5/x' } },
        now,
      ),
    ).toThrow(/https/);
  });

  it('usar material exige permissão ativa, vigente e do tipo certo', () => {
    const perm = { id: 'p1', type: 'REACT_CLIPS' as const, status: 'ACTIVE' as const };
    expect(() => assertPartnerPermission(perm, 'REACT_CLIPS', now)).not.toThrow();
    expect(() => assertPartnerPermission(null, 'REACT_CLIPS', now)).toThrow(/sem permissão/);
    expect(() =>
      assertPartnerPermission({ ...perm, status: 'REVOKED' }, 'REACT_CLIPS', now),
    ).toThrow(/revogada/);
    expect(() =>
      assertPartnerPermission({ ...perm, status: 'SUSPENDED' }, 'REACT_CLIPS', now),
    ).toThrow(/suspensa/);
    expect(() =>
      assertPartnerPermission({ ...perm, expiresAt: new Date('2026-11-16') }, 'REACT_CLIPS', now),
    ).toThrow(/vencida/);
  });

  it('manifesto e render de mídia de parceiro conferem a permissão', () => {
    const permission = { id: 'p1', type: 'REACT_CLIPS' as const, status: 'ACTIVE' as const };
    expect(() =>
      assertManifestInput({
        origin: 'PARTNER',
        license: 'Permissão de cortes para react',
        credit: 'Canal do Fulano',
        permission,
      }),
    ).not.toThrow();
    expect(() =>
      assertManifestInput({ origin: 'PARTNER', license: 'Permissão', permission }),
    ).toThrow(/crédito/);
    const asset = {
      id: 'v1',
      origin: 'PARTNER' as const,
      manifest: { origin: 'PARTNER' as const, license: 'Permissão', status: 'ACTIVE' as const },
    };
    expect(() => assertAssetRenderable({ ...asset, permission }, now)).not.toThrow();
    expect(() =>
      assertAssetRenderable({ ...asset, permission: { ...permission, status: 'REVOKED' } }, now),
    ).toThrow(PolicyViolation);
  });
});

describe('links de arquivos do parceiro', () => {
  it('Dropbox: força o download e mantém o rlkey', () => {
    expect(
      parseShareLink('https://www.dropbox.com/scl/fi/abc123/clipe.mp4?rlkey=xyz&e=1&dl=0'),
    ).toEqual({
      provider: 'dropbox',
      url: 'https://www.dropbox.com/scl/fi/abc123/clipe.mp4?rlkey=xyz&dl=1',
      folder: false,
    });
    expect(parseShareLink('https://www.dropbox.com/scl/fo/pasta1/AAA?rlkey=k&dl=0')).toMatchObject({
      provider: 'dropbox',
      folder: true,
    });
  });

  it('Google Drive: arquivo e pasta', () => {
    expect(
      parseShareLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_q-rs/view?usp=sharing'),
    ).toEqual({ provider: 'gdrive', id: '1AbCdEfGhIjKlMnOp_q-rs', folder: false });
    expect(
      parseShareLink('https://drive.google.com/drive/folders/1ZyXwVuTsRqPoNmLkJi?usp=drive_link'),
    ).toEqual({ provider: 'gdrive', id: '1ZyXwVuTsRqPoNmLkJi', folder: true });
    expect(parseShareLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toMatchObject({
      id: '1AbCdEfGhIjKlMnOp',
    });
  });

  it('YouTube e outros sites são recusados; redirecionamento só para Dropbox/Google', () => {
    expect(() => parseShareLink('https://www.youtube.com/watch?v=abc')).toThrow(/YouTube/);
    expect(() => parseShareLink('https://youtu.be/abc')).toThrow(/YouTube/);
    expect(() => parseShareLink('https://mega.nz/file/abc')).toThrow(/Dropbox ou do Google Drive/);
    expect(() => parseShareLink('http://www.dropbox.com/s/abc/x.mp4')).toThrow(/https/);
    expect(isAllowedDownloadHost('uc3f2.dl.dropboxusercontent.com')).toBe(true);
    expect(isAllowedDownloadHost('www.googleapis.com')).toBe(true);
    expect(isAllowedDownloadHost('rr1---sn.googlevideo.com')).toBe(false);
    expect(isAllowedDownloadHost('evil-dropbox.com')).toBe(false);
    expect(isAllowedDownloadHost('postgres')).toBe(false);
  });
});

describe('Short de react (regra 3)', () => {
  const credit = 'Canal do Fulano';
  const good: ReactBlock[] = [
    {
      kind: 'comment',
      start: 0,
      end: 6,
      spoken: 'Olha o que a galera achou no mapa novo de Leonida, perto do porto.',
    },
    { kind: 'clip', start: 6, end: 12, credit },
    {
      kind: 'comment',
      start: 12,
      end: 20,
      spoken: 'Repara que o carro derrapa diferente na areia molhada, a física mudou muito.',
    },
    { kind: 'clip', start: 20, end: 25, credit },
    {
      kind: 'comment',
      start: 25,
      end: 31,
      spoken: 'Conta aqui se você acha que isso vai mudar as perseguições do jogo.',
    },
  ];

  it('reações genéricas não contam como comentário', () => {
    expect(isSubstantiveComment('Uau! Olha isso, caramba, kkkk')).toBe(false);
    expect(isSubstantiveComment('Nossa... olha só isso, que isso mano')).toBe(false);
    expect(isSubstantiveComment('Repara no reflexo da água na lataria do carro')).toBe(true);
  });

  it('timeline boa passa: clipe ≤ 50%, comentário substantivo ≥ 50%', () => {
    const s = assertReactTimeline(good, { credit });
    expect(s).toMatchObject({
      totalSec: 31,
      clipSec: 11,
      commentSec: 20,
      substantiveCommentSec: 20,
    });
    expect(s.clipRatio).toBeLessThanOrEqual(0.5);
  });

  it('clipe demais, comentário vazio, sobreposição, clipes seguidos e sem crédito falham', () => {
    const longClip: ReactBlock[] = [
      { kind: 'comment', start: 0, end: 5, spoken: good[0]!.spoken },
      { kind: 'clip', start: 5, end: 20, credit },
      { kind: 'comment', start: 20, end: 25, spoken: good[2]!.spoken },
    ];
    expect(
      checkReactTimeline(longClip, { credit })
        .map((i) => i.message)
        .join(' '),
    ).toMatch(/clipe ocupa 60%/);
    const generic = good.map((b) =>
      b.kind === 'comment' ? { ...b, spoken: 'Uau, olha isso!' } : b,
    );
    expect(checkReactTimeline(generic, { credit })[0]!.message).toMatch(/não contam/);
    const overlap = good.map((b, i) => (i === 2 ? { ...b, start: 11 } : b));
    expect(checkReactTimeline(overlap, { credit }).some((i) => /pausar/.test(i.message))).toBe(
      true,
    );
    const twoClips: ReactBlock[] = [
      good[0]!,
      good[1]!,
      { kind: 'clip', start: 12, end: 13, credit },
      { ...good[2]!, start: 13 },
    ];
    expect(checkReactTimeline(twoClips, { credit }).some((i) => /seguidos/.test(i.message))).toBe(
      true,
    );
    const noCredit = good.map((b) => (b.kind === 'clip' ? { ...b, credit: null } : b));
    expect(
      checkReactTimeline(noCredit, { credit }).some((i) => i.rule === 'PARTNER_CONDITIONS'),
    ).toBe(true);
    expect(() => assertReactTimeline(longClip, { credit })).toThrow(PolicyViolation);
  });

  it('teto de clipe do parceiro e limite configurado mais rígido', () => {
    expect(checkReactTimeline(good, { credit, maxClipSec: 8 })[0]!.message).toMatch(/até 8 s/);
    expect(checkReactTimeline(good, { credit, maxClipRatio: 0.3 })[0]!.message).toMatch(
      /máximo 30%/,
    );
    // O limite configurado nunca afrouxa a regra.
    expect(reactStats(good).clipRatio).toBeLessThan(0.5);
    const tooMuch: ReactBlock[] = [
      { kind: 'comment', start: 0, end: 4, spoken: good[0]!.spoken },
      { kind: 'clip', start: 4, end: 9, credit },
    ];
    expect(checkReactTimeline(tooMuch, { credit, maxClipRatio: 0.9 }).length).toBeGreaterThan(0);
  });

  it('descrição com crédito, link e hashtag do parceiro', () => {
    const { lines, hashtags } = partnerDescriptionLines(conditions, 'Fulano');
    const desc = [...lines, hashtags.join(' ')].join('\n');
    expect(desc).toContain('Clipe: Canal do Fulano — https://www.youtube.com/@fulano');
    expect(checkDescriptionConditions(desc, conditions)).toEqual([]);
    expect(checkDescriptionConditions('Sem nada', conditions)).toHaveLength(3);
  });
});
