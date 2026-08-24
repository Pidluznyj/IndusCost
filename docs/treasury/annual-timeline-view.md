# Tesouraria — Visão Anual da Linha do Tempo

Modal sob demanda em Financeiro → Tesouraria (Caixa) que apresenta a Linha do
Tempo Financeira de um ano civil completo (01/jan–31/dez), com a MESMA regra
financeira do gráfico "Evolução do saldo" da página.

## Arquitetura (fonte única)

```
motor canônico (treasuryCaixaRules)
  buildTreasuryCaixaUnifiedTimeline → appendTreasuryCaixaDailyDueEstimates
  → buildTreasuryCaixaMonthlyTimeline → buildTreasuryCaixaMonthlyBalanceChart
        │                                        │
   página da Caixa                        Visão Anual (modal lazy)
   (período filtrado)                     (year sem mês/dia = ano civil)
        └──── mesma composição: treasuryCaixaAnnualViewUi ────┘
```

- `src/lib/treasury/treasuryCaixaAnnualViewUi.ts` — composição compartilhada:
  `buildTreasuryCaixaTimelineFromBoardSources` (movida da página; a página
  importa daqui), `buildTreasuryCaixaAnnualSeries` (mesma cadeia canônica,
  incluindo a correção do fluxo de hoje ancorada no board do ano pedido) e
  `deriveTreasuryCaixaAnnualKpis` (KPIs derivados da própria série — nenhuma
  query própria).
- `src/components/finance/treasury/TreasuryCaixaAnnualViewModal.tsx` — modal
  (CostCenterDialog oficial), carregado por `React.lazy` na página; renderiza
  o PRÓPRIO `TreasuryCaixaBalanceChart`.
- Backend: **zero mudança** — `GET /api/treasury/caixa?year=YYYY` já resolve
  01/01–31/12 (bissexto incluso) via `resolveTreasuryCaixaDueDateRange`; a
  agenda canônica é pedida para o mesmo período, como a página faz. Mesmo
  guard de permissão do board.

## Contratos (protegidos por teste)

- Nenhum request ao abrir a Tesouraria, ao abrir o modal ou ao trocar o ano;
  o fetch acontece só no clique em **Gerar gráfico** (2 requests: board +
  agenda — os mesmos de uma pesquisa da página).
- Corrida: AbortController + número de sequência; fechar/desmontar aborta;
  resposta antiga nunca sobrescreve o ano mais novo. Cache por ano enquanto o
  modal está aberto.
- Granularidade mensal — a mesma agregação oficial do gráfico da página
  (o ponto É o "Terminou" do mês da linha do tempo; nada recalculado).
- KPIs: saldo inicial do período (abertura do 1º mês com saldo), menor saldo
  do ano + mês, saldo final (rótulo oficial realizado × projetado do ponto).
- Gráfico de 90 dias/cenários e a página atual: intocados.

Testes: `src/lib/treasury/treasuryCaixaAnnualViewUi.test.ts` (range/bissexto,
equivalência com a cadeia da página por fixture, KPIs, gates estruturais de
lazy/fetch/endpoint/race). Coletados automaticamente pelo `test:treasury`.
