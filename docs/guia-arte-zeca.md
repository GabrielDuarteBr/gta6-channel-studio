# Guia para o artista: o Zeca Neon em camadas

Este guia é para quem vai desenhar o **Zeca Neon**, apresentador animado do canal Radar Neon. O
estúdio anima o personagem sozinho: a boca acompanha a fala, ele pisca, respira, muda de
expressão e faz gestos. Para isso, o desenho precisa vir **separado em partes (camadas)**, e não
como uma imagem única.

O **modelo** com todas as camadas nas posições certas (um boneco simples, só para referência) está
no painel, em **Personagem → Arte do artista → "Baixar modelo para o artista"**, e no projeto em
`docs/modelo-arte-zeca/`. Você pode desenhar por cima dele no seu programa.

## Regras gerais

1. **Todas as camadas com o mesmo tamanho de tela**, com fundo **transparente**. Recomendado:
   **1500 × 1800 px** (proporção 5:6), personagem da cintura para cima, centralizado, com a base
   do corpo encostando na borda de baixo.
2. Cada camada é **um arquivo**, já na posição final dentro da tela (não recorte). Se você ligar
   todas as camadas no seu programa, tem que ver o personagem montado.
3. Formato: **PNG** (recomendado) ou **SVG simples**. O SVG não pode ter scripts, links externos
   nem imagens de fora (o painel recusa).
4. Até 8 MB por arquivo e 24 MB no total.
5. Nomes exatamente como na tabela abaixo (maiúsculas, acentos e espaços não atrapalham:
   `Cabeça.png` e `cabeca.png` valem igual).

## Camadas

### Obrigatórias (sem elas o painel não aceita)

| Arquivo | O que é |
|---|---|
| `corpo.png` | Tronco, camisa e pescoço. **Sem o braço que gesticula** (ele é uma camada própria). |
| `cabeca.png` | Cabeça, orelhas, cabelo e nariz, **sem olhos, sem sobrancelhas e sem boca**. |
| `olhos-aberto.png` | Os dois olhos abertos (olhando para a frente). |
| `olhos-fechado.png` | Os dois olhos fechados (usado na piscada). |
| `sobrancelhas-neutro.png` | Sobrancelhas na posição normal. |
| `boca-A.png` … `boca-H.png` e `boca-X.png` | As 9 bocas da fala (tabela abaixo). |

### As 9 bocas (padrão de animação Preston Blair)

| Arquivo | Som | Como fica |
|---|---|---|
| `boca-A.png` | M, B, P | lábios fechados, apertados |
| `boca-B.png` | K, S, T, I | dentes quase juntos, boca um pouco aberta |
| `boca-C.png` | É, Ê | aberta, média |
| `boca-D.png` | A | bem aberta |
| `boca-E.png` | Ó, R | aberta e arredondada |
| `boca-F.png` | U, O, W | bico (lábios para a frente) |
| `boca-G.png` | F, V | dentes de cima no lábio de baixo |
| `boca-H.png` | L | aberta, ponta da língua para cima |
| `boca-X.png` | (repouso) | boca fechada e relaxada, quando ele não está falando |

Todas as bocas no mesmo lugar do rosto. Dica: desenhe a boca com um leve sorriso; o Zeca é
animado.

### Expressões (recomendadas)

O Zeca tem 8 expressões. Para cada uma, desenhe as **sobrancelhas** (e, se quiser, os olhos e um
detalhe no rosto). O que faltar usa a versão neutra.

| Expressão | Quando ele usa | Arquivos |
|---|---|---|
| neutro | explicação, transição | `sobrancelhas-neutro.png` (obrigatória) |
| feliz | notícia boa, fechamento | `sobrancelhas-feliz.png` |
| empolgado | novidade grande, abertura com energia | `sobrancelhas-empolgado.png` |
| debochado | zoeira com a situação | `sobrancelhas-debochado.png` |
| desconfiado | rumor, "será mesmo?" (uma sobrancelha erguida) | `sobrancelhas-desconfiado.png` |
| surpreso | revelação | `sobrancelhas-surpreso.png` |
| sério | alerta importante | `sobrancelhas-serio.png` |
| bravo | raro: golpe, atraso | `sobrancelhas-bravo.png` |

Opcionais por expressão:

- `olhos-<expressão>.png`: olhos daquela expressão (ex.: `olhos-desconfiado.png` com um olho mais
  fechado). Sem ela, usa `olhos-aberto.png`.
- `rosto-<expressão>.png`: detalhe por cima do rosto (ex.: `rosto-empolgado.png` com bochechas
  coradas, `rosto-bravo.png` com uma veia saltada).

### Opcionais (deixam a animação melhor)

| Arquivo | O que é |
|---|---|
| `olhos-meio.png` | Olhos meio fechados (deixa a piscada mais suave). |
| `braco-repouso.png` | O braço que gesticula, parado (abaixado). |
| `braco-aponta_tela.png` | O mesmo braço apontando para cima/para o lado, mostrando algo na tela. |
| `braco-aceno.png` | O mesmo braço levantado, acenando (mão aberta). |
| `costas.png` | O que fica atrás do corpo (ex.: cabelo comprido de trás). |
| `frente.png` | O que fica na frente do rosto e se mexe com a cabeça: **os óculos escuros neon**, franja, boné. |

## Ordem das camadas (de trás para a frente)

```
costas → corpo → braço → cabeca → olhos → sobrancelhas → boca → rosto-<expressão> → frente
```

O braço fica **atrás da cabeça e na frente do corpo**. Os óculos vão na camada `frente`, por cima
dos olhos, com lentes um pouco transparentes, para os olhos e a piscada aparecerem.

## Movimento

O estúdio mexe as camadas assim:

- **Cabeça** (com olhos, sobrancelhas, boca, rosto e frente) gira um pouco em cada expressão, em
  volta do **pescoço**. Ponto padrão: 50% da largura × 55% da altura da tela.
- **Braço** gira em volta do **ombro** no aceno. Ponto padrão: 66% × 62%.
- Respiração: o corpo e a cabeça sobem e descem bem pouco.

Se o desenho tiver o pescoço ou o ombro em outro lugar, o dono ajusta esses pontos no painel ao
enviar (em "Ajuste fino: pontos de giro").

## Visual do personagem (bíblia atual)

- Óculos escuros com armação neon (rosa e ciano), lentes que deixam ver os olhos.
- Camisa floral aberta no colarinho, clima Vice City/Leonida.
- Topete escuro com brilho magenta.
- Personalidade: comentarista com energia de youtuber, divertido e sarcástico. A pose padrão pode
  ser descontraída e confiante.

Não use logotipos, marcas ou personagens de jogos (nem do GTA), nem rostos de pessoas reais.

## Entrega

Mande a pasta com os arquivos (ou um .zip). O dono vai:

1. extrair a pasta;
2. no painel, em **Personagem → Arte do artista**, escolher todos os arquivos, preencher o seu
   nome e a prova de direitos (contrato de cessão ou licença), e enviar;
3. conferir a prévia de todas as expressões, bocas e da piscada, e gerar um clipe de teste;
4. clicar em **Usar esta arte**.

Se algo estiver fora do padrão, o painel diz exatamente qual arquivo (ex.: "boca-D: tamanho
1400×1800 diferente da tela 1500×1800").
