# Funil de Vendas — relatório de implementação

## Diagnóstico da aba anterior

| Aspecto | Situação anterior |
|---------|-------------------|
| Componente | `SalesFunnelPanel.tsx` (~700 linhas) |
| Endpoint | `GET /api/proposals` |
| Fonte | Propostas (`Proposal`) |
| KPIs | Pipeline aberto, valor ponderado, conversão proposta ganha/perdida |
| Cálculos | Majoritariamente no frontend (filtros, métricas, gráficos) |
| Formatação | `formatCurrency` / `formatNumber` de `utils.ts` (precisão variável) |
| UX | Filtros extensos, tabela analítica gigante como elemento principal |
| Problema de negócio | Propostas ainda não são base confiável do comercial |

**Decisão:** substituir fonte por **Pedidos de Venda** via `GET /api/dashboard/executive-summary?year=YYYY` → `tabs.salesFunnel`.

---

## Nova arquitetura

### Backend

- `salesFunnelDashboardRules.ts` — regras puras testáveis
- `salesFunnelDashboardMetrics.ts` — agregações SQL (`SalesOrder`, NF processada)
- Orquestração em `executiveDashboardService.ts`

### Frontend

- `SalesFunnelPanel.tsx` reescrito — consome payload executivo
- Ano compartilhado com Visão Executiva (`DashboardModule` → `executiveYear`)

---

## Regras de negócio

| Conceito | Regra |
|----------|-------|
| Emissão | `SalesOrder.issueDate` no ano selecionado |
| Valor | `SalesOrder.totalNetValue` |
| Válido | `status != CANCELLED` |
| Faturado | NF com `dataProcessamento` |
| Carteira aberta | válido + sem NF |
| Atrasado | emitido no ano + entrega vencida + sem NF + não cancelado |
| Cancelado | `status = CANCELLED` no ano |

Os pedidos atrasados são limitados ao ano selecionado no dashboard. Para 2026, somente pedidos emitidos em 2026 entram no indicador.

---

## Layout entregue

1. **Topo** — título, subtítulo, filtro de ano, Atualizar, link pedidos, última atualização
2. **Cards executivos** — emitidos, faturados, carteira, atrasados, cancelados, ticket, conversão, backlog
3. **Pipeline operacional** — barras proporcionais por etapa (não linear)
4. **Gráficos** — evolução mensal emitido/faturado; barras por status; conversão mensal
5. **Tabelas** — top 10 clientes em carteira; pedidos críticos (atrasados + abertos antigos)

---

## Formatação

Usa `executiveDashboardFormatters.ts` — moeda 2 casas, compacto em cards, percentuais 1–2 casas, inteiros sem decimais.

---

## Pendências documentadas

- **Evolução mensal de carteira/atraso:** exige snapshot histórico por mês — não implementado; campos `openPortfolioValue` / `overdueValue` retornam `null`.
- **Filtro por cliente/vendedor:** não implementado (evitar nova regra sem fonte consolidada).
- **Funil linear perfeito:** pipeline é operacional; etapas se sobrepõem (atrasados ⊆ carteira).

---

## Testes

`npm run test:dashboard` inclui `salesFunnelDashboardRules.test.ts`.

---

## Arquivos

**Novos:** `salesFunnelDashboardRules.ts`, `salesFunnelDashboardMetrics.ts`, `salesFunnelDashboardRules.test.ts`, este doc.

**Alterados:** `executiveDashboardTypes.ts`, `executiveDashboardService.ts`, `SalesFunnelPanel.tsx`, `DashboardModule.tsx`, `package.json`.

**Preservados:** `salesFunnel.ts` (utilitários de propostas usados em CRM/Propostas — não removido).
