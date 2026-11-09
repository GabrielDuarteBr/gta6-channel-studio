import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookImage,
  CalendarDays,
  CheckCheck,
  Clapperboard,
  Handshake,
  LayoutDashboard,
  Newspaper,
  Palette,
  Settings,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Fase em que a tela ganha funcionalidade. 0 = já funciona. */
  phase: number;
  description: string;
}

export const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Visão geral',
    icon: LayoutDashboard,
    phase: 6,
    description: 'Inscritos, views, tempo de exibição, top vídeos e comparação por formato.',
  },
  {
    href: '/pauta',
    label: 'Pauta',
    icon: Newspaper,
    phase: 1,
    description: 'Notícias pontuadas com fontes e botões para virar longo, Short ou compilado.',
  },
  {
    href: '/producao',
    label: 'Produção',
    icon: Clapperboard,
    phase: 3,
    description:
      'Kanban em tempo real: Ideia → Roteiro → Voz → Animação → Edição → Revisão → Conformidade → Aprovação → Publicado.',
  },
  {
    href: '/aprovacao',
    label: 'Aprovação',
    icon: CheckCheck,
    phase: 5,
    description:
      'Player, quadros revisados, roteiro, fontes, relatório de conformidade e aprovar/rejeitar.',
  },
  {
    href: '/calendario',
    label: 'Calendário',
    icon: CalendarDays,
    phase: 5,
    description: 'Publicações agendadas e publicadas.',
  },
  {
    href: '/parceiros',
    label: 'Parceiros',
    icon: Handshake,
    phase: 4,
    description:
      'Candidatos com evidência, parceiros com prova da permissão, condições e revogação.',
  },
  {
    href: '/personagem',
    label: 'Personagem',
    icon: Sparkles,
    phase: 2,
    description: 'Bíblia do Zeca, expressões, poses, bocas, teste de voz e layouts.',
  },
  {
    href: '/arte',
    label: 'Arte',
    icon: Palette,
    phase: 3,
    description: 'Cenários e fundos gerados, com aprovar, descartar e gerar variação.',
  },
  {
    href: '/biblioteca',
    label: 'Biblioteca',
    icon: BookImage,
    phase: 3,
    description:
      'Mídia com manifesto de direitos obrigatório, importação de links de parceiros, tags e busca.',
  },
  {
    href: '/comando',
    label: 'Comando',
    icon: TerminalSquare,
    phase: 7,
    description: 'Chat com o Diretor, mostrando as ferramentas que ele chama.',
  },
  {
    href: '/configuracoes',
    label: 'Configurações',
    icon: Settings,
    phase: 0,
    description: 'Perfil, modo simulado, limites, orçamento, anti-spoiler e identidade.',
  },
  {
    href: '/saude',
    label: 'Saúde e custos',
    icon: Activity,
    phase: 0,
    description: 'Estado dos serviços, auditoria, custos e cota.',
  },
];

export function navItem(href: string): NavItem {
  const item = NAV.find((n) => n.href === href);
  if (!item) throw new Error(`Rota sem item de navegação: ${href}`);
  return item;
}
