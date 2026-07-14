# Detalhe do Pedido de Venda — modal + PDF

Este documento descreve o **botão "Detalhe"** da tela **Comercial → Pedidos
de venda**, o modal executivo que ele abre, o componente compartilhado que
alimenta a visualização e o PDF/impressão, e os motores oficiais consumidos.

## 1. Comportamento

1. Usuário está em **Comercial → Pedidos de venda** com filtros aplicados
   (cliente, vendedor, período, status, busca).
2. Clique no botão **"Detalhe"** na linha do pedido (ou em **"Abrir detalhe
   completo"** dentro do drawer resumo).
3. Modal grande (quase fullscreen) abre **in-place** — a rota e os filtros
   da lista permanecem intactos.
4. Modal chama `GET /api/sales-orders/:salesOrderId/detail` e renderiza o
   componente `SalesOrderDetailView` com o DTO oficial.
5. Fechar (Esc / botão X / clique fora) volta à mesma posição e filtros.

**Alternativa**: continua funcionando a rota tradicional
`/sales-orders/:id` (fallback página cheia usada por links diretos). Ambas
consomem o mesmo endpoint `/detail`.

## 2. Arquitetura

```
Comercial > Pedidos de venda
  └── SalesOrderListTable (botão Detalhe)
       └── openDetail(orderId, orderCode)   ← preserva filtros (state local)
            └── SalesOrderDetailDialog       ← modal portalizado
                 └── SalesOrderDetailView    ← componente compartilhado
                      ↑ recebe payload oficial
                      └── (mesmo componente pode ser reusado pelo PDF/print)
```

## 3. Contrato oficial

- **Endpoint**: `GET /api/sales-orders/:salesOrderId/detail`
- **Guard**: `sales_orders.detail.view` OR `sales_orders.view`.
- **Payload**: `SalesOrderDetailPayload` — `src/lib/sales-orders/salesOrderDetailClient.ts`.

Blocos do payload:

| Bloco | Fonte oficial |
|---|---|
| `header` | `SalesOrder` (Prisma) + `salesOrderNomusSellerDisplay.buildSalesOrderNomusSellerDto` + `crmCustomerCommercialOwner.loadManualCommercialOwnersForCustomers` + `salesOrderListBillingStatus.resolveSalesOrderBillingStatus` |
| `summary` | Cards executivos (valores originais/ativo/cancelado/faturado/saldo + margem + status faturamento + última NF) |
| `items` | `SalesOrderItem` + `nomusSalesOrderItemStatus.parseNomusSalesOrderItemStatusFromRawItem` + margens por linha |
| `invoices` | `salesOrderLinkedNfe.loadSalesOrderLinkedNfeContextMap` |
| `stockDocuments` | `NomusStockDocument` (via `getOrderFullAudit`) |
| `financial` | **CR real**: `NomusAccountsReceivable`. **Planejado**: `buildSalesOrderPlannedReceivables` → `resolveSalesOrderListPaymentSummary`. **Baixas**: derivadas dos CRs oficiais. |
| `pricingMargin` | `salesOrderMarginService.calculateSalesOrderMarginsForOrders` |
| `alerts` | Divergências oficiais (`RECEIVABLE_*`, `PLANNED_RECEIVABLE_*`, `NFE_*`, `DOCUMENT_*`, `ORDER_ITEM_*`, `SELLER_*`, `COMMERCIAL_RESPONSIBLE_MISSING`). |
| `technicalInfo` | Lista de motores oficiais + tabelas consultadas + runId. |

## 4. Regra oficial (imutável)

1. **Pedido de Venda é fonte oficial** (SalesOrder + SalesOrderItem).
2. **Proposta não é fonte oficial** — apenas origem comercial auditável.
3. **Responsável Comercial** vem do **CRM/carteira do cliente**
   (`CrmCustomerCommercialOwner`); **nunca** aceita FATURAMENTO/FINANCEIRO
   (guardado por `OPERATIONAL_SECTOR_KEYWORDS` no service).
4. **Vendedor do Pedido** vem do **Nomus/SalesOrder.externalSellerId**.
5. **Faturamento** vem exclusivamente da **NF vinculada oficial**
   (`loadSalesOrderLinkedNfeContextMap`). CR planejado sem NF **não** conta
   como faturado.
6. **CR real / planejado**: CR real (`NomusAccountsReceivable`) prevalece
   sobre planejado; planejado só aparece quando não há CR real cobrindo a
   parcela.
7. **Margem** vem do motor oficial `calculateSalesOrderMarginsForOrders`.
   Item cancelado / cortado / stale **não** gera NO_MARGIN.
8. **Item cancelado** aparece como cancelado, **não** como pendente.
9. **Item com corte** encerra pendência, não gera pendência infinita.
10. **Status do item é por linha** (`salesOrderItemId`), **não por SKU**.
    Mesmo SKU pode ter status diferente em linhas diferentes.

## 5. UI — o que o usuário vê

### Cabeçalho fixo (topo do modal)

- Título: **Detalhe do Pedido — PD XXXXX**
- Subtítulo: **Pedido de Venda Nomus · Cliente · Data de emissão**
- Badges: **Status de faturamento** (Faturado / Parcial / Não faturado /
  Cancelado) + **Status operacional** (Enviado ao Nomus / Rascunho / …)
- Ações: **Copiar** (número do pedido) · **Imprimir / PDF** (window.print
  no mesmo componente) · **Auditoria 360º** · **CR** (deep-link para Contas
  a Receber filtrado) · **Fechar**

### Seções (rolagem interna)

1. **Cabeçalho comercial** — 12 campos (cliente, CNPJ, empresa, vendedor,
   responsável comercial, responsável operacional, emissão, entrega,
   ID Nomus, condição/forma de pagamento, frete).
2. **Resumo executivo** — 10 KPI cards com tons executivos (verde ativo,
   amarelo saldo, vermelho cancelado, azul faturado).
3. **Itens do pedido** — tabela de 17 colunas (sequência, SKU, produto,
   qtd pedida/atendida/pendente/cancelada, status, preço unit., valor
   total, valor ativo, custo unit., margem R$/%, entrega, NF vinculada).
4. **Faturamento** — NF-e vinculadas + Documentos de saída com valor
   atribuído × valor total (dedup de cabeçalho).
5. **Financeiro** — Contas a Receber real + Recebíveis planejados pelo
   pedido em uma única tabela (coluna "Origem" com badge CR real ×
   Planejado pelo pedido). KPIs consolidados: CR real total/aberto/
   recebido, Planejado total, Próximo vencimento.
6. **Margem, preço e custo** — 9 KPI cards (valor vendido, valor ativo,
   custo total, margem R$/%, itens sem margem, itens ignorados, Δ
   pedido × tabela, Δ pedido × documento). Fonte:
   `calculateSalesOrderMarginsForOrders`.
7. **Alertas e divergências** — códigos oficiais com severidade, título,
   descrição, ação sugerida e impacto financeiro.
8. **Observações** (se existir).

### Rodapé

- Data/hora de emissão + assinatura institucional.

## 6. Diferença entre resumo e detalhe

| Aspecto | Ver resumo | Detalhe |
|---|---|---|
| UI | Drawer lateral estreito | Modal grande quase fullscreen |
| Endpoint | `/api/sales-orders/:id/intelligence` | `/api/sales-orders/:id/detail` |
| Escopo | KPIs rápidos + últimos alertas | Cabeçalho + 10 KPIs + itens + NF/docs + Financeiro (real + planejado) + Margem + Alertas |
| Impressão | Não | Sim (mesmo componente vai para PDF) |
| Preserva filtros? | Sim | Sim (portalizado) |

## 7. Relação com PDF/impressão

O componente `SalesOrderDetailView` renderiza o mesmo layout tanto na
modal quanto no PDF (via `window.print()`). O CSS
`sales-order-detail-view.css` usa a paleta institucional já aplicada no
Relatório Comercial > Pedidos de Venda (`sales-order-report-print.css`) —
Lazarios Koppetel.

Botão **"Imprimir / PDF"** na modal:
1. adiciona `body.sales-order-detail-print-route`;
2. imprime apenas `#sales-order-detail-print-root` (conteúdo do detalhe);
3. esconde `#root` e a barra de ações do modal (`so-detail-no-print`).

Isso é obrigatório porque `reports-print.css` usa `body * { visibility: hidden }`
e só libera roots explícitos — sem o root/whitelist a folha sai em branco.
CSS dedicado: `src/components/sales/sales-order-detail-print.css`.

(A rota `/sales-orders/:id/print` continua sendo o documento cliente A4
separado — `SalesOrderPrintView` / `SalesOrderClientDocument`.)

## 8. Como o botão Detalhe passou a funcionar

- **Antes**: `onOpenDetail={(orderId) => navigate(\`/sales-orders/${orderId}\`)}`
  → navegação para página cheia (sai da lista, perde filtros/paginação).
- **Depois**: `onOpenDetail={(orderId) => openDetail(orderId, orderCode)}`
  → abre `<SalesOrderDetailDialog>` in-place. A rota
  `/sales-orders/:id` continua funcionando para links diretos (usa o
  mesmo endpoint `/detail`).

## 9. QA

- **Estático + fixture**: `npx tsx scripts/qaSalesOrderDetailView.ts`.
- **Diagnóstico live** (com `DATABASE_URL`):
  `npx tsx tmp-audits/inspect-sales-order-detail-view.ts`.
- Casos cobertos:
  - PD 02740 — planejado sem NF (R$ 175.600 · 20/10/2026).
  - PD 02739 — companheiro.
  - PD 02534 — status por linha (SKU repetido).
  - PD 02207 — cancelados não pendentes.

## 10. Documentos relacionados

- `docs/finance/order-full-audit-official-engines-map.md` — mapa geral
  aba × motor oficial da Auditoria 360º.
- `docs/finance/order-full-audit-dialog.md` — modal Auditoria 360º.
- `docs/sales/sales-order-item-status-rules.md` — regras de status do
  item.
- `docs/sales/sales-order-reports.md` — relatório da lista Comercial.
