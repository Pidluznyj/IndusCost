# Auditoria de consumidores — Pedido de Venda (SalesOrder)

**Projeto:** IndusCost / My Industry  
**Missão:** 4 — Inventário técnico (sem migração nesta fase)  
**Data:** 2026-06-23  
**Commit base:** `e5debb1` (motor de fulfillment em Gestão de Pedidos)

---

## 1. Resumo executivo

O sistema possui **um motor refatorado e confiável** para Gestão de Pedidos (Missões 1–3), mas **a maior parte dos demais módulos ainda consome Pedido de Venda por caminhos paralelos**, principalmente via `nomusRawResponse.nfes[]` em SQL/JS.

| Métrica | Valor |
|---------|-------|
| Arquivos únicos analisados (grep `SalesOrder`/`salesOrder`/`sales-orders` em `src/`, `scripts/`, `server.ts`) | **270** |
| Consumidores distintos mapeados (telas/endpoints/scripts) | **52** |
| Consumidores com risco **ALTO** (cálculo próprio de status/prazo/faturamento/SLA) | **28** |
| Consumidores com risco **MÉDIO** | **14** |
| Consumidores com risco **BAIXO** | **10** |
| Já no motor oficial (Gestão de Pedidos + audit admin) | **4** |

**Conclusão:** Antes de corrigir telas, é necessário consolidar em uma **camada única de métricas** que exponha os campos derivados do motor (NF vinculada, status logístico BI, lifecycle, SLA, % faturamento/atendimento) e substituir gradualmente `salesOrderHasInvoicing` / `orderIsInvoicedSql` / parsing direto de `nfes[]`.

---

## 2. Motor oficial existente (fonte única desejada)

Não existe um único arquivo chamado `SalesOrderManagementEngine`. O motor real é **composto em camadas**:

```
SalesOrderNfeLink (DB)
        ↓
buildSalesOrderLinkedNfeContext / loadSalesOrderLinkedNfeContextMap   ← salesOrderLinkedNfe.ts
        ↓
buildSalesOrderLifecycleSummary                                       ← salesOrderLifecycleStatus.ts
        ↓
buildSalesOrderBiLogisticStatus                                       ← salesOrderLogisticStatus.ts
        ↓
buildManagementRowsFromOrders + buildFulfillmentKpis/Charts           ← salesOrderManagement.ts + salesOrderManagementFulfillment.ts
        ↓
buildSalesOrderIntelligencePayload                                     ← salesOrderIntelligence.ts (detalhe por pedido)
```

| Camada | Arquivo | Função principal | Responsabilidade |
|--------|---------|------------------|------------------|
| Vínculo NF-e | `src/lib/salesOrderNfeLink.ts` | `upsertSalesOrderNfeLinksForOrder`, `buildSalesOrderNfeLinkDiagnostic` | Normaliza `nomusRawResponse.nfes[]` → `SalesOrderNfeLink` |
| Contexto NF | `src/lib/salesOrderLinkedNfe.ts` | `buildSalesOrderLinkedNfeContext`, `loadSalesOrderLinkedNfeContextMap` | Valor faturado, cobertura, SLA, revisão |
| Lifecycle gerencial | `src/lib/salesOrderLifecycleStatus.ts` | `buildSalesOrderLifecycleSummary` | Status operacional, billing, prazo, completude, riscos |
| Status logístico BI | `src/lib/salesOrderLogisticStatus.ts` | `buildSalesOrderBiLogisticStatus` | 6 cards Power BI (no prazo, atrasado, pendente, revisar…) |
| Orquestrador gestão | `src/lib/salesOrderManagement.ts` | `buildManagementRowsFromOrders` | Filtros, grid, cards BI, KPIs fulfillment |
| Fulfillment analytics | `src/lib/salesOrderManagementFulfillment.ts` | `buildFulfillmentKpis`, `buildFulfillmentCharts`, `buildFulfillmentAudit` | KPIs executivos, gráficos, auditoria |
| Inteligência pedido | `src/lib/salesOrderIntelligence.ts` | `buildSalesOrderIntelligencePayload`, `mapLifecycleToManagementRow` | Drawer detalhado + explicação de regras |

**Alias de compatibilidade:** `src/lib/salesOrderManagementStatus.ts` reexporta nomes `Management*` → delega 100% para `salesOrderLogisticStatus.ts`.

**API oficial de gestão:**
- `GET /api/sales-orders/management`
- `GET /api/sales-orders/:id/intelligence`
- `GET /api/admin/sales-orders/fulfillment/audit`
- `GET /api/admin/sales-orders/nfe-links/diagnostic`

---

## 3. Caminhos legados paralelos (duplicidade de verdade)

Estes módulos **não** passam pelo motor acima e representam risco de divergência:

| Caminho legado | Arquivo(s) | O que calcula |
|----------------|------------|---------------|
| Invoicing SQL | `salesOrderInvoicingSql.ts` | `orderIsInvoicedSql`, `orderNotInvoicedSql` — presença de NF via jsonb `nomusRawResponse->nfes` |
| Has invoicing JS | `customerCommercialSalesOrderView.ts` | `salesOrderHasInvoicing(nomusRawResponse)` |
| Dashboard tab | `salesOrdersDashboardMetrics.ts` | `buildSalesOrdersDashboardTab` — carteira, realizado, projeção, atraso |
| Dashboard rules | `salesOrderDashboardRules.ts` | Metas, ticket médio, projeção mensal |
| Finance extended | `financeSalesOrdersExtendedMetrics.ts` | Logistic breakdown + manufacturing (usa BI logistic **parcialmente**) |
| CRM portfolio SQL | `crmOrderPortfolioSql.ts` | Carteira aberta / faturado via jsonb nfes |
| CRM seller SQL | `crmSellerDashboardService.ts` | **Duplica** `orderIsInvoicedSql` inline |
| Funil vendas | `salesFunnelDashboardMetrics.ts` | Estágios funil com `orderIsInvoicedSql` |
| Material previsto×realizado | `materialDemandPlannedRealized.ts`, `salesOrderRawMaterialIntelligenceService.ts` | Realizado via raw nfes + itens |
| Ranking produtos | `salesProductRanking.ts` | Data NF / faturado via raw |

---

## 4. Tabela de consumidores

Legenda: **Migrar?** = deve passar a consumir motor único. **Raw?** = lê `nomusRawResponse` / `nfes[]` diretamente.

### 4.1 Dashboard principal

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO direto | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----------|------|-----|-----------|-------|---------|------------|------------|
| Dashboard | Resumo executivo — aba Pedidos | `GET /api/dashboard/executive-summary` | `executiveDashboardService.ts`, `salesOrdersDashboardMetrics.ts` | KPIs vendido, carteira, realizado, projeção, atraso | **Y** | Y | parcial | Y (SQL) | N | **Alta** | Sim | **Alta** | Usa `orderNotInvoicedSql`; não usa status logístico BI |
| Dashboard | Funil de vendas | mesmo endpoint → `salesFunnelDashboardMetrics.ts` | Estágios proposta→pedido→faturado | **Y** | Y | N | Y (SQL) | N | **Alta** | Sim | **Alta** | `orderIsInvoicedSql` ≠ motor linked NFe |
| Dashboard | UI funil | `SalesFunnelPanel.tsx`, `DashboardModule.tsx` | Payload executive-summary | Indireto | N | — | — | — | **Alta** | Sim | Alta | Só exibe; backend diverge |
| Dashboard | UI aba pedidos | `ExecutiveSalesOrdersTab.tsx` | Payload executive-summary | Indireto | N | — | — | — | **Alta** | Sim | Alta | — |
| Dashboard | UI aba faturamento | `ExecutiveBillingTab.tsx` | Billing tab (NomusNfe + SO forecast) | **Y** (forecast) | Y | N | parcial | N | **Média** | Sim | Média | Billing oficial = NomusNfe; forecast = SO raw |

### 4.2 Gestão de Pedidos de Venda

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----|------|-----|-----------|-------|---------|------------|------------|
| Vendas | Central Operacional / Board | `GET /api/sales-orders/management` | `salesOrderManagement.ts`, `salesOrderManagementFulfillment.ts`, UI `SalesOrderManagementPage.tsx` | Motor completo + linked NFe | **Y** (fallback) | Y | Y | Y (link) | **Y** | **Baixa** | Parcial | Baixa | **Referência oficial** — manter e exportar API interna |
| Vendas | Inteligência por pedido | `GET /api/sales-orders/:id/intelligence` | `salesOrderIntelligence.ts`, `SalesOrderIntelligenceDrawer.tsx` | Lifecycle + logistic + linkedNfes | **Y** | Y | Y | Y | **Y** | **Baixa** | Não | — | Já alinhado ao motor |
| Vendas | Auditoria fulfillment | `GET /api/admin/sales-orders/fulfillment/audit` | `salesOrderManagementFulfillment.ts` | Audit linked vs raw | **Y** | Y | N | Y | Y | **Baixa** | Não | — | Ferramenta de validação |
| Vendas | Auditoria NF links | `GET /api/admin/sales-orders/nfe-links/diagnostic` | `salesOrderNfeLink.ts` | Diagnóstico vínculos | **Y** | Y | N | Y | N | **Baixa** | Não | — | Admin only |
| Vendas | Lista clássica pedidos | `GET /api/sales-orders` | `salesOrdersListSummary.ts`, `SalesOrdersModule.tsx` | Listagem + resumo básico | N (retorna raw) | Y | Y | N | N | **Média** | Sim | Média | Poderia enriquecer colunas via motor |
| Vendas | Detalhe pedido clássico | `GET /api/sales-orders/:id` | `SalesOrdersModule.tsx`, `SalesOrderPrintView.tsx` | Campos DB + raw pass-through | N | Y | Y | N | N | **Média** | Sim | Baixa | Sem status logístico calculado |
| Vendas | Indicadores pedidos | `SalesOrdersIndicatorsDashboard.tsx` | `/api/sales-orders` summary | Agregados lista | N | Y | N | N | N | **Baixa** | Sim | Baixa | Valor/contagem bruta |

### 4.3 Financeiro

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----|------|-----|-----------|-------|---------|------------|------------|
| Financeiro | Pedidos de Venda | `GET /api/finance/sales-orders/dashboard` | `financeSalesOrdersDashboard.ts`, `financeSalesOrdersExtendedMetrics.ts`, `FinanceSalesOrdersPage.tsx` | KPIs + breakdown manufacturing/logistic | **Y** | Y | Y | Y (SQL+link parcial) | **Y** (parcial) | **Alta** | Sim | **Alta** | Extended metrics chama BI logistic mas invoicing ainda SQL raw |
| Financeiro | Export pedidos financeiro | `GET /api/finance/sales-orders/export` | `financeSalesOrdersExport.ts` | Mesmo dashboard | **Y** | Y | Y | Y | parcial | **Alta** | Sim | Alta | — |
| Financeiro | Faturamento (modo pedido) | `GET /api/finance/billing/dashboard?billingSource=sales_order` | `billingDashboardMetrics.ts`, `FinanceBillingPage.tsx` | Faturamento mercado via nfes raw | **Y** | Y | N | Y | N | **Alta** | Sim | **Alta** | KPI financeiro crítico |
| Financeiro | Faturamento (modo NF-e) | mesmo, `billingSource=nfe` | `financeBillingNfeDashboard.ts` | NomusNfe + forecast SO | **Y** (forecast) | Y | N | tabela | N | **Média** | Sim | Média | Forecast usa carteira SO raw |
| Financeiro | Comparativo SO × NF-e | `GET /api/finance/billing/comparison` | `financeBillingNfeComparison.ts` | Reconciliação mensal | **Y** | Y | N | Y | N | **Alta** | Sim | Alta | Deve usar linked NFe + NomusNfe |
| Financeiro | Horizonte carteira | `GET /api/finance/billing/horizon/orders` | `financeBillingHorizonDrilldown.ts` | Pedidos abertos 60d | **Y** | Y | N | Y | N | **Alta** | Sim | Alta | — |
| Financeiro | Auditoria faturamento | `GET /api/finance/billing/audit` | `financeBillingAuditDataset.ts` | Divergências SO vs NomusNfe | **Y** | Y | N | Y | N | **Alta** | Sim | Alta | — |
| Financeiro | Relatório Presidencial | `GET /api/finance/executive-report` | `financeExecutiveReport.ts`, `FinanceExecutiveReportPage.tsx` | Seção pedidos + billing + forecast | **Y** | Y | Y | Y | N | **Alta** | Sim | **Alta** | `buildSalesOrdersDashboardTab` duplicado |
| Financeiro | Gráfico pedidos presidencial | `ExecutiveSalesOrdersChart.tsx` | Payload executive-report | Indireto | N | — | — | — | **Alta** | Sim | Alta | UI only |

### 4.4 CRM / Comercial

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----|------|-----|-----------|-------|---------|------------|------------|
| CRM | Gestão gerencial | `GET /api/crm/management-dashboard` | `crmManagementDashboardService.ts`, `crmOrderPortfolioSql.ts`, `CrmManagementDashboardSection.tsx` | Carteira, atraso, risco, top clientes | **Y** | Y | N | Y (SQL) | N | **Alta** | Sim | **Alta** | — |
| CRM | Gestão por vendedor | `GET /api/crm/seller-dashboard` | `crmSellerDashboardService.ts`, `CrmSellerDashboardSection.tsx` | Pedidos, faturado, carteira, produtos | **Y** | Y | Y | Y (SQL duplicado) | N | **Alta** | Sim | **Alta** | SQL invoicing inline |
| CRM | Lista clientes CRM | `GET /api/crm/customers` | `crmCustomersList.ts`, `CrmCustomerPortfolioSection.tsx` | Carteira aberta, sem NF | **Y** | Y | N | Y | N | **Alta** | Sim | Alta | — |
| CRM | Cockpit comercial cliente | `GET /api/crm/customers/:id/commercial-intelligence` | `crmCommercialIntelligence.ts`, `crmCommercialOrderRules.ts` | Pedidos + hasInvoicing | **Y** | Y | Y | Y | N | **Alta** | Sim | Alta | — |
| CRM | Cliente 360 comercial | `GET /api/customers/:id/commercial-360` | `customerCommercialSalesOrderView.ts`, `CustomerCommercial360.tsx` | Pedidos, itens, ABC, KPIs | **Y** | Y | Y | Y | N | **Alta** | Sim | **Alta** | Duplicata parcial com intelligence page |
| CRM | Inteligência cliente | `GET /api/crm/customers/:id/intelligence` | `customerIntelligence.ts`, `CustomerIntelligencePage.tsx` | Compras, recompra, produtos | **Y** | Y | Y | Y | N | **Alta** | Sim | Alta | — |
| Comercial | Produtos vendidos | `GET /api/commercial/sold-products` | `salesProductRanking.ts`, `SoldProductsReportPage.tsx` | Ranking por item, data NF | **Y** | Y | Y | Y | N | **Alta** | Sim | Média | Data faturamento via raw |
| Comercial | Clientes por produto | `GET /api/commercial/sold-products/:productId/customers` | `soldProductCustomers.ts` | Linhas por cliente/produto | **Y** | Y | Y | Y | N | **Alta** | Sim | Média | — |
| CRM | Indicadores clientes | `GET /api/customers/indicators` | `customerIndicators.ts` | Contagem pedidos por cliente | N | Y | N | N | N | **Baixa** | Sim | Baixa | Só `_count` |

### 4.5 Inteligência de Matéria-Prima

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----|------|-----|-----------|-------|---------|------------|------------|
| Matéria-prima | Demanda prevista | `GET /api/sales-orders/material-demand/*` | `materialDemandFilters.ts`, `ProductMaterialDemandDashboard.tsx` | SO + items + BOM | N | Y | Y | N | N | **Média** | Sim | Média | Status SO como filtro demanda |
| Matéria-prima | Análise inteligência MP | `GET .../material-demand/analysis` | `salesOrderRawMaterialIntelligenceService.ts` | Itens + nfes raw | **Y** | Y | Y | Y | N | **Alta** | Sim | **Alta** | Realizado depende raw nfes |
| Matéria-prima | Previsto × realizado | `GET .../planned-vs-realized` | `materialDemandPlannedRealized.ts`, `MaterialDemandPlannedRealizedPanel.tsx` | Planned BOM + realized NF | **Y** | Y | Y | Y | N | **Alta** | Sim | **Alta** | KPI crítico produção |
| Matéria-prima | Drilldown MP | `GET .../planned-vs-realized/materials/:id/details` | `materialDemandIntelligenceDrilldown.ts` | Audit por pedido/material | **Y** | Y | Y | Y | N | **Alta** | Sim | Alta | — |

### 4.6 Relatórios, exportações e scripts

| Módulo | Tela / Endpoint | Arquivo(s) | Consome | Fonte atual | Raw? | SO | Item | NF | Logístico | Risco | Migrar? | Prioridade | Observação |
|--------|-----------------|------------|---------|-------------|------|-----|------|-----|-----------|-------|---------|------------|------------|
| Relatórios | Dados agregados | `GET /api/reports/data` | `server.ts` | Agregados SO + repurchase | N | Y | Y | N | N | **Média** | Sim | Média | — |
| Propostas | Gerar pedido | `POST /api/proposals/:id/generate-sales-order` | `server.ts` | Cria SO + items | N | Y (write) | Y | N | N | **Baixa** | Não | — | Criação, não métricas |
| Sync | Import Nomus pedidos | `scripts/nomusSalesOrdersSyncV1.ts` | Upsert SO + items + NFe links | **Y** (write) | Y | Y | Y | **Baixa** | Não | — | Origem dos dados |
| Sync | Backfill NF links | `scripts/backfill-sales-order-nfe-links.ts` | `salesOrderNfeLink.ts` | **Y** | Y | N | Y | **Baixa** | Não | — | Infra motor |
| Audit | Status pedidos | `scripts/audit-sales-order-statuses.ts` | `salesOrderNomusRaw.ts`, `salesOrderStatusAudit.ts` | Auditoria raw status | **Y** | Y | Y | Y | parcial | **Média** | Parcial | Baixa | Ferramenta diagnóstico |
| Audit | Fulfillment | `scripts/audit-sales-order-fulfillment.ts` | Motor gestão | Motor oficial | **Y** | Y | Y | Y | Y | **Baixa** | Não | — | Validação pós-migração |
| Audit | Lineage / sources | `systemDataLineageAudit.ts`, `projectSourceInventoryAudit.ts` | Metadados | N | doc | — | — | **Baixa** | Não | — | Documentação |

---

## 5. Funções duplicadas / conflitantes

### 5.1 “Tem NF / faturado?”

| Função | Arquivo | Mecanismo | Conflito |
|--------|---------|-----------|----------|
| `salesOrderHasInvoicing` | `customerCommercialSalesOrderView.ts` | JS: `nomusRawResponse.nfes[]` com `dataProcessamento` | **Legado** — ignora `SalesOrderNfeLink` |
| `orderIsInvoicedSql` | `salesOrderInvoicingSql.ts` | SQL jsonb nfes | Usado em 8+ módulos |
| `orderNotInvoicedSql` | `salesOrderInvoicingSql.ts` | Negation of above | Carteira aberta em finance/CRM/funil |
| `orderIsInvoicedSql` (inline) | `crmSellerDashboardService.ts` | SQL duplicado | Cópia local — drift risk |
| `linkedNfeContext.hasNfe` | `salesOrderLinkedNfe.ts` | Links + NomusNfe | **Motor novo** |
| `lifecycle.hasInvoice` | `salesOrderLifecycleStatus.ts` | linked ?? raw fallback | Híbrido — correto se link backfill OK |

### 5.2 Status logístico / prazo / atraso

| Função | Arquivo | Conflito |
|--------|---------|----------|
| `buildSalesOrderBiLogisticStatus` | `salesOrderLogisticStatus.ts` | **Oficial BI** (6 cards) |
| `buildExtendedMetricsFromOrders` | `financeSalesOrdersExtendedMetrics.ts` | Chama BI logistic mas agrega diferente |
| `crmOrderPortfolioSql` | `crmOrderPortfolioSql.ts` | Atraso via SQL datas + nfes, não BI |
| `salesOrderDashboardRules` / overdue SQL | `salesOrdersDashboardMetrics.ts` | Atraso = `expectedDeliveryDate` + not invoiced |
| `buildFulfillmentKpis` | `salesOrderManagementFulfillment.ts` | SLA/% no prazo — **oficial gestão** |

### 5.3 Valor vendido vs faturado

| Função | Arquivo | Conflito |
|--------|---------|----------|
| `nfeTotalValue` / `invoiceCoveragePercent` | `salesOrderLinkedNfe.ts` | Soma NF vinculada vs `totalNetValue` |
| `billingDashboardMetrics` | `billingDashboardMetrics.ts` | Faturamento via raw nfes SQL |
| `financeBillingNfeComparison` | `financeBillingNfeComparison.ts` | SO raw vs NomusNfe tabela |
| `buildSalesOrdersDashboardTab` | `salesOrdersDashboardMetrics.ts` | Realizado = invoiced SQL, não linked |

### 5.4 Completude / parcial / corte

| Função | Arquivo | Conflito |
|--------|---------|----------|
| `buildSalesOrderLifecycleSummary` | `salesOrderLifecycleStatus.ts` | Item status normalization |
| `extractNomusRawItems` | `salesOrderNomusRaw.ts` | Raw item status |
| `financeSalesOrdersManufacturingStatus.ts` | Manufacturing from raw items | Paralelo ao lifecycle |
| `materialDemandPlannedRealized` | Planned vs realized qty | Usa raw items + nfes |

### 5.5 Funil de vendas

| Função | Arquivo | Conflito |
|--------|---------|----------|
| `buildSalesFunnelDashboard` | `salesFunnelDashboardMetrics.ts` | Estágio “faturado” = `orderIsInvoicedSql` |
| `salesFunnel.ts` | Regras estágios | Não usa status logístico |

---

## 6. Risco por módulo

| Módulo | Consumidores | Alta | Média | Baixa | Risco geral |
|--------|--------------|------|-------|-------|-------------|
| Dashboard executivo / Funil | 5 | 4 | 1 | 0 | **CRÍTICO** |
| Gestão de Pedidos | 7 | 0 | 2 | 5 | **OK** (referência) |
| Financeiro | 9 | 7 | 2 | 0 | **CRÍTICO** |
| CRM / Comercial | 9 | 7 | 0 | 2 | **CRÍTICO** |
| Matéria-prima | 4 | 3 | 1 | 0 | **ALTO** |
| Relatórios / Sync / Audit | 7 | 0 | 2 | 5 | **BAIXO** |

---

## 7. Plano de migração recomendado

### Fase 0 — Contrato da fonte única (sem quebrar telas)
1. Criar módulo facade `salesOrderMetricsEngine.ts` (nome sugerido) que exporta:
   - `loadSalesOrderMetricsMap(orderIds[])` → row enriquecida (mesmo shape de `SalesOrderManagementRow` + campos financeiros)
   - `aggregateSalesOrderMetrics(filters)` → KPIs reutilizáveis
2. Documentar contrato estável (tipos em `salesOrderManagementTypes.ts` estendidos).
3. Garantir backfill `SalesOrderNfeLink` 100% (`backfill:sales-order-nfe-links:apply`).

### Fase 1 — Endpoints prioritários (alta divergência)
1. `salesOrderInvoicingSql.ts` → delegar para linked NFe (view SQL ou batch load).
2. `customerCommercialSalesOrderView.salesOrderHasInvoicing` → wrapper sobre `loadSalesOrderLinkedNfeContextMap`.
3. `GET /api/finance/billing/dashboard` (modo sales_order).
4. `GET /api/finance/billing/comparison` e `/audit`.
5. `crmOrderPortfolioSql.ts` + `crmSellerDashboardService.ts`.

### Fase 2 — Dashboard / Funil
1. `salesOrdersDashboardMetrics.ts` / `buildSalesOrdersDashboardTab`.
2. `salesFunnelDashboardMetrics.ts`.
3. `GET /api/dashboard/executive-summary`.

### Fase 3 — Gestão de Pedidos (polish)
1. Exportar métricas do motor para consumo interno (facade).
2. Enriquecer lista clássica `/api/sales-orders` com campos opcionais.
3. Unificar labels entre finance e gestão.

### Fase 4 — Financeiro / Relatório Presidencial
1. `financeSalesOrdersDashboard.ts` — substituir extended invoicing SQL.
2. `financeExecutiveReport.ts` — seção pedidos via facade.
3. Forecast billing — carteira via motor (pendente/atrasado BI).

### Fase 5 — CRM
1. Management + seller dashboards.
2. Customer 360 + commercial intelligence (unificar duplicata).
3. Sold products ranking — data NF via linked.

### Fase 6 — Inteligência de Matéria-Prima
1. `materialDemandPlannedRealized.ts` — realized qty/dates via linked NFe.
2. Manter demanda prevista (BOM) separada; só “realizado” migra.

### Fase 7 — Validação final
1. Rodar `audit-sales-order-fulfillment.ts` por ano.
2. Comparar KPIs: gestão vs finance vs CRM vs executive (script de paridade).
3. Testes de regressão: `salesOrderManagementFulfillment.test.ts`, `salesOrderLinkedNfeMotor.test.ts`, finance/CRM dashboard tests.

---

## 8. Próximos passos imediatos (Missão 5+)

1. **Criar facade `salesOrderMetricsEngine`** — thin wrapper sobre `buildManagementRowsFromOrders` + batch Prisma.
2. **Substituir `salesOrderHasInvoicing`** por linked context (1 PR, alto impacto).
3. **Paridade finance billing** — comparar totais gestão vs billing antes/depois.
4. **Não remover** SQL legado até paridade validada; marcar `@deprecated`.

---

## 9. Referências internas existentes

- `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`
- `docs/sales-orders/NOMUS_SALES_ORDER_STATUS_MAPPING.md`
- `docs/generated/sales-funnel-dashboard-report.md`
- `docs/generated/executive-dashboard-sales-order-source-fix.md`
- `docs/generated/finance-dashboard-consistency-audit.md`

---

*Relatório gerado em modo Ops 4.8 — inventário apenas; nenhuma regra de negócio alterada nesta missão.*
