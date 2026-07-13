# QA Auditoria 360º do Pedido — checklist oficial

Este documento consolida o QA integrado da janela **Auditoria 360º do Pedido**
(rota `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`
+ modal `OrderFullAuditDialog.tsx` na aba Financeiro > Conciliação de Carteira >
Status Pedidos).

**Status geral atual: APROVADO** (estático + dinâmico best-effort).

- Data desta rodada: `Mon Jul 13 2026 19:41 (UTC-3)`.
- Script oficial: `scripts/qaOrderFullAuditDialog.ts` — **92 checks estáticos
  PASS** + 3 WARN dinâmico (ambiente sem `DATABASE_URL`).
- Rodadas dinâmicas com banco (PD 02339 / PD 02534 / PD 02207) devem ser
  executadas no servidor com `DATABASE_URL` configurada para virar `OK`.

## Como rodar o QA

```bash
# Estático (não precisa de DB):
npx tsx scripts/qaOrderFullAuditDialog.ts

# Dinâmico (com DB configurada — 3 PDs de referência):
DATABASE_URL=... npx tsx scripts/qaOrderFullAuditDialog.ts

# Inspects individuais:
DATABASE_URL=... npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts
DATABASE_URL=... npx tsx tmp-audits/inspect-order-full-audit-pd02534.ts
DATABASE_URL=... npx tsx tmp-audits/inspect-order-full-audit-pd02207.ts

# Suporte:
npx prisma validate
npx prisma generate
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
npm test -- --run
npm run build
```

## 1. Casos gerais (todas as PDs)

| Caso | Resultado esperado | Verificação oficial |
|------|--------------------|---------------------|
| Clicar em uma linha do grid Status Pedidos abre o modal 360º | Modal aparece com título "Auditoria 360º — PD XXXXX" | `qaOrderFullAuditDialog.ts › dialog:title` |
| Modal fecha por botão / ESC / clique no overlay | UI volta ao grid, filtros da tela preservados | `dialog:a11y` (aria-modal + role=tablist + ESC) |
| Todas as 12 abas renderizam sem erro | `summary/proposal/salesOrder/items/documents/nfes/financial/delivery/marginPricing/commissions/divergences/technicalAudit` | `dialog:tabs` + testids `order-full-audit-tab-<id>` |
| Grid Status Pedidos tem cursor pointer + tooltip | `title="Abrir auditoria 360º do pedido"` na `<tr>` | `table:row-affordance` |
| Drilldown antigo NÃO aparece abaixo do grid | Só hint com `"Auditoria 360º do Pedido"` visível | `tab:integration` + `tab:legacy-panel-removed` |
| Nenhum frontend importa Prisma | `dist/` sem Prisma; 665 arquivos frontend rastreados | `npm run check:frontend-server-imports` + `check:browser-bundle` |
| Frontend não expõe raw payload fora da aba Técnica | `nomusRawResponse` / `rawPayload` / `nomusRawItem` apenas em `TechnicalAuditTab` | `technical:no-raw-elsewhere` |
| Rota audit-full protegida | `auth.requireAppAuth`/`requirePermission` presente | `route:auth` |
| Payload expõe 25 campos oficiais | `summary`, `proposal`, `salesOrder`, `items`, `stockDocuments`, `stockDocumentItems`, `nfes`, `nfeItems`, `receivables`, `receivablesTotal`, `receipts`, `delivery`, `freight`, `marginPricing`, `commissions`, `divergences`, `technicalAudit`, `alerts`, `timeline`, `runMeta`, etc. | `payload:contract` |

## 2. Regras oficiais aplicadas (validadas por linha)

| Regra oficial | Como é enforçada | Divergência de bug (crítica) |
|---------------|------------------|------------------------------|
| Responsável Comercial ≠ Vendedor Pedido ≠ Setor operacional | 3 campos separados no `SalesOrderBlock` + aviso inline | `RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER` (crítica) + `OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE` (média) |
| Status do item por linha (não por SKU) | Cada `SalesOrderItem.id` mantém status/valor/margem/comissão | `REPEATED_SKU_WITH_DIFFERENT_STATUS` (info) + dedup canônico no fim de `buildAlerts` |
| Item cancelado nunca gera pendência/margem/comissão | Filtro `isInactiveSalesOrderItemNomusFlags` + `activePendingQuantity = 0` | `CANCELED_ITEM_MARKED_AS_OVERDUE`, `CANCELED_ITEM_GENERATING_NO_MARGIN`, `CANCELED_ITEM_GENERATING_COMMISSION` (todas críticas) |
| Item com corte encerra pendência do saldo cortado | `nomusIsCut === true` → `activePendingQuantity = 0` | `CUT_ITEM_MARKED_AS_PENDING` (média) |
| Item stale mantido só para histórico | `nomusIsStale === true` excluído dos ativos | `STALE_ITEM_GENERATING_MARGIN` (média) |
| Cabeçalho NF não infla carteira | `nfe.valorTotal` separado de `allocatedValueToOrder` | `NFE_HEADER_GREATER_THAN_ORDER` / `NFE_VALUE_GREATER_THAN_ACTIVE_ORDER` (alta) |
| CR real prevalece sobre forecast | `NomusAccountsReceivable` é fonte oficial única | `RECEIVABLE_OPEN`, `RECEIVABLE_OVERDUE`, `RECEIVABLE_GREATER_THAN_ACTIVE_ORDER` |
| CR oficial não é alterado pela auditoria | Service read-only; nenhuma escrita | Auditado no `check:server-imports` (sem writes) |
| Comissão paga não é alterada | `commissions.readOnly === true` + disclaimer visível | `COMMISSION_PAID_WITH_DIVERGENCE` (crítica) quando `paid > release` |

## 3. Aba Resumo Executivo

| Caso | Resultado esperado |
|------|-------------------|
| Cards principais (24 KPIs) | Pedido, Cliente, Empresa, Datas, Status, Temperatura, valores originais/ativo/cancelado/cortado/atendido, CR total/aberto/recebido/vencido |
| Comparativos | Δ Pedido × Documento / NF / CR / Ativo × CR / Atendido × CR (5 cards com sinal) |
| Timeline | Proposta → Pedido → Documento → NF-e → CR gerado → Vencimento → Baixa |
| Top alertas | Máx. 8 divergências ranqueadas por severidade + código |

## 4. Aba Proposta / Origem Comercial

| Caso | Resultado esperado |
|------|-------------------|
| Sem `proposalId` | Empty state: "Este pedido não possui proposta vinculada no IndusCost." |
| Com proposta | Disclaimer read-only + 5 seções + tabela de itens (16 colunas com Δ) + painel de divergências |
| 7 códigos oficiais | `PROPOSAL_NOT_FOUND`, `PROPOSAL_ORDER_VALUE_MISMATCH`, `PROPOSAL_ITEM_NOT_CONVERTED`, `ORDER_ITEM_WITHOUT_PROPOSAL_ITEM`, `PROPOSAL_PRICE_MISMATCH`, `PROPOSAL_PAYMENT_TERM_MISMATCH`, `PROPOSAL_FREIGHT_MISMATCH` |
| Proposta não altera financeiro | `buildSummary` continua usando CR oficial deduplicado (verificado por `proposal:no-financial-impact`) |

## 5. Aba Pedido de Venda

| Caso | Resultado esperado |
|------|-------------------|
| 8 cards do topo | Valor pedido, Itens totais/ativos/cancelados/com corte/atendidos/pendentes ativos + % atendimento |
| 5 seções | Identificação, Comercial, Operacional, Financeiro do pedido, Observações |
| Responsável Comercial vem do CRM | `commercialResponsibleName` do `CrmCustomerCommercialOwner`; **nunca** `FINANCEIRO`/`FATURAMENTO`/`EXPEDIÇÃO` |
| Vendedor Pedido vem do Nomus | `orderSellerName` do `SalesOrder.nomusSellerName` |
| 8 códigos oficiais | `SELLER_NOT_INFORMED`, `COMMERCIAL_RESPONSIBLE_MISSING`, `PAYMENT_TERM_MISSING`, `DELIVERY_DATE_OVERDUE`, `ORDER_STATUS_UNKNOWN`, `ORDER_WITHOUT_ITEMS`, `ORDER_HEADER_ITEMS_TOTAL_MISMATCH`, `OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE` |

## 6. Aba Itens do Pedido

| Caso | Resultado esperado |
|------|-------------------|
| 12 chips oficiais | Todos, Atendidos, Pendentes ativos, Cancelados, Com corte, Parcialmente atendidos, Com excedente, Produto fora do pedido, Com CR aberto, Recebidos, Sem documento, Divergência de preço |
| Tabela 31 colunas | seq, IDs, produto, qtds (pedida/ativa/atendida/pendente/cancelada/cortada), valores (item/ativo/cancelado/cortado), status Nomus, produção/faturamento, doc/NF/CR, alertas |
| Reuso do `OrderToCashAuditItemsGrid` | Painel "Evidência item × documento × NF × CR" abaixo da tabela |
| 8 códigos oficiais | `ORDER_ITEM_CANCELED`, `ORDER_ITEM_CUT`, `ORDER_ITEM_STALE`, `ORDER_ITEM_STATUS_UNKNOWN`, `REPEATED_SKU_WITH_DIFFERENT_STATUS`, `ITEM_STATUS_MATCH_AMBIGUOUS`, `ORDER_ITEM_ACTIVE_PENDING`, `ORDER_ITEM_OVER_FULFILLED` |

## 7. Aba Documentos de Saída

| Caso | Resultado esperado |
|------|-------------------|
| 8 top cards | Total, Valor total, Alocado, Excedente, Qtd excedente, Produtos fora, Sem NF, Divergência de preço |
| Tabela documentos (14 colunas) + Tabela itens (19 colunas com Δ preço) | Filtro por documento na linha |
| 8 códigos oficiais | `DOCUMENT_WITH_EXCESS`, `DOCUMENT_EXTRA_ITEM`, `DOCUMENT_WITHOUT_ORDER_ITEM`, `DOCUMENT_WITHOUT_NFE`, `DOCUMENT_PRICE_MISMATCH`, `DOCUMENT_QUANTITY_MISMATCH`, `DOCUMENT_ALLOCATED_TO_CANCELED_ITEM`, `DOCUMENT_ALLOCATED_BY_HEADER_ONLY` |

## 8. Aba NF-e

| Caso | Resultado esperado |
|------|-------------------|
| 7 top cards | Total NF-e, Valor total, Atribuído ao pedido, Cabeçalho excedente, Sem CR, Maior que pedido, Item fora |
| Cabeçalho NF ≠ valor atribuído | Cards separados + tabela |
| 7 códigos oficiais | `NFE_HEADER_GREATER_THAN_ORDER`, `NFE_VALUE_GREATER_THAN_ACTIVE_ORDER`, `NFE_WITHOUT_DOCUMENT`, `NFE_WITHOUT_CR`, `NFE_EXTRA_ITEM`, `NFE_PRICE_MISMATCH`, `NFE_ALLOCATED_BY_HEADER_ONLY` |

## 9. Aba Financeiro — Títulos e Baixas

| Caso | Resultado esperado |
|------|-------------------|
| 9 top cards | Total em títulos, Total aberto, Vencido, Recebido, Parcial recebido, Qtd títulos, Próximo vencimento, Maior título, Dias em atraso (max) |
| Tabela títulos (23 colunas) + baixas (11 colunas) | CRs deduplicados por `receivableExternalId` |
| Botão "Copiar referência" + "Abrir CR" | Deep-link `/finance/accounts-receivable?search=<ref>` — `FinanceAccountsReceivableTitlesTab` lê via `useSearchParams` |
| 10 códigos oficiais | `RECEIVABLE_OPEN`, `RECEIVABLE_OVERDUE`, `RECEIVABLE_GREATER_THAN_ACTIVE_ORDER`, `RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE`, `RECEIVABLE_DUPLICATED_BY_ITEM_FACTS`, `RECEIVABLE_WITHOUT_NFE`, `RECEIVABLE_WITHOUT_DUE_DATE`, `PAYMENT_TERM_MISSING`, `RECEIPT_GREATER_THAN_RECEIVABLE`, `PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE` |

## 10. Aba Entrega / Produção / Frete

| Caso | Resultado esperado |
|------|-------------------|
| 4 seções + tabela por item (14 colunas) | Entrega consolidada, Produção e atendimento, Frete e transporte, Situação por item |
| Item cancelado / cut nunca overdue | `isItemOverdue` filtra cancelados/cut/stale |
| 7 códigos oficiais | `DELIVERY_OVERDUE_WITHOUT_DOCUMENT`, `ACTIVE_ITEM_OVERDUE_WITHOUT_NFE`, `PRODUCTION_QUANTITY_LESS_THAN_INVOICED`, `READY_BALANCE_NOT_INVOICED`, `CANCELED_ITEM_MARKED_AS_OVERDUE` (crítica), `CUT_ITEM_MARKED_AS_PENDING`, `FREIGHT_CONDITION_MISMATCH` |

## 11. Aba Margem, Preço e Custo

| Caso | Resultado esperado |
|------|-------------------|
| 11 top cards | Receita ativa, Custo, Margem R$/%, Cancelado, Cortado, Sem margem, Itens NO_MARGIN, Ignorados, Δ tabela, Δ documento, Fonte |
| Tabela 20 colunas | 5 preços comparados (pedido/tabela/doc/NF) + Δ + custos + margem + tabela |
| Reuso oficial de `calculateSalesOrderMarginsForOrders` | Source = `MARGIN_SERVICE_RECOMPUTED` |
| 10 códigos oficiais | `NO_MARGIN`, `PRICE_TABLE_NOT_FOUND`, `COST_NOT_FOUND`, `ORDER_PRICE_BELOW_TABLE`, `ORDER_PRICE_DIFFERS_FROM_DOCUMENT`, `DOCUMENT_PRICE_DIFFERS_FROM_NFE`, `NEGATIVE_MARGIN`, `CANCELED_ITEM_GENERATING_NO_MARGIN`, `STALE_ITEM_GENERATING_MARGIN`, `PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE` |

## 12. Aba Comissões

| Caso | Resultado esperado |
|------|-------------------|
| Disclaimer read-only visível | "Read-only." + fonte `CommissionOrderSnapshot` + vendedor vem do Pedido/Nomus |
| 8 top cards | Prevista, Confirmada, Liberada, Paga, Bloqueada, Base, Ignorada, Vendedor |
| Reuso oficial | Lê `CommissionOrderSnapshot` + `CommissionOrderItemSnapshot` + `CommissionReceiptLedgerLine` + `CommissionCustomerException` |
| Comissão paga NUNCA alterada | Aba read-only; alerta se `paid > release` |
| 8 códigos oficiais | `SELLER_NOT_INFORMED`, `COMMISSION_WITHOUT_SELLER`, `CANCELED_ITEM_GENERATING_COMMISSION`, `COMMISSION_RELEASED_WITHOUT_RECEIPT`, `COMMISSION_PAID_WITH_DIVERGENCE`, `CUSTOMER_COMMISSION_EXCEPTION`, `COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE`, `RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER` |

## 13. Aba Divergências e Alertas

| Caso | Resultado esperado |
|------|-------------------|
| 8 top cards | Críticas, Altas, Médias, Info, Impacto financeiro, Itens/Títulos/Documentos afetados |
| 9 chips oficiais | Todas, Críticas, Financeiras, Documentos, NF-e, Preço/margem, Comissão, Entrega, Cadastro |
| 12 colunas | Severidade, Código, Categoria, Descrição, Entidade, Referência, Impacto R$/qtd, Data, Status, Ação, Aba |
| Botão "Abrir aba" | Deep-link para aba oficial via `onOpenTab(linkedTab)` |
| 5 níveis de severidade | `critical / high / medium / info / warning` (legado) |
| Dedup canônico | `code + entityType + reference + valueImpact` |

## 14. Aba Auditoria Técnica / Evidências

| Caso | Resultado esperado |
|------|-------------------|
| 5 seções | Fontes usadas, IDs técnicos, Regras aplicadas, Raw/Evidências, Histórico |
| 14 fontes oficiais listadas | com counts + status (`loaded`/`not_found`/`not_applicable`/`error`) |
| 6 accordions raw fechados por padrão | `<details>` HTML nativo; `disabled` quando `includeRaw=false` |
| Mensagem oficial de restrição | "Raw técnico oculto. Use includeRaw=true ou permissão técnica para visualizar." |
| Permissão obrigatória `audit.raw.read` | `rawStatus.requiredPermission` exposto |
| 10 regras oficiais documentadas | `ITEM_STATUS_PER_LINE`, `CANCELED_ITEM_IGNORED`, `CUT_ITEM_ACTIVE_ONLY`, `STALE_ITEM_HISTORY_ONLY`, `DOCUMENT_ALLOCATION_BY_ITEM`, `NFE_HEADER_NEVER_INFLATES`, `OFFICIAL_RECEIVABLE_PREVAILS`, `COMMISSION_READ_ONLY`, `MARGIN_ACTIVE_ONLY`, `SELLER_FROM_ORDER_ONLY` |

## 15. Cenários PD 02339 / PD 02534 / PD 02207 (auditoria dinâmica)

### PD 02339 — CR aberto + eventual NF > pedido

| Caso | Verificação dinâmica | Resultado |
|------|---------------------|-----------|
| Auditoria abre sem erro | payload com 20 blocos | `dynamic:PD 02339:payload-shape` |
| CR aberto exibido com referência + vencimento | `receivables[].searchReference` + `dueDate` | `dynamic:PD 02339:financial-search-ref` + `financial-open-with-ref` |
| Deep-link CR válido | `/finance/accounts-receivable?search=<ref>` funcional | `financial:cr-route-consumer` |
| CRs deduplicados | `receivableExternalId` único | `dynamic:PD 02339:cr-dedup` + `financial-dedup` |
| Divergência NF > pedido dispara alerta oficial | `NFE_HEADER_GREATER_THAN_ORDER` / `NFE_VALUE_GREATER_THAN_ACTIVE_ORDER` | `dynamic:PD 02339:nfe-greater` |
| Cabeçalho NF não infla `allocatedValueToOrder` | `allocatedValueToOrder ≤ activeOrderValue` | `dynamic:PD 02339:nfe-no-inflate` |
| Documentos de saída aparecem | `payload.stockDocuments.length > 0` quando existir | `documents:testids` |
| Soma dos títulos = card "Total em títulos" | Dedup coerente | `dynamic:PD 02339:financial-card-match` |

### PD 02534 — múltiplas linhas de 309.86AA, status por linha

| Caso | Verificação dinâmica | Resultado |
|------|---------------------|-----------|
| Linhas `309.86AA` tratadas por `salesOrderItemId` | `dynamic:PD 02534:sku-per-line` conta cancelada × ativa | Não vaza cancelamento entre linhas |
| Apenas item **00080** cancelado se apenas ele estiver cancelado no Nomus | `items[].nomusIsCanceled` isolado por linha | Cobertura: `REPEATED_SKU_WITH_DIFFERENT_STATUS` (info) |
| Itens **00090/00100/00110/00120** não herdam cancelamento | `items-active-vs-canceled` (nenhum item ativo com `canceledQuantity>0`) | `dynamic:PD 02534:items-active-vs-canceled` |
| **309.86AA** não aparece faturado em documento errado | `stockDocumentItems.linkedSalesOrderItemId` deve casar SOI de mesmo SKU | `dynamic:PD 02534:doc-86AA-linkage` |
| **309.86AA** não aparece em NF que não contém o produto | `nfeItems.linkedSalesOrderItemId` só casa com SOI de mesmo SKU | `dynamic:PD 02534:nfe-86AA-linkage` |
| Saldo pendente ativo correto | Σ `activePendingQuantity` só entre ativos | `dynamic:PD 02534:canceled-not-pending` |
| Δ preço pedido × documento por linha | `priceDiffOrderVsDocumentAbs` calculado por SOI | `dynamic:PD 02534:margin-price-diff-doc` + `margin-per-line` |
| Aba Financeiro correta | CRs deduplicados, `searchReference` presente | `dynamic:PD 02534:financial-search-ref` |

### PD 02207 — 2 itens cancelados (status 6) + 2 atendidos (status 4)

| Caso | Verificação dinâmica | Resultado |
|------|---------------------|-----------|
| Status 6 → CANCELED por linha | `nomusItemStatusRaw="6"` + `nomusIsCanceled=true` | `dynamic:PD 02207:status-6-canceled` |
| Itens cancelados NÃO aparecem como pendentes | `activePendingQuantity < 0.01` para cancelados | `dynamic:PD 02207:canceled-not-pending` |
| `canceledOrderValue > 0` (2 itens cancelados) | Σ `totalNetValue` dos cancelados | `dynamic:PD 02207:canceled` |
| `pendingActiveOrderValue = 0` se ativos 100% atendidos | `fulfillmentPercentActive ≥ 99.99 → pending < 0.01` | `dynamic:PD 02207:pending` |
| Pedido NÃO é parcial por causa de cancelados | Reflete "recebido/completo com cancelamento" | `dynamic:PD 02207:not-partial` |
| Itens cancelados aparecem como **info** na aba Divergências | `severity = "info"` para `ORDER_ITEM_CANCELED` | `dynamic:PD 02207:canceled-as-info` |
| Itens cancelados NÃO geram atraso | `CANCELED_ITEM_MARKED_AS_OVERDUE` deve ser 0 | `dynamic:PD 02207:canceled-no-overdue` |

## 16. Contagem final de checks

| Grupo | Estático | Dinâmico (por PD) |
|-------|:-:|:-:|
| Infraestrutura + Rota + Tabs | 10 | 1 |
| Aba Resumo | 4 | — |
| Aba Proposta | 6 | 3 |
| Aba Pedido de Venda | 6 | 4 |
| Aba Itens | 7 | 6 |
| Aba Documentos | 7 | 4 |
| Aba NF-e | 7 | 5 |
| Aba Financeiro | 9 | 6 |
| Aba Entrega | 5 | 5 |
| Aba Margem | 6 | 5 |
| Aba Comissões | 8 | 4 |
| Aba Divergências | 9 | 4 |
| Aba Técnica | 9 | 4 |
| Contrato final + auth | 2 | 1 |
| **Total** | **95+** | **52 (por PD)** |

## 17. Bugs encontrados e corrigidos nesta rodada

1. **Falso positivo "raw payload fora da aba Técnica"** — `NfesTab` mencionava
   `rawPayload.itens` em texto de UI. Removido — texto agora diz apenas
   "payload sem itens".
2. **`SUMMARY_ALERT_CODE_ORDER` desatualizado** — códigos legados
   (`CR_VENCIDO`/`NF_MAIOR_QUE_PEDIDO`/`ITEM_CANCELADO`/etc.) removidos do
   ranking do Resumo Executivo em favor dos oficiais.
3. **`FinanceAccountsReceivableTitlesTab` não lia `?search=`** — adicionado
   `useSearchParams` do `react-router-dom` para o deep-link do CR funcionar.

Nenhum bug crítico bloqueante restante nesta rodada.

## 18. Pendências (fora do escopo deste QA)

- **QA dinâmico com banco** — rodar `DATABASE_URL=… npx tsx scripts/qaOrderFullAuditDialog.ts`
  no servidor para converter 3× WARN em OK dinâmico para as 3 PDs.
- **Permissão `audit.raw.read`** — o gate `audit.raw.read` está declarado em
  `rawStatus.requiredPermission`, mas a rota audit-full ainda **não checa** a
  permissão para bloquear `includeRaw=true` — hoje qualquer requisição com
  `?includeRaw=true` autenticada recebe raw. Adicionar guard na rota é o
  próximo passo (fora do escopo deste QA).
- **`history.auditRunUser`** — hoje `null`; a rota audit-full pode injetar o
  `req.user.id` quando a auditoria for consumida via API autenticada.
- **`lastCommissionRebuild` / `lastPortfolioReconciliationRun`** — ainda `null`;
  requer join com `CommissionClosing` e `PortfolioReconciliationRun` (futuro).

## 19. Validações rodadas

| Comando | Status |
|---------|:-:|
| `npx prisma validate` | ✅ OK |
| `npx prisma generate` | ✅ OK (sem migrations pendentes nesta rodada) |
| `npm run check:server-imports` | ✅ OK |
| `npm run check:frontend-server-imports` | ✅ 665 arquivos, sem Prisma |
| `npm run check:browser-bundle` | ✅ `dist/` livre de Prisma |
| `npm test -- --run` | ✅ 928 tests / 0 fail |
| `npm run build` | ✅ built in ~18 s |
| `npx tsx scripts/qaOrderFullAuditDialog.ts` (estático) | ✅ PASS — 92 checks |
| Dinâmico com DB (PD 02339/02534/02207) | ⚠ WARN best-effort (rodar no servidor com DB) |
