# Motor de conciliação existente — auditoria profunda e matriz de cobertura

Base: `f0821d7` (Etapa 1) + inspeção desta etapa. Nenhum código alterado.

---

## Parte A — Inventário do motor existente

### A.1 Persistência (Prisma)

| Model | Responsabilidade | Escrita por | Reuso | Limitação |
|---|---|---|---|---|
| `TreasuryBankImportBatch` | Lote OFX; `fileSha256`, `status`, `summaryJson` | `treasuryBankImportOfxApplyService` | Leitura | `summaryJson` é o único lugar do saldo do extrato |
| `TreasuryBankMovement` | Movimento normalizado; `fingerprint`, `fitId`, `amount` Decimal(20,2), `direction`, `postedCivilDate`, `reconciliationStatus`, `reconciledAmount` | idem + `matchService` (só status/valor conciliado) | Leitura | Sem campo de correção/estorno/supersede |
| `TreasuryReconciliationMatch` | Cabeçalho do aceite; `matchedAmount`, `status`, `version`, soft-unmatch | `treasuryReconciliationMatchService` | **Delegar** | Sem `idempotencyKey`; sem maker-checker |
| `TreasuryReconciliationMatchMovement` | N:N movimento↔match com `amount` parcial | idem | **Delegar** | — |
| `TreasuryReconciliationAllocation` | Pernas: `TITLE`/`FEE`/`INTEREST`/`DISCOUNT`/`ABATEMENT`/`DIFFERENCE`/`TRANSFER`/`MANUAL_LEDGER`/`UNIDENTIFIED`; `nomusSide`+`nomusExternalId` | idem | **Delegar** | `differenceCode` livre, sem catálogo |
| `TreasuryTransfer` | Transferência interna; `transferGroupId`, `status`, `version`, datas sent/received/reconciled | `treasuryTransferController` | Leitura + `TRANSFER` alloc | — |
| `TreasuryBalanceSnapshot` | Saldo informado versionado; `previousSnapshotId`, `cancelledAt` | rotas de conta | **Leitura apenas** | Sem tipo "fim de dia" x "instantâneo" |
| `TreasuryDailyClosing` | Fechamento; `observedBalance`, `status`, `version` | controller de fechamento | **Leitura apenas** | — |
| `TreasuryAuditLog` | Trilha append-only (`beforeJson`/`afterJson`/`justification`/`requestId`) | `treasuryAuditService` | **Reutilizar** | — |
| `TreasuryException` | Exceções operacionais (`severity`, `status`) | `treasuryExceptionController` | Avaliar p/ investigação | Genérica, não específica de conciliação |

Enums relevantes: `TreasuryReconciliationMatchStatus` (`PENDING`/`MATCHED`/`UNMATCHED`/`IGNORED`),
`TreasuryReconciliationAllocationKind`, `TreasuryBankMovementDirection`,
`TreasuryBankMovementReconciliationStatus`, `TreasuryCurrencyCode` (**só `BRL`**),
`TreasuryBalanceOrigin`, `TreasuryTransferStatus`.

### A.2 Domínio puro

`domain/treasuryReconciliationMatchRules.ts` — sem I/O, tudo em `TreasuryMoneyString`:

| Função | Responsabilidade |
|---|---|
| `computeTreasuryReconciliationCoveringNet` | Cobertura líquida (kinds positivos − negativos) |
| `assertTreasuryReconciliationAllocationShape` | Forma por kind (`TITLE` exige side+externalId, etc.) |
| `assertTreasuryReconciliationMatchBalanced` | Σ movimentos == covering net |
| `assertTreasuryReconciliationMovementCapacity` | Alocado ≤ valor do movimento |
| `assertTreasuryReconciliationTitleOpenBalances` | Alocado ≤ saldo aberto do título |
| `deriveTreasuryBankMovementReconciliationStatus` | PENDING/PARTIAL/MATCHED derivado |
| `assertTreasuryReconciliationMatchVersion` | Optimistic locking |
| `assertTreasuryReconciliationReverseConfirmPhrase` | Confirmação forte |
| `TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL` | Invariante anti-baixa |

`domain/treasuryReconciliationSuggestionEngine.ts` — `runTreasuryReconciliationSuggestionEngine`,
score ponderado + bandas HIGH/MEDIUM/LOW, `algorithmVersion`, `scoreBreakdown`.
Cabeçalho declara: *"apenas sugere. Nunca aplica match."*

### A.3 Serviços

| Serviço | Métodos | Autoridade escrita | Nota |
|---|---|---|---|
| `treasuryReconciliationMatchService.server.ts` | `getById`, `listActiveByBankMovement`, `accept`, `unmatch`, `reverse` | Match + status do movimento | Transacional; audita; dispara recálculo; `reverse` notifica pós-fechamento |
| `treasuryBankMovementQueryService.server.ts` | `listBatches`, `listMovements`, `getMovement` | Nenhuma (leitura) | **`resolveAuthorizedAccountIds` = filtro ACL anti-IDOR pronto** |
| `treasuryReconciliationSuggestions.server.ts` | Sementes + execução do motor | Nenhuma | — |
| `treasuryBankImportOfxPreviewService` / `...ApplyService` | Preview (token assinado) / apply | Batch + movimentos | **Escrita proibida ao Apoio ao Caixa** |
| `treasuryReconciledBalanceRepository.server.ts` | Saldo *ledger* do OFX lido de `summaryJson` | Nenhuma | Só ledger; sem `available` |

### A.4 Controllers, rotas e segurança

Todas em `treasuryRoutes.ts`, cadeia:
`requireAppAuth → moduleEnabled → reconciliationEnabled → requireResource → rateLimit → controller`.

| Rota | Permissão |
|---|---|
| `GET /bank-imports`, `/bank-movements`, `/bank-movements/:id` | `viewReconciliation` |
| `GET /reconciliations`, `/reconciliations/:id` | `viewReconciliation` |
| `POST /reconciliations` (accept) | `manageReconciliation` |
| `POST /reconciliations/:id/unmatch` | `manageReconciliation` |
| `POST /reconciliations/:id/reverse` | `reconciliationReverse` + rate limit |
| `POST /bank-imports/ofx/preview` \| `/apply` | `manageReconciliation` + flag OFX |

RBAC: `finance.treasury.reconciliation` (view/manage) e `finance.treasury.reconciliation.reverse`.
ACL por conta: `TreasuryFinancialAccountAccess` via `canTreasuryActorManageAccount`.
Feature flags: `treasury.reconciliation.enabled`, `treasury.ofx.*`.

### A.5 Concorrência e idempotência — estado real

| Item | Situação | Evidência |
|---|---|---|
| Transação | **Sim** | `runInTransaction` → `prisma.$transaction` |
| Optimistic locking | **Sim** em `unmatch`/`reverse` (`expectedVersion`) | `treasuryReconciliationMatchService.server.ts:521,591` |
| Locking em `accept` | **Não** — sem `expectedVersion` | idem `:344` |
| Capacidade revalidada dentro da transação | **NÃO** — `already` é lido **antes** do `$transaction` e reusado dentro | idem `:369-423` vs `:425` |
| `SELECT FOR UPDATE` | **Não existe** | — |
| `Idempotency-Key` | **Não existe** no accept | — |
| Maker-checker | **Não existe** | — |

---

## Parte B — Matriz de cobertura

Status: `REUTILIZAR` · `REUTILIZAR COM ADAPTADOR` · `LACUNA REAL` · `FORA DO ESCOPO` · `BLOQUEADO`

| # | Requisito | Componente existente | Arquivo / tabela | Status | Evidência | Lacuna | Ação |
|---|---|---|---|---|---|---|---|
| 1 | Posição bancária | `TreasuryBankMovement` + query service | `treasuryBankMovementQueryService.server.ts` | REUTILIZAR COM ADAPTADOR | `listMovements` com ACL | Não agrega posição por conta | Adaptador soma no backend |
| 2 | OFX preview/apply | Serviços OFX | `...OfxPreviewService`, `...OfxApplyService` | REUTILIZAR | Rotas ativas | — | Somente leitura do resultado |
| 3 | Deduplicação | `fingerprint` + `fitId` únicos | `schema.prisma:9376-9377` | REUTILIZAR | Constraint de banco | — | Nenhuma |
| 4 | Correções OFX | — | — | **LACUNA REAL** | Sem campo de correção/supersede | Movimento corrigido não é representável | Warning `SOURCE_CORRECTION_UNSUPPORTED`; decidir na Etapa 3 |
| 5 | Saldo *ledger* | `reconciledBalanceRepository` | `treasuryReconciledBalanceRepository.server.ts` | REUTILIZAR COM ADAPTADOR | Lê `summaryJson` | Depende de JSON não tipado | Adaptador tolerante + warning |
| 6 | Saldo *available* | — | — | **LACUNA REAL** | Só `ledgerBalance` no `summaryJson` | Sem saldo disponível do extrato | Não comparar; warning explícito |
| 7 | Data/hora do saldo | `ledgerBalanceAsOfCivilDate`; `TreasuryBalanceSnapshot.referenceAt` | ambos | REUTILIZAR COM ADAPTADOR | — | Granularidade civil no OFX | Comparar só mesma data-base |
| 8 | Cobertura de extrato | — | — | **LACUNA REAL** | Nenhum modelo de período coberto | Não se sabe se o extrato cobre o período | Warning `STATEMENT_COVERAGE_UNKNOWN`; **sem tabela nova sem autorização** |
| 9 | CR real | Linha do tempo canônica | `treasuryCaixaService.server.ts` | REUTILIZAR COM ADAPTADOR | `arResult.gridRows` | Sem conta/moeda | Adaptador (Etapa 5) |
| 10 | CP real | idem | idem | REUTILIZAR COM ADAPTADOR | `apResult.gridRows` | idem | idem |
| 11 | Previsões | FIN-08 | `financeAccountsReceivableEffectiveTitles.ts` | REUTILIZAR COM ADAPTADOR | `lineKind` | `lineKind` descartado no board | Expor como contexto; `reconcilable=false` |
| 12 | Match 1:1 | Motor | `matchService.accept` | REUTILIZAR | — | — | Delegar |
| 13 | Match 1:N (1 mov → N títulos) | N allocations `TITLE` | `assertTreasuryReconciliationMatchBalanced` | REUTILIZAR | — | — | Delegar |
| 14 | Match N:1 (N mov → 1 título) | `MatchMovement` N:N | `schema.prisma:9457` | REUTILIZAR | — | — | Delegar |
| 15 | Parcial | `reconciledAmount` + `PARTIAL` | `deriveTreasuryBankMovementReconciliationStatus` | REUTILIZAR | — | — | Delegar |
| 16 | Tarifa | `FEE` | enum | REUTILIZAR | — | — | Delegar |
| 17 | Juros | `INTEREST` | enum | REUTILIZAR | — | — | Delegar |
| 18 | Desconto | `DISCOUNT` (negativo) | `TREASURY_..._NEGATIVE_KINDS` | REUTILIZAR | — | — | Delegar |
| 19 | Abatimento | `ABATEMENT` | idem | REUTILIZAR | — | — | Delegar |
| 20 | Diferença | `DIFFERENCE` + `differenceCode` | enum | REUTILIZAR COM ADAPTADOR | — | Sem catálogo de motivos | Exigir memo na UI |
| 21 | Transferência | `TreasuryTransfer` + alloc `TRANSFER` | `schema.prisma:8797` | REUTILIZAR | `transferGroupId` | — | Consolidado zero no read model |
| 22 | Unidentified | `UNIDENTIFIED` | enum | REUTILIZAR | — | — | Dinheiro fica no banco, pendente |
| 23 | Reversão | `reverse` + frase forte | `matchService:570` | REUTILIZAR | Soft, preserva histórico | — | Delegar |
| 24 | Investigação | `TreasuryException` (genérico) | `schema.prisma:8911` | REUTILIZAR COM ADAPTADOR | — | Não específico de movimento | Avaliar na Etapa 16 antes de criar tabela |
| 25 | Sugestões | Motor com score | `treasuryReconciliationSuggestionEngine.ts` | REUTILIZAR | `algorithmVersion` | Não persiste rejeição | Etapa 11/12 |
| 26 | Aceite | `accept` | `matchService:344` | REUTILIZAR | — | Sem `expectedVersion`/idempotência | Ver #33, #34 |
| 27 | Rejeição de sugestão | — | — | **LACUNA REAL** | Sugestão não é persistida | Rejeitar não tem onde gravar | Etapa 12 decide (pode ser não-persistente) |
| 28 | Auditoria | `TreasuryAuditLog` append-only | `treasuryAuditService.server.ts` | REUTILIZAR | before/after/justification | — | Nenhuma |
| 29 | Concorrência (locking) | `expectedVersion` | `assertTreasuryReconciliationMatchVersion` | REUTILIZAR | Em unmatch/reverse | **`accept` sem locking** | Ver #33 |
| 30 | Concorrência (capacidade) | — | `matchService:369-425` | **LACUNA REAL** | Capacidade lida **antes** da transação | Dois aceites simultâneos podem exceder o movimento | **Alta prioridade** — revalidar dentro da tx |
| 31 | Idempotência | `idempotencyKey` institucional (limite 128) | `contracts/treasuryConstants.ts:177`; unique em `TreasuryBalanceSnapshot` | REUTILIZAR COM ADAPTADOR ¹ | Padrão existe; falta aplicar ao `accept` | Duplo clique cria dois matches | Aplicar o padrão em CS-000 |
| 32 | Maker-checker | — | — | **LACUNA REAL** | Inexistente | Sem segregação criador/aprovador | Etapa 18 (só se a matriz confirmar necessidade) |
| 33 | Fechamento de período | `TreasuryDailyClosing` | `schema.prisma:9076` | REUTILIZAR | `status`, `version` | — | Leitura |
| 34 | Reabertura | `TreasuryDailyClosingReopening` + `postClosingChangeService` | `schema.prisma:9249` | REUTILIZAR | `reverse` já notifica | — | Leitura |
| 35 | Exportação | Report exports CSV/XLSX/PDF | `treasuryReportRepository.server.ts` | REUTILIZAR COM ADAPTADOR | Rotas com rate limit | Não conhece o read model novo | Etapa 19 |
| 36 | Comentários | `justification`/`memo`/`notes` | vários | REUTILIZAR | — | Sem thread | Aceitar campo único |
| 37 | Anexos | `attachmentUrl` (só snapshot) | `schema.prisma:8202` | FORA DO ESCOPO | — | Match não tem anexo | Não implementar no MVP |
| 38 | Permissões | RBAC por recurso | `permissionContract/resources.ts:1612` | REUTILIZAR | — | Sem recurso próprio de Apoio ao Caixa | Reusar `reconciliation.view` |
| 39 | ACL por conta | `resolveAuthorizedAccountIds` | `treasuryBankMovementQueryService.server.ts:127` | REUTILIZAR | Anti-IDOR pronto | — | Reusar |
| 40 | Feature flag | `treasury.reconciliation.enabled` | `treasuryFeatureFlags.ts` | REUTILIZAR | — | — | Reusar |
| 41 | Empresa | `companyCode` no lado bancário | — | **BLOQUEADO (parcial)** | Board Caixa usa `companyAccounts[0]` | Timeline monoempresa | Documentar; não filtrar por empresa no MVP |
| 42 | Conta | `accountId` só no lado bancário | — | **BLOQUEADO (parcial)** | Título tem só `bankAccountName` texto | Não casa título↔conta | Contexto ausente + warning |
| 43 | Moeda | `TreasuryCurrencyCode` = `BRL` | enum | REUTILIZAR COM ADAPTADOR | Enum de valor único | Sem multimoeda | Assumir BRL; warning se evoluir |
| 44 | Timezone | `todayTreasuryCivilDateInSaoPaulo`, `civilDateUtcRange` | `contracts/treasuryCivilDate.ts` | REUTILIZAR | — | — | Reusar |
| 45 | `bankDate` | `postedCivilDate` (+`userCivilDate`) | `schema.prisma:9354` | REUTILIZAR | — | — | Realizado usa `postedCivilDate` |
| 46 | `dueDate` | `dueDate`/`operationalDueDate` | canônico | REUTILIZAR | — | — | Previsão/atraso |
| 47 | Dupla contagem | Dimensões disjuntas + supressão FIN-08 | `treasuryCaixaCanonicalDay.ts` | REUTILIZAR COM ADAPTADOR | Disjunção por construção | Não sabe do lado bancário | Ponte explícita no read model (Etapa 8) |
| 48 | Linha do tempo canônica | `getBoard` | `treasuryCaixaService.server.ts` | REUTILIZAR COM ADAPTADOR | — | Descarta `lineKind`/`orderCode` | Adaptador (Etapa 5) |

### Resumo

| Status | Qtd |
|---|---|
| REUTILIZAR | 25 |
| REUTILIZAR COM ADAPTADOR | 14 |
| LACUNA REAL | 6 (#4, #6, #8, #27, #30, #32) |
| FORA DO ESCOPO | 1 (#37) |
| BLOQUEADO (parcial) | 2 (#41, #42) |

¹ **Reclassificado na Etapa 3.** Revalidação encontrou `idempotencyKey` como padrão
institucional da Tesouraria — deixa de ser lacuna de infraestrutura. Ver
`06-implementation-backlog.md` Parte A.

**Lacuna mais grave: #30** — a capacidade do movimento é validada fora da transação. Dois
aceites concorrentes podem alocar mais do que o movimento comporta. É defeito do motor
existente, anterior a este trabalho, e viola o Prompt 0 §11.
