# Models Prisma — Central de Tesouraria

Fonte: `prisma/schema.prisma`. Migrations versionadas em `prisma/migrations/202608*treasury*`.

## 1. Contas e saldos

| Model | Função |
|-------|--------|
| `TreasuryFinancialAccount` | Conta bancária/local IndusCost (`companyCode`, máscaras, liquidez, consolidado) |
| `TreasuryFinancialAccountAccess` | ACL por usuário/conta |
| `TreasuryBalanceSnapshot` | Saldo versionado (observado/operacional/bloqueado/aplicações/limite); idempotency |

## 2. Complementos de títulos (não são títulos)

| Model | Função |
|-------|--------|
| `TreasuryTitleOperationalComplement` | Overlay CR/CP: expected/confirmed/scheduled, prioridade, conta, responsável |
| `TreasuryPaymentPromise` | Promessa de recebimento (histórico preservado) |
| `TreasuryCollectionAction` | Ação de cobrança (append-only / cancel lógico) |
| `TreasuryDispute` | Contestação |

Enums relevantes: `TreasuryOfficialTitleKind`, `TreasuryTitleOperationalStatus`, `TreasuryTitleOperationalPriority`, `TreasuryPaymentPromiseStatus`, `TreasuryCollectionActionType`, `TreasuryDisputeStatus`.

## 3. Ledger e transferências

| Model | Função |
|-------|--------|
| `TreasuryLedgerEntry` | Lançamento local (MANUAL/ADJUSTMENT/REVERSAL…); status ACTIVE/REVERSED |
| `TreasuryTransfer` | Transferência entre contas (`transferGroupId`); status FORECAST→…→RECONCILED/CANCELLED |

Enums: `TreasuryLedgerDirection`, `TreasuryLedgerNature`, `TreasuryLedgerStatus`, `TreasuryTransferStatus`.

## 4. Projeção

| Model | Função |
|-------|--------|
| `TreasuryProjectionRun` | Execução por empresa/cenário/período |
| `TreasuryProjectionDayLine` | Linha diária (saldos/fluxos/risco) |
| `TreasuryProjectionCompositionItem` | Composição do dia |
| `TreasuryProjectionRecalcJob` | Fila persistente PostgreSQL (sem broker) |

Enums: `TreasuryProjectionScenario`, `TreasuryProjectionRunStatus`, `TreasuryProjectionRiskCode`, `TreasuryProjectionItemKind`, `TreasuryProjectionRecalcJobStatus`, `TreasuryProjectionRecalcEventType`.

## 5. Exceções e alertas

| Model | Função |
|-------|--------|
| `TreasuryException` | Exceção operacional (upsert idempotente por `uniqueKey`) |
| `TreasuryAlertSettings` | Singleton de limites/severidade |

## 6. Fechamento diário

| Model | Função |
|-------|--------|
| `TreasuryDailyClosing` | Fechamento versionado (`civilDate` + `version`); imutável quando CLOSED |
| `TreasuryDailyClosingAccountPosition` | Posição congelada por conta |
| `TreasuryDailyClosingFrozenPendency` | Pendências congeladas |
| `TreasuryDailyClosingFrozenException` | Exceções congeladas |
| `TreasuryDailyClosingCaveat` | Ressalvas explícitas |
| `TreasuryDailyClosingReopening` | Reabertura (novo registro; não reescreve o CLOSED) |

Enum: `TreasuryDailyClosingStatus` (`OPEN` \| `CLOSED` \| `REOPENED`).

## 7. Banco / OFX / conciliação

| Model | Função |
|-------|--------|
| `TreasuryBankImportBatch` | Lote de importação OFX (hash; sem raw file permanente) |
| `TreasuryBankMovement` | Movimento bancário normalizado + fingerprint |
| `TreasuryReconciliationMatch` | Match (1:1 / 1:N / N:1 via junções) |
| `TreasuryReconciliationMatchMovement` | Ligação match↔movimento |
| `TreasuryReconciliationAllocation` | Alocações (título, fee, diferença, etc.) |

## 8. Auditoria

| Model | Função |
|-------|--------|
| `TreasuryAuditLog` | Append-only (`beforeJson`/`afterJson`); trigger de imutabilidade na migration |

## 9. Migrations Tesouraria (ordem lógica)

| Pasta | Conteúdo |
|-------|----------|
| `20260805120000_treasury_financial_accounts_and_balance_snapshots` | Contas + saldos |
| `20260806120000_treasury_audit_log` | Auditoria |
| `20260807120000_treasury_title_operational_complement` | Complemento |
| `20260808120000_treasury_payment_promise` | Promessas |
| `20260809120000_treasury_collection_action_and_dispute` | Cobrança/disputa |
| `20260810120000_treasury_projection_run_and_day_lines` | Projeção |
| `20260811120000_treasury_projection_recalc_queue` | Fila recalc |
| `20260812120000_treasury_transfer` | Transferências |
| `20260813120000_treasury_exception` | Exceções |
| `20260814120000_*` / `20260815120000_*` | Tipos/status exceção |
| `20260816120000_treasury_alert_settings` | Alertas |
| `20260817120000_treasury_daily_closing` | Fechamento |
| `20260818120000_treasury_bank_import_and_movements` | OFX/movimentos |
| `20260819120000_treasury_reconciliation_match_and_allocations` | Conciliação |
| `20260820120000_treasury_perf_indexes` | Índices perf |
| `20260821120000_treasury_ledger_entry` | Ledger manual |

**Produção:** apenas `npx prisma migrate deploy` pelo operador humano.
