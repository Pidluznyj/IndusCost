# FIN-01 — Fluxo financeiro efetivo: Pedido × Documento × CR

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | FIN-01 |
| **Atualizado** | 2026-07-17 |
| **Escopo** | Auditoria de código local (sem banco/servidor) |
| **Fora de escopo** | Implementação de correções; sync Nomus; migrations |

Este documento mapeia a lógica **atual** que transforma condições do Pedido de Venda em agenda financeira efetiva (previsão residual + CR real), identifica funções de cálculo e consumidores concorrentes que precisam de motor único.

Documentos relacionados (não substituem este mapa):

- `docs/finance/order-nfe-cr-financial-separation.md` — Pedido × NF × CR × planejado
- `docs/finance/order-full-audit-official-engines-map.md` — motores da Auditoria 360°
- `docs/output-documents/code-inventory.md` — Documentos de Saída / stage Nomus
- `docs/finance/cash-flow.md` — Fluxo de Caixa (CR/AP oficiais)
- `docs/finance/nfe-status-rules.md` — status estrutural de NF-e

---

## 1. Conclusão executiva

1. **Parcelas originais** nascem do `SalesOrder.nomusRawResponse` (arrays de condição/parcelas) + fallbacks (`paymentTerms` à vista / valor ativo), via `resolveSalesOrderListPaymentSummary` → `extractSalesOrderForecastInstallments`.
2. **Agenda efetiva** (o que ainda “pesa” financeiramente) é montada por `buildSalesOrderPlannedReceivables`: CR real e Documento válido **substituem** previsão; residual proporcional permanece ativo.
3. **CR oficial** é só `NomusAccountsReceivable` (não recalcular aberto/recebido a partir de Pedido−NF).
4. **Documento ↔ Pedido ↔ Item** não tem FK; alocação operacional é `linkOrderItemsToStockDocumentItems` no builder O2C; ligação financeira Documento→CR é indireta via NF (`idNfe` / `sourceInvoiceId`).
5. **Há mais de um sítio** que calcula cobertura/residual com a mesma ideia (CR > Doc > Pedido). FIN-01 recomenda **um motor único** e consumidores só de leitura.
6. **Status numérico de item Nomus**: o código mapeia 1–6, mas a evidência de produção documentada no repo **não é uniforme** para todos os códigos — ver §8 (não presumir).

---

## 2. Topologia (estado atual)

```text
SalesOrder
  ├─ paymentTerms / paymentMethod / issueDate / totalNetValue
  ├─ nomusRawResponse ──► parcelas previstas (JSON)
  └─ SalesOrderItem[] (status Nomus persistido)

SalesOrderNfeLink ──► NomusNfe.externalId
NomusStockDocument.idNfe ──► NomusNfe.externalId
NomusAccountsReceivable.sourceInvoiceId ──► NomusNfe.externalId

OrderToCashAuditRun 1─N OrderToCashAuditFact
  (derivado reconstruível: Pedido × item × Doc × NF × CR)

Agenda efetiva (read-model):
  resolveSalesOrderListPaymentSummary   → parcelas originais / linhas
       └─ buildSalesOrderPlannedReceivables → cobertura + residual + substituição
            └─ computeSalesOrderFinancialCoverage
            └─ allocateResidualPlannedAmounts
            └─ findCoveringRealCr (match parcela↔CR)

Consolidação totais:
  computeConsolidatedFinancialSummary
  orderFiscalFinancialMetrics (applicableExpected / total financeiro)

Façade:
  resolveReceivablesForSalesOrder → getOrderFullAudit (fatia financeira)
```

---

## 3. Inventário por artefato pedido

### 3.1 Parcelas originais do SalesOrder

| Peça | Local |
|---|---|
| Campos cabeçalho | `SalesOrder.paymentTerms`, `paymentMethod`, `issueDate`, `totalNetValue`, `nomusRawResponse` (`prisma/schema.prisma`) |
| Extração de parcelas | `src/lib/salesOrderListPaymentSchedule.ts` — `extractSalesOrderForecastInstallments`, chaves `parcelas`, `condicaoPagamentoParcelas`, `parcelasCondicaoPagamento`, `titulosFinanceiros`, `financeiroParcelas` |
| Resumo / linhas | `resolveSalesOrderListPaymentSummary` — se há CR candidatos usa linhas de AR; senão forecast; senão “à vista” |
| Conversão monetária | `toNumber` no mesmo arquivo (pt-BR / US) — fonte única recomendada |
| Server helper | `src/lib/salesOrderListPaymentSchedule.server.ts` |
| Uso comercial/listagem | `salesOrderListReportExport.server.ts`, `salesOrderReportService.server.ts` |

**Importante:** `buildSalesOrderPlannedReceivables` chama `resolveSalesOrderListPaymentSummary` com `receivables: []` de propósito — força linhas da **condição do pedido**, não troca o schedule por títulos CR (a substituição é etapa seguinte).

### 3.2 Status dos SalesOrderItem

| Peça | Local |
|---|---|
| Colunas persistidas | `SalesOrderItem.nomusItemStatusRaw`, `nomusItemStatusNormalized`, `nomusQuantityFulfilled/Pending`, `nomusIsCanceled`, `nomusIsCut`, `nomusIsStale`, `nomusMatchConfidence`, `nomusRawItem` |
| Parser oficial | `src/lib/sales/nomusSalesOrderItemStatus.ts` — `parseNomusSalesOrderItemStatus`, `normalizeNomusSalesOrderItemStatus`, `NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP` |
| Mapa legado/paralelo | `src/lib/salesOrderNomusRaw.ts` — `NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE` + regex de texto |
| Gates de negócio | `isSalesOrderItemActiveForCommercialValue`, `…ForReceivableForecast`, `…ForCommission`, `…ForMargin`, `isFulfilledWithCutSalesOrderItem` |
| Enrichment O2C | `src/lib/finance/orderToCashFactItemStatusEnrichment.server.ts` |
| UI Status Pedidos / Management | `SalesOrderManagementPage`, funnel classification |

Detalhe de códigos → §8.

### 3.3 Documentos de saída e itens

| Peça | Local |
|---|---|
| Stage | `NomusStockDocument` / `NomusStockDocumentItem` |
| Sync | `scripts/nomusStockDocumentsSync.ts` (+ mapper/logic) |
| Inventário | `docs/output-documents/code-inventory.md` |
| UI módulo | `OutputDocumentsModule` / APIs de output-documents |
| Na auditoria do pedido | Facts O2C + enrich `nomusStockDocument.findMany` em `orderFullAuditService` |

### 3.4 Alocação Documento ↔ Pedido ↔ Item

| Função | Arquivo | Papel |
|---|---|---|
| `linkOrderItemsToStockDocumentItems` | `orderToCashAuditBuilder.ts` | Matching qty/produto; `quantityUsed`, excess, outside order |
| `buildOrderToCashAuditRows` | idem | Materializa facts com `allocatedValueByOrderPrice/DocumentPrice` |
| Engine portfolio (outro eixo) | `portfolioReconciliationAllocationEngine.ts` | Alocação/carteira — **não** é o mesmo contrato da agenda financeira de parcelas |
| Resolver docs | `nomusOutputDocumentResolver.ts` | Cruzamento Doc/NF/Pedido/CR para UI de documentos |

Sem FK. Cadeia lógica usual:

`SalesOrderNfeLink.nfeExternalId` = `NomusNfe.externalId` = `NomusStockDocument.idNfe` = `NomusAccountsReceivable.sourceInvoiceId`.

### 3.5 NF-e

| Peça | Local |
|---|---|
| Stage | `NomusNfe` + `SalesOrderNfeLink` |
| Status | `src/lib/finance/nfeStatus.ts` (cancelada estrutural = 7) |
| Motor vínculo pedido | `salesOrderLinkedNfe.ts` — `loadSalesOrderLinkedNfeContextMap` |
| Métricas Pedido×NF×CR | `orderFiscalFinancialMetrics.ts` |
| Separação conceitual | `docs/finance/order-nfe-cr-financial-separation.md` |

### 3.6 NomusAccountsReceivable

| Peça | Local |
|---|---|
| Model | `NomusAccountsReceivable` — `amountReceivable`, `amountReceived`, `balanceReceivable`, `dueDate`, `settlementDate`, `sourceInvoiceId/Number`, `rawPayload` |
| Regras/status título | `financeAccountsReceivableRulesAdapter.ts`, format helpers |
| Dashboard / títulos / export | `financeAccountsReceivableDashboard.ts`, `financeAccountsReceivableTitles.ts`, export CSV |
| Sync UI | `NomusAccountsReceivableSyncCard.tsx` |
| Por pedido | carregado em `orderFullAuditService` / façades; deep-link Contas a Receber `?search=<orderCode>` |

Campos oficiais de **aberto / recebido / vencimento** do título real: `balanceReceivable`, `amountReceived`, `dueDate` (não reinventar).

### 3.7 OrderToCashAuditFact

| Peça | Local |
|---|---|
| Models | `OrderToCashAuditRun`, `OrderToCashAuditFact` |
| Builder puro | `src/lib/sales/orderToCashAuditBuilder.ts` — `buildOrderToCashAuditRows`, `detectOrderToCashAlerts` |
| Rebuild | `scripts/rebuildOrderToCashAudit.ts` |
| API listagem O2C | `orderToCashAuditApi.ts` |
| Natureza | **Derivado / reconstruível** — não master financeiro |

Campos financeiros no fact incluem `plannedReceivableValue`, `receivable*`, `payment*`, flags `hasPartialFulfillment`, `hasDocumentWithoutReceivable`, `hasOverdueReceivable`, etc.

### 3.8 Detalhe financeiro do Pedido

| Peça | Local |
|---|---|
| API | `GET /api/sales-orders/:salesOrderId/detail` → `getSalesOrderDetail` |
| Service | `src/lib/sales-orders/salesOrderDetailService.server.ts` (compõe via `getOrderFullAudit` / planned totals) |
| Client types | `salesOrderDetailClient.ts` |
| UI | `SalesOrderDetailView.tsx`, `SalesOrderDetailDialog.tsx`, aba Tributos |
| Cards | “Previsão residual”, “cobertos por documento/CR”, status parcela Substituída / Parcialmente substituída |

### 3.9 Tela geral Contas a Receber

| Peça | Local |
|---|---|
| UI | módulo Financeiro → Contas a Receber (`FinanceModule` / rotas `finance/accounts-receivable*`) |
| Dados | stage `NomusAccountsReceivable` + adapters de status |
| Relação com pedido | filtro/busca; **não** monta agenda residual do pedido sozinha |

### 3.10 Fluxo de Caixa

| Peça | Local |
|---|---|
| Dataset | `financeCashFlowDataset.ts` — entradas de AR/AP oficiais |
| Radar / forecast | `financeCashFlowForecast.ts`, daily-radar APIs |
| Doc | `docs/finance/cash-flow.md` |

**Estado atual:** o Fluxo de Caixa opera sobre **títulos oficiais** AR/AP. Comentários em `orderReceivablesResolver` / `salesOrderPlannedReceivables` **declaram** intenção de consumo unificado da previsão do pedido, mas o dataset de cash-flow **não** chama `buildSalesOrderPlannedReceivables` hoje (gap / consumidor futuro do motor único).

### 3.11 Alertas de previsão vencida

| Código / comportamento | Onde |
|---|---|
| `PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR` | `orderFullAuditService.ts` (build alerts) — só linhas com `replacedByRealCr === false` e `statusLabel === "Vencido"` |
| `PLANNED_RECEIVABLE_WITHOUT_REAL_CR` | idem |
| `PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR` | evidência; não gera “vencido” operacional |
| Título residual | “Previsão residual vencida sem cobertura” quando `entryKind === "RESIDUAL_ORDER_PLAN"` |
| UI | Auditoria 360° aba Financeiro / Divergências; detalhe do pedido |

Classificação de vencimento da previsão: `classifyPlannedStatus` em `salesOrderPlannedReceivables.ts` (dia local).

### 3.12 Auditoria 360°

| Peça | Local |
|---|---|
| Orquestrador | `orderFullAuditService.ts` — `getOrderFullAudit` / `loadOrderFullAudit` |
| Rota | `GET /api/finance/portfolio-reconciliation/orders/:id/audit-full` |
| UI | `OrderFullAuditDialog.tsx` |
| Façade financeira | `orderReceivablesResolver.ts` |
| Mapa de motores | `docs/finance/order-full-audit-official-engines-map.md` |

Aba Financeiro já consome `buildSalesOrderPlannedReceivables` + CR real.

### 3.13 Impressão / PDF

| Peça | Local |
|---|---|
| Detalhe do pedido | `SalesOrderDetailDialog` — `window.print()` + `sales-order-detail-print.css`; mesma composição de `SalesOrderDetailView` |
| Contas a Receber | helpers de print meta (`financeArTitlesPrintMeta.ts`) para filtros/export |
| Relatório comercial / XLSX | `salesOrderReportExport.ts` / list export (cronograma via `resolveSalesOrderListPaymentSummary`) |
| Métricas fiscais/financeiras compartilhadas | `orderFiscalFinancialMetrics.ts` (tela/PDF/XLSX alinhados à 360°) |

Não há motor PDF server-side separado para a agenda efetiva: é a mesma view + print do browser.

---

## 4. Funções que calculam os conceitos-alvo

### 4.1 Valor coberto

| Função | Arquivo | Semântica |
|---|---|---|
| `computeSalesOrderFinancialCoverage` | `salesOrderPlannedReceivables.ts` | `coveredByRealReceivables`, `coveredByDocumentsWithoutRealReceivable`, `remainingPlannedValue`; dominante = `min(ativo, max(CR, Doc))` |
| `resolveFinancialEvidenceWithoutDoubleCount` | `auditOutputDocumentsFinancial.ts` | Mesma precedência em **centavos** para evidência de Documentos de Saída |
| UI detalhe | `SalesOrderDetailView.tsx` | Soma `coveredByRealReceivables + coveredByDocumentsWithoutRealReceivable` para card |

### 4.2 Previsão residual

| Função | Arquivo | Semântica |
|---|---|---|
| `allocateResidualPlannedAmounts` | `salesOrderPlannedReceivables.ts` | Distribui residual proporcional nas parcelas sem match 1:1 |
| Linhas `RESIDUAL_ORDER_PLAN` | `buildSalesOrderPlannedReceivables` | `expectedAmount`/`openAmount` = residual; datas preservadas |
| Totais | `summarizePlanned` → `applicableExpected`, `openExpected`, `remainingPlannedValue` |
| `resolveApplicablePlannedExpected` | `orderFiscalFinancialMetrics.ts` | `totalExpected − replacedAmount` |

### 4.3 Parcelas planejadas

| Função | Arquivo |
|---|---|
| `extractSalesOrderForecastInstallments` / `buildForecastLines` | `salesOrderListPaymentSchedule.ts` |
| `resolveSalesOrderListPaymentSummary` | idem |
| `buildSalesOrderPlannedReceivables` | `salesOrderPlannedReceivables.ts` |
| Campos no Fact | `plannedInstallmentsCount`, `plannedFirst/LastDueDate`, `plannedPaymentDatesJson`, `plannedReceivableValue` (`orderToCashAuditBuilder`) |

### 4.4 Substituição por CR (e por Documento / cobertura)

| Função | Arquivo | Semântica |
|---|---|---|
| `findCoveringRealCr` | `salesOrderPlannedReceivables.ts` | Match forte: valor ±0,01 e dueDate ±3 dias; fallback mesmo valor |
| Flags | `replacedByRealCr`, `replacedBySource` (`REAL_RECEIVABLE` \| `OUTPUT_DOCUMENT` \| `VALUE_COVERAGE`), `entryKind` |
| StatusLabel | `Substituída` / `Parcialmente substituída` (histórico) + residual ativo separado |
| Consolidação | `computeConsolidatedFinancialSummary` — planejado substituído **não** reentra no total |

### 4.5 Vencimento / aberto / recebido

| Conceito | Fonte CR real | Fonte previsão |
|---|---|---|
| Vencimento | `NomusAccountsReceivable.dueDate` | `planned.dueDate` + `classifyPlannedStatus` |
| Aberto | `balanceReceivable` | `openAmount` das linhas não substituídas |
| Recebido | `amountReceived` (+ `settlementDate`) | N/A na previsão (open = expected residual) |
| Status título AR | adapters `financeAccountsReceivable*` / `formatFinanceCalculatedStatus` | labels planejados |

### 4.6 Corte

| Função / flag | Arquivo |
|---|---|
| Status `5` / texto “Atendido com corte” → `FULFILLED_WITH_CUT` | `nomusSalesOrderItemStatus.ts` |
| `nomusIsCut`, `quantityCut` | persistência + parser |
| `isFulfilledWithCutSalesOrderItem` | gates |
| Alerta O2C `ORDER_ITEM_CUT` | `orderToCashAuditBuilder` — saldo cortado **encerra** pendência/forecast do item |
| Relatórios | contagens `cutItemsCount` em report export |

### 4.7 Atendimento parcial

| Camada | Onde |
|---|---|
| Status item `3` / texto parcial → `PARTIAL` | mapas Nomus (§8) |
| Flag fact `hasPartialFulfillment` | `OrderToCashAuditFact` / builder |
| Funil comercial | `salesOrderToCashFunnelClassification.ts` — estágio `PEDIDO_PARCIALMENTE_ATENDIDO` |
| Alocação parcial doc | residual de qty no `linkOrderItemsToStockDocumentItems` + linhas `ORDER_ITEM_PENDING` |

---

## 5. Cálculos concorrentes (precisam motor único)

A regra de negócio desejada é única:

> **Precedência:** CR real ≥ Documento de Saída válido ≥ previsão do Pedido.  
> **Sem dupla contagem** de CR + Documento da mesma cadeia.  
> **Residual** só no saldo não coberto.  
> **Saldo financeiro aberto** nunca = Pedido − NF.

### 5.1 Implementações paralelas da mesma ideia

| # | Implementação | Unidade | Consumidores atuais |
|---|---|---|---|
| A | `computeSalesOrderFinancialCoverage` + `buildSalesOrderPlannedReceivables` | reais | Auditoria 360°, detalhe do pedido, testes fiscais, façace `orderReceivablesResolver` |
| B | `resolveFinancialEvidenceWithoutDoubleCount` | centavos | Auditoria/evidência de Documentos de Saída (`auditOutputDocumentsFinancial.ts`) |
| C | Campos planejados no `orderToCashAuditBuilder` (`plannedReceivableValue`, payment stages) | fact O2C | Status Pedidos / rebuild O2C / alertas operacionais |
| D | `resolveSalesOrderListPaymentSummary` com `receivables` preenchidos | linhas | Listagem/export comercial — **substitui** forecast por CR quando há títulos (comportamento diferente de A, que força forecast e depois dedup) |
| E | Totais UI locais | mistos | `OrderFullAuditDialog` / `SalesOrderDetailView` somam covered; devem só espelhar totals oficiais |
| F | Fluxo de Caixa | AR/AP only | Ainda **não** consome A — risco futuro de agenda paralela se alguém “encaixar” forecast ad-hoc |

### 5.2 Consumidores que devem usar o motor único (alvo)

Quando unificar (fora deste ticket), estes devem **ler** o motor e não recalcular:

1. Auditoria 360° — aba Financeiro / alertas de previsão  
2. Detalhe do Pedido — cards residual/coberto + impressão/PDF  
3. Contas a Receber (deep-link / painel por pedido, se existir)  
4. Fluxo de Caixa — se passar a incluir previsão de pedido  
5. Documentos de Saída — evidência financeira (hoje B)  
6. Relatório Comercial / export — alinhar D com A quando misturar forecast+CR  
7. Comissões (timeline/forecast) — hoje usam CR oficial; não inventar residual paralelo  
8. Portfolio cash-forecast / maturity — se agregarem pedido sem NF  

**Candidato a motor canônico (já existe e é o mais completo):**  
`src/lib/finance/salesOrderPlannedReceivables.ts` (+ `computeSalesOrderFinancialCoverage`, `allocateResidualPlannedAmounts`)  
com parcelas-base de `resolveSalesOrderListPaymentSummary` e consolidação em `orderFinancialConsolidation.ts` / `orderFiscalFinancialMetrics.ts`.

**Façade de leitura:** `resolveReceivablesForSalesOrder`.

---

## 6. Fluxo efetivo passo a passo

```text
1. Valor ativo do pedido
   = totalNetValue − cancelados/cortes (motores de item/status; ver Status Pedidos / O2C)

2. Parcelas originais
   = extract do nomusRawResponse (ou à vista / terms)
   → linhas com dueDate + amount (escala validada vs total ativo)

3. CR reais do pedido
   = NomusAccountsReceivable ligados (via NF / order audit loader)
   amountReceivable / balanceReceivable / dueDate / settlementDate

4. Cobertura dominante
   coveredCr = min(ativo, Σ amountReceivable)
   coveredDoc = max(0, min(ativo, max(coveredCr, validDocumentAllocated)) − coveredCr)
   remaining = ativo − (coveredCr + coveredDoc)

5. Match parcela ↔ CR (1:1 quando possível)
   → SUPERSEDED_ORDER_PLAN (Substituída)

6. Residual nas não casadas
   allocateResidualPlannedAmounts(original unmatched, residualForUnmatched)
   → ACTIVE_ORDER_PLAN ou RESIDUAL_ORDER_PLAN
   → histórico “Parcialmente substituída” + linha residual

7. Totais operacionais
   applicableExpected / openExpected / overdueExpected
   (linhas replacedByRealCr=true fora de alertas de vencido)

8. Total financeiro consolidado
   = CR original + applicableExpected
   (nunca CR + planejado já substituído)
```

---

## 7. APIs e telas (entrada)

| Superfície | Entrada de dados |
|---|---|
| Detalhe Pedido | `getSalesOrderDetail` ← `getOrderFullAudit` |
| Auditoria 360° | `getOrderFullAudit` |
| Recebíveis por pedido | `resolveReceivablesForSalesOrder` |
| Contas a Receber geral | `NomusAccountsReceivable` + dashboard/titles |
| Fluxo de Caixa | `financeCashFlowDataset` (AR/AP) |
| O2C / Status Pedidos | `OrderToCashAuditFact` rebuild |
| Documentos de Saída | stage + resolvers + evidência financeira paralela (B) |
| Print/PDF detalhe | mesma payload do detalhe |

---

## 8. Status de item Nomus — evidência vs mapa no código

### 8.1 Dois mapas no repositório

1. `NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP` em `nomusSalesOrderItemStatus.ts`  
2. `NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE` em `salesOrderNomusRaw.ts`  

Valores alinhados entre si (1–6). Textos PT via `ITEM_STATUS_RULES` / `normalizeSalesOrderItemNomusStatus`.

| Código | Mapa no código | Label normalizado (mapa 1) | Lifecycle (mapa 2) |
|---|---|---|---|
| 1 | PENDING | `PENDING` | `awaiting_release` |
| 2 | RELEASED | `RELEASED` | `released` |
| 3 | PARTIAL | `PARTIAL` | `partially_fulfilled` |
| 4 | FULFILLED | `FULFILLED` | `fully_fulfilled` |
| 5 | FULFILLED_WITH_CUT | `FULFILLED_WITH_CUT` | `fulfilled_with_cut` |
| 6 | CANCELED | `CANCELED` | `cancelled` |
| outro | UNKNOWN | `UNKNOWN` | `unknown` |

### 8.2 Evidência **no código** (não inventar além disso)

| Código / texto | Evidência no repo | Força |
|---|---|---|
| **6** Cancelado | Comentário em `salesOrderNomusRaw.ts`: “PD 02130 com status=6 = Cancelado”; testes PD 02207 / PD 02534; texto `/^cancelad/` | **Alta** |
| **4** Atendido totalmente | Header `nomusSalesOrderItemStatus.ts`: “confirmados em produção (PD 02207): 4 → FULFILLED”; testes unitários; texto “Atendido totalmente” | **Alta** |
| **5** Atendido com corte | Testes com `status: 5` + texto “Atendido com corte”; `quantityCut` derivado | **Alta** (fixture/teste; não há PD citado no header como 4/6) |
| **2** Liberado | Fixture PD 02534 (`status: "2"`) + texto “Liberado” | **Média-alta** |
| **1** Aguardando liberação | Presente nos mapas + regex `aguardando liberac`; **sem** PD citado como evidência de produção no comentário de `salesOrderNomusRaw` (que ainda tem TODO para demais códigos além do 6) | **Contrato de código / fraca evidência de produção documentada** |
| **3** Parcial | Presente nos mapas + regex `atendido parcial` / lifecycle `partially_fulfilled`; **sem** PD de produção citado no mesmo nível de 4/6 | **Contrato de código / fraca evidência de produção documentada** |

**Regra FIN-01:** não tratar 3 ou 4 (nem qualquer código) como significado de negócio sem apontar a fonte. No código atual, **4** e **6** têm a evidência mais explícita; **1** e **3** estão no mapa por contrato Status Pedidos/sync, mas o próprio `salesOrderNomusRaw.ts` admite mapeamento incompleto frente a documentação oficial Nomus.

Persistência: string normalizada + flags (`nomusIsCanceled`, `nomusIsCut`, …). Consumidores de carteira/comissão/forecast devem preferir flags + `nomusItemStatusNormalized`, não reinterpretar número cru.

---

## 9. Lacunas e riscos (somente diagnóstico)

1. **Motor A vs B** (reais vs centavos) — risco de drift se regras divergirem.  
2. **Motor A vs D** — listagem comercial troca forecast por CR inteiro; A mantém forecast e marca substituição.  
3. **Fact O2C (C)** ainda calcula `plannedReceivableValue` no builder — pode divergir do residual de A.  
4. **Fluxo de Caixa** não usa A — previsão vencida do pedido não entra no radar diário.  
5. **Status 1/3** — mapa existe; evidência de produção documentada é mais fraca que 4/6.  
6. Auditoria 360° ainda tem lógica duplicada em outras abas (ver engines-map); financeiro já é o mais alinhado.

Nenhuma correção foi implementada neste ticket.

---

## 10. Arquivos-chave (checklist)

```
prisma/schema.prisma
  SalesOrder, SalesOrderItem, SalesOrderNfeLink
  NomusAccountsReceivable, NomusNfe, NomusStockDocument*
  OrderToCashAuditRun, OrderToCashAuditFact

src/lib/salesOrderListPaymentSchedule.ts
src/lib/finance/salesOrderPlannedReceivables.ts
src/lib/finance/orderReceivablesResolver.ts
src/lib/finance/orderFullAuditService.ts
src/lib/sales/orderFinancialConsolidation.ts
src/lib/sales/orderFiscalFinancialMetrics.ts
src/lib/sales/orderToCashAuditBuilder.ts
src/lib/sales/nomusSalesOrderItemStatus.ts
src/lib/salesOrderNomusRaw.ts
src/lib/salesOrderLinkedNfe.ts
src/lib/output-documents/auditOutputDocumentsFinancial.ts
src/lib/financeCashFlowDataset.ts
src/lib/sales-orders/salesOrderDetailService.server.ts
src/components/sales/SalesOrderDetailView.tsx
src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx
```

---

## 11. Próximo passo sugerido (fora de FIN-01)

FIN-02+ — extrair/publicar motor único a partir de `salesOrderPlannedReceivables.ts`, fazer B/C/D/F consumirem a mesma API de cobertura/residual, e fechar gaps de evidência de status Nomus com amostra de produção no servidor (fora do Cursor local).
