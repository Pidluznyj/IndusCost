# Plano: Motor Cost-to-Cash Trace

> **Projeto:** IndusCost / My Industry  
> **Conceito:** Produto → Custo → Preço → Venda → Comissão  
> **Data:** 2026-07-06

---

## Objetivo

Service único de rastreabilidade read-only que alimenta **scripts**, **APIs**, **telas** e **CSV**, sem cálculo paralelo no frontend e sem recalcular dados publicados sem marcar como diagnóstico.

---

## Arquitetura

```
src/lib/audit/
├── traceCommon.ts          # DTOs compartilhados (status, dataSource, CSV)
├── traceDiagnostic.ts      # severity, status, message, source
├── productCostTrace.ts     # camada pública — custo de produto
├── publishedPriceTrace.ts  # camada pública — preço publicado
├── salesOrderTrace.ts      # camada pública — venda/margem
├── commissionTrace.ts      # camada pública — comissão
├── costToCashTrace.ts      # orquestrador puro (cadeia, CSV, texto)
└── costToCashTrace.server.ts  # builders Prisma (ponto único server)
```

### Implementação subjacente (reaproveitada)

| Etapa | Service público | Implementação existente |
|-------|-----------------|-------------------------|
| Custo produto | `buildProductCostTrace` | `productCostTraceAudit.*` — custo oficial + engine engenharia |
| Preço publicado | `buildPublishedPriceTrace` | `publishedPriceSourceTrace.*` — snapshots congelados |
| Venda/margem | `buildSalesOrderTrace` | `salesOrderTraceAudit.*` — custo versionado + Nomus |
| Comissão | `buildCommissionTrace` | `commissionTraceAudit.*` — snapshots/schedules/ledger |
| Cadeia completa | `buildCostToCashTrace` | Orquestra os quatro acima |

---

## Tipos principais

| Tipo | Descrição |
|------|-----------|
| `ProductCostTrace` | Custo oficial, BOM, processo, alertas |
| `PublishedPriceTrace` | Preço congelado, custo/MP/taxa/margem/comissão na publicação |
| `SalesOrderTrace` | Pedido, itens, margem com custo oficial IndusCost |
| `CommissionTrace` | Snapshot, títulos AR, recebimentos, fechamento |
| `CostToCashTrace` | Cadeia `chain[]`, `diagnostics[]`, checklist unificado |
| `TraceDiagnostic` | `{ code, severity, status, message, source }` |

### Modo de cálculo

- **`PUBLISHED`** — snapshot/materializado (precedência)
- **`DIAGNOSTIC`** — recálculo ao vivo (ex.: engenharia sem custo oficial publicado)

---

## Scripts migrados

| Script | Service |
|--------|---------|
| `scripts/audit-product-cost-trace.ts` | `buildProductCostTrace` |
| `scripts/audit-sales-order-trace.ts` | `buildSalesOrderTrace` |
| `scripts/audit-commission-trace.ts` | `buildCommissionTrace` |

CSV continua em `tmp/` (gitignored).

---

## APIs (implementado)

| Endpoint | Permissão mínima |
|----------|------------------|
| `GET /api/audit/product-cost-trace` | `pricing.view` / `costs.view` |
| `GET /api/audit/published-price-trace` | `pricing.view` |
| `GET /api/audit/sales-order-trace` | `sales_orders.view` |
| `GET /api/audit/commission-trace` | `commissions.audit.view` |
| `GET /api/audit/cost-to-cash-trace` | qualquer permissão da cadeia |

Resposta padronizada: `{ status, summary, sections, diagnostics, warnings, errors }`.

Registro: `registerCostToCashTraceRoutes` em `server.ts`.

**Tela:** `/reports/cost-to-cash-trace` — `CostToCashTracePage` (read-only, consome `/api/audit/cost-to-cash-trace`).

---

## APIs e telas (futuro)

- **Preço publicado:** `GET /api/pricing/published-price-source-trace` — pode migrar import para `audit/publishedPriceTrace`
- **Cost-to-Cash completo:** novo endpoint `GET /api/audit/cost-to-cash-trace?orderNumber=...` reutilizando `buildCostToCashTrace`
- **Telas:** importar tipos/formatadores de `src/lib/audit/*` — nunca duplicar lógica no frontend

---

## Checklist de conformidade

1. Scripts anteriores tinham lógica duplicada? **Não mais** — scripts delegam aos services.
2. Serviços comuns extraídos? **Sim** — `traceCommon`, `traceDiagnostic`, `costToCashTrace`.
3. Produto reaproveita custo oficial? **Sim** — via `getEffectiveProductProductionCost` / engine.
4. Price trace reaproveita fonte publicada? **Sim** — `costSnapshotJson` / `formulaSnapshotJson`.
5. Sales trace reaproveita custo oficial e Nomus? **Sim** — `calculateSalesOrderMarginsForOrders`.
6. Commission trace reaproveita snapshots/schedules/ledger? **Sim** — materialização only.
7. DTOs/tipos comuns? **Sim** — `TraceDataSource`, `TraceDiagnostic`, `TraceAuditStatus`.
8. APIs futuras podem reaproveitar? **Sim** — `costToCashTrace.server.ts`.
9. CSVs podem reaproveitar? **Sim** — formatadores por etapa + `buildCostToCashTraceCsv`.
10. Testes cobrem services? **Sim** — `costToCashTrace.test.ts`.

---

## Regras de negócio preservadas

- Comissão nasce na venda → condição de pagamento distribui → recebimento libera → fechamento congela.
- `SalesOrderItem.unitCost` Nomus **não** é custo industrial — apenas diagnóstico.
- Cliente excluído → `CUSTOMER_EXCLUDED`, bruto mantido, final zerado.
- Sem schedule → `NO_SCHEDULE`, script não quebra.

---

## Testes

```bash
npm run test:cost-to-cash-trace
npm run build
npm run check:frontend-server-imports
npm run check:browser-bundle
```
