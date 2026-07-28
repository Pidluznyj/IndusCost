# Central de Tesouraria — Matriz de rastreabilidade de requisitos

**Atualizado:** 2026-07-28  
**Fontes oficiais usadas nesta auditoria:**
1. Escopo/objetivo do **Prompt 00** (lista de capacidades da Central de Tesouraria) — tratado como PRD operacional na ausência de arquivo PRD dedicado no repositório.
2. Desenho técnico em `docs/treasury/02-REQUIREMENTS-MAPPING.md` + plano `03-IMPLEMENTATION-PLAN.md` — tratado como TDD operacional na ausência de arquivo TDD dedicado.
3. Evidências de código em `src/lib/treasury/**`, `src/components/finance/treasury/**`, `prisma/schema.prisma`, `docs/treasury/IMPLEMENTATION_STATUS.md`.

**Busca PRD/TDD formais:** não foram encontrados arquivos nomeados `PRD*` / `TDD*` / `*Tesouraria*.md` fora de `docs/treasury/`. Lacuna documental registrada em R28.

**Regra de situação:** `DONE` só com evidência de implementação **e** teste relevante. Caso contrário `PARTIAL` ou `MISSING`.

| Legenda | Significado |
|---------|-------------|
| DONE | Código + teste evidenciados |
| PARTIAL | Capacidade principal existe; path/UI/API diferem ou faltam pedaços menores |
| MISSING | Sem implementação utilizável |

---

## Matriz R01–R30

| ID | requisito | implementado | arquivo | endpoint | tela | teste | situação | evidência | lacuna |
|----|-----------|--------------|---------|----------|------|-------|----------|-----------|--------|
| R01 | Contas financeiras | Y | `services/treasuryAccountService.server.ts`, `TreasuryAccountsPage.tsx` | `GET/POST /api/finance/treasury/accounts`, `GET/PATCH …/:id` | `/finance/treasury/accounts` | `treasuryAccountApi.test.ts`, `TreasuryAccountsPage.test.tsx` | DONE | CRUD+ACL+UI | — |
| R02 | Saldos manuais e históricos | Y | `treasuryBalanceService.server.ts`, `TreasuryAccountBalancePage.tsx` | `GET …/balances`, `POST …/balance-snapshots` | `/finance/treasury/accounts/:id/balances` | `treasuryBalanceApi.test.ts` | DONE | snapshots versionados | path `balance-snapshots` ≠ mapping `balances` (equivalente) |
| R03 | Saldo observado/calculado/conciliado | Y | `treasuryFinancialPositionService.server.ts` | `GET …/accounts/:id/balance-position` + dashboard | `/finance/treasury` | `treasuryFinancialPosition*.test.ts`, `treasuryTraceabilityGapsApi.test.ts` | DONE | engine + endpoint dedicado (Prompt 63) | — |
| R04 | Contas a receber (títulos) | Y | adapter oficial + query/API/UI | `GET …/receivables` | `/finance/treasury/receivables` | `treasuryReceivable*.test.ts` | DONE | facade read-only Nomus | — |
| R05 | Contas a pagar (títulos) | Y | payable query/API/UI | `GET …/payables` | `/finance/treasury/payables` | `treasuryPayable*.test.ts` | DONE | facade + programação | — |
| R06 | Previsto versus realizado | Y | dashboard day-flow + report | `GET …/forecast-vs-actual`, `GET …/dashboard`, `GET …/reports/planned-vs-actual` | `/finance/treasury`, `/reports` | `treasuryDashboard*.test.ts`, `treasuryTraceabilityGapsApi.test.ts` | DONE | endpoint canônico mapping (Prompt 63) | — |
| R07 | Datas esperadas | Y | complemento + expectation service | `PUT …/receivables/:titleId/expectation` | drawer CR | `treasuryReceivableExpectation*.test.ts` | DONE | não muta `dueDate` | path ≠ overlays genérico |
| R08 | Promessas de pagamento | Y | `TreasuryPaymentPromise` | nested `…/receivables/:titleId/promises` | drawer CR | `treasuryPaymentPromise*.test.ts` | DONE | lifecycle + audit | — |
| R09 | Ações de cobrança | Y | `TreasuryCollectionAction` | `…/collection-actions` | timeline CR | `treasuryCollection*.test.ts` | DONE | append-only | — |
| R10 | Contestações | Y | `TreasuryDispute` | `…/disputes` | drawer CR | `treasuryDispute*.test.ts` | DONE | não zera saldo oficial | — |
| R11 | Programação de pagamentos | Y | payable programming + list | `POST/PUT …/program-payment`, `GET …/payment-schedule` | `/finance/treasury/payment-schedule` + payables | `treasuryPayableProgramming*.test.ts`, gaps wiring | DONE | list+UI dedicados (Prompt 63) | — |
| R12 | Projeção contratual/provável/confirmada | Y | projection engine/APIs | `POST …/projections/calculate`, compare/latest | `/finance/treasury/projections` | `treasuryProjection*.test.ts` | DONE | 3 cenários | — |
| R13 | Agenda financeira | Y | agenda API/UI | `GET …/agenda` | `/finance/treasury/agenda` | `TreasuryAgendaPage.test.tsx` | DONE | buckets multi-cenário | — |
| R14 | Transferências | Y | `TreasuryTransfer` stack | `GET/POST …/transfers` + transitions | `/finance/treasury/transfers` | `treasuryTransfer*.test.ts` | DONE | consolidado neutro | ledger dual-leg via projeção (sem 2 rows ledger) |
| R15 | Lançamentos manuais | Y | `TreasuryLedgerEntry` + service/API/UI | `GET/POST …/ledger-entries`, `POST …/:id/reverse` | `/finance/treasury/manual-entries` | `treasuryManualLedgerRules.test.ts`, `treasuryManualLedgerApi.test.ts` | DONE | create+reverse; migration `20260821120000_*` | — |
| R16 | Exceções | Y | exception engine/center | `GET/PATCH …/exceptions` | `/finance/treasury/exceptions` | `treasuryException*.test.ts` | DONE | 16 tipos | — |
| R17 | Alertas | Y | alert rules + settings | `GET …/alerts`, `GET/PUT …/alert-settings` | dashboard/agenda | `treasuryAlertRules.test.ts`, gaps wiring | DONE | feed dedicado (Prompt 63) | sem push externo (fora de escopo atual) |
| R18 | Fechamento diário | Y | daily closing stack | `GET/POST …/daily-closing` | `/finance/treasury/closing` | `treasuryDailyClosing*.test.ts` | DONE | imutável+versionado | path `closing` ≠ `closings` |
| R19 | Reabertura | Y | reopen service/UI | `POST …/daily-closing/:id/reopen` | ação no closing | daily closing tests | DONE | não in-place | — |
| R20 | Importação OFX | Y | parser+preview+apply | `POST …/bank-imports/ofx/preview\|apply` | `/finance/treasury/bank-movements` + alias `/ofx` | OFX/bank-import tests | DONE | idempotente fingerprint | paths mapping `/ofx/import` → bank-imports |
| R21 | Conciliação bancária | Y | match service + workspace | `POST …/reconciliations` (accept), `…/unmatch`, `…/reverse`, `GET …/reconcile/workspace` | `/finance/treasury/reconcile` | reverse/match tests + gaps wiring | DONE | accept/unmatch HTTP + workspace (Prompt 63) | — |
| R22 | Relatórios | Y | report service/UI | `GET …/reports/:reportKey` | `/finance/treasury/reports` | `treasuryReport*.test.ts` | DONE | 10 keys | — |
| R23 | Exportações | Y | export controllers | `GET …/reports/:reportKey/export.csv\|xlsx\|pdf` | botões reports | `treasuryReportExport*.test.ts` | DONE | exige `export` | exports focados em reports |
| R24 | Auditoria | Y | `TreasuryAuditLog` writer+list | `GET …/audit` | `/finance/treasury/audit` | `treasuryAudit.test.ts`, gaps wiring | DONE | list+UI (Prompt 63) | — |
| R25 | Permissões | Y | `finance.treasury*` contract | guards em rotas | admin + tabs | `treasuryPermissions.test.ts` | DONE | deny>allow | — |
| R26 | Observabilidade | Y | availability+health | `GET …/availability`, `GET …/health` | indicadores freshness | availability + gaps wiring | DONE | health fail-closed (Prompt 63) | métricas OFX/closing ainda básicas |
| R27 | Testes | Y | `npm run test:treasury` | — | — | suite unit+integ+E2E | DONE | P59–P61 + gaps | 1 skip gated Postgres |
| R28 | Documentação | Y | `docs/treasury/*` + `manuals/*` | — | — | — | DONE | README + 10–18 técnicos + manuais P64; discovery/mapping/plan/status/runbook/traceability | PRD/TDD externos ausentes no repo |
| R29 | Feature flags | Y | `treasuryFeatureFlags.ts` | fail-closed nas rotas | nav oculta | `treasuryFeatureFlags.test.ts` | DONE | mestra+subflags | — |
| R30 | Scripts deploy/validação | Y | runbook + validate + backfill | — | — | `treasuryValidateDeploy.test.ts`, backfill tests | DONE | `validate:treasury:deploy`, `DEPLOYMENT_RUNBOOK.md`, backfill P62 | Cursor não executa prod |

---

## Princípios anti-duplicação (Prompt 00 / mapping §0)

| Regra | situação | evidência |
|-------|----------|-----------|
| Nomus fonte oficial CR/CP | DONE | adapter read-only; sem model espelho de título |
| Local = complementos | DONE | `TreasuryTitleOperationalComplement` + overlays |
| Não somar pedido/NF/título | DONE | motor identidade + reports escopo caixa |
| Não somar previsão+realização | DONE | flag `doesNotSumForecastAndActual` no forecast-vs-actual |
| Transferência não altera consolidado | DONE | testes transfer invariant |
| Nunca substituir vencimento | DONE | expectation/promise/programming tests |
| Sem exclusão física | DONE | cancel/reverse/version |
| Money string Decimal | DONE | `treasuryMoney` + DTO strings |

---

## Prompt 63 — fechamento de lacunas

Itens implementados nesta auditoria (com testes de wiring/regras):

- R15 ledger completo (schema/migration/API/UI)
- R03 balance-position
- R06 forecast-vs-actual
- R11 payment-schedule API/UI
- R17 GET alerts
- R21 accept/unmatch + reconcile workspace/UI
- R24 GET audit + UI
- R26 GET health
- R20 alias UI `/ofx`
- R28/R30 runbook + `validate:treasury:deploy`

**Commit:** `0b687bb` — ver também `IMPLEMENTATION_STATUS.md` Prompt **63**.
