# Mapa oficial de motores — Auditoria 360º do Pedido

Este documento define, aba a aba, **qual motor oficial cada bloco da
Auditoria 360º deve consumir**, o estado atual do consumo (Reutilizando |
Adapter necessário | Lógica duplicada — extrair) e as ações de correção.

> **Princípio central**: a Auditoria 360º é uma **central de leitura e
> cruzamento**. Ela **não é dona de regra financeira, fiscal, comissão ou
> pedido**. Ela **consome e compõe** dados dos módulos oficiais.

### Status de NF-e

- Motor de classificação: `src/lib/finance/nfeStatus.ts` (status estrutural
  `NomusNfe.status`; cancelada = 7).
- Documentação: `docs/finance/nfe-status-rules.md`.
- NF cancelada é **auditável** (aparece na aba NF-e / divergências / técnica)
  e **não** entra no faturamento válido (`nfeValidValue`, `nfeAllocatedValue`).

## Localização das peças

- **Orquestrador**: `src/lib/finance/orderFullAuditService.ts` →
  `loadOrderFullAudit` (interno) e `getOrderFullAudit` (público, usado pela
  rota `GET /api/finance/portfolio-reconciliation/orders/:id/audit-full`).
- **Façade oficial de recebíveis**:
  `src/lib/finance/orderReceivablesResolver.ts` →
  `resolveReceivablesForSalesOrder({ salesOrderId, orderCode, includePlanned, includeReal })`.
- **Contrato público**: `src/lib/finance/orderFullAuditClient.ts`.
- **Modal UI**: `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx`.

## Comportamento oficial ao clicar num pedido em Status Pedidos

1. Usuário clica na linha do PD em **Financeiro → Conciliação de Carteira →
   Status Pedidos**.
2. A `OrderStatusTable` chama `onRowOpenAudit({ salesOrderId, orderCode })`.
3. `OrderFullAuditDialog` abre e busca
   `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`.
4. O orquestrador `loadOrderFullAudit` consome os **motores oficiais**
   (tabela abaixo) e devolve um único payload com 12 blocos.
5. Cada aba renderiza o bloco correspondente.

**Regra**: cada aba equivale a "abrir o módulo oficial e filtrar pelo
pedido". Especificamente a aba **Financeiro** equivale a "Contas a Receber
oficial filtrado pelo pedido" (CR real + planejado pelo pedido, com dedup).

## Tabela — 12 abas × motor oficial × estado

| # | Aba | Dado (bloco no payload) | Motor oficial (arquivo · export) | Uso atual em `orderFullAuditService.ts` | Status | Correção necessária / futura |
|---|---|---|---|---|---|---|
| 1 | **Resumo Executivo** | `summary` + `timeline` | `orderToCashAuditApi.ts::buildOrderToCashAuditListSummary`; `nomusSalesOrderItemStatus.ts::isInactiveSalesOrderItemNomusFlags` / `isFulfilledWithCutSalesOrderItem`; `crmCustomerCommercialOwner.ts::loadManualCommercialOwnersForCustomers` | `buildSummary()` (interno) + `enrichFactsWithOrderItemStatus` + CRM oficial (`loadManualCommercialOwnersForCustomers`) | **Lógica duplicada — extrair** | Extrair `buildOrderFullAuditSummary` reutilizando `buildOrderToCashAuditListSummary` (1 pedido). Não urgente porque o resultado hoje é consistente com o motor O2C. |
| 2 | **Proposta / Origem Comercial** | `proposal`, `proposalVsOrderComparisons` | `Proposal` / `ProposalItem` (Prisma) — sem loader dedicado | `loadProposalBlock()` (interno, `prisma.proposal.findUnique`) + `buildProposalOrderComparison()` | **Adapter necessário** | Criar `loadProposalAuditBlock(proposalId)` compartilhável; audit adapta para DTO. |
| 3 | **Pedido de Venda** | `salesOrder` | `SalesOrder` (Prisma) + `salesOrderNomusSellerDisplay.ts::buildSalesOrderNomusSellerDto` + `nomusSalesOrderItemStatus.ts` | `buildSalesOrderBlock()` (interno) usa flags Nomus persistidas + `order.nomusSellerName` diretamente | **Adapter necessário** | Reutilizar `buildSalesOrderNomusSellerDto` + `loadCommissionSellerIdentityContext` (mesma fonte usada pelo Relatório Comercial). |
| 4 | **Itens do Pedido** | `items[]` | `nomusSalesOrderItemStatus.ts::parseNomusSalesOrderItemStatusFromRawItem` + colunas Nomus persistidas | Map inline sobre `order.items` (Prisma) + cross-ref com `orderToCashAuditFact` | **Lógica duplicada — extrair** | Migrar para o padrão do Relatório Comercial: colunas Nomus persistidas primárias + fallback pelo parser. |
| 5 | **Documentos de Saída** | `stockDocuments[]`, `stockDocumentItems[]` | `orderToCashAuditBuilder.ts::buildOrderToCashAuditRows` + `linkOrderItemsToStockDocumentItems` + `detectOrderToCashAlerts` (materialização O2C oficial) | Cross-ref via `orderToCashAuditFact` + `prisma.nomusStockDocument.findMany` inline | **Lógica duplicada — extrair** | Reidratar doc/item a partir do `Fact` + `NomusStockDocument` usando funções do builder (não reimplementar matching). |
| 6 | **NF-e** | `nfes[]`, `nfeItems[]` | `salesOrderLinkedNfe.ts::loadSalesOrderLinkedNfeContextMap` + `buildSalesOrderLinkedNfeContext` (motor oficial usado pelo Comercial e pelo Relatório) | Facts + `prisma.nomusNfe.findMany` inline; **não** usa o motor oficial hoje | **Adapter necessário** | Cabeçalho NF via `loadSalesOrderLinkedNfeContextMap`; itens (preço × pedido × doc) permanecem na camada audit. |
| 7 | **Financeiro** | `receivables[]`, `plannedReceivables[]`, `plannedReceivablesTotal`, `receipts[]`, `receivablesTotal` | **CR real**: `NomusAccountsReceivable` oficial. **Cronograma**: `salesOrderListPaymentSchedule.ts::resolveSalesOrderListPaymentSummary`. **Forecast**: `salesOrderPlannedReceivables.ts::buildSalesOrderPlannedReceivables`. **Façade**: `orderReceivablesResolver.ts::resolveReceivablesForSalesOrder` (novo). | CR: `prisma.nomusAccountsReceivable.findMany` + `summarizeReceivables()`. **Planned: `buildSalesOrderPlannedReceivables` ✅ (commit c599191)**. Receipts derivados. | **OK** (CR real + planejado); adapter fino para receipts | Encapsular consumo externo via `resolveReceivablesForSalesOrder` (façade recém-criada). Detalhes na seção "Aba Financeiro" abaixo. |
| 8 | **Entrega / Produção / Frete** | `delivery`, `freight` | `salesOrderLifecycleTimeline.ts::buildSalesOrderTimeline` + `loadSalesOrderLinkedNfeContextMap` (SLA) | `buildDeliveryBlock()` (interno) + freight inline via `readNomusRawString/Number` | **Lógica duplicada — extrair** | Unificar lead time/atraso com `buildSalesOrderTimeline`; SLA via `loadSalesOrderLinkedNfeContextMap`. |
| 9 | **Margem, Preço e Custo** | `marginPricing` | `salesOrderMarginService.server.ts::calculateSalesOrderMarginsForOrders` (motor oficial) | `buildMarginPricingBlock()` chama `calculateSalesOrderMarginsForOrders` diretamente | **OK** | Adapter audit está mínimo — apenas anexa diffs preço doc/NF sobre a saída oficial. |
| 10 | **Comissões** | `commissions` | `commission-source-resolver.server.ts::loadCommissionOrderSourceBySalesOrderId` (bundle oficial) + `salesOrderTraceAudit.server.ts::buildSalesOrderTraceAudit` (trace) | `loadCommissionBlock()` (interno) — Prisma ad-hoc em `commissionOrderSnapshot`, `commissionCustomerException`, `commissionReceiptLedgerLine` | **Adapter necessário** | Trocar Prisma ad-hoc pelo `loadCommissionOrderSourceBySalesOrderId` (source bundle oficial). |
| 11 | **Divergências** | `alerts[]`, `divergences` | `orderToCashAuditBuilder.ts::detectOrderToCashAlerts` (alertas O2C oficiais) + commission audit (`collectOrderAuditIssues`) | Catálogo próprio `getAlertMetadata` (60+ códigos) + `buildAlerts` + `buildDivergencesBlock` | **Lógica duplicada — extrair** | Unificar códigos com `detectOrderToCashAlerts` + commission audit; `divergences` = rollup puro. |
| 12 | **Auditoria Técnica** | `technicalAudit` | Meta (sem motor único) — referencia todos os motores acima | `buildTechnicalAuditBlock()` (interno) + `sourceTables` + `includeRaw` gated | **OK** | Opcional: incluir `orderToCashAuditRun` hash + `CommissionOrderSnapshot.sourceHash`. |

## Aba Financeiro em detalhe (prioridade máxima)

A aba Financeiro é a **primeira aba refatorada para consumir o motor
oficial**. O padrão está formalizado em `orderReceivablesResolver.ts`.

### Fluxo oficial

```text
UI (aba Financeiro)
  ↓ payload já vem embutido em getOrderFullAudit(...)
resolveReceivablesForSalesOrder({ salesOrderId, orderCode })
  ↓
getOrderFullAudit()
  ├─ CR real:      prisma.nomusAccountsReceivable + summarizeReceivables()
  ├─ Planejado:    buildSalesOrderPlannedReceivables()
  │                 └─ resolveSalesOrderListPaymentSummary() [motor oficial]
  ├─ Baixas:       derivadas dos CRs oficiais (settlementDate/amountReceived)
  └─ Divergências: alerts[] com linkedTab === "financial"
```

### Regras oficiais (imutáveis)

1. **CR real prevalece sobre planejado** — dedup por (dueDate ± 3 dias) +
   (valor ± R$ 0,01). Ver `buildSalesOrderPlannedReceivables`.
2. **Planejado não altera `NomusAccountsReceivable`** — é apenas leitura.
3. **Pedido sem NF pode ter planejado** — caso do PD 02740.
4. **Empty state** só quando não há CR real **e** não há planejado.
5. **Cabeçalho NF não infla financeiro** — dedup por `receivableExternalId`
   antes de somar `receivablesTotal`.
6. **Divergências financeiras**: `PLANNED_RECEIVABLE_WITHOUT_REAL_CR`,
   `PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR`,
   `PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR`, mais os 10
   `RECEIVABLE_*`/`RECEIPT_*` clássicos.

## Motores oficiais reutilizáveis (façade pública)

Serviços que já são **motores oficiais** e podem ser consumidos por outros
módulos além da Auditoria 360º:

| Motor | Arquivo · export |
|---|---|
| Auditoria completa do pedido | `src/lib/finance/orderFullAuditService.ts` · `getOrderFullAudit` |
| **Recebíveis oficiais (real + planejado)** | `src/lib/finance/orderReceivablesResolver.ts` · `resolveReceivablesForSalesOrder` |
| Relatório oficial Comercial | `src/lib/sales/salesOrderReportService.server.ts` · `loadSalesOrderReportPayload` |
| Cronograma de pagamento | `src/lib/salesOrderListPaymentSchedule.ts` · `resolveSalesOrderListPaymentSummary` |
| Forecast planejado | `src/lib/finance/salesOrderPlannedReceivables.ts` · `buildSalesOrderPlannedReceivables` |
| NF vinculada ao pedido | `src/lib/salesOrderLinkedNfe.ts` · `loadSalesOrderLinkedNfeContextMap` |
| Margem oficial | `src/lib/salesOrderMarginService.server.ts` · `calculateSalesOrderMarginsForOrders` |
| CRM responsável comercial | `src/lib/crmCustomerCommercialOwner.ts` · `loadManualCommercialOwnersForCustomers` |
| Vendedor Nomus | `src/lib/salesOrderNomusSellerDisplay.ts` · `buildSalesOrderNomusSellerDto` |
| Contexto identidade vendedor | `src/lib/commissions/commissionSellerIdentity.server.ts` · `loadCommissionSellerIdentityContext` |
| Status item Nomus | `src/lib/sales/nomusSalesOrderItemStatus.ts` · `parseNomusSalesOrderItemStatusFromRawItem` |
| Materialização O2C | `src/lib/sales/orderToCashAuditBuilder.ts` · `buildOrderToCashAuditRows` / `detectOrderToCashAlerts` |
| CR Nomus oficial | `src/lib/financeAccountsReceivableRulesAdapter.ts` · `buildOfficialAccountsReceivableRulesResult` |
| Bundle Comissão | `src/lib/commissions/commission-source-resolver.server.ts` · `loadCommissionOrderSourceBySalesOrderId` |
| Trace auditoria pedido | `src/lib/salesOrderTraceAudit.server.ts` · `buildSalesOrderTraceAudit` |
| Timeline lifecycle | `src/lib/salesOrderLifecycleTimeline.ts` · `buildSalesOrderTimeline` |

## Estratégia progressiva de refatoração

Não fizemos big-bang porque a Auditoria 360º já está em produção e
consistente. Cada extração é uma tarefa isolada com QA próprio:

| Prioridade | Aba | Ação |
|---|---|---|
| **P0** (feito no commit c599191) | Financeiro (planejado) | `buildSalesOrderPlannedReceivables` |
| **P0** (este commit) | Financeiro (façade) | `resolveReceivablesForSalesOrder` |
| **P1** | NF-e | Cabeçalho via `loadSalesOrderLinkedNfeContextMap` |
| **P1** | Pedido de Venda | Vendedor via `buildSalesOrderNomusSellerDto` |
| **P2** | Comissões | Bundle via `loadCommissionOrderSourceBySalesOrderId` |
| **P2** | Divergências | Códigos via `detectOrderToCashAlerts` |
| **P3** | Documentos, Entrega, Resumo, Itens, Proposta | Extração de adapters compartilhados |

## Casos de validação (PDs de referência)

### PD 02740 — Financeiro sem NF/CR real

- Estado esperado: `receivables.length === 0`, `plannedReceivables.length > 0`.
- Vencimento visível: **20/10/2026**.
- Valor previsto: **R$ 175.600,00**.
- NF emitida: **Não**.
- Origem: **Pedido de Venda / Condição de pagamento**.
- Alerta: `PLANNED_RECEIVABLE_WITHOUT_REAL_CR` (warning).
- QA dinâmico: `scripts/qaOrderFullAuditDialog.ts` case `PD 02740`.

### PD 02339 — CR real + docs + NF

- `receivables.length > 0` deduplicado por `receivableExternalId`.
- Alertas de NF/documento/CR emitidos quando aplicável.
- Divergência mostra CR aberto com referência + vencimento.

### PD 02534 — Status por linha (SKU repetido)

- `items[]` respeita status por `salesOrderItemId`, não por SKU.
- 309.86AA não herda cancelamento em todas as linhas.
- Itens não faturados não pegam NF alheia.
- QA dinâmico com match confidence.

### PD 02207 — Cancelados não pendentes

- `canceledItemsCount = 2`, `pendingActiveItemsCount = 0`.
- `originalOrderValue = 197030`, `canceledOrderValue = 125625`.
- Pedido não fica parcial por causa de cancelados.
- Alerta `ORDER_ITEM_CANCELED` (info) por linha.

## Comandos de QA

```powershell
# Estático + fixture — sem DATABASE_URL exige apenas contratos.
npx tsx scripts/qaOrderFullAuditOfficialEngines.ts

# Estático + dinâmico best-effort (com DATABASE_URL).
npx tsx scripts/qaOrderFullAuditDialog.ts

# Diagnósticos por PD (com DATABASE_URL).
npx tsx tmp-audits/inspect-order-full-audit-pd02740.ts
npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts
npx tsx tmp-audits/inspect-order-full-audit-pd02534.ts
npx tsx tmp-audits/inspect-order-full-audit-pd02207.ts
npx tsx tmp-audits/inspect-order-full-audit-official-engines.ts

# Auditoria de escala em massa — flagra pedidos onde planejado ≠ ativo
# em ordens de magnitude (0.001×, 0.01×, 100×, 1000×).
npx tsx tmp-audits/inspect-order-full-audit-value-scale.ts
npx tsx tmp-audits/inspect-order-full-audit-value-scale.ts --take=200
npx tsx tmp-audits/inspect-order-full-audit-value-scale.ts --orders=PD02740,PD02339
```

## Escala de valores monetários — regra oficial (2026-07)

- **Backend trafega valores em REAIS** (`number` decimal, ex.: `175600` =
  R$ 175.600,00). Nunca em milhares nem em centavos.
- **Nunca `Number(str.replace(",", "."))` ingênuo** em valores vindos do
  Nomus/CSV/JSON externo — `"175.600,00"` → `"175.600.00"` → `NaN → 0`. Usar
  `toNumber` do `salesOrderListPaymentSchedule.ts`, que reconhece:
  - `175600` (number) → 175600
  - `"175.600,00"` (pt-BR) → 175600
  - `"175600.00"` (US) → 175600
  - `"175,60"` (só vírgula decimal) → 175.60
  - `"1,234,567.89"` (US com milhar) → 1234567.89
- **Formatação BRL só na camada de apresentação** (`formatFinanceCurrency`,
  `Intl.NumberFormat("pt-BR", { style: "currency" })`) — nunca dentro de
  cálculo/serviço.
- **Sanity check de forecast** (`extractSalesOrderForecastInstallments`):
  se a soma das parcelas vindas do `nomusRawResponse` divergir do
  `totalNetValue` do pedido em mais de 10× (para cima ou para baixo), a
  estrutura (nº de parcelas + datas) é preservada mas os valores são
  **reescalados proporcionalmente** para bater com o valor ativo oficial
  do pedido. A última parcela recebe o residual para eliminar drift.
- **CR real prevalece sobre planejado**: se `receivables.length > 0`, o
  motor devolve os CR reais direto — o forecast só entra em cena quando
  não há CR real materializado (pedido ainda sem NF).

## Documentos relacionados

- `docs/finance/order-full-audit-dialog.md` — UX/funcional das 12 abas.
- `docs/finance/order-full-audit-dialog-qa.md` — checklist de QA.
- `docs/finance/portfolio-order-status-tab.md` — tela Status Pedidos que
  dispara o modal.
- `docs/sales/sales-order-item-status-rules.md` — regras oficiais de status
  do item (CANCELED / CUT / STALE).
- `docs/finance/order-to-cash-audit-item-evidence-rules.md` — evidência
  item × doc × NF × CR.
