# Inventário técnico — abas da Conciliação de Carteira

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → Conciliação de Carteira (`/finance/portfolio-reconciliation`) |
| **Data** | 2026-07-12 |
| **Escopo** | Leitura/inventário apenas — sem mudança de regra, cálculo, banco ou UI |
| **HEAD de referência** | commit deste inventário (docs only) |

---

## 1. Mapa visual do fluxo atual

```text
FinancePortfolioReconciliationPage
│  rota: /finance/portfolio-reconciliation
│  permissão: finance.view | finance.accountsReceivable.view | …
│  filtro global da página (sempre visível): cliente, ano, mês, pedido, status,
│    confiança, fonte previsão, runId, onlyIssues
│
├─[aba] Conciliação
│     load (useEffect no mount) →
│       GET /api/finance/portfolio-reconciliation/runs
│       GET /api/finance/portfolio-reconciliation?...
│     drawer →
│       GET /api/finance/portfolio-reconciliation/orders/:salesOrderId
│     service: financePortfolioReconciliationApi.server.ts
│     libs puras: portfolioReconciliationApi.ts (+ comparison / businessAnswers)
│     tabelas: PortfolioReconciliationRun + PortfolioReconciliationFact
│              (+ SalesOrder só para totalNetValue)
│
├─[aba] Inteligência da Carteira
│     PortfolioIntelligenceSection (enabled se houver run da conciliação)
│     load (useEffect quando enabled/filtros) →
│       GET /api/finance/portfolio-reconciliation/intelligence?...
│     drawer →
│       GET /api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId
│     service: financePortfolioReconciliationApi.server.ts
│              (loadPortfolioIntelligenceList / OrderDetail)
│     libs: portfolioMaturityIntelligenceApi.ts, portfolioMaturityAnalytics.ts,
│           portfolioOrderFulfillmentMap.ts, portfolioO2cBusinessKpis.ts, …
│     tabelas: PortfolioReconciliationRun + PortfolioReconciliationFact
│              (+ SalesOrder para enrichments: seller, company, dates)
│
└─[aba] Auditoria Pedido → Caixa
      OrderToCashAuditTab (NÃO carrega no mount)
      só após Cliente + Ano + Pesquisar →
        GET /api/finance/portfolio-reconciliation/order-to-cash-audit?...
      (detalhe inline usa payload da listagem; endpoint :factId existe mas UI MVP
       não chama runs/list detail dedicados ainda)
      service: financeOrderToCashAuditApi.server.ts
      libs: orderToCashAuditApi.ts + orderToCashAuditClient.ts
      tabelas: OrderToCashAuditRun + OrderToCashAuditFact
```

**Observação:** não há hooks customizados (`usePortfolioX`). Cada aba usa `useState` / `useEffect` / `useCallback` / `useMemo` / `useRef` inline nos componentes.

---

## 2. Arquivos React/TSX da tela

### Shell / página

| Arquivo | Papel |
|---------|--------|
| `src/components/finance/FinancePortfolioReconciliationPage.tsx` | Página standalone; tablist; filtros globais; orquestra as 3 abas |
| `src/App.tsx` | Rota `finance/portfolio-reconciliation` |
| `src/lib/financeNavigation.ts` / `modulePermissions` / sidebar | Menu Financeiro → item |

### Aba Conciliação

| Arquivo | Papel |
|---------|--------|
| (conteúdo inline na página) | Cards, tabela e empty/loading da aba |
| `portfolio-reconciliation/PortfolioReconciliationSummaryCards.tsx` | Cards business answers |
| `portfolio-reconciliation/PortfolioReconciliationComparisonPanel.tsx` | Comparativo |
| `portfolio-reconciliation/PortfolioReconciliationOrdersTable.tsx` | Grid de pedidos |
| `portfolio-reconciliation/PortfolioReconciliationOrderDrawer.tsx` | Detalhe do pedido |
| `portfolio-reconciliation/PortfolioReconciliationBadges.tsx` | Badges status/confiança |

### Aba Inteligência da Carteira

| Arquivo | Papel |
|---------|--------|
| `PortfolioIntelligenceSection.tsx` | Container da aba |
| `PortfolioIntelligenceFiltersBar.tsx` | Filtros da inteligência |
| `PortfolioIntelligenceCards.tsx` | Cards de maturidade |
| `PortfolioO2cBusinessBoard.tsx` | Board O2C de negócio |
| `PortfolioIntelligenceAccordions.tsx` | Sanfonas / drilldown |
| `PortfolioIntelligenceOrdersGrid.tsx` | Grid de pedidos |
| `PortfolioIntelligenceSellerKpis.tsx` | KPIs por vendedor |
| `PortfolioIntelligenceOrderDrawer.tsx` | Detalhe + mapa atendimento |
| `PortfolioOrderFulfillmentMap.tsx` + grids/status/freshness/alerts | Detalhe operacional |

### Aba Auditoria Pedido → Caixa (já existe)

| Arquivo | Papel |
|---------|--------|
| `OrderToCashAuditTab.tsx` | Container; pesquisa obrigatória |
| `OrderToCashAuditFilters.tsx` | Cliente/Ano + filtros avançados |
| `OrderToCashAuditSummaryCards.tsx` | Cards pós-pesquisa |
| `OrderToCashAuditTable.tsx` | Tabela server-side sort/page |

### Clients / permissões (frontend-safe)

| Arquivo | Papel |
|---------|--------|
| `src/lib/financePortfolioReconciliationClient.ts` | Tipos + query builders conciliação/inteligência |
| `src/lib/finance/portfolioIntelligenceFilters.ts` | Filtros UI inteligência |
| `src/lib/finance/orderToCashAuditClient.ts` | Query/sort helpers da auditoria |
| `src/lib/financePortfolioReconciliationPermissions.ts` | Guard de visão |

---

## 3. Tabela por aba

### 3.1 Conciliação

| Campo | Valor |
|-------|--------|
| **Nome** | Conciliação |
| **Frontend** | `FinancePortfolioReconciliationPage.tsx` + components `PortfolioReconciliation*` |
| **“Hook”** | Inline: `load` / `loadRuns` (`useCallback` + `useEffect` no mount) |
| **Endpoints** | `GET /api/finance/portfolio-reconciliation` · `GET …/runs` · `GET …/orders/:salesOrderId` · (opcional `…/runs/:runId/summary`) |
| **Service backend** | `financePortfolioReconciliationApi.server.ts` → `loadPortfolioReconciliationList`, `listPortfolioReconciliationRuns`, `loadPortfolioReconciliationOrderDetail` |
| **Libs puras** | `finance/portfolioReconciliationApi.ts`, comparison, businessAnswers, orderTrace |
| **Rotas** | `financePortfolioReconciliationRoutes.ts` |
| **Tabela origem** | **`PortfolioReconciliationRun`** + **`PortfolioReconciliationFact`** (+ `SalesOrder` para `totalNetValue`) |
| **Filtros enviados** | `runId`, `customerExternalId`, `year`, `month`, `orderCode`, `status`, `confidenceLevel`, `forecastSource`, `onlyIssues`, `page`, `pageSize` |
| **Cliente** | Opcional (select “Todos”) |
| **Ano / mês** | Opcionais |
| **Período / eixo de data** | **Não** (só year/month sobre fatos já no run) |
| **Vendedor** | **Não** |
| **Estágio/status** | `status` da conciliação (ex.: ORDER_ONLY, PRICE_MISMATCH…) + confiança + fonte forecast |
| **Escolha da run** | Se `runId` → essa run SUCCESS; senão **último `PortfolioReconciliationRun` SUCCESS** (`finishedAt`/`createdAt` desc) — **global**, sem filtro por cliente/ano na seleção do run |
| **Ausência de dados** | `ok: false` / `PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE`; empty “Nenhum resultado” se run ok sem rows |
| **Fonte oficial atual** | Fatos materializados da **Conciliação de Carteira** (alocação pedido×doc×CR) |
| **Problemas / gaps** | Não lê `OrderToCashAudit*`. Run mais recente é global (pode não bater com cliente/ano do filtro). Carrega no mount mesmo sem cliente. |

### 3.2 Inteligência da Carteira

| Campo | Valor |
|-------|--------|
| **Nome** | Inteligência da Carteira |
| **Frontend** | `PortfolioIntelligenceSection.tsx` + família `PortfolioIntelligence*` / `PortfolioO2c*` / fulfillment |
| **“Hook”** | Inline na Section + drawer próprio |
| **Endpoints** | `GET /api/finance/portfolio-reconciliation/intelligence` · `GET …/intelligence/orders/:salesOrderId` |
| **Service backend** | `loadPortfolioIntelligenceList` / `loadPortfolioIntelligenceOrderDetail` em `financePortfolioReconciliationApi.server.ts` |
| **Libs** | `portfolioMaturityIntelligenceApi.ts`, `portfolioMaturityAnalytics.ts`, `portfolioOrderFulfillmentMap.ts`, `portfolioO2cBusinessKpis.ts`, `portfolioIntelligenceFilters.ts`, … |
| **Tabela origem** | **`PortfolioReconciliationRun`** + **`PortfolioReconciliationFact`** (+ `SalesOrder` enrichments) |
| **Filtros enviados** | Herda `runId` / `customerExternalId` da página; + `sellerExternalId`/`sellerName`, `dateAxis`, `periodPreset`/`from`/`to`, status principal/financeiro/operacional, confiança, alertas, pedido, produto, faixa de valor, vários `only*` (sem NF, sem CR, O2C hints, etc.), `page`/`pageSize` (section usa pageSize 200) |
| **Cliente** | Opcional (herdado do filtro global ou próprio) |
| **Ano** | Via preset de período (`current_year`, etc.), não campo `year` dedicado |
| **Período + eixo** | **Sim** — presets + `dateAxis` (ORDER_ISSUE, EXPECTED_DELIVERY, NFE, STOCK, CR due/settlement, FORECAST, UPDATED_AT) |
| **Vendedor** | **Sim** (`sellerExternalId` / `sellerName`) |
| **Estágio/status** | Maturidade (`statusPrincipal`), FIN_*, OP_*, tags de alerta |
| **Escolha da run** | Mesmo `resolvePortfolioReconciliationRun` (runId explícito ou último SUCCESS global). Cliente filtra **facts**, não a escolha do run |
| **Ausência de dados** | Payload vazio se sem run; `enabled={canView && !noRun}` — se conciliação sem run, seção desabilitada/empty |
| **Fonte oficial atual** | Mesmos fatos **`PortfolioReconciliationFact`**, reclassificados em maturidade/O2C |
| **Problemas / gaps** | Também **não** usa `OrderToCashAudit*`. Depende da existência de run de conciliação. Default `dateAxis=FORECAST_DATE`. |

### 3.3 Auditoria Pedido → Caixa

| Campo | Valor |
|-------|--------|
| **Nome** | Auditoria Pedido → Caixa |
| **Frontend** | `OrderToCashAuditTab.tsx` + Filters / Table / SummaryCards |
| **“Hook”** | Inline: `applied` null até Pesquisar; `useEffect` só quando `applied` muda |
| **Endpoints** | `GET /api/finance/portfolio-reconciliation/order-to-cash-audit` (listagem). Também registrados: `…/order-to-cash-audit/runs`, `…/order-to-cash-audit/:factId` (UI MVP **não** chama runs; detalhe é painel local) |
| **Service backend** | `financeOrderToCashAuditApi.server.ts` → `loadOrderToCashAuditList`, `listOrderToCashAuditRuns`, `loadOrderToCashAuditFactById` |
| **Libs** | `orderToCashAuditApi.ts` (parse/where/sort/payload), `orderToCashAuditClient.ts` |
| **Tabela origem** | **`OrderToCashAuditRun`** + **`OrderToCashAuditFact`** |
| **Filtros enviados** | **Obrigatórios:** `customerId` **ou** `customerExternalId` + `year`. Opcionais: `orderCode`, `sellerName`, produto/SKU, NF, doc saída, `orderToCashStage`, operacional/financeiro, `paymentStatus`, temperatura, confiança, flags `hasAlerts` / excesso / fora pedido / sem doc / sem CR / vencidos, `runId`, `page`, `pageSize`, `sortBy`, `sortDirection` |
| **Cliente** | **Obrigatório** (autocomplete → `customerId`) |
| **Ano** | **Obrigatório** (select; default visual = ano corrente, sem auto-fetch) |
| **Período / eixo** | **Não** na API de listagem (só year + filtros de fato); rebuild materializa com periodFrom/To/dateAxis |
| **Vendedor** | Sim (`sellerName` contains) |
| **Estágio/status** | `orderToCashStage`, operacional, financeiro, pagamento, temperatura, confiança |
| **Escolha da run** | Se `runId` → essa SUCCESS; senão fato mais recente (`createdAt` desc) com `run.status=SUCCESS` **e** cliente **e** (`run.year=year` **OU** `orderIssueDate` no ano) |
| **Ausência de dados** | Antes de pesquisar: mensagem “Selecione Cliente e Ano…”. Após: empty se 0 rows / mensagem se nenhum run SUCCESS para cliente/ano; error banner em 5xx |
| **Fonte oficial atual** | **`OrderToCashAuditFact`** materializado (builder/rebuild) |
| **Problemas / gaps** | UI não lista runs O2C nem permite escolher run geral `41c2470a-…` vs Britânia `a0bdc0b6-…` (escolhe via fato mais recente matching). Filtro global da página **não** alimenta esta aba. Não há eixo de data na listagem. |

---

## 4. Endpoints × services × tabelas (resumo)

| Endpoint | Service | Prisma principal |
|----------|---------|------------------|
| `GET /api/finance/portfolio-reconciliation` | `loadPortfolioReconciliationList` | `PortfolioReconciliationRun`, `PortfolioReconciliationFact`, `SalesOrder` |
| `GET /api/finance/portfolio-reconciliation/runs` | `listPortfolioReconciliationRuns` | `PortfolioReconciliationRun` |
| `GET /api/finance/portfolio-reconciliation/orders/:id` | `loadPortfolioReconciliationOrderDetail` | Run + Fact |
| `GET /api/finance/portfolio-reconciliation/runs/:runId/summary` | `loadPortfolioReconciliationRunSummary` | Run + Fact + SalesOrder |
| `GET /api/finance/portfolio-reconciliation/intelligence` | `loadPortfolioIntelligenceList` | Run + Fact + SalesOrder |
| `GET /api/finance/portfolio-reconciliation/intelligence/orders/:id` | `loadPortfolioIntelligenceOrderDetail` | Run + Fact + SalesOrder |
| `GET /api/finance/portfolio-reconciliation/order-to-cash-audit` | `loadOrderToCashAuditList` | **`OrderToCashAuditRun`**, **`OrderToCashAuditFact`** |
| `GET …/order-to-cash-audit/runs` | `listOrderToCashAuditRuns` | `OrderToCashAuditRun` |
| `GET …/order-to-cash-audit/:factId` | `loadOrderToCashAuditFactById` | Fact + Run |

Nenhuma dessas rotas de tela usa Proposta ou Comissão como fonte.

---

## 5. Runs OrderToCashAudit conhecidas (contexto operacional)

Informadas pelo usuário (fora do código):

| Run | Escopo | Totais |
|-----|--------|--------|
| `41c2470a-b685-4765-a954-77110fd8cf5c` | Geral · SUCCESS · APPLY · period 2025-06-01→2026-12-31 · customerFilter null | 1283 pedidos · 5860 facts · orderValue ~17,8 Mi |
| `a0bdc0b6-b3d5-42ca-a548-283edbc31cfa` | Britânia · customerFilter 200 · year 2026 | 14 pedidos · 53 facts |

**Implicação:** a aba Auditoria, ao pesquisar cliente 200 + ano 2026, tende a resolver o fato mais recente matching → tipicamente a run Britânia se for a última criada; a run geral só entra se tiver facts daquele cliente/ano e for a mais recente no critério atual. As abas Conciliação/Inteligência **ignoram** essas runs O2C.

---

## 6. Conclusão

### Qual base cada aba usa hoje

| Aba | Base materializada |
|-----|--------------------|
| **Conciliação** | `PortfolioReconciliationRun` / `PortfolioReconciliationFact` |
| **Inteligência da Carteira** | `PortfolioReconciliationRun` / `PortfolioReconciliationFact` (mesma família) |
| **Auditoria Pedido → Caixa** | `OrderToCashAuditRun` / `OrderToCashAuditFact` |

### O que precisa ser populado ou adaptado para as 3 refletirem a base nova

1. **População:** manter rebuild `OrderToCashAudit` atualizado (runs gerais e/ou por cliente-ano). As abas 1 e 2 **não** leem essa base ainda — só a aba 3.
2. **Para Conciliação e Inteligência refletirem a base nova:** seria necessário **adaptar** services/endpoints (ou criar adapters) para consumir `OrderToCashAuditFact` (ou sincronizar/rebuild paralelo em `PortfolioReconciliationFact`). Hoje são pipelines distintos.
3. **Aba Auditoria:** já aponta para a base nova; gaps de produto: seletor de run (geral vs Britânia), alinhar filtro global da página, opcionalmente eixo/período na listagem, e wire do endpoint `:factId` / `runs` se desejado.
4. **Não confundir** com o Funil do Dashboard (`/api/sales/order-to-cash-funnel`), que também ainda usa **`PortfolioReconciliationFact`**, não `OrderToCashAuditFact`.

### Regras observadas neste inventário

- Sem alteração de cálculo, UI, API ou banco neste documento.
- Sem proposta/comissão como fonte oficial nas abas inventariadas.
- Conciliação e Inteligência evitam “somar pedido+NF+CR” via regras de businessAnswers/maturidade; Auditoria trabalha no grão item/alocação materializado.

---

## 7. Referência rápida de resolução de run

```text
Conciliação / Inteligência:
  runId? → PortfolioReconciliationRun SUCCESS
  senão → último PortfolioReconciliationRun SUCCESS (global)

Auditoria Pedido → Caixa:
  runId? → OrderToCashAuditRun SUCCESS
  senão → OrderToCashAuditFact mais recente (createdAt desc)
           com cliente + (run.year = year OR orderIssueDate no ano)
           e run.status = SUCCESS
```
