# Tesouraria — Projeção do caixa (cenários) — Visão Ampliada

Modal sob demanda no card "Projeção do caixa — cenários" da Caixa. O
usuário informa **data inicial** e **data final** (padrão 01/01 → 31/12 do
ano corrente, America/Sao_Paulo) e clica em **Gerar projeção**. Alterar as
datas não dispara o cálculo. Os três cenários continuam o mesmo motor.

## Semântica temporal (motor real)

O motor de cenários é **prospectivo**: janela civil de `asOf` (hoje) até
`asOf + horizonDays`, ancorada no saldo oficial de hoje. Estender a janela
DELE para trás faria a projeção futura divergir da âncora (a acumulação é
sequencial, sem re-ancoragem no meio) — por isso o motor permanece intacto
e o **passado realizado entra como PREFIXO no frontend**: os dias anteriores
a hoje, dentro do período pedido, vêm da série canônica da Linha do tempo
(a MESMA composição da Visão Anual — board anual + fluxo de hoje + agenda
via `buildTreasuryCaixaAnnualSeries`), com as três linhas coincidindo com o
realizado, exatamente como o motor trata dias < asOf. No padrão, a janela
é o ano civil (01/01 → 31/12). A projeção a partir de hoje continua a do
card quando o fim é 31/12. Presets locais: Ano completo / Hoje → 31/12 /
próximos 90 / próximos 180 dias, sobre a série já gerada.

## Arquitetura (fonte única)

- Backend: `GET /api/finance/treasury/caixa/scenarios` segue clampando `horizonDays`
  em 366 para quem não pede a extensão. Isso preserva os recortes de
  7/15/30/60/90. A visão ampliada, quando a data final passa de 31/12 do
  ano da âncora, envia `extendDueEstimatesBeyondAnchorYear=1`. O serviço
  então lê o board oficial de cada ano seguinte da janela e honra o
  horizonte até 732 dias (dois anos civis). Acima disso a visão recusa,
  com mensagem, sem truncar. As estimativas entram só no mapa diário do
  Realista; a população de títulos de CR/CP do ano da âncora não muda.
- Período inteiramente anterior a hoje não chama o motor de cenários: o
  gráfico é o prefixo realizado da Linha do tempo daquele ano.
- `treasuryCaixaScenariosExpandedUi.ts` — plano do período (strings civis),
  presets/índices e KPIs derivados das linhas desenhadas.
- `TreasuryCaixaScenariosExpandedModal.tsx` — lazy (React.lazy), carregamento
  só no "Gerar projeção" (AbortController + sequência; cache por período),
  renderiza o PRÓPRIO `TreasuryCaixaScenariosChart` (mesmas séries, legenda,
  tooltip, drill-down e simulador what-if) com `brush` opt-in.
- `TreasuryCaixaScenariosChart` — três acréscimos opt-in: `headerAction`
  (botão no card), `brush` (Brush nativo do Recharts, granularidade DIÁRIA
  do gráfico) e `export buildRows` (KPIs do modal usam exatamente os números
  desenhados). Card atual: comportamento intacto (7/15/30/60/90 e default
  30 preservados; modo apresentação inalterado).

## Equivalência provada (não inferida)

Testes rodam os motores puros com os MESMOS inputs em janela 30/60/90 vs
365 e comparam por deepEqual: `computeTreasuryCaixaScenarios` produz prefixo
dia a dia IDÊNTICO, e os deltas diários de `computeTreasurySalesVolumeScenarios`
coincidem no prefixo (o run-rate diário deriva da média mensal ÷ 21 e não
depende do fim do horizonte — o horizonte só corta). A visão ampliada é,
portanto, o card com horizonte maior — nunca uma segunda conta.

## Contratos protegidos por teste

- Zero fetch: página/abrir modal/interações — o carregamento só no Gerar
  (cenários + board anual + agenda, todos endpoints canônicos existentes);
  slicer (presets/datas/brush) recorta índices localmente, KPIs sobre o
  recorte; o prefixo do passado nunca recalcula cenário.
- Bordas: start>end (troca), datas fora da janela (clamp), NaN, vazio,
  ponto único, 29/02/2028.
- Gates estruturais: lazy sem import estático; fetch único no handler;
  AbortController+seq; endpoint canônico; mesmo componente/buildRows;
  HORIZON_OPTIONS e default do card congelados.

Testes: `treasuryCaixaScenariosExpandedUi.test.ts` (coletado pelo
`test:treasury`).
