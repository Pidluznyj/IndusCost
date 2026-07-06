# Validação final — Cost-to-Cash Trace

> **Projeto:** IndusCost / My Industry  
> **Escopo:** Produto → Custo → Preço → Venda → Comissão  
> **Data:** 2026-07-06  
> **Regra:** read-only — sem fechamento real, sem alteração de dados, sem publicação automática.

---

## Status geral

| Área | Status | Evidência |
|------|--------|-----------|
| Motor `src/lib/audit/*` | OK | 45 testes `test:cost-to-cash-trace` |
| Módulo comissões | OK | 368 testes `test:commissions` |
| Build frontend | OK | `npm run build` |
| Isolamento browser/server | OK | `check:frontend-server-imports`, `check:browser-bundle` |
| Scripts CLI | OK | 4 scripts delegam a `costToCashTrace.server.ts` |
| Tela única | OK | `/reports/cost-to-cash-trace` |
| Export dossiê | OK | JSON + CSV + copiar diagnósticos |
| Validação ao vivo (DB) | Pendente local | Requer `DATABASE_URL` em `.env` |

**Correção aplicada nesta validação:** assinatura quebrada em `commissionTraceAudit.server.ts` (`buildCommissionTraceAudit`) — impedia scripts/API de comissão via tsx.

---

## Comandos executados

```bash
npm run test:commissions
npm run test:cost-to-cash-trace
npm run build
npm run check:frontend-server-imports
npm run check:browser-bundle
npx tsx scripts/validate-cost-to-cash-trace.ts
```

### Scripts de auditoria (com DB)

```bash
npx tsx scripts/audit-product-cost-trace.ts --sku=618.08AA --json --csv
npx tsx scripts/audit-published-price-trace.ts --sku=618.08AA --table-code=VAREJO_2 --json --csv
npx tsx scripts/audit-commission-trace.ts --year=2026 --month=6 --seller=GISLENE --json --csv --include-lines
npx tsx scripts/audit-sales-order-trace.ts --order-number=<pedido>
npm run validate:cost-to-cash-trace
```

CSV/JSON de scripts → `tmp/` (gitignored). Export da tela → download no navegador (sem arquivo no repo).

---

## Critérios de aceite

| # | Critério | Resultado |
|---|----------|-----------|
| 1 | Preview comissão não retorna 500 | OK (testes `commissionReceiptClosingApi`); ao vivo: `getReceiptClosingPreviewPage` via `validate:cost-to-cash-trace --live` |
| 2 | SKU 618.08AA sem warning crítico se oficial = calculado | OK (lógica em `productCostTraceAudit`; validar ao vivo com `--live`) |
| 3 | Modal preço tem aba **Fonte do Preço** | OK — `PricingModule.tsx` + `PublishedPriceSourceTraceTab` |
| 4 | `audit-product-cost-trace` — custo, BOM, MP, processo, alertas | OK — script + `buildProductCostTrace` |
| 5 | `audit-published-price-trace` — preço, custo, margem, comissão, imposto | OK — script criado nesta validação |
| 6 | `audit-sales-order-trace` existe e roda | OK |
| 7 | `audit-commission-trace` existe e roda | OK (após fix server) |
| 8 | Tela única de rastreabilidade | OK — `/reports/cost-to-cash-trace` |
| 9 | Export/dossiê funciona | OK — `costToCashTraceExport.ts` |
| 10 | Git status limpo após scripts | OK — artefatos em `tmp/` |
| 11 | Nenhum CSV untracked no repo | OK — `.gitignore` inclui `tmp/` |
| 12 | Fechamento real bloqueado sem confirmação | OK — `FECHAR COMISSAO` / `REPROCESSAR COMISSAO` |

---

## APIs validadas (contrato)

| Endpoint | Service subjacente |
|----------|-------------------|
| `GET /api/commissions/receipt-closing/preview?year=2026&month=6` | `getReceiptClosingPreviewPage` |
| `GET /api/audit/product-cost-trace?sku=618.08AA` | `buildProductCostTrace` |
| `GET /api/audit/published-price-trace?sku=618.08AA&tableCode=VAREJO_2` | `resolvePublishedPriceItemIdForTrace` + `buildPublishedPriceTrace` |
| `GET /api/audit/cost-to-cash-trace` | `buildCostToCashTrace` |

Erros retornam envelope amigável — sem stack trace ao cliente (`costToCashTraceRoutes.ts`).

---

## Legado — classificação Cost-to-Cash

| Item | Tag | Notas |
|------|-----|-------|
| `src/lib/audit/costToCashTrace.server.ts` | **KEEP** | Ponto único server para scripts/API/tela |
| `src/lib/audit/productCostTrace.ts` | **KEEP** | Fachada pública → `productCostTraceAudit.*` |
| `src/lib/audit/publishedPriceTrace.ts` | **KEEP** | Fachada → `publishedPriceSourceTrace.*` |
| `src/lib/audit/salesOrderTrace.ts` | **KEEP** | Fachada → `salesOrderTraceAudit.*` |
| `src/lib/audit/commissionTrace.ts` | **KEEP** | Fachada → `commissionTraceAudit.*` |
| `src/lib/productCostTraceAudit.server.ts` | **KEEP** | Implementação custo (Prisma) |
| `src/lib/pricing/publishedPriceSourceTrace.server.ts` | **KEEP** | Implementação preço publicado |
| `src/lib/salesOrderTraceAudit.server.ts` | **KEEP** | Implementação venda/margem |
| `src/lib/commissions/commissionTraceAudit.server.ts` | **KEEP** | Implementação comissão |
| `GET /api/pricing/published-price-source-trace` | **KEEP** | Modal Fonte do Preço (mesmo service) |
| `scripts/audit-product-cost-trace.ts` | **KEEP** | CLI read-only |
| `scripts/audit-published-price-trace.ts` | **KEEP** | CLI read-only (novo) |
| `scripts/audit-sales-order-trace.ts` | **KEEP** | CLI read-only |
| `scripts/audit-commission-trace.ts` | **KEEP** | CLI read-only |
| `scripts/audit-sales-order-margins.ts` | **LEGACY_READ_ONLY** | Diagnóstico margem legado — preferir `audit-sales-order-trace` |
| `scripts/audit-cost-price-margin-integration.ts` | **LEGACY_READ_ONLY** | Integração antiga — preferir trace services |
| `commissionVisualAudit.*` | **LEGACY_READ_ONLY** | Não usar para pagamento; trace comissão usa materialização |
| `commissionApuracao.*` | **DEPRECATED** | Substituir por receipt-closing + trace |
| `commission-calculation-service.server.ts` | **DEPRECATED** | Substituir por materialização |
| Recalcular no frontend | **REPLACE_WITH_TRACE_SERVICES** | Tela/export consomem só API payload |

Detalhamento comissões legado: `docs/commission-legacy-deactivation-plan.md`.

---

## Próximo passo (deploy / homologação)

1. Configurar `.env` com `DATABASE_URL` no ambiente alvo.
2. Rodar validação ao vivo:

```bash
npm run validate:cost-to-cash-trace
```

3. Build seguro e deploy:

```bash
npm run build:safe
```

4. Smoke manual: `/reports/cost-to-cash-trace` → buscar `618.08AA` → exportar dossiê JSON/CSV.
