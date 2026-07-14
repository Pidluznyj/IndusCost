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

## Auditoria 360º do Pedido (modal)

1. Usuário filtra (ex.: card **Parciais**) e vê pedidos na tabela.
2. Clique em uma linha (ex.: **PD 02207**) — com cursor pointer e tooltip
   **"Abrir auditoria 360º do pedido"** — abre o modal
   **Auditoria 360º — PD 02207**.
3. O modal chama `GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full`.
4. **12 abas oficiais**: Resumo Executivo · Proposta / Origem Comercial ·
   Pedido de Venda · Itens do Pedido · Documentos de Saída · NF-e ·
   Financeiro (Títulos e Baixas) · Entrega / Produção / Frete · Margem,
   Preço e Custo · Comissões · Divergências e Alertas · Auditoria Técnica /
   Evidências.
5. Fechar (Esc / clique fora / botão) volta à mesma posição/filtro da tabela.

O painel embutido antigo **Itens do pedido selecionado** foi removido — abaixo
da tabela existe apenas um hint textual que aponta para o modal:

> Selecione um pedido para abrir a **Auditoria 360º do Pedido** — proposta,
> pedido, itens, documentos, NF-e, financeiro, margem, comissões e
> divergências em um único lugar.

Detalhes das abas, regras oficiais, códigos de divergência e cenários PD 02339 /
PD 02534 / PD 02207 em [`order-full-audit-dialog.md`](./order-full-audit-dialog.md).
Checklist de QA em [`order-full-audit-dialog-qa.md`](./order-full-audit-dialog-qa.md).

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

---

## Simplificação das abas da Conciliação de Carteira (2026-07)

A tela **Financeiro → Conciliação de Carteira** foi simplificada. A partir
desta versão, a navegação visual mostra **somente duas abas**:

1. **Status Pedidos** — visão consolidada **por pedido** (esta doc).
2. **Auditoria Pedido → Caixa** — visão detalhada **item/evidência**.

As abas **Conciliação** e **Inteligência da Carteira** foram **ocultadas** da
UI. Elas continuam **cadastradas** em `PORTFOLIO_RECONCILIATION_UI_TABS`
(`src/lib/permissionsClient.ts`), com suas permissões
(`FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO`,
`FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA`) e endpoints ativos, porque os
services são reaproveitados por:

- Auditoria 360º do Pedido (modal)
- Cards de resumo executivo
- Scripts de rebuild / diagnóstico (`rebuildPortfolioReconciliationFacts`,
  auditorias)
- Trilhas de dados vindas do módulo Comercial (dashboards CRM, portfolio
  intelligence de terceiros)

### Whitelist canônica de abas visíveis

Fonte da verdade: `PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS` em
`src/lib/permissionsClient.ts` — tupla `readonly` com a ordem canônica:

```ts
export const PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS = [
  "order-status-pedidos",
  "order-to-cash-audit",
] as const;
```

O helper `isPortfolioReconciliationVisibleTabId(id)` recebe qualquer string
(state antigo, query param, deep-link, localStorage) e retorna `true`
apenas se estiver na whitelist. A UI consulta esse helper no `useEffect` de
sincronização e força o fallback → primeira aba visível permitida.

### Fallback de estado antigo

Qualquer valor de `activeView` fora da whitelist é redirecionado para a
primeira aba visível permitida (default: `order-status-pedidos`). Ids
tratados como estado legado incluem:

- `conciliation` (aba removida)
- `intelligence` (aba removida)
- `portfolio`, `carteira`, `reconciliation`, `old-tab` (nomes históricos
  vindos de scripts/QA antigos, deep-links de e-mails, bookmarks)

Como o `useState` inicial já resolve para `visibleTabs[0]` e o `useEffect`
força correção sempre que `visibleTabs` muda, o pior caso é **um render
inicial com o valor errado, seguido de correção automática no mesmo tick**
— nenhuma aba oculta é montada nem tem chance de disparar `fetch`.

### Endpoints e services (não removidos)

Nenhum endpoint, service ou modelo Prisma foi removido:

- `/api/finance/portfolio-reconciliation` (JSON — usado pelo painel de
  filtros para popular customers/runs/statuses/confidenceLevels)
- `/api/finance/portfolio-reconciliation/runs` (lista de runs)
- `/api/finance/portfolio-intelligence/*` (Inteligência da Carteira — usado
  por dashboards externos ao módulo, mas não mais renderizado aqui)
- `PortfolioReconciliationRun` / `PortfolioReconciliationFact`
  (materialização) — usados por scripts de rebuild e pela Auditoria 360º

### QA

Rode `npx tsx scripts/qaPortfolioReconciliationTabs.ts` para validar as
9 asserções obrigatórias:

1. Whitelist canônica declarada em `permissionsClient.ts` (só Status Pedidos + Auditoria Pedido → Caixa)
2. Aba default é Status Pedidos
3. Estado antigo `conciliation` cai no fallback
4. Estado antigo `intelligence` cai no fallback
5. `OrderStatusTab` continua sendo montado
6. `OrderToCashAuditTab` continua sendo montado
7. Painel superior de filtros continua renderizado
8. Nenhum JSX residual das abas ocultas (`<PortfolioIntelligenceSection>`, `<PortfolioReconciliationOrdersTable>`, `activeView === "conciliation"`, etc.)
9. Frontend não importa `@prisma/client`

Sair com `exit code 0` = liberação para deploy.
