# Auditoria 360º do Pedido — modal executivo

| Campo | Valor |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Rota UI** | Financeiro → Conciliação de Carteira → Status Pedidos |
| **Trigger** | Clique numa linha da tabela de pedidos (`tr[role=button]`) |
| **Componente** | `src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx` |
| **Service (orquestrador)** | `src/lib/finance/orderFullAuditService.ts` |
| **Façade oficial recebíveis** | `src/lib/finance/orderReceivablesResolver.ts` |
| **Client contract** | `src/lib/finance/orderFullAuditClient.ts` (sem Prisma) |
| **Endpoint** | `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full` |
| **Mapa de motores oficiais** | `docs/finance/order-full-audit-official-engines-map.md` |
| **QA script** | `scripts/qaOrderFullAuditDialog.ts`, `scripts/qaOrderFullAuditOfficialEngines.ts` |
| **Checklist QA** | `docs/finance/order-full-audit-dialog-qa.md` |

## 1. Objetivo

A **Auditoria 360º do Pedido** é o modal executivo aberto ao clicar em qualquer
pedido na aba **Financeiro → Conciliação de Carteira → Status Pedidos**.
Ela consolida em **uma única janela** tudo o que existe sobre o pedido no
IndusCost: origem comercial (proposta), cabeçalho do pedido, itens, documentos
de saída, NF-e, títulos de Contas a Receber, baixas, entrega, produção e
frete, margem/preço/custo, comissão, divergências e evidência técnica.

### 1.1 Princípio: orquestradora, não motor paralelo

A Auditoria 360º é **central de leitura e cruzamento**. Ela **não é dona da
regra**. Cada aba consome o **motor oficial** correspondente (mapeamento
completo em `docs/finance/order-full-audit-official-engines-map.md`).

### 1.2 NF-e cancelada × CR (status fiscal ≠ financeiro)

Status oficial vem de `NomusNfe.status` (cancelada = **7**), normalizado por
`src/lib/finance/nfeStatus.ts` — ver `docs/finance/nfe-status-rules.md`.

- NF cancelada **aparece** nas abas NF-e, Divergências e Auditoria Técnica,
  com badge **Cancelada**.
- **Não** entra em `summary.nfeValidValue` / `summary.nfeAllocatedValue`
  (`allocatedValueToOrder` da NF cancelada = **0**).
- Gera `NFE_CANCELED_LINKED_TO_ORDER`.
- CR real permanece com status financeiro oficial (ex.: Recebido).
- Aba Financeiro mostra **Status financeiro** + **Status NF vinculada**.
- CR recebido + NF cancelada: badge e alerta
  `RECEIVED_CR_LINKED_TO_CANCELED_NFE` (não tratar como recebimento “normal”).
- Qualquer CR na NF cancelada: `CANCELED_NFE_WITH_RECEIVABLE`.
- Comissão paga **não** é alterada; aba Comissões exibe aviso de revisão.

Regras derivadas:

- **Aba Financeiro** equivale a "Contas a Receber oficial filtrado por este
  pedido" — retorna CR real (`NomusAccountsReceivable`) + Recebíveis
  planejados (`buildSalesOrderPlannedReceivables`) com dedup automático.
  Consumidores externos usam
  `orderReceivablesResolver.resolveReceivablesForSalesOrder`.
- **Aba Margem** usa `calculateSalesOrderMarginsForOrders` do motor oficial.
- **Aba Comissões** é read-only sobre o motor oficial (não recalcula).
- **Proposta** é apenas origem comercial/auditável — **não** é fonte
  financeira, fiscal ou de comissão.
- **CR real prevalece sobre planejado.** Planejado só aparece quando não há
  CR real cobrindo a parcela.

Substitui o drilldown inline "Itens do pedido selecionado" que ficava abaixo
da tabela. Agora, abaixo do grid, aparece apenas um hint:

> Selecione um pedido para abrir a **Auditoria 360º do Pedido** — proposta,
> pedido, itens, documentos, NF-e, financeiro, margem, comissões e
> divergências em um único lugar.

Os filtros / ordenação / paginação da tela principal **não** são afetados ao
abrir/fechar o modal.

## 2. Abas (12 oficiais)

Ordem de exibição na barra de tabs (`ORDER_FULL_AUDIT_TABS`):

| # | ID | Título |
|---|----|--------|
| 1 | `summary` | Resumo Executivo |
| 2 | `proposal` | Proposta / Origem Comercial |
| 3 | `salesOrder` | Pedido de Venda |
| 4 | `items` | Itens do Pedido |
| 5 | `documents` | Documentos de Saída |
| 6 | `nfes` | NF-e |
| 7 | `financial` | Financeiro (Títulos e Baixas) |
| 8 | `delivery` | Entrega / Produção / Frete |
| 9 | `marginPricing` | Margem, Preço e Custo |
| 10 | `commissions` | Comissões |
| 11 | `divergences` | Divergências e Alertas |
| 12 | `technicalAudit` | Auditoria Técnica / Evidências |

### 2.1 Resumo Executivo

- **24 KPIs** organizados em 4 seções (Identificação e status / Valores do
  pedido / Documentos, NF-e e financeiro / Comparativos).
- **Timeline** de 7 pontos: `Proposta → Pedido emitido → Documento de saída →
  NF-e → CR gerado → Vencimento → Baixa`. Cada ponto mostra data, valor
  atribuído e alerta contextual.
- **Top alertas** — até 8 divergências ranqueadas por severidade (`critical`
  → `high` → `medium` → `warning` → `info`) e categoria.

### 2.2 Proposta / Origem Comercial

- **Empty state** quando `SalesOrder.proposalId == null`: “Este pedido não
  possui proposta vinculada no IndusCost.”
- **Disclaimer read-only oficial**: “Proposta é origem comercial e auditável.
  Não substitui o Pedido de Venda como fonte oficial de faturamento,
  financeiro ou comissão.”
- **Tabela de itens** (16 colunas) com casamento linha a linha via
  `SalesOrderItem.proposalItemId` + Δ preço/qtd/total contra o pedido.
- **7 divergências oficiais**: `PROPOSAL_NOT_FOUND`,
  `PROPOSAL_ORDER_VALUE_MISMATCH`, `PROPOSAL_ITEM_NOT_CONVERTED`,
  `ORDER_ITEM_WITHOUT_PROPOSAL_ITEM`, `PROPOSAL_PRICE_MISMATCH`,
  `PROPOSAL_PAYMENT_TERM_MISMATCH`, `PROPOSAL_FREIGHT_MISMATCH`.

### 2.3 Pedido de Venda

- **8 top cards** (Valor pedido, Itens totais/ativos/cancelados/com corte/
  atendidos/pendentes ativos, % atendimento).
- **5 seções**: Identificação, Comercial, Operacional, Financeiro do pedido,
  Observações.
- **Separação oficial**: Responsável Comercial (CRM) × Vendedor Pedido
  (Nomus) × Setor / Responsável operacional. NUNCA mistura.
- **8 divergências oficiais**: `SELLER_NOT_INFORMED`,
  `COMMERCIAL_RESPONSIBLE_MISSING`, `PAYMENT_TERM_MISSING`,
  `DELIVERY_DATE_OVERDUE`, `ORDER_STATUS_UNKNOWN`, `ORDER_WITHOUT_ITEMS`,
  `ORDER_HEADER_ITEMS_TOTAL_MISMATCH`,
  `OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE`.

### 2.4 Itens do Pedido

- **12 chips** oficiais (Todos, Atendidos, Pendentes ativos, Cancelados, Com
  corte, Parcialmente atendidos, Com excedente, Produto fora do pedido, Com
  CR aberto, Recebidos, Sem documento, Divergência de preço).
- **Tabela de 31 colunas** com evidência por linha (`SalesOrderItem.id`).
- Painel **"Evidência item × documento × NF × CR"** reutiliza o
  `OrderToCashAuditItemsGrid` oficial.
- **8 divergências oficiais**: `ORDER_ITEM_CANCELED`, `ORDER_ITEM_CUT`,
  `ORDER_ITEM_STALE`, `ORDER_ITEM_STATUS_UNKNOWN`,
  `REPEATED_SKU_WITH_DIFFERENT_STATUS`, `ITEM_STATUS_MATCH_AMBIGUOUS`,
  `ORDER_ITEM_ACTIVE_PENDING`, `ORDER_ITEM_OVER_FULFILLED`.

### 2.5 Documentos de Saída

- **8 top cards** (Total documentos, Valor total, Alocado, Valor
  excedente, Qtd excedente, Produtos fora, Sem NF, Divergência de preço).
- **Tabela de documentos** (14 colunas) + **tabela de itens do documento**
  (19 colunas, com Δ preço unitária/%/impacto).
- **8 divergências oficiais**: `DOCUMENT_WITH_EXCESS`, `DOCUMENT_EXTRA_ITEM`,
  `DOCUMENT_WITHOUT_ORDER_ITEM`, `DOCUMENT_WITHOUT_NFE`,
  `DOCUMENT_PRICE_MISMATCH`, `DOCUMENT_QUANTITY_MISMATCH`,
  `DOCUMENT_ALLOCATED_TO_CANCELED_ITEM`,
  `DOCUMENT_ALLOCATED_BY_HEADER_ONLY`.

### 2.6 NF-e

- **7 top cards** (Total NF-e, Valor total, Atribuído ao pedido, Cabeçalho
  excedente, Sem CR, > pedido, Item fora).
- **Valor total ≠ valor atribuído ao pedido** — colunas separadas.
- **7 divergências oficiais**: `NFE_HEADER_GREATER_THAN_ORDER`,
  `NFE_VALUE_GREATER_THAN_ACTIVE_ORDER`, `NFE_WITHOUT_DOCUMENT`,
  `NFE_WITHOUT_CR`, `NFE_EXTRA_ITEM`, `NFE_PRICE_MISMATCH`,
  `NFE_ALLOCATED_BY_HEADER_ONLY`.

### 2.7 Financeiro (Títulos, Baixas e Recebíveis Planejados)

Duas seções lado a lado, com o **CR real prevalecendo sempre sobre o
planejado**:

**A. Títulos reais de Contas a Receber** (origem: `NomusAccountsReceivable`)
- **Tabela** — 24 colunas (Tipo · Referência · IDs · NF · Parcela · Emissão ·
  Vencimento · Competência · Valores · Status · Dias vencidos · Condição/Forma
  · Cliente/Empresa · Observação · Origem vínculo · Ações).
- **Botão Copiar referência + Abrir no Contas a Receber** — deep-link para
  `/finance/accounts-receivable?search=<ref>`.
- **Empty state** aponta para a seção de planejados quando existirem parcelas
  previstas: "Nenhum título real … Existe(m) recebível(is) planejado(s) pelo
  Pedido de Venda — ver seção abaixo".

**B. Recebíveis planejados pelo pedido** (fallback quando não há CR real)
- Origem: motor único `resolveSalesOrderListPaymentSummary`
  (`salesOrderListPaymentSchedule.ts`) — o mesmo usado pela tela Comercial >
  Pedidos de venda e pelo Fluxo de Caixa para exibir "Pedido PD XXXXX -
  Parcela N".
- **KPIs** (Total planejado, Aberto planejado, Vencido planejado, Parcelas,
  Próximo vencimento).
- **Tabela** — 15 colunas (Tipo · Referência · Documento/NF · Parcela ·
  Vencimento · Valor previsto · Aberto previsto · Recebido · Status ·
  Condição · Forma · NF emitida · Origem · Observação · Ação).
- Para cada linha: `NF emitida = Não`, `Recebido = R$ 0,00`, `Origem =
  "Pedido de Venda / Condição de pagamento"`, ação abre `/finance/accounts-receivable?search=<orderCode>`.

**Cards do topo (padrão executivo IndusCost, mesmo design system aplicado ao
relatório Comercial de Pedidos):**
Total financeiro · CR real · Planejado pelo pedido · Aberto (real +
planejado) · Total vencido (CR) · Total recebido · Parcial recebido · Próximo
vencimento · Títulos/parcelas.

**Deduplicação:** ao emitir o payload, cada parcela planejada é comparada com
os CRs reais por (dueDate ± 3 dias) + (valor ± R$ 0,01). Quando um CR real
cobre a parcela, o planejado é marcado `replacedByRealCr=true` e sai da
tabela oficial; um alerta informativo `PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR`
é emitido para auditoria do dedup.

**13 divergências oficiais**: as 10 anteriores (`RECEIVABLE_*`, `RECEIPT_*`,
`PAYMENT_TERM_MISSING`) mais três novas:
- `PLANNED_RECEIVABLE_WITHOUT_REAL_CR` (warning) — pedido tem previsão pela
  condição de pagamento mas ainda não gerou NF/CR real.
- `PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR` (critical) — parcela planejada
  já venceu e continua sem CR real emitido.
- `PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR` (info) — informativo do dedup.

**Regras oficiais preservadas:**
1. CR real do Nomus é fonte única de verdade financeira.
2. Planejado nunca altera `NomusAccountsReceivable`.
3. `receivableTotalValue` no summary continua contando **só CR real**.
4. Pedido cancelado + planejado é descartado antes de emitir alerta.
5. Alertas de planejado sempre marcam `linkedTab="financial"`.

### 2.7.1 Financeiro: CR real × Recebíveis planejados

- **CR real** vem de Contas a Receber/Nomus (tabela `NomusAccountsReceivable`
  vinculada por `sourceInvoiceId` → NF-e do pedido).
- **Recebível planejado** vem do Pedido de Venda + condição de pagamento
  (`resolveSalesOrderListPaymentSummary`).
- **CR real prevalece.** Quando existe CR real para a mesma parcela (mesmo
  valor + vencimento próximo), o planejado é ocultado da tabela oficial e
  aparece apenas na Auditoria Técnica (para consulta de auditoria).
- **Planejado não altera Contas a Receber oficial.** É apenas leitura /
  auditoria — nunca é gravado.
- **Pedido sem NF pode ter financeiro planejado.** É o caso do PD 02740: o
  Fluxo de Caixa já mostra "Pedido PD 02740 - Parcela 1 - 20/10/2026 - R$
  175.600,00" a partir da condição de pagamento; a aba Financeiro passa a
  espelhar esse mesmo forecast.
- **A aba mostra ambos separados**, com badge "Tipo" (`CR real` vs
  `Planejado pelo pedido`) e KPIs cruzados.

### 2.8 Entrega / Produção / Frete

- **4 seções**: Entrega consolidada, Produção e atendimento, Frete e
  transporte, Situação por item.
- Lead time prometido / real / atraso; previsão futura de entrega; status
  operacional consolidado.
- Frete: modalidade, transportadora, responsável, endereço, observações.
- **7 divergências oficiais**: `DELIVERY_OVERDUE_WITHOUT_DOCUMENT`,
  `ACTIVE_ITEM_OVERDUE_WITHOUT_NFE`,
  `PRODUCTION_QUANTITY_LESS_THAN_INVOICED`, `READY_BALANCE_NOT_INVOICED`,
  `CANCELED_ITEM_MARKED_AS_OVERDUE`, `CUT_ITEM_MARKED_AS_PENDING`,
  `FREIGHT_CONDITION_MISMATCH`.

### 2.9 Margem, Preço e Custo

- **11 top cards** (Receita ativa, Custo, Margem R$/%, Cancelado, Cortado,
  Sem margem, NO_MARGIN, Ignorados, Δ pedido × tabela, Δ pedido × documento,
  Fonte).
- **Tabela de 20 colunas** — 5 preços comparados (pedido / tabela oficial /
  documento / NF-e / custo) + Δ absoluta e percentual entre eles.
- Reutiliza o motor oficial `calculateSalesOrderMarginsForOrders` do
  `salesOrderMarginService.server.ts`.
- **10 divergências oficiais**: `NO_MARGIN`, `PRICE_TABLE_NOT_FOUND`,
  `COST_NOT_FOUND`, `ORDER_PRICE_BELOW_TABLE`,
  `ORDER_PRICE_DIFFERS_FROM_DOCUMENT`, `DOCUMENT_PRICE_DIFFERS_FROM_NFE`,
  `NEGATIVE_MARGIN`, `CANCELED_ITEM_GENERATING_NO_MARGIN`,
  `STALE_ITEM_GENERATING_MARGIN`, `PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE`.

### 2.10 Comissões

- **Read-only**. Disclaimer oficial exibido no topo:
  *“Read-only. Esta aba mostra apenas o snapshot oficial da comissão.
  Comissão paga nunca é alterada aqui. Vendedor comissionável vem do Pedido
  de Venda/Nomus.”*
- **8 top cards** (Prevista, Confirmada, Liberada, Paga, Bloqueada, Base,
  Ignorada, Vendedor comissionável).
- Reutiliza `CommissionOrderSnapshot` + `CommissionOrderItemSnapshot` +
  `CommissionReceivableSchedule` + `CommissionReceiptLedgerLine` +
  `CommissionCustomerException` — sem recompute local.
- **8 divergências oficiais**: `SELLER_NOT_INFORMED`,
  `COMMISSION_WITHOUT_SELLER`, `CANCELED_ITEM_GENERATING_COMMISSION`,
  `COMMISSION_RELEASED_WITHOUT_RECEIPT`, `COMMISSION_PAID_WITH_DIVERGENCE`,
  `CUSTOMER_COMMISSION_EXCEPTION`,
  `COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE`,
  `RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER`.

### 2.11 Divergências e Alertas

- **Central de auditoria**. Consolida os alertas de todas as outras 11 abas.
- **8 top cards**: Críticas, Altas, Médias, Info, Impacto financeiro, Itens
  afetados, Títulos afetados, Documentos afetados.
- **9 filtros** (Todas, Críticas, Financeiras, Documentos, NF-e,
  Preço/margem, Comissão, Entrega, Cadastro).
- **Tabela de 12 colunas** — cada divergência tem código, categoria,
  descrição, entidade afetada, referência, impacto R$/qtd, data, status,
  ação recomendada e **atalho para a aba oficial** (`linkedTab`).
- **Deduplicação canônica**: chave `code + entityType + reference +
  valueImpact` — nunca a mesma divergência aparece duas vezes.
- **5 níveis de severidade**: `critical / high / medium / warning / info`.
- **13 categorias** oficiais: Comercial, Pedido, Item, Documento saída, NF-e,
  Financeiro/CR, Recebimento/Baixa, Entrega, Frete, Margem/Preço, Comissão,
  Integração/Nomus, Cadastro.

### 2.12 Auditoria Técnica / Evidências

- **5 seções**: Fontes usadas, IDs técnicos, Regras aplicadas, Raw
  controlado, Histórico.
- **14 fontes oficiais** listadas com counts + status: `SalesOrder`,
  `SalesOrderItem`, `Proposal`, `ProposalItem`, `NomusStockDocument`,
  `NomusStockDocumentItem`, `NomusNfe`, `NomusAccountsReceivable`,
  `Receipts/Baixas`, `OrderToCashAuditFact`, `PortfolioReconciliationFact`,
  `CommissionOrderSnapshot`, `CommissionReceiptLedgerLine`,
  `PriceTable / PriceTableItem`, `Customer / CrmCustomerCommercialOwner`.
- **10 regras aplicadas** documentadas em código (documentação viva).
- **6 accordions raw** — `<details>` HTML nativo, **fechados por padrão**.
- **Raw controlado**: `includeRaw=false` → `rawPayloads` **não vai** no JSON
  serializado; a UI mostra "Raw técnico oculto. Use includeRaw=true ou
  permissão técnica para visualizar." (permissão oficial:
  `audit.raw.read`).
- **Histórico**: última sync SalesOrder/NF-e/documento/CR, rebuild OrderToCash,
  conciliação de carteira, rebuild de comissão, usuário/processo/commit.

## 3. Origem oficial dos dados

| Bloco do payload | Fonte oficial | Regra |
|---|---|---|
| `summary` | `SalesOrder` + `SalesOrderItem` + `NomusAccountsReceivable` dedup | agregação read-only |
| `salesOrder` | `SalesOrder` + `nomusRawResponse` (best-effort) | cabeçalho oficial |
| `proposal` | `Proposal` + `ProposalItem` + `SalesOrderItem.proposalItemId` | só se `SalesOrder.proposalId != null` |
| `items` | `SalesOrderItem` (com flags Nomus) | grão linha, nunca por SKU |
| `stockDocuments` / `stockDocumentItems` | `NomusStockDocument` + itens do rawJson | dedup por `stockDocumentExternalId` |
| `nfes` / `nfeItems` | `NomusNfe` + `SalesOrderNfeLink` + itens do rawPayload | dedup por `nfeExternalId` |
| `receivables` / `receipts` | `NomusAccountsReceivable` via `sourceInvoiceId` | dedup por `receivableExternalId` |
| `marginPricing` | `calculateSalesOrderMarginsForOrders` (motor oficial) | recompute a partir de itens ativos |
| `commissions` | `CommissionOrderSnapshot.ACTIVE` + itens + schedules + ledger | **read-only**; nunca recomputado |
| `technicalAudit` | run atual + agregações `syncedAt` + rawPayloads (opt-in) | `includeRaw=true` obrigatório |
| Responsável comercial | `CrmCustomerCommercialOwner` | nunca é setor operacional |

## 4. Regras oficiais do payload

### 4.1 Status por LINHA do pedido (nunca por SKU)

Cada `SalesOrderItem.id` mantém status próprio. SKU repetido em múltiplas
linhas **não** herda cancelamento/atendimento entre linhas. Verificado por:

- `REPEATED_SKU_WITH_DIFFERENT_STATUS` (info) quando um SKU aparece com
  status distintos entre linhas.
- Casamento fact→SOI prioritário via `OrderToCashAuditFact.salesOrderItemId`;
  fallback por produto externo **só** quando o SKU é único no pedido.

**Cenário canônico:** PD 02534 — SKU `309.86AA` em múltiplas linhas. Se
apenas a linha 00080 está cancelada, as demais (00090/00100/00110/00120)
**não** herdam o cancelamento.

### 4.2 Item cancelado / cortado / stale

| Flag | Origem | Efeito |
|---|---|---|
| `nomusIsCanceled` | status Nomus `6` normalizado para `CANCELED` | ignorado em pendente, margem, comissão, forecast |
| `nomusIsCut` | `FULFILLED_WITH_CUT` | saldo cortado NÃO gera pendência infinita; parte atendida entra em margem/comissão |
| `nomusIsStale` | item local que sumiu do último payload Nomus | mantido só para histórico; nunca ativo |

Invariantes verificados em runtime:

- `CANCELED_ITEM_MARKED_AS_OVERDUE` (crítico)
- `CANCELED_ITEM_GENERATING_NO_MARGIN` (crítico)
- `CANCELED_ITEM_GENERATING_COMMISSION` (crítico)
- `STALE_ITEM_GENERATING_MARGIN` (média)
- `CUT_ITEM_MARKED_AS_PENDING` (média)

**Cenário canônico:** PD 02207 — 2 itens `status=6` (cancelados) + 2 itens
`status=4` (atendidos). O pedido aparece como **"completo/recebido com
cancelamento"**, nunca parcial; `pendingActiveOrderValue = 0` quando ativos
100% atendidos.

### 4.3 Comparação preço pedido × documento × NF

Casamento por **linha do pedido** (via `linkedSalesOrderItemId`), nunca por
SKU. Três Δs oficiais:

1. **Δ pedido × tabela** — `orderUnitPrice - officialTableUnitPrice` (obtido
   via `SalesOrderMarginCommercialReference`).
2. **Δ pedido × documento** — `documentUnitPrice - orderUnitPrice` (via
   `stockDocumentItems.linkedSalesOrderItemId`).
3. **Δ documento × NF** — `nfeUnitPrice - documentUnitPrice` (via
   `nfeItems.linkedSalesOrderItemId`).

Impactos financeiros: `Δ × activeQuantity`.
Divergências: `ORDER_PRICE_BELOW_TABLE`, `ORDER_PRICE_DIFFERS_FROM_DOCUMENT`,
`DOCUMENT_PRICE_DIFFERS_FROM_NFE`, `PROPOSAL_PRICE_MISMATCH`.

### 4.4 NF × pedido

- **Cabeçalho NF nunca infla a carteira**. `NomusNfe.valorTotal` e
  `NomusNfe.allocatedValueToOrder` são grandezas separadas.
- Quando `valorTotal > activeOrderValue`, dispara
  `NFE_HEADER_GREATER_THAN_ORDER` e/ou `NFE_VALUE_GREATER_THAN_ACTIVE_ORDER`
  (alta) — a NF continua aparecendo, apenas com alerta.
- NF sem CR → `NFE_WITHOUT_CR` (média).
- NF sem documento de saída → `NFE_WITHOUT_DOCUMENT` (média).
- Item de NF fora do pedido → `NFE_EXTRA_ITEM` (alta).

### 4.5 CR real × forecast

- **CR real prevalece**. `NomusAccountsReceivable` é a única fonte de
  receita realizada.
- A Auditoria 360º **não** gera forecast de CR local.
- CRs deduplicados por `receivableExternalId` — mesmo CR referenciado por
  múltiplos facts item×NF dispara `RECEIVABLE_DUPLICATED_BY_ITEM_FACTS`
  (info, confirmatório) mas aparece **uma única vez** na tabela.
- CR oficial nunca é alterado pela auditoria (service read-only).
- Baixas em `CommissionReceiptLedgerLine` são lidas mas nunca gravadas.

### 4.6 Comissão

- **Fonte oficial única**: `CommissionOrderSnapshot.ACTIVE`. Nada é
  recomputado localmente.
- **Vendedor comissionável = `SalesOrder.nomusSellerName`** (via seller
  resolver → `CommissionPerson.canonicalName`). **NUNCA** é o
  `CrmCustomerCommercialOwner` (Responsável Comercial).
- **Comissão paga nunca é alterada.** Quando `paidCommissionAmount >
  releasedCommissionAmount`, dispara `COMMISSION_PAID_WITH_DIVERGENCE`
  (crítico) — investigar duplicidade sem tocar no valor.
- **Item cancelado/cut/stale não gera comissão.** Se o snapshot antigo tiver
  comissão sobre cancelado, `CANCELED_ITEM_GENERATING_COMMISSION` (crítico).
- **Exceções de cliente** — `CommissionCustomerException` ativa dispara
  `CUSTOMER_COMMISSION_EXCEPTION` (info).

### 4.7 Proposta como origem comercial (nunca fonte financeira)

- **Proposta é auditável, não é fonte oficial** de faturamento, financeiro
  ou comissão.
- A aba Proposta traz disclaimer visível no topo.
- `buildSummary` continua usando `NomusAccountsReceivable` deduplicado para
  todos os valores oficiais (verificado por
  `qa:proposal:no-financial-impact`).
- Comparativos Proposta × Pedido geram divergências (`PROPOSAL_*`) para
  auditoria — nunca alteram totais financeiros.

## 5. Estados de UI

| Estado | Texto oficial |
|---|---|
| Loading | "Carregando auditoria 360º do pedido..." |
| Erro | "Não foi possível carregar a auditoria do pedido." |
| Sem dados | "Pedido não encontrado." |
| Sem proposta | "Este pedido não possui proposta vinculada no IndusCost." |
| Raw restrito | "Raw técnico oculto. Use includeRaw=true ou permissão técnica para visualizar." |

## 6. Permissões

- Rota audit-full protegida por `auth.requireAppAuth` +
  `auth.requirePermission("FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS")`
  (mesma guarda do grid Status Pedidos).
- Raw payloads técnicos: `?includeRaw=true` opt-in — `rawStatus.included`
  sempre exposto para transparência; `rawStatus.requiredPermission =
  "audit.raw.read"` reservado para futuro guard por permissão.

## 7. Scripts e diagnóstico

```bash
# QA estático + dinâmico best-effort
npx tsx scripts/qaOrderFullAuditDialog.ts

# Inspects individuais (requerem DATABASE_URL real)
npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts
npx tsx tmp-audits/inspect-order-full-audit-pd02534.ts
npx tsx tmp-audits/inspect-order-full-audit-pd02207.ts

# Inventário do contrato (estrutura + backend)
npx tsx scripts/qaOrderFullAuditInventory.ts
```

## 8. Documentos relacionados

- `docs/finance/order-full-audit-dialog-qa.md` — checklist oficial de QA com
  todos os casos por aba e por PD.
- `docs/finance/order-full-audit-inventory.md` — inventário técnico das
  fontes e do contrato.
- `docs/finance/portfolio-order-status-tab.md` — aba Status Pedidos que
  hospeda o modal.
- `docs/finance/order-to-cash-audit-item-evidence-rules.md` — regras de
  evidência item × doc × NF × CR (fonte do bloco Itens).
- `docs/sales/sales-order-item-status-rules.md` — status por linha
  (cancelado/cut/stale) e impacto financeiro/comissão.
