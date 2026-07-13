# Status Pedidos — Conciliação de Carteira

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → Conciliação de Carteira → **Status Pedidos** |
| **Endpoint** | `GET /api/finance/portfolio-reconciliation/order-status` |
| **QA** | `npm run qa:portfolio-order-status` |
| **Atualizado** | 2026-07-13 |

## Objetivo

Visão executiva **por pedido de venda**: atendimento, CR, alertas e ação recomendada.  
Backend consolida; frontend só exibe. Sem Prisma no browser.

## Grão

- Cards contam **pedidos distintos**
- Tabela: **uma linha por pedido**
- Painel abaixo: **itens/evidências** do pedido selecionado (mesma origem da Auditoria)
- Drawer opcional: resumo executivo do pedido

## UI (padrão executivo)

| Bloco | Comportamento |
|-------|----------------|
| Header | Eyebrow + título + badge “Uma linha por pedido” + banner curto |
| Cards principais | Título uppercase, valor grande (qtd), valor/R$ secundário, `%`, ícone no canto, tooltip `?`, estado ativo com anel + chip |
| Drilldowns | Segunda linha menor, scroll horizontal, contexto claro |
| Tabela | Cabeçalho sticky, sort com seta, monetário à direita, badges pequenas, `—` para vazio, scroll horizontal |
| **Itens do pedido** | Painel abaixo da tabela; chips atendido/pendente/excedente/fora/CR/recebido; grid compartilhado |
| Drawer | Largura `max-w-xl`, resumo + mini-cards, mapa de atendimento, abas Resumo / Valores / Alertas |

## Auditoria completa do pedido (modal)

1. Usuário filtra (ex.: card **Parciais**) e vê pedidos na tabela.
2. Clique em uma linha (ex.: **PD 02207**) abre o modal **Auditoria completa — PD 02207**.
3. O modal chama `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`.
4. 7 abas: Resumo · Itens · Financeiro · Documentos · NF-e · Entrega/Frete · Alertas.
5. Fechar (Esc / clique fora / botão) volta à mesma posição/filtro da tabela.

O painel embutido antigo **Itens do pedido selecionado** foi removido — abaixo da tabela existe apenas um hint textual que aponta para o modal.

Detalhes das abas e regras oficiais em [`order-full-audit-dialog.md`](./order-full-audit-dialog.md).

### Regras de exibição por linha (herdadas da Auditoria Pedido → Caixa)

- `ORDER_ITEM_PENDING`: documento/NF/valor cobrado = `—` (não parece faturado).
- `ORDER_ITEM_CANCELED`: item cancelado/stale no PV — sem forecast/alerta de entrega; chip “Itens cancelados”.
- `ORDER_ITEM_CUT`: item atendido com corte — saldo cortado encerra pendência.
- `DOCUMENT_EXTRA_ITEM`: produto/documento fora do pedido.
- CR total título: coluna com label claro; **não** é valor do item.
- Caso **PD 02534 / 309.86AA**: cinco linhas do mesmo SKU, cada uma com status próprio (por linha, não por SKU).

Componente compartilhado: `OrderToCashAuditItemsGrid.tsx` (Auditoria + aba Itens do modal).

## Tratamento de itens cancelados

Item cancelado no Nomus (status Cancelado / quantidade cancelada ≥ pedida) **aparece** no detalhe item a item, com status visual **Cancelado**.

Regras:

1. **Aparece no detalhe** — chip “Itens cancelados”; observação “Item cancelado no Pedido de Venda/Nomus”.
2. **Não conta como pendente** — `pendingActiveItemsCount` / card Parciais ignoram cancelados.
3. **Não compõe saldo pendente ativo** — `pendingActiveOrderValue` só de itens ativos.
4. **Não reduz o % atendido dos itens ativos** — `fulfillmentPercentActive = alocado / activeOrderValue`.
5. **Compõe** `canceledOrderValue`, `canceledItemsCount`, card/drilldown **Com cancelamento**.
6. **Status do pedido**: se todos os itens ativos foram atendidos e há cancelados → `RECEBIDO_COM_CANCELAMENTO` ou `COMPLETO_COM_CANCELAMENTO` (não parcial).
7. **Parcial só** quando existe item ativo com saldo pendente real (`PARCIAL_*` / `PARCIAL_COM_CANCELAMENTO`).
8. **Forecast / comissão / margem**: cancelado/stale fora do valor ativo (ver `docs/sales/sales-order-item-status-rules.md`).

Caso **PD 02207**: 2 itens atendidos + 2 cancelados → 100% dos ativos, saldo ativo R$ 0, status recebido/completo com cancelamento — **não** cai no card Parciais.

Fonte do status: `SalesOrderItem.nomusIsCanceled` / `nomusIsCut` / `nomusItemStatusNormalized` (persistidos no sync Nomus) e fallback `SalesOrder.nomusRawResponse` via `enrichFactsWithOrderItemStatus`. **Casamento é sempre por LINHA do item**, nunca por SKU. Ver também `docs/sales/sales-order-item-status-rules.md`, `docs/sales/sales-order-item-nomus-status-sync.md` e `docs/sales/sales-order-item-status-impact-audit.md`.

### Responsável Comercial × Vendedor Pedido × Responsável Operacional

Três conceitos distintos — não podem se confundir na UI:

| Campo | Origem oficial | Uso |
|-------|----------------|-----|
| **Responsável Comercial** | `CrmCustomerCommercialOwner` (carteira do cliente no CRM) — via `loadManualCommercialOwnersForCustomers` | Gestão comercial, filtros de carteira. Nunca gera comissão sozinho. |
| **Vendedor Pedido** | `SalesOrder.externalSellerId` + `SalesOrder.nomusSellerName` (Nomus) — refletido em `fact.sellerName` | Fonte oficial da **comissão** do pedido. |
| **Setor / Responsável operacional** | `fact.responsibleArea` (montado no builder da Auditoria Pedido → Caixa: `COMERCIAL`, `FINANCEIRO`, `FATURAMENTO`, `EXPEDIÇÃO`) — espelha `SalesOrder.responsible` | Só para roteamento operacional / ação recomendada. **Nunca** aparece como Responsável Comercial. |

Ordem de resolução no service (aggregator):

1. `commercialResponsibleName` só é preenchido a partir de `fact.commercialResponsibleName` (injetado pelo loader Prisma via CRM).
2. `orderSellerName` vem de `fact.sellerName` (Nomus).
3. `operationalResponsibleArea` vem de `fact.responsibleArea` (setor).

Se o cliente não tem responsável comercial cadastrado no CRM, a UI exibe **"Sem responsável comercial"** (helper `orderStatusCommercialResponsibleLabel`). Se o pedido Nomus não tem vendedor, a coluna **"Vendedor Pedido"** mostra **"Sem vendedor informado"** (helper `orderStatusOrderSellerLabel`). Nunca reaproveitar um campo para tapar o buraco do outro.

### Atendido com corte

Item com status `FULFILLED_WITH_CUT` encerra o saldo cortado — separado de cancelado direto:

- não conta como pendente
- não entra em forecast/recebível planejado
- não gera comissão nem `NO_MARGIN`
- `cutOrderValue` acumulado ao lado de `canceledOrderValue`
- `activeOrderValue = originalOrderValue − canceledOrderValue − cutOrderValue`

## Componentes

- `OrderStatusTab.tsx`
- `OrderStatusFilters.tsx` / `OrderStatusActiveFilterBar.tsx`
- `OrderStatusPrimaryCards.tsx` / `OrderStatusDrilldownCards.tsx`
- `OrderStatusTable.tsx` / `OrderStatusDrawer.tsx`
- `OrderStatusSelectedOrderItemsPanel.tsx`
- `OrderToCashAuditItemsGrid.tsx` / `OrderToCashAuditTable.tsx`
- Helpers: `orderStatusUi.tsx`, `orderToCashAuditItemsUi.ts`
- Client: `src/lib/finance/portfolioOrderStatusClient.ts`
- Service: `src/lib/finance/portfolioOrderStatusService.ts`

## Documentos relacionados

- `docs/finance/portfolio-order-status-tab-plan.md` — contrato técnico
- `docs/finance/portfolio-order-status-tab-qa-report.md` — relatório QA

## Critérios de polimento

- Visual limpo para diretoria
- Clique em card/drilldown filtra a tabela sem recalcular no frontend
- Clique no pedido abre itens sem sair da aba
- Mensagens em português claro (sem JSON / `undefined` / `null` / `NaN`)
- Sem regressão nas abas Conciliação, Inteligência e Auditoria
