# Apoio ao Caixa — memória de execução

## Git
- Branch: `feat/treasury-cash-support`
- Backup protegido: `backup/cash-support-audit-f0821d7` → `f0821d7`
- Etapa 1: `f0821d7` (já publicada em `origin/main` por fluxo externo — não reescrever)
- Etapa 2: docs de ADR, matriz e read model

## Caminhos principais
| Papel | Caminho |
|---|---|
| Tela Caixa | `src/components/finance/treasury/TreasuryCaixaPage.tsx` |
| Linha do tempo (UI) | `src/components/finance/treasury/TreasuryCaixaTimeline.tsx` |
| Rota | `treasuryRoutes.ts` → `TREASURY_CAIXA_PATH` (`caixa.getBoard`) |
| Controller | `src/lib/treasury/controllers/treasuryCaixaController.ts` |
| Service (fonte canônica) | `src/lib/treasury/services/treasuryCaixaService.server.ts` |
| Motor único-de-dia | `src/lib/treasury/domain/treasuryCaixaCanonicalDay.ts` |
| Regras da timeline | `src/lib/treasury/domain/treasuryCaixaRules.ts` |
| Agenda efetiva FIN-08 (CR) | `src/lib/finance/financeAccountsReceivableEffectiveTitles.ts` |
| OFX preview/apply | `services/treasuryBankImportOfxPreviewService.server.ts`, `...OfxApplyService.server.ts` |
| Conciliação existente | `domain/treasuryReconciliationMatchRules.ts`, `services/treasuryReconciliationMatchService.server.ts` |
| Saldo manual | `TreasuryBalanceSnapshot` + `services/treasuryOfficialTodayBalance.server.ts` |
| Dinheiro (Decimal/string) | `src/lib/treasury/treasuryMoney.ts` |

## Fonte canônica identificada
`TreasuryCaixaService.getBoard({year, month?, day?})` → `TreasuryCaixaBoardDto`.
Population: FIN-08 (`buildFinanceCashFlowEffectiveArPortfolio`) para CR + `loadFinanceApManagementRowsFromPrisma` para CP,
projetados em dias por `buildTreasuryCaixaCanonicalDays` (6 dimensões disjuntas).

## Contratos identificados
- `TreasuryCaixaBoardDto`: `realizedDays`, `canonicalDays`, `receivables`, `payables`,
  `monthlyDueEstimates`, `dailyDueEstimates`, `overdue`, `totals`, `officialTodayBalance`.
- Título exposto: `FinanceAccountsReceivableGridRow` / `FinanceAccountsPayableGridRow`.

## Tabelas OFX identificadas
`TreasuryBankImportBatch` (fileSha256, status), `TreasuryBankMovement`
(fingerprint, fitId, direction, amount Decimal(20,2), currency, postedCivilDate,
reconciliationStatus, reconciledAmount).

## Fonte do saldo manual
`TreasuryBalanceSnapshot` (accountId, referenceAt, availableBalance/blocked/investments/usedLimit,
origin, idempotencyKey, cancelledAt) + precedência em `loadTreasuryOfficialTodayBalance`.

## Decisões técnicas aprovadas (permanentes — ADR 001)
1. **Nenhum segundo motor.** `TreasuryReconciliation*` é a autoridade de conciliação.
2. **Somente títulos reais conciliáveis** (`externalId > 0`, lado AR/AP).
3. **Previsões são contexto**: nunca recebem allocation, nunca marcadas como pagas/recebidas.
4. Três identidades distintas e não intercambiáveis: `officialTitleKey`, `bankMovementKey`,
   `forecastContextKey` (esta proibida em qualquer escrita).
5. `bankDate` (`postedCivilDate`) determina o realizado; `dueDate` determina previsão/atraso.
6. Movimento válido afeta a posição bancária mesmo sem classificação.
7. Transferência interna: consolidado zero.
8. Reusar `treasuryMoney.ts` (string + cents bigint); proibido float no caminho monetário.
9. Reusar `resolveAuthorizedAccountIds` (ACL anti-IDOR) e `TreasuryAuditLog`.
10. Não tocar em `treasuryCaixaService.server.ts` sem teste de caracterização.

## Limitações
- Board Caixa não filtra por empresa nem por conta; `currency` inexistente no evento canônico.
- Evento canônico não expõe `lineKind`/`orderCode`/`revision`/`fingerprint`/`ruleVersion`.
- `otherMovements` (ledger/transfer) não carregados para dias arbitrários (`not_loaded`).

## Bloqueios
- Bloqueio de identidade da Etapa 1 **resolvido pela ADR 001**: escopo reduzido a títulos reais.
- Persistem parciais: empresa (#41) e conta (#42) ausentes no lado canônico — ver matriz.

## Lacunas reais confirmadas (matriz §B)
#4 correções OFX · #6 saldo available · #8 cobertura de extrato · #27 rejeição de sugestão ·
**#30 capacidade validada fora da transação (mais grave)** · #31 idempotência no accept ·
#32 maker-checker.

## Etapa concluída
Etapa 2 — ADR, identidades, matriz de lacunas e read model proposto.

## Próxima etapa autorizada
Etapa 3 — validar as 7 lacunas reais e produzir backlog (`05`) e MVP (`06`). Somente docs.
