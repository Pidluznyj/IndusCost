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
- Drawer: resumo do pedido (item a item fica na Auditoria Pedido → Caixa)

## UI (padrão executivo)

| Bloco | Comportamento |
|-------|----------------|
| Header | Eyebrow + título + badge “Uma linha por pedido” + banner curto |
| Cards principais | Título uppercase, valor grande (qtd), valor/R$ secundário, `%`, ícone no canto, tooltip `?`, estado ativo com anel + chip |
| Drilldowns | Segunda linha menor, scroll horizontal, contexto claro |
| Tabela | Cabeçalho sticky, sort com seta, monetário à direita, badges pequenas, `—` para vazio, scroll horizontal |
| Drawer | Largura `max-w-xl`, resumo + mini-cards, mapa de atendimento, abas Resumo / Valores / Alertas com severidade |

## Componentes

- `OrderStatusTab.tsx`
- `OrderStatusFilters.tsx` / `OrderStatusActiveFilterBar.tsx`
- `OrderStatusPrimaryCards.tsx` / `OrderStatusDrilldownCards.tsx`
- `OrderStatusTable.tsx` / `OrderStatusDrawer.tsx`
- Helpers visuais: `orderStatusUi.tsx`
- Client: `src/lib/finance/portfolioOrderStatusClient.ts`
- Service: `src/lib/finance/portfolioOrderStatusService.ts`

## Documentos relacionados

- `docs/finance/portfolio-order-status-tab-plan.md` — contrato técnico
- `docs/finance/portfolio-order-status-tab-qa-report.md` — relatório QA

## Critérios de polimento

- Visual limpo para diretoria
- Clique em card/drilldown filtra a tabela sem recalcular no frontend
- Mensagens em português claro (sem JSON / `undefined` / `null` / `NaN`)
- Sem regressão nas abas Conciliação, Inteligência e Auditoria
