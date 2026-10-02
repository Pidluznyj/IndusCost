# Fluxo de Caixa — baseline de hardening (Prompt 1)

Data: 2026-10-02  
Branch: `perf/cash-flow-light-hardening`  
HEAD inicial: `ab39ab435ade27297fe25210847701cdeb194f79`  
Banco usado na medição: nenhum. `DATABASE_URL` aponta para `localhost:5432` / `induscost`. O servidor não está no ar (P1001) e não há instalação local de PostgreSQL nem Docker. Homologação remota, Tailscale, Nginx e produção não foram acessados.

Working tree preexistente, preservada e fora deste escopo: `tmp-customer-export-tsc.txt`, `tmp-origin-page.tsx`, `tmp-resolve-page.cjs`, `tmp-resolve-page.js`.

## Medição

O runner oficial é `scripts/perf-cash-flow-baseline.ts` (`npm run perf:cash-flow:baseline`). Ele já mede legacy e light no mesmo processo (warmup + runs). Nesta fase o script foi alinhado ao handler HTTP do dashboard e do anual (caixa canônico, freshness em paralelo com o spotlight, `arRealizedOnlyRows`) e ganhou uma auditoria read-only do teto de pedidos, fora do trecho cronometrado.

Execução tentada:

```text
PERF_CASH_FLOW_WARMUP=1 PERF_CASH_FLOW_RUNS=3 npx tsx scripts/perf-cash-flow-baseline.ts
```

Resultado: falha imediata em `resolveNomusArReportSyncCutoffFromPrisma` — `Can't reach database server at localhost:5432`.

Não há `totalMs`, `queryCount`, `dbMs`, payload nem fases medidas. Os números abaixo são limites de desenho, não baseline.

Espera de pool do Prisma não é coletada pela instrumentação atual (`$use` soma duração de cada operação em `dbMs`; `dbMs` pode passar de `totalMs` quando há query paralela). Não foi adicionada instrumentação de pool.

## Arquitetura real

```text
FinanceCashFlowPage
  GET /api/finance/cash-flow/dashboard          (bloqueia a primeira pintura)
  FinanceCashFlowAnnualComparisonChart          (useSectionVisible)
    GET /api/finance/cash-flow/annual-comparison
  FinanceCashFlowDailyRadar                     (useSectionVisible)
    GET /api/finance/cash-flow/daily-radar
```

Cadeia do dashboard:

```text
loadCashFlowRows
  loadFinanceArTitlesSourceBundle
    loadFinanceArManagementRowsFromPrisma
    enrichFinanceCashFlowArLoadBundle
      loadFinanceArEffectiveOrderContexts          (só se houver filtro de cliente/documento)
      loadFinanceArEffectiveOrderContextsForPortfolio
        legacy: getOrderFullAudit por pedido
        light:  loadCashFlowOrderProjections
      resolveFinanceArNfeOrderLinksFromRows
  resolveNomusApReportSyncCutoffFromPrisma        (paralelo à carga AR)
  nomusAccountsPayable.findMany                    (depois da projeção)
buildFinanceCashFlowDashboard
loadCashFlowArCanonicalCash
Promise.all(spotlight, resolveFinanceReceiptsFreshness)
```

`cf:dashboard` marca o fim desse JSON, incluindo spotlight. `cf:ready` só fecha quando dashboard, anual e radar terminam; se o usuário não rola, `cf:ready` não dispara.

## Consumers

`resolveCashFlowProjectionMode()` é chamado em todos os handlers HTTP do Fluxo. Os loaders continuam com default `"legacy"`, então Relatório Executivo, Tesouraria e scripts que não passam o modo não mudam. A flag só liga com o valor exato `"1"`. Com a flag ligada, export, audit, radar, centros de custo e os exports do radar usam a mesma fonte que o dashboard. Sem a flag, todos continuam no Full Audit.

| Consumer | Rota | Loader | projectionMode | Builder | População AR | População AP |
|---|---|---|---|---|---|---|
| Dashboard | `GET /api/finance/cash-flow/dashboard` | `loadCashFlowRows` | flag | `buildFinanceCashFlowDashboard` + caixa canônico + spotlight | Filtros da página + janela de baixa do ano; split `periodRows` / `arRealizedOnlyRows` | Filtros da página, eixo de vencimento, cutoff AP |
| Anual | `GET /api/finance/cash-flow/annual-comparison` | `loadAnnualComparisonPortfolioRows` | flag | `buildCashFlowAnnualComparison` + caixa canônico | Carteira `status: all`, sem ano/mês e sem filtros da página | Idem, sem recorte de período |
| Radar | `GET /api/finance/cash-flow/daily-radar` | `loadDailyRadarPortfolioRows` | flag | `buildFinanceCashFlowDailyRadar` | Carteira `status: open`, sem ano/mês | Carteira aberta, sem período |
| Export CSV | `GET /api/finance/cash-flow/export` | `loadCashFlowRows` | flag | mesmo builder do dashboard + YTD canônico | Igual ao dashboard | Igual ao dashboard |
| Audit JSON | `GET /api/finance/cash-flow/audit` | `loadCashFlowRows` | flag | `buildFinanceCashFlowDataset` + audit payload | Igual ao dashboard | Igual ao dashboard |
| Audit na query do dashboard | `GET .../dashboard?audit=1` | `loadCashFlowRows` | flag | dataset de auditoria | Igual ao dashboard | Igual ao dashboard |
| Centros de custo do radar | `GET .../daily-radar/cost-centers` | `loadDailyRadarPortfolioRows` | flag | radar + `buildCashFlowCostCenterSummary` | Igual ao radar | Igual ao radar |
| Títulos do centro de custo | `GET .../daily-radar/cost-centers/titles` | idem | flag | idem + filtro de títulos | Igual ao radar | Igual ao radar |
| Export dados do radar | `GET .../daily-radar/export-data` | idem | flag | export do radar | Igual ao radar | Igual ao radar |
| Export xlsx do radar | `GET .../daily-radar/export.xlsx` | idem | flag | xlsx | Igual ao radar | Igual ao radar |

Consumers de fora do Fluxo que reutilizam carga parecida e devem continuar no default legacy: Relatório Executivo, radar de caixa do executivo, Tesouraria, rotas de Contas a Receber, detalhe do pedido, comissão e a auditoria 360º. O teste `cashFlowLightProjectionFlag.test.ts` trava isso.

Scripts de auditoria (`audit-cash-flow-annual-comparison.ts` e outros) chamam o loader sem modo e portanto seguem legacy. Não são a tela.

## Populações — não unificar

### Dashboard

`toArLoadFilters` / `toApLoadFilters` aplicam ano, mês, empresa, cliente ou fornecedor, status, forma de pagamento, conta, origem de NF e escopo gerencial de AP. `resolveCashFlowArSettlementLoadWindow` amplia a carga AR para baixas dentro do ano civil filtrado, mesmo com vencimento fora desse ano. `splitCashFlowArRowsBySettlementOnlyWindow` separa:

- `periodRows`: vencimento no recorte do filtro. Entram na carteira, na projeção e na timeline de aberto.
- `arRealizedOnlyRows`: vencimento fora do ano e com `settlementDate`. Alimentam só o realizado. Não viram previsão.

Sem ano no filtro, a janela extra não existe.

### Annual

`createAnnualComparisonBaseFilters()` é `viewMode: projected`, `dateBase: due`, `status: all`, sem cliente, empresa, mês ou ano. `toCashFlowPortfolioArFilters` / `toCashFlowPortfolioApFilters` zeram ano, mês e intervalo de vencimento. O query param `year` só escolhe o ano desenhado no gráfico, não a população carregada. A seção declara independência dos filtros da página.

### Radar

`createDailyRadarDashboardFilters()` é `status: open`, sem período. A paginação (`page`, `pageSize`) recorta a grade depois da carga. A população SQL é a carteira aberta inteira. `arRealizedOnlyRows` volta vazio de propósito.

## Legacy

`getOrderFullAudit` → `loadOrderFullAudit` (dedupe in-flight por `salesOrderId|runId|includeRaw`) → `buildSalesOrderFiscalTaxesPayload`.

No Fluxo, a chamada está em `buildFinanceArEffectiveContextsForOrders` quando `projectionMode !== "light"`.

- Teto: `PORTFOLIO_ORDER_LIMIT = 80`. Não alterado.
- Concorrência: `EFFECTIVE_ORDER_AUDIT_CONCURRENCY = 8`.
- Com filtro de cliente/documento, o enrich dispara contexto de cliente (teto interno 24, `contains` em código) e contexto de portfólio (teto 80) em `Promise.all`. O dedupe só cola chamadas simultâneas do mesmo pedido.
- Erro por pedido: `catch` registra `orderProjectionFailures`, loga e omite o pedido. O request continua.
- O comentário do próprio código fala em ~28 consultas por pedido dentro da auditoria. Isso não foi recontado em runtime. O teto arquitetural 80 × ~28 é um limite superior de desenho, não um `queryCount` medido. `getOrderFullAudit` ainda acrescenta o bloco fiscal depois do loader.
- Entram no schedule (`buildEffectiveScheduleInputFromAudit`): itens, parcelas originais, CR (`externalId`, `sourceInvoiceId`, datas, valores, saldo), documentos (`idNfe`, valor alocado, `dataDocumento`, `dataMovimentacao`).
- Não entram no schedule, embora a auditoria carregue: proposta, margem, comissão, frete, alertas, evidência de fluxo, fiscal, vendedor, raw payloads.

## Light

`loadCashFlowOrderProjections` é em lote para o conjunto de pedidos, não por pedido:

1. `SalesOrder` + itens + links.
2. `OrderToCashAuditFact` de todos os runs dos pedidos; o run vigente é o de `createdAt` mais recente, filtrado em memória.
3. NFes relacionadas em lote (links, NF, documentos de estoque ligados).
4. AR por `sourceInvoiceId` da cobertura, sem os filtros da tela.
5. `loadOutputDocumentsForSalesOrdersBatch`, que por sua vez relê facts, documentos, itens, NF, AR e pedidos. Continua sendo um número fixo de queries para o conjunto, não N × auditoria.
6. Composição em memória com os mesmos mappers do audit e `projectEffectiveScheduleForOrderAudit`.
7. O caller monta o input com `buildEffectiveScheduleInputFromAudit` e chama `buildSalesOrderEffectiveFinancialSchedule`.

Não há dedupe do loader. Com filtro de cliente, as duas entradas do enrich podem chamar o loader duas vezes.

`projectOrderAuditReceivables` usa `new Date()` dentro do loader. O audit 360º faz o mesmo (`referenceDate: new Date()` na montagem dos CR). Os dois lados ignoram o `referenceDate` do caller nesse status de atraso. Não é uma divergência light-only.

`nfeByExternalId` não é passado no loader. O status monetário do CR não depende desse mapa; `linkedNfeIsCanceled` não entra em `buildEffectiveScheduleInputFromAudit`. A omissão não muda o schedule. Muda campos de alerta da auditoria que o Fluxo não consome.

Omissões deliberadas, com teste de inércia: `stockDocumentItems: []`, `nfeNumbers: []`.

## Teto de 80

Função read-only `summarizeFinanceArPortfolioOrderLimit` mais a matemática em `cashFlowPortfolioLimitMath.ts`. Conta candidatos distintos (prioridade por NF, depois código exato, ordem `orderCode`) contra o que o `take` processaria. Não soma valor de pedido: o projetado oficial só existe depois do FIN-05.

Nesta máquina o limite não foi observado em dados. `candidateOrders` medido: indisponível. `potentialExcludedProjectedAmount`: não calculado, de propósito.

## Spotlight

`loadRawMaterialCostCenterSpotlight` está no JSON do dashboard, e o painel é o primeiro bloco do `<main>`, acima dos filtros. Anos necessários: ano YTD, ano-âncora e o ano de +2 meses, em série. Por ano: carga de AP. Depois: alocações dos external ids, centros, fornecedores, mapa DRE. Falha degrada para spotlight vazio sem derrubar o dashboard, mas a latência continua no critical path. Não foi removido.

## Receipts

`loadCashFlowArCanonicalCash` faz as duas leituras:

1. `listReceiptEventsByReceivables` — histórico dos `externalId` em escopo; vira o mapa mensal.
2. `sumReceivedAmountInPeriod` — outra leitura, janela YTD, mesmos ids.

O handler espera o build do dashboard antes dessa carga. Anual repete o par. Radar não chama caixa canônico. Não foi fundido.

## Índices já existentes (sem índice novo)

| Acesso quente | Índice |
|---|---|
| `NomusAccountsReceivable.sourceInvoiceId` | `@@index([sourceInvoiceId])` |
| AR `dueDate`, `settlementDate`, presença | `dueDate`, `settlementDate`, `(sourcePresenceStatus, dueDate)` |
| AP `dueDate`, `settlementDate`, `paymentDate`, `scheduleDate` | índices homônimos + `(sourcePresenceStatus, dueDate)` |
| `NomusReceivableReceipt` por título e data | `(receivableExternalId, receiptDate)` |
| `SalesOrderNfeLink.nfeExternalId` | `@@index([nfeExternalId])` e unique `(salesOrderId, nfeExternalId)` |
| `OrderToCashAuditFact.salesOrderId` | `@@index([salesOrderId])`, `@@index([runId])`, unique `(runId, auditKey)` |

Gap para um `EXPLAIN` futuro, não aplicado: não há `(salesOrderId, createdAt)` nem `(salesOrderId, runId)` em facts, e o loader lê todos os runs. Filtros `contains` / `ILIKE` em nome e código de pedido não usam bem o btree. Sem plano, nenhum índice foi criado.

## Hipóteses

Confirmadas no código:

- O default operacional é legacy.
- Full audit está no caminho quente do Fluxo enquanto a flag não é `"1"`.
- Dashboard, anual e radar não compartilham a mesma população.
- Com a flag em `"1"`, os handlers HTTP do Fluxo usam o loader light. Sem a flag, o Full Audit continua no caminho.
- Spotlight e a segunda query de YTD estão no caminho do dashboard.
- O loader light reutiliza os builders; não é um segundo motor.

Rejeitadas ou não medidas:

- "80 × 28 é o query count de cada abertura" — é teto de desenho, não medição.
- "O frontend recalcula o caixa" — o payload já chega calculado.
- Qualquer ganho de tempo legacy × light — sem banco, não há número.
- `loadCashFlowBaseContext` — fora desta fase; as populações não podem ser unificadas.

## Riscos

Promover light sem o shadow em dados reais deixaria exportação e auditoria em outra fonte que a tela, se só os três handlers mudarem. Esta fase não promoveu a flag e não alterou fórmula financeira.
