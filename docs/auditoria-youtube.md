# Auditoria da YouTube API (para os vídeos poderem ficar públicos pela API)

Projetos do Google Cloud que ainda não passaram pela auditoria do YouTube têm os vídeos enviados
pela API **travados como privados**. O estúdio já envia tudo privado e agendado; depois da
auditoria, o agendamento passa a publicar sozinho na data que você aprovou. Até lá, publique pelo
YouTube Studio (a Aprovação avisa quando a hora passa e o vídeo continua privado).

## O que preparar antes

1. **Política de privacidade e termos de uso** num endereço público (pode ser uma página simples,
   por exemplo no Google Sites ou no GitHub Pages). Os textos abaixo servem de base.
2. **Cliente OAuth publicado** ("Em produção") com os escopos `youtube.upload`, `youtube.readonly`
   e `yt-analytics.readonly` (guia do notebook, seção 13.1).
3. **Vídeo curto de demonstração** (gravação de tela, 1 a 2 min, pode ser não listado): login no
   painel, Configurações → Conectar YouTube (tela de consentimento do Google), um vídeo na
   Aprovação com o relatório da Conformidade, aprovar com data, e o vídeo aparecendo **privado e
   agendado** no YouTube Studio com "conteúdo alterado ou sintético".

## Onde pedir

No formulário **"YouTube API Services – Audit and Quota Extension"** do Google (procure por esse
nome; hoje ele fica em `support.google.com/youtube/contact/yt_api_form`). Use o e-mail da conta
dona do projeto do Google Cloud e informe o número do projeto (página inicial do console).

## Respostas sugeridas (copie e ajuste)

**Nome do app / organização:** Radar Neon Studio (uso próprio do canal Radar Neon).

**Descrição do uso da API (em inglês, como o formulário pede):**

> Radar Neon Studio is a private, single-user tool that runs on the channel owner's own computer.
> It helps the owner of one YouTube channel ("Radar Neon", Brazilian Portuguese gaming news) to
> prepare original news videos and upload them to that same channel.
>
> - OAuth is used only by the channel owner, who signs in with Google to authorize their own
>   channel. Tokens are stored encrypted (AES-256-GCM) on the owner's machine and are never shared.
> - `videos.insert` (resumable): every upload is created as **private** with a scheduled
>   `publishAt`, `selfDeclaredMadeForKids=false` and `containsSyntheticMedia=true` (the host is an
>   animated character with a synthetic voice). Nothing is published without the owner explicitly
>   approving each video in the dashboard.
> - `thumbnails.set` for the approved custom thumbnail of long videos.
> - `channels.list` (mine) to show which channel is connected; `videos.list` for status and public
>   statistics of the channel's own videos.
> - YouTube Analytics API (`reports.query`, `ids=channel==MINE`) to show the owner their own channel
>   metrics in a private dashboard.
> - Data API `search.list`/`channels.list`/`playlistItems.list` with an API key read public
>   metadata only (titles, links, publish dates) to find news and potential collaborators. The tool
>   never downloads YouTube audio or video, never re-uploads third-party content and never sends
>   messages to other creators (it only drafts text that the owner may send manually).
> - Expected volume: up to 1 long video and 4 Shorts per day, plus one metrics sync every 3 hours.

**Por que precisa:** publicar automaticamente na data que o dono aprovou (hoje os envios ficam
travados como privados) e ler as métricas do próprio canal.

**Quem acessa:** só o dono do canal (1 usuário). Não há outros usuários nem acesso público.

## Base para a política de privacidade (português)

> **Política de privacidade do Radar Neon Studio.** O Radar Neon Studio é uma ferramenta de uso
> pessoal do dono do canal Radar Neon, que roda no computador dele. Ao conectar o YouTube, o dono
> autoriza o acesso ao próprio canal pelos Serviços de API do YouTube para enviar vídeos (sempre
> privados e agendados) e ler as estatísticas do canal. Os tokens de acesso ficam cifrados no
> computador do dono e não são compartilhados com terceiros. Não coletamos dados de espectadores
> nem de outros usuários. O dono pode revogar o acesso a qualquer momento no painel (Desconectar)
> ou em <https://myaccount.google.com/permissions>. Ao usar esta ferramenta você também concorda
> com a Política de Privacidade do Google (<https://policies.google.com/privacy>) e com os Termos de
> Serviço do YouTube (<https://www.youtube.com/t/terms>). Contato: (seu e-mail).

## Base para os termos de uso (português)

> **Termos de uso do Radar Neon Studio.** Ferramenta pessoal, sem usuários externos. O uso dos
> Serviços de API do YouTube segue os Termos de Serviço do YouTube
> (<https://www.youtube.com/t/terms>) e as Políticas dos Serviços de API do YouTube. O conteúdo
> publicado é de responsabilidade do dono do canal, que aprova cada vídeo antes da publicação.

## Depois da aprovação

Nada muda no estúdio: os próximos envios aprovados passam a ir ao ar sozinhos na data marcada (a
métrica "publicado" aparece no Calendário após a sincronização). Se o Google pedir ajustes, mande a
mensagem para o Claude.
