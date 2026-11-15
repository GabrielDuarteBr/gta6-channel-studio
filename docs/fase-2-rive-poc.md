# Fase 2 — Prova de conceito do Caminho A (Rive)

Data: 15/11/2026. Ambiente: imagem de render do projeto (Remotion 4.0.542, Chrome headless,
modo `swiftshader`), `@remotion/rive` 4.0.542 e `@rive-app/canvas-advanced` 2.31.5 (MIT).
Arquivo de teste: `rating.riv`, exemplo oficial do Rive (MIT), state machine "State Machine 1"
com a entrada numérica `rating` (análoga a "qual boca mostrar").

## O que foi testado

| Pergunta | Resultado |
|---|---|
| O componente oficial `<RemotionRiveCanvas>` controla state machine ou data binding? | **Não.** Ele toca só **uma animação linear** e avança pela diferença entre quadros. Não há props para entradas nem para view model. |
| O componente oficial funciona sem internet? | **Não.** O WASM do Rive vem fixo de `unpkg.com` a cada render. Com a rede travada (VPS, CDN fora), o render quebra; e é código baixado de fora a cada vídeo. |
| Dá para controlar uma state machine **por quadro** de forma determinística? | **Sim**, com componente próprio (`apps/render/src/remotion/RivePoc.tsx`): a cada quadro cria artboard + state machine novos, ajusta a entrada e avança só o tempo desde a última troca (que sai da linha do tempo). Nenhum quadro depende do anterior. |
| Funciona sem CDN? | **Sim.** O WASM sai do pacote npm e é servido localmente pelo bundle. |
| Dois renders dão quadros idênticos? | **Sim:** 120 de 120 quadros com o mesmo hash (`framemd5`). |
| A entrada muda o desenho de verdade? | **Sim:** `rating` 1, 3 e 5 acendem 1, 3 e 5 estrelas nos quadros certos. |
| Desempenho | 120 quadros (720p) em ~8 s, na mesma faixa do Caminho B. |
| Data binding (view model) | Disponível na 2.31.5 (`ViewModel`, `bindViewModelInstance`). É o jeito mais limpo para um personagem: propriedades `boca`, `expressao`, `piscada`, `gesto`. Não testado por falta de um `.riv` com view model. |

## Conclusão

- O Caminho A é **viável tecnicamente**, mas **não** com o componente oficial: usamos o nosso
  (runtime local + avaliação por quadro sem estado).
- O que falta para o A virar produção é **arte**: um `.riv` do Zeca feito no editor do Rive com
  entradas (ou view model) para boca (9 formas do Rhubarb), expressão, piscada e gestos. Isso
  depende de um animador que use Rive e, possivelmente, de plano pago do editor para exportar
  (a conferir antes de contratar).
- O Caminho B (camadas SVG) já entrega tudo o que a fase pede (boca sincronizada, expressões,
  gestos, piscada, respiração, quadros idênticos), sem custo de licença.

## Recomendação

Manter o **Caminho B (camadas) como padrão**. Decidir entre A e B na hora de contratar a arte
definitiva:

- Ilustrador entrega **camadas** (SVG/PNG por parte do rosto e do corpo) → seguimos no B.
- Animador entrega **`.riv` com entradas ou view model** → o A já tem o componente pronto.

Nos dois casos o restante do sistema não muda: a linha do tempo (`@studio/avatar`) é a mesma e
o motor fica atrás da interface `AvatarEngine`.
