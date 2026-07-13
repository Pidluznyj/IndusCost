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

## Drilldown item a item do pedido

1. Usuário filtra (ex.: card **Parciais**) e vê pedidos na tabela.
2. Clique em uma linha (ex.: **PD 02207**) seleciona o pedido.
3. Abaixo da tabela abre **Itens do pedido selecionado**.
4. O painel chama `GET /api/finance/portfolio-reconciliation/order-to-cash-audit?orderCode=…&year=…&runId=…` (mesma API da Auditoria).
5. Chips filtram o grid no cliente (sem recalcular).
6. Botão **Resumo do pedido** abre o drawer lateral.

Regras de exibição (herdadas da Auditoria):

- `ORDER_ITEM_PENDING`: documento/NF/valor cobrado = `—` (não parece faturado).
- `ORDER_ITEM_CANCELED`: item cancelado/stale no PV — sem forecast/alerta de entrega; chip “Itens cancelados”.
- `DOCUMENT_EXTRA_ITEM`: produto/documento fora do pedido.
- CR total título: coluna com label claro; **não** é valor do item.
- Caso **PD 02534 / 309.86AA**: permanece PENDING sem NF 7228 no item.

Componente compartilhado: `OrderToCashAuditItemsGrid.tsx` (Auditoria + Status Pedidos).

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

Fonte do status: `SalesOrderItem.nomusIsCanceled` / `nomusItemStatusNormalized` (persistidos no sync Nomus) e fallback `SalesOrder.nomusRawResponse` via `enrichFactsWithOrderItemStatus`. Ver também `docs/sales/sales-order-item-nomus-status-sync.md` e `docs/sales/sales-order-item-status-impact-audit.md`.

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
