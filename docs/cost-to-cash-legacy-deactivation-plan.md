# Plano de desativação — legado Cost-to-Cash

> **Projeto:** IndusCost / My Industry  
> **Data:** 2026-07-06  
> **Status:** mapeamento — **nenhum código removido** nesta etapa.  
> **Regra:** não remover código sem aprovação explícita.

---

## Fontes oficiais (pós-rastreabilidade)

| Domínio | Fonte oficial | API / CLI / Tela |
|---------|---------------|------------------|
| **Custo de produto** | Versão **PUBLISHED** de `ProductionCostTable` vigente na data de referência | `buildProductCostTrace` → `GET /api/audit/product-cost-trace`, `audit-product-cost-trace.ts` |
| **Preço comercial publicado** | `PriceTableItem` congelado (`costSnapshotJson`, `formulaSnapshotJson`, `frozenTotalCost`) | `buildPublishedPriceTrace` → `GET /api/audit/published-price-trace`, modal **Fonte do Preço**, `audit-published-price-trace.ts` |
| **Margem / venda** | Custo oficial IndusCost versionado por data do pedido + valores Nomus | `buildSalesOrderTrace` → `GET /api/audit/sales-order-trace`, `audit-sales-order-trace.ts` |
| **Comissão (pagamento)** | Materialização (`CommissionOrderSnapshot` + `CommissionReceivableSchedule`) → preview/fechamento por recebimento → `CommissionReceiptLedgerLine` | `GET /api/commissions/receipt-closing/preview`, `apply-commission-receipt-closing.ts` |
| **Comissão (rastreio “por quê”)** | Snapshots + schedules + ledger materializados (read-only) | `buildCommissionTrace` → `GET /api/audit/commission-trace`, `audit-commission-trace.ts` |
| **Rastreabilidade end-to-end** | Orquestrador único read-only | `buildCostToCashTrace` → `GET /api/audit/cost-to-cash-trace`, `/reports/cost-to-cash-trace`, export dossiê |

**Modos de cálculo na trace:**

- `PUBLISHED` — snapshot/materializado (precedência)
- `DIAGNOSTIC` — recálculo ao vivo, sempre marcado como diagnóstico

**Aviso padrão em scripts legados críticos:**

```
LEGACY MODE — não usar como fonte oficial de pagamento/preço/custo.
```

Implementado em `scripts/commission-audit-args.ts` (`warnTraceLegacyMode`) e `scripts/commission-script-utils.ts` (`warnCommissionLegacyMode`).

---

## Classificações

| Tag | Significado |
|-----|-------------|
| **KEEP** | Ativo na arquitetura nova ou master data / ops necessário |
| **LEGACY_READ_ONLY** | Consulta/diagnóstico histórico; não usar para decisão oficial |
| **DEPRECATED** | Não usar em novas telas/relatórios; substituir |
| **REPLACE_WITH_TRACE_SERVICES** | Migrar consumidores para `src/lib/audit/*` |
| **CANDIDATE_REMOVE_LATER** | Remover após cutover completo e validação |

---

## 1. Scripts antigos de custo

| Script | Tag | Substituir por |
|--------|-----|----------------|
| `audit-product-cost-trace.ts` | **KEEP** | — (já no motor trace) |
| `audit-production-cost-component-coverage.ts` | **KEEP** | Métrica batch de cobertura |
| `audit-production-cost-material-table-link.ts` | **KEEP** | Hygiene MP ↔ custo produção |
| `audit-material-cost-versioning.ts` | **KEEP** | Upstream MP versionada |
| `audit-component-performance-cost-impact.ts` | **KEEP** | What-if performance (usa live engine) |
| `audit-sales-order-cost-semantics.ts` | **KEEP** | Scan estático de semântica `unitCost` |
| `audit-cost-center-*.ts` (5 scripts) | **KEEP** | Domínio financeiro CC/AP (fora trace produto) |
| `audit-production-cost-versioning.ts` | **LEGACY_READ_ONLY** | Cobertura de versões publicadas |
| `audit-production-cost-publication-flow.ts` | **LEGACY_READ_ONLY** | Fluxo de publicação (workflow) |
| `audit-sales-order-unit-cost-snapshot.ts` | **LEGACY_READ_ONLY** | Campo Nomus `unitCost` ≠ custo industrial |
| `audit-sales-margin-cost-coverage.ts` | **LEGACY_READ_ONLY** | Batch cobertura margem |
| `audit-production-cost-snapshot.ts` | **REPLACE_WITH_TRACE_SERVICES** | `audit-product-cost-trace.ts` |
| `audit-production-cost-engineering-snapshot.ts` | **REPLACE_WITH_TRACE_SERVICES** | `buildProductCostTrace` (DIAGNOSTIC) |
| `audit-sales-order-effective-cost.ts` | **REPLACE_WITH_TRACE_SERVICES** | `audit-sales-order-trace.ts` |
| `audit-cost-price-margin-integration.ts` | **REPLACE_WITH_TRACE_SERVICES** | `buildCostToCashTrace` (item); batch TBD |
| `bootstrap-production-cost-table-from-engineering.ts` | **DEPRECATED** | Mutation/bootstrap ops |

---

## 2. Scripts antigos de preço

| Script | Tag | Substituir por |
|--------|-----|----------------|
| `audit-published-price-trace.ts` | **KEEP** | — (já no motor trace) |
| `audit-commercial-price-grid.ts` | **KEEP** | Integridade grid vs frozen items (complementar) |
| `audit-cost-price-margin-integration.ts` | **REPLACE_WITH_TRACE_SERVICES** | Ver seção custo |

---

## 3. Scripts antigos de comissão

| Script | Tag | Substituir por |
|--------|-----|----------------|
| `audit-commission-trace.ts` | **KEEP** | — (motor trace) |
| `materialize-commission-order.ts` | **KEEP** | Escreve snapshots que trace lê |
| `rebuild-commission-materialization.ts` | **KEEP** | Rebuild massivo materialização |
| `apply-commission-receipt-closing.ts` | **KEEP** | Fechamento oficial (ledger) |
| `preview-commission-receipt.ts` | **KEEP** | Preview receipt engine (ops) |
| `validate-commission-receipt-closing.ts` | **KEEP** | Validação novo vs legado |
| `audit-commission-readiness.ts` | **KEEP** | Prontidão de dados |
| `audit-commission-links.ts` | **KEEP** | Hygiene pedido→NF→AR |
| `audit-commission-missing-links.ts` | **KEEP** | Hygiene cadeia |
| `audit-commission-seller-identity.ts` | **KEEP** | Identidade vendedor |
| `audit-commission-customer-exclusion.ts` | **KEEP** | Exclusões |
| `audit-commission-monthly-payable.ts` | **KEEP** | Rollup PAYABLE oficial |
| `audit-commission-receivables-timeline.ts` | **KEEP** | Timeline AR |
| `audit-commission-apuracao-nomus-comparison.ts` | **KEEP** | Reconciliação externa Nomus |
| `reconcile-ar-vs-commission.ts` | **KEEP** | Ponte AR × comissão |
| `compare-commission-with-nomus-export.ts` | **KEEP** | Diff arquivo Nomus |
| `export-commission-june-comparison.ts` | **KEEP** | Export comparativo |
| `commission-script-utils.ts`, `commission-audit-args.ts` | **KEEP** | Infra CLI |
| `audit-commission-visual-summary.ts` | **LEGACY_READ_ONLY** | Paridade cards auditoria visual |
| `audit-commission-financial-release.ts` | **LEGACY_READ_ONLY** | `CommissionRecord` legado |
| `audit-commission-june-readiness.ts` | **LEGACY_READ_ONLY** | Readiness via records legados |
| `audit-commission-rules-coverage.ts` | **LEGACY_READ_ONLY** | Preview legado de regras |
| `validate-commission-receipt-closing.ts` (`--recalc-fallback`) | **LEGACY_READ_ONLY** | Ramo fallback legado |
| `recalculate-commissions.ts` | **DEPRECATED** | Materialização + receipt-closing |
| `audit-commission-apuracao.ts` | **DEPRECATED** | `audit-commission-trace.ts` + receipt-closing |
| `reconcile-commission-release-amounts.ts` | **DEPRECATED** | Rebuild schedules materializados |
| `dedupe-commission-persons.ts` | **CANDIDATE_REMOVE_LATER** | Hygiene one-time |

Comissões legado detalhado: `docs/commission-legacy-deactivation-plan.md`.

---

## 4. Services que recalculam onde deveriam ler snapshot

| Service | Tag | Notas |
|---------|-----|-------|
| `costToCashTrace.server.ts` + implementações `*TraceAudit.server.ts` | **KEEP** | Read-only; fonte trace |
| `publishedPriceSourceTrace.server.ts` | **KEEP** | Lê snapshots congelados |
| `commercialPublishedPrices.server.ts` | **KEEP** | Grid read-only frozen |
| `productionCostTables.server.ts` → `getEffectiveProductProductionCost` | **KEEP** | Resolve versão **publicada** (não live BOM) |
| `productEngineeringCostSnapshot.server.ts` | **KEEP** | Live CIU — só DIAGNOSTIC / engenharia |
| `productCostAnalysisEngine.server.ts` | **KEEP** | Engine engenharia (não é fonte oficial) |
| `salesOrderMarginResolver.ts` (`RECALCULATED_CURRENT_COST`) | **REPLACE_WITH_TRACE_SERVICES** | Fallback live quando falta versão |
| `costPriceMarginIntegratedAudit.server.ts` | **REPLACE_WITH_TRACE_SERVICES** | Batch integrado legado |
| `priceTablePublication.server.ts` (gerar DRAFT) | **KEEP** | Mutation pré-publicação |
| `commissionOrderMaterializer.server.ts` | **KEEP** | Calcula **e persiste** snapshot |
| `commissionReceiptEngine.server.ts` | **KEEP** | Preview live; prefere schedule materializado |
| `commissionTraceAudit.server.ts` | **KEEP** | Read-only materializado |
| `commission-calculation-service.server.ts` | **DEPRECATED** | `calculateCommissions` → `CommissionRecord` |
| `commission-preview-calculation.server.ts` | **DEPRECATED** | Preview legado |
| `commissionVisualAudit.server.ts` | **LEGACY_READ_ONLY** | PAYABLE via CPS legado |
| `commissionApuracao.server.ts` | **DEPRECATED** | Eixo `confirmedAt` |
| `commissionReceivableForecast.server.ts` | **REPLACE_WITH_TRACE_SERVICES** | Ainda lê visual audit |
| `commissionReportSource.server.ts` (ramo legacy) | **LEGACY_READ_ONLY** | Resolver `auto→legacy` |
| `commissionCustomerExclusionReprocess.server.ts` | **LEGACY_READ_ONLY** | Reprocessa records legados |

---

## 5. Componentes que exibem custo sem fonte explícita

| Componente | Tag | Risco / ação |
|------------|-----|--------------|
| `CostToCashTracePage` / `CostToCashTraceSections` | **KEEP** | Exibe `dataSources`, chain, diagnostics |
| `PublishedPriceSourceTraceTab` | **KEEP** | Fonte do preço com versões congeladas |
| `PricingModule` (aba Fonte do Preço) | **KEEP** | Consome `published-price-source-trace` |
| `CostPriceMarginAuditPanel` | **REPLACE_WITH_TRACE_SERVICES** | Painel integrado legado (`/api/cost-price-margin/audit`) |
| `SalesOrderManagementMarginOverview` | **LEGACY_READ_ONLY** | Margem agregada — verificar `costSource` por item |
| `CommissionsVisualAuditPage` | **LEGACY_READ_ONLY** | Auditoria visual CPS; não é pagamento oficial |
| `CommissionsReceiptClosingPage` | **KEEP** | Fonte oficial pagamento |
| `ProjectCostSimulation` / `ProjectStructureLineModal` | **KEEP** | Domínio projetos (simulação, não custo oficial produto) |
| `MaterialDemandPlannedRealizedPanel` | **LEGACY_READ_ONLY** | `unitCost` MP planejado — contexto MRP |

---

## 6. Endpoints que retornam número sem versão

| Endpoint | Tag | Substituir / enriquecer |
|----------|-----|------------------------|
| `GET /api/audit/product-cost-trace` | **KEEP** | Inclui `officialVersion`, `costBreakdown.source` |
| `GET /api/audit/published-price-trace` | **KEEP** | Snapshots + revisões MP/custo |
| `GET /api/audit/sales-order-trace` | **KEEP** | `costSource` por item |
| `GET /api/audit/commission-trace` | **KEEP** | Snapshot + schedule + ledger |
| `GET /api/audit/cost-to-cash-trace` | **KEEP** | Cadeia completa |
| `GET /api/pricing/published-price-source-trace` | **KEEP** | Modal Fonte do Preço |
| `GET /api/cost-price-margin/audit` | **REPLACE_WITH_TRACE_SERVICES** | Batch legado sem trace por item |
| `POST /api/commissions/recalculate` | **DEPRECATED** | Materialização + receipt-closing |
| `GET /api/commissions/visual-audit/*` | **LEGACY_READ_ONLY** | CPS legado |
| `GET /api/commissions/apuracao/*` | **DEPRECATED** | Apuração legado |
| `GET /api/price-tables/:tableId/products/:productId/published-price` | **KEEP** | Preço modal (enriquecer link trace) |

---

## 7. CSVs antigos

| Origem | Tag | Destino preferido |
|--------|-----|------------------|
| Scripts `audit-*-trace.ts` → `tmp/` | **KEEP** | Gitignored; mesma fonte trace |
| Export dossiê tela (browser download) | **KEEP** | Payload API sem recalcular |
| `audit-cost-price-margin-integration.ts` CSV | **REPLACE_WITH_TRACE_SERVICES** | Dossiê cost-to-cash |
| `audit-commission-apuracao.ts` CSV | **DEPRECATED** | `audit-commission-trace.ts --csv` |
| `recalculate-commissions.ts` export | **DEPRECATED** | Receipt-closing export |
| `commissionVisualAudit` export CSV | **LEGACY_READ_ONLY** | Receipt-closing / trace |
| `export-commission-june-comparison.ts` | **KEEP** | Reconciliação Nomus (externa) |

---

## 8. Testes antigos que validam fluxo legado

| Teste | Tag | Notas |
|-------|-----|-------|
| `costToCashTrace.test.ts` | **KEEP** | Motor trace |
| `costToCashTraceDossier.test.ts` | **KEEP** | Export |
| `commissionTraceAudit.test.ts` | **KEEP** | Trace comissão |
| `productCostTraceAudit.test.ts` | **KEEP** | Trace custo |
| `publishedPriceSourceTrace.test.ts` | **KEEP** | Trace preço |
| `salesOrderTraceAudit.test.ts` | **KEEP** | Trace venda |
| `commissionReceiptClosing*.test.ts` | **KEEP** | Fechamento oficial |
| `commissionApuracao.test.ts` | **DEPRECATED** | Manter até cutover |
| `commissionVisualAudit.test.ts` | **LEGACY_READ_ONLY** | UI legado |
| `costPriceMarginIntegratedAudit.test.ts` | **REPLACE_WITH_TRACE_SERVICES** | Batch integrado |
| `commissionE2eValidation.test.ts` | **LEGACY_READ_ONLY** | Fluxo CPS |
| `commissionOutOfTable.test.ts` (via apuracao) | **LEGACY_READ_ONLY** | Regras tier legado |

---

## 9. Funções duplicadas

| Duplicação | Tag | Consolidar em |
|------------|-----|---------------|
| Margem pedido: `audit-sales-order-effective-cost` vs `buildSalesOrderTrace` | **REPLACE_WITH_TRACE_SERVICES** | `salesOrderTraceAudit.server.ts` |
| Custo produto: `audit-production-cost-snapshot` vs `buildProductCostTrace` | **REPLACE_WITH_TRACE_SERVICES** | `productCostTraceAudit.server.ts` |
| Preço fonte: modal API vs `buildPublishedPriceTrace` | **KEEP** | Mesmo `publishedPriceSourceTrace.server.ts` |
| Comissão: `audit-commission-apuracao` vs `buildCommissionTrace` | **DEPRECATED** | `commissionTraceAudit.server.ts` |
| CSV builders espalhados vs `costToCashTraceDossier` | **KEEP** | Dossiê usa payload API; scripts usam builders por etapa |
| `warnCommissionLegacyMode` vs `warnTraceLegacyMode` | **KEEP** | Mensagem unificada em `commission-audit-args.ts` |
| Payable mensal: visual audit vs ledger-first | **DEPRECATED** (ramo visual) | `commissionMonthlyPayable.server.ts` ledger |

---

## 10. Riscos de remoção

| Risco | Severidade | Mitigação |
|-------|------------|-----------|
| Remover `recalculate-commissions.ts` antes do cutover materialização | **Alta** | Validar `rebuild-commission-materialization` + receipt-closing em prod |
| Remover `commissionVisualAudit` enquanto dashboard/forecast dependem | **Alta** | Migrar `commissionReceivableForecast` para schedules |
| Remover `GET /api/cost-price-margin/audit` com painel ativo | **Média** | Migrar `CostPriceMarginAuditPanel` para trace |
| Remover fallback `RECALCULATED_CURRENT_COST` em margem | **Média** | Garantir cobertura 100% custo publicado por SKU/data |
| Remover scripts CC/AP (`audit-cost-center-*`) | **Baixa** | Fora do escopo produto; domínio financeiro separado |
| Confundir `SalesOrderItem.unitCost` (Nomus) com custo industrial | **Alta** | Manter `audit-sales-order-cost-semantics.ts`; trace marca `costSource` |
| Export legado usado em reconciliação Nomus | **Média** | Manter scripts de comparação externa (**KEEP**) |

---

## Roadmap sugerido (sem remoção imediata)

1. **Fase A — Desvio de tráfego:** telas novas e exports usam apenas `/api/audit/*` e receipt-closing.
2. **Fase B — Deprecation banners:** APIs legadas retornam header/warning `X-Legacy-Source`.
3. **Fase C — Cutover comissão:** desativar `POST /api/commissions/recalculate` após 2 ciclos fechados em ledger.
4. **Fase D — Remoção candidata:** `audit-commission-apuracao`, `recalculate-commissions`, ramo visual em payable.
5. **Fase E — Limpeza testes:** remover suites DEPRECATED após 1 release estável.

---

## Documentos relacionados

- `docs/cost-to-cash-trace-plan.md` — arquitetura motor trace
- `docs/cost-to-cash-trace-validation.md` — checklist de validação
- `docs/commission-legacy-deactivation-plan.md` — legado comissões detalhado
- `docs/pricing-published-price-source-trace-plan.md` — aba Fonte do Preço
