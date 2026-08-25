# Tesouraria — Projeção do caixa (cenários) — Visão Ampliada

Modal sob demanda no card "Projeção do caixa — cenários" da Caixa que projeta
os MESMOS três cenários (Otimista/Realista/Pessimista) de **hoje até 31/12**,
com slicers locais — sem segundo motor.

## Semântica temporal (motor real)

O motor de cenários é **prospectivo**: janela civil de `asOf` (hoje) até
`asOf + horizonDays`; o board que o alimenta cobre o ano civil do asOf. Não
existe projeção retroativa — por isso a visão ampliada NÃO oferece "ano
passado" nem 01/01 retroativo (`REQUEST_ADAPTATION_REQUIRED=YES`): o range
máximo semanticamente rico é hoje → 31/12, e é isso que ela carrega. Os
presets trimestrais civis foram adaptados para janelas prospectivas
(Até 31/12 / 30 / 60 / 90 / 180 dias), alinhadas aos horizontes do card.

## Arquitetura (fonte única)

- Backend: **zero mudança** — `GET /api/treasury/caixa/scenarios` já aceita
  e clampa `horizonDays` até 365 (`MAX_HORIZON_DAYS`); mesma permissão.
- `treasuryCaixaScenariosExpandedUi.ts` — horizonte hoje→31/12 (strings
  civis, bissexto correto), presets/índices/clamp (reusa
  `normalizeAnnualRange`) e KPIs derivados das linhas desenhadas.
- `TreasuryCaixaScenariosExpandedModal.tsx` — lazy (React.lazy), UM request
  no "Gerar projeção" (AbortController + sequência; cache do payload),
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

- Zero fetch: página/abrir modal/interações — o request só no Gerar; slicer
  (presets/datas/brush) recorta índices localmente, KPIs sobre o recorte.
- Bordas: start>end (troca), datas fora da janela (clamp), NaN, vazio,
  ponto único, 29/02/2028.
- Gates estruturais: lazy sem import estático; fetch único no handler;
  AbortController+seq; endpoint canônico; mesmo componente/buildRows;
  HORIZON_OPTIONS e default do card congelados.

Testes: `treasuryCaixaScenariosExpandedUi.test.ts` (coletado pelo
`test:treasury`).
