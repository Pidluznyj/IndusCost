# Plano de inativação — código legado de comissões

**Projeto:** IndusCost / My Industry  
**Data:** 2026-07-06  
**Status:** mapeamento — **nenhum código removido** nesta etapa.

## Fonte oficial (nova arquitetura)

```
Pedido/NF → CommissionOrderSnapshot (+ itens)
         → CommissionReceivableSchedule (rateio por CR)
         → commissionReceiptEngine (prévia por settlementDate)
         → CommissionMonthlyClosing (RECEIPT_BASED, CLOSED)
         → CommissionReceiptLedgerLine
```

**UI oficial:** `/commissions` → Fechamento por recebimento (`CommissionsReceiptClosingPage`)  
**API oficial:** `/api/commissions/receipt-closing/*`  
**Scripts operacionais:** `rebuild-commission-materialization.ts`, `apply-commission-receipt-closing.ts`, `validate-commission-receipt-closing.ts`

**Resolver de fonte** (`commissionReportSource.ts`): `auto` → ledger CLOSED → prévia receipt → legado visual audit.

---

## Classificações

| Tag | Significado |
|-----|-------------|
| **KEEP** | Ativo na arquitetura nova ou master data necessário |
| **LEGACY_READ_ONLY** | Consulta/diagnóstico histórico; não usar para pagamento |
| **DEPRECATED** | Não usar em novas telas/relatórios; substituir |
| **REPLACE_WITH_MATERIALIZED_FLOW** | Migrar para snapshot/schedule/receipt-closing |
| **CANDIDATE_REMOVE_LATER** | Remover após validação e cutover completo |

---

## 1. Services antigos — não são fonte oficial

| Item | Classificação |
|------|----------------|
| `commission-calculation-service.server.ts` — `calculateCommissions()` grava `CommissionRecord` + `CommissionPaymentSchedule` | **DEPRECATED** |
| `commission-preview-calculation.server.ts` — preview do recalc legado | **LEGACY_READ_ONLY** |
| `commissionVisualAudit.server.ts` / `commissionVisualAudit.ts` — PAYABLE via CPS | **LEGACY_READ_ONLY** |
| `commissionApuracao.server.ts` / `commissionApuracao.ts` — eixo `confirmedAt` | **DEPRECATED** |
| `commissionReleases.server.ts` | **DEPRECATED** |
| `commissionArViews.server.ts` — payable/generated/future/overdue legado | **DEPRECATED** |
| `commissionConfirmed.server.ts` | **LEGACY_READ_ONLY** |
| `commissionForecast.server.ts` | **LEGACY_READ_ONLY** |
| `commissionReceivableForecast.server.ts` / `.ts` — ainda lê visual audit | **REPLACE_WITH_MATERIALIZED_FLOW** |
| `commissionDashboard.server.ts` — agrega `CommissionRecord` | **LEGACY_READ_ONLY** |
| `commissionRecords.server.ts` | **LEGACY_READ_ONLY** |
| `commissionPayments.server.ts` / `commission-payment-service.server.ts` | **LEGACY_READ_ONLY** |
| `commission-release-service.ts` — liberação em `CommissionPaymentSchedule` | **LEGACY_READ_ONLY** |
| `commissionCustomerExclusionReprocess.server.ts` — reprocessa records legados | **LEGACY_READ_ONLY** |
| `commissionNomusReconciliation.ts` — diff sobre linhas visual audit | **LEGACY_READ_ONLY** |
| `commissionReceivablesTimeline.ts` | **LEGACY_READ_ONLY** |
| `commissionMonthlyClosingWorkflow.ts` — workflow UI antiga | **LEGACY_READ_ONLY** |
| `getCommissionMonthlyPayableSummaryLedgerFirst()` | **DEPRECATED** |
| `commissionMonthlyPayable.server.ts` — facade com ramo receipt + fallback legado | **KEEP** (facade); ramo legado **LEGACY_READ_ONLY** |

### Stack oficial (referência KEEP)

`commissionOrderCalculation`, `commissionOrderMaterializer`, `commissionOrderSnapshot`, `commissionReceivableScheduler`, `commissionMaterializationOrchestrator`, `commissionMaterializationAfterNomusSync`, `commissionReceiptEngine`, `commissionReceiptClosing`, `commissionReceiptLedger`, `commissionReceiptClosingApi`, `commissionReceiptClosingValidation`, `commissionNomusReceiptReconciliation`, `commissionReportSource`, `reconcileArVsCommission`, regras/vendedor/exclusão/settings.

---

## 2. Scripts

### KEEP (oficiais / materializados)

| Script | Uso |
|--------|-----|
| `rebuild-commission-materialization.ts` | Rebuild snapshot + schedule em massa |
| `materialize-commission-order.ts` | Materializar pedido único |
| `apply-commission-receipt-closing.ts` | Fechar/reprocessar ledger |
| `preview-commission-receipt.ts` | Prévia receipt engine |
| `validate-commission-receipt-closing.ts` | Validar novo vs legado (`--compare-legacy`) |
| `audit-commission-monthly-payable.ts` | PAYABLE com `--source=auto\|receipt\|legacy` |
| `reconcile-ar-vs-commission.ts` | AR × comissão com `--source` |
| `audit-commission-seller-identity.ts` | Identidade vendedor |
| `audit-commission-customer-exclusion.ts` | Exclusões por cliente |
| `audit-commission-readiness.ts` | Prontidão de dados |
| `audit-commission-receivables-timeline.ts` | Timeline (usa resolver) |
| `backfill-commission-persons.ts` / `dedupe-commission-persons.ts` | Master data |
| `commission-script-utils.ts` / `commission-audit-args.ts` | Utilitários CLI |

### DEPRECATED — usar materialização / receipt-closing

| Script | Substituir por |
|--------|----------------|
| `recalculate-commissions.ts` | `rebuild-commission-materialization.ts` |
| `reconcile-commission-release-amounts.ts` | rebuild + receipt preview |
| `preview-commission-interpolated-rates.ts` | — (experimental) |
| `export-commission-june-comparison.ts` | receipt-closing export + Nomus reconcile |
| `compare-commission-with-nomus-export.ts` | `validate-commission-receipt-closing.ts` |
| `reconcile-commission-nomus-june-2026.ts` | `commissionNomusReceiptReconciliation` via UI/script receipt |
| `audit-commission-apuracao.ts` | receipt-closing |
| `audit-commission-apuracao-nomus-comparison.ts` | receipt-closing + Nomus |
| `audit-commission-financial-release.ts` | receipt engine |

### LEGACY_READ_ONLY — exibir aviso; `--source=legacy` quando aplicável

| Script | Nota |
|--------|------|
| `audit-commission-visual-summary.ts` | Sempre lê `CommissionRecord`; em `mode=payable` comparar com oficial |
| `audit-commission-links.ts` | Diagnóstico de vínculos via records |
| `audit-commission-missing-links.ts` | Diagnóstico |
| `apply-commission-customer-exclusion-reprocess.ts` | Reprocessa records até haver rematerialização |
| `preview-commission-customer-exclusion-impact.ts` | Impacto em records |
| `audit-commission-rules-coverage.ts` | Cobertura via preview legado |
| `audit-commission-june-readiness.ts` | Prontidão + contagem records existentes |

**Aviso CLI padrão** (scripts legados): `LEGACY MODE: não usar para pagamento oficial.`  
Implementado em `scripts/commission-script-utils.ts` → `warnCommissionLegacyMode()`.

---

## 3. Rotas API — risco de divergência

| Rota | Classificação | Risco |
|------|----------------|-------|
| `GET/POST /api/commissions/receipt-closing/*` | **KEEP** | Fonte oficial |
| `GET /api/commissions/monthly-closing` (+ export) | **REPLACE_WITH_MATERIALIZED_FLOW** | `auto` cai no legado sem CLOSED |
| `GET /api/commissions/visual-audit` (+ export, detail) | **LEGACY_READ_ONLY** | PAYABLE ≠ ledger oficial |
| `GET /api/commissions/payable` | **DEPRECATED** | |
| `GET /api/commissions/generated` / `confirmed` | **LEGACY_READ_ONLY** | |
| `GET /api/commissions/future` / `overdue` | **DEPRECATED** | |
| `GET /api/commissions/releases` | **DEPRECATED** | |
| `GET /api/commissions/apuracao` (+ export) | **DEPRECATED** | |
| `GET /api/commissions/forecast` | **LEGACY_READ_ONLY** | |
| `GET /api/commissions/receivable-forecast` | **REPLACE_WITH_MATERIALIZED_FLOW** | |
| `GET /api/commissions/dashboard` | **LEGACY_READ_ONLY** | Overlay oficial parcial |
| `POST /api/commissions/recalculate` | **DEPRECATED** | Reescreve records |
| `POST /api/commissions/audit/rerun` | **LEGACY_READ_ONLY** | |
| `GET /api/commissions/records` | **LEGACY_READ_ONLY** | |
| `GET/POST /api/commissions/payment-batches/*` | **LEGACY_READ_ONLY** | Lotes manuais |
| `POST /api/commissions/customer-exclusions/reprocess` | **LEGACY_READ_ONLY** | |

Definições: `src/lib/commissionsRoutes.ts`.

---

## 4. Componentes / telas

### Ativas (`COMMISSIONS_SIMPLIFIED_UI = true`)

| Tela | Classificação |
|------|----------------|
| `CommissionsReceiptClosingPage.tsx` | **KEEP** — oficial |
| `CommissionsVisualAuditPage.tsx` | **LEGACY_READ_ONLY** — auditoria; PAYABLE pode divergir |
| `CommissionsReceivableForecastPage.tsx` | **REPLACE_WITH_MATERIALIZED_FLOW** |
| `CommissionsCustomerExclusionsPage.tsx` | **KEEP** |

### Órfãs (redirect em `commissionsNavigation.ts`)

| Tela | Classificação |
|------|----------------|
| `CommissionsMonthlyClosingPage.tsx` | **DEPRECATED** → receipt closing |
| `CommissionsDashboardPage.tsx` | **LEGACY_READ_ONLY** |
| `CommissionsReleasesPage.tsx` | **DEPRECATED** |
| `CommissionsPaymentsPage.tsx` | **LEGACY_READ_ONLY** |
| `CommissionsApuracaoPage.tsx` | **DEPRECATED** |
| `CommissionsConfirmedPage.tsx` / `CommissionsForecastPage.tsx` | **LEGACY_READ_ONLY** |
| `CommissionsArPages.tsx` | **DEPRECATED** |
| `CommissionsPersonsPage.tsx` / `CommissionsRulesPage.tsx` | **KEEP** |
| `CommissionsExceptionsPage.tsx` | **DEPRECATED** (`CommissionCustomerException`) |
| `CommissionsAuditPage.tsx` | **LEGACY_READ_ONLY** |
| `CommissionsSettingsPage.tsx` | **KEEP** |

**Regra:** nenhuma tela oficial deve calcular comissão no frontend. Receipt closing consome apenas API (`data.cards`, `data.lines`).

---

## 5. Models / tabelas — compatibilidade

| Model | Classificação | Uso atual |
|-------|----------------|-----------|
| `CommissionOrderSnapshot` | **KEEP** | Snapshot materializado da venda |
| `CommissionOrderItemSnapshot` | **KEEP** | Itens do snapshot |
| `CommissionReceivableSchedule` | **KEEP** | Rateio oficial por CR |
| `CommissionMonthlyClosing` | **KEEP** | Cabeçalho fechamento receipt |
| `CommissionReceiptLedgerLine` | **KEEP** | Linhas oficiais a pagar |
| `CommissionPerson` / `CommissionPersonAlias` | **KEEP** | Vendedor canônico |
| `CommissionRule` / `CommissionRuleCondition` | **KEEP** | Regras |
| `CommissionCustomerExclusionRule` | **KEEP** | Exclusão por cliente |
| `CommissionSettings` | **KEEP** | Configuração |
| `CommissionAuditIssue` | **KEEP** | Auditoria transversal |
| `CommissionRecord` | **LEGACY_READ_ONLY** | Visual audit, recalc, pagamentos legados |
| `CommissionPaymentSchedule` | **LEGACY_READ_ONLY** | Liberação legada por parcela |
| `CommissionPaymentBatch` / `CommissionPaymentBatchItem` | **LEGACY_READ_ONLY** | Lotes manuais |
| `CommissionCalculationRun` | **CANDIDATE_REMOVE_LATER** | Histórico de recalc |
| `CommissionCustomerException` | **DEPRECATED** | Substituído por `CommissionCustomerExclusionRule` |

**Armadilha de nomenclatura:** `CommissionPaymentSchedule` (legado) ≠ `CommissionReceivableSchedule` (materializado).

---

## 6. Models candidatos à inativação futura

Após cutover completo (ledger CLOSED para todos os meses em produção + validação Nomus):

1. `CommissionRecord` — **CANDIDATE_REMOVE_LATER**
2. `CommissionPaymentSchedule` — **CANDIDATE_REMOVE_LATER**
3. `CommissionCalculationRun` — **CANDIDATE_REMOVE_LATER**
4. `CommissionCustomerException` — **CANDIDATE_REMOVE_LATER**
5. Endpoints `POST /recalculate`, `GET /apuracao`, `GET /releases` — **CANDIDATE_REMOVE_LATER**
6. Telas órfãs listadas acima — **CANDIDATE_REMOVE_LATER**

---

## 7. Funções duplicadas de cálculo

| Função | Arquivo | Motor | Classificação |
|--------|---------|-------|----------------|
| `calculateCommissionForSalesOrderItems()` | `commissionOrderCalculation.ts` | Venda → snapshot | **KEEP** (canônico materializado) |
| `calculateCommissions()` | `commission-calculation-service.server.ts` | Persiste record+schedule | **DEPRECATED** |
| `buildCommissionReceiptPreview()` | `commissionReceiptEngine.ts` | PAYABLE materializado | **KEEP** (canônico pagamento) |
| `listPayableVisualAuditRows()` | `commissionVisualAudit.server.ts` | PAYABLE legado | **LEGACY_READ_ONLY** |
| `recomputeCommissionRecordRelease()` | `commission-release-service.ts` | Schedule legado | **LEGACY_READ_ONLY** |
| `previewCommissionCalculation()` | `commission-preview-calculation.server.ts` | Preview legado | **LEGACY_READ_ONLY** |
| `buildApuracaoLine()` | `commissionApuracao.ts` | Eixo confirmedAt | **DEPRECATED** |
| `aggregateMonthlyPayableFromRows()` | `commissionMonthlyPayable.ts` | Agrega legado | **LEGACY_READ_ONLY** |
| `aggregateMonthlyPayableFromLedgerLines()` | `commissionMonthlyPayable.ts` | Agrega ledger | **KEEP** |
| `aggregateMonthlyPayableFromReceiptPreview()` | `commissionMonthlyPayable.ts` | Agrega prévia receipt | **KEEP** |

---

## 8. Exports CSV antigos

| Export | Classificação |
|--------|----------------|
| `buildVisualAuditCsv()` / `GET visual-audit/export` | **LEGACY_READ_ONLY** |
| `buildApuracaoCsv()` / `GET apuracao/export` | **DEPRECATED** |
| `buildReceivableForecast*Csv()` | **REPLACE_WITH_MATERIALIZED_FLOW** |
| `GET monthly-closing/export` (sem receipt CLOSED) | **REPLACE_WITH_MATERIALIZED_FLOW** |
| `buildMonthlyPayableCsv()` (com meta de fonte) | **KEEP** |
| `buildReceiptClosingExportCsv()` | **KEEP** — oficial |
| `buildValidationCsv()` (novo vs legado) | **KEEP** |
| `buildMaterializationRebuildCsv()` | **KEEP** |
| `export-commission-june-comparison.ts` | **DEPRECATED** |
| `compare-commission-with-nomus-export.ts` | **DEPRECATED** |
| `audit-commission-visual-summary.ts --csv` | **LEGACY_READ_ONLY** |
| `reconcile-ar-vs-commission.ts --csv` | **KEEP** (source-aware) |

---

## 9. Testes que validam lógica legada

| Arquivo | Classificação |
|---------|----------------|
| `commissionVisualAudit.test.ts` | **LEGACY_READ_ONLY** |
| `commissionMonthlyClosing.test.ts` | **LEGACY_READ_ONLY** |
| `commissionMonthlyClosingWorkflow.test.ts` | **LEGACY_READ_ONLY** |
| `commissionApuracao.test.ts` | **DEPRECATED** |
| `commission-release-service.test.ts` | **LEGACY_READ_ONLY** |
| `commission-payment-service.test.ts` | **LEGACY_READ_ONLY** |
| `commission-qa-flow.test.ts` | **LEGACY_READ_ONLY** |
| `commissionE2eValidation.test.ts` | **LEGACY_READ_ONLY** |
| `commissionReceivableForecast.test.ts` | **REPLACE_WITH_MATERIALIZED_FLOW** |
| `commissionReceivablesTimeline.test.ts` | **LEGACY_READ_ONLY** |
| `commissionNomusReconciliation.test.ts` | **LEGACY_READ_ONLY** |
| `commissionCustomerExclusionReprocess.test.ts` | **LEGACY_READ_ONLY** |
| `commissionsDashboard.test.ts` | **LEGACY_READ_ONLY** |
| `commissionReceiptClosingValidation.test.ts` | **KEEP** (compara novo × legado) |
| `commissionOrderCalculation.test.ts` e demais materialized/receipt | **KEEP** |

Rodar suite: `npm run test:commissions`.

---

## 10. Plano seguro de inativação em fases

### Fase 0 — Agora (mapeamento)
- Documentar inventário (este arquivo).
- Avisos em scripts legados.
- Validar junho/2026 com receipt-closing + Nomus reconcile.

### Fase 1 — Congelar uso oficial legado
- Bloquear `POST /recalculate` em produção (feature flag ou permissão restrita).
- Garantir que nenhum processo de pagamento use visual-audit PAYABLE.
- Exigir `--source=receipt` em scripts de auditoria mensal.

### Fase 2 — Migrar leituras
- Receivable forecast → schedules materializados.
- Dashboard → totais do ledger CLOSED.
- Exclusion reprocess → rebuild materialization + receipt reprocess.

### Fase 3 — Deprecar APIs e telas órfãs
- Remover redirects apenas após confirmação de usuários.
- Marcar rotas DEPRECATED com header `Deprecation` na API.

### Fase 4 — Cutover de dados (após validação)
- Congelar writes em `CommissionRecord` / `CommissionPaymentSchedule`.
- Arquivar dados históricos.
- Remover código CANDIDATE_REMOVE_LATER.

---

## Checklist de cutover

- [ ] **1.** Nenhuma tela oficial usa cálculo legado (receipt closing OK; visual audit só consulta).
- [ ] **2.** Nenhum relatório oficial de pagamento usa `CommissionRecord` / `CommissionPaymentSchedule`.
- [ ] **3.** Scripts legados exibem aviso `LEGACY MODE`.
- [ ] **4.** Documentação aponta fonte oficial (este doc + `commissionReportSource.ts`).
- [ ] **5.** Testes cobrem materialização, receipt engine, receipt closing, Nomus receipt reconcile.

---

## Riscos de remoção prematura

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Remover `CommissionRecord` antes do ledger | Perda de histórico e pagamentos em andamento | Manter LEGACY_READ_ONLY até Fase 4 |
| Desligar visual audit | Perda de diagnóstico GENERATED/FORECAST | Manter para modos não-PAYABLE |
| Remover `POST /recalculate` sem rebuild | Operações manuais quebram | Migrar runbooks para `rebuild-commission-materialization` |
| Confundir `CommissionPaymentSchedule` com `CommissionReceivableSchedule` | Números divergentes | Nomenclatura explícita em docs e UI |
| Fechar mês no legado e no receipt | Dois totais oficiais | Apenas receipt-closing grava CLOSED |
| Lotes `CommissionPaymentBatch` órfãos | Pagamentos registrados só no legado | Conciliar lotes antes do cutover |

---

## Referências

- `docs/commission-summary.md`
- `docs/commission-materialization-plan.md`
- `docs/commission-receipt-engine-plan.md`
- `src/lib/commissions/commissionReportSource.ts` — `LEGACY_PAYABLE_DEPRECATION_NOTICE`
