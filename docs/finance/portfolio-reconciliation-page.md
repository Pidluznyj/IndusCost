# Conciliação de Carteira — página (shell)

| Campo | Valor |
|-------|--------|
| **Rota** | `/finance/portfolio-reconciliation` |
| **Componente** | `src/components/finance/FinancePortfolioReconciliationPage.tsx` |
| **Módulo** | Financeiro → Conciliação de Carteira |

## O que a página mostra

1. **Cabeçalho** — eyebrow Financeiro · Conciliação de Carteira, título, descrição, botão **Atualizar**.
2. **Alerta informativo** — visão paralela; não altera o fluxo de caixa oficial.
3. **Meta da última run** — id, status, data/hora, modo; quando aplicável, fonte OrderToCashAudit.
4. **Abas**
   - **Status Pedidos** (`OrderStatusTab`)
   - **Auditoria Pedido → Caixa** (`OrderToCashAuditTab`)

## Filtro global legado removido (2026-07)

O card superior **Filtros** (`FinanceBiFilterPanel`) — Cliente, Ano, Mês, Pedido, Status, Confiança, Fonte da previsão, Run de conciliação, Apenas divergências/alertas, Aplicar/Limpar — foi **removido da UI**.

Motivo: redundante e confuso após a simplificação para duas abas. Cada aba já possui filtros próprios.

| Área | Filtros |
|------|---------|
| Shell da página | Nenhum filtro global |
| Status Pedidos | Filtros internos (`OrderStatusFilters`) — período, cliente, status, responsável comercial, vendedor do pedido, SKU, toggles, etc. |
| Auditoria Pedido → Caixa | Filtros internos (`OrderToCashAuditFilters`) |

## O que NÃO foi removido

- Endpoints `/api/finance/portfolio-reconciliation` e `/runs`
- Services, motors e rebuild de conciliação
- Permissões das abas ocultas (Conciliação / Inteligência) — ainda no catálogo para reuso
- Componentes das abas ocultas (reuso interno / Auditoria 360º)

A página shell passa a carregar apenas **`/api/finance/portfolio-reconciliation/runs`** para exibir a meta da run. Listagens e filtros de pedidos ficam nas abas.

## QA

```bash
npx tsx scripts/qaFinancePortfolioReconciliationPage.ts
npx tsx scripts/qaPortfolioReconciliationTabs.ts
```

## Relacionados

- `docs/finance/portfolio-order-status-tab.md`
- `docs/finance/portfolio-reconciliation-tabs-inventory.md`
- `docs/finance/order-to-cash-audit-rebuild-official.md`
