# Apoio ao Caixa — memória de execução

## Git
- Branch: `feat/treasury-cash-support` (criada a partir de `main` @ `24c11f8`)
- Último commit da funcionalidade: (este — docs da Etapa 1)
- Working tree na abertura da Etapa 1: limpo

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

## Decisões técnicas aprovadas
1. Reusar `TreasuryReconciliationMatch/Allocation` — já existe e cobre o modelo de alocação exigido.
2. Reusar `treasuryMoney.ts` (string + cents bigint) como transporte monetário.
3. Não tocar em `treasuryCaixaService.server.ts` sem teste de caracterização.

## Limitações
- Board Caixa não filtra por empresa nem por conta; `currency` inexistente no evento canônico.
- Evento canônico não expõe `lineKind`/`orderCode`/`revision`/`fingerprint`/`ruleVersion`.
- `otherMovements` (ledger/transfer) não carregados para dias arbitrários (`not_loaded`).

## Bloqueios
**BLOQUEIO CRÍTICO — identidade econômica** (ver `01-current-state-audit.md` §9).
`economicEventKey`/`canonicalRepresentationKey` não são deriváveis exclusivamente do resultado canônico
atual, e o id sintético das previsões é instável na evolução PV → DS → NF-e → CR.

## Etapa concluída
Etapa 1 — Auditoria técnica das fontes existentes.

## Próxima etapa autorizada
Nenhuma. Etapa 2 depende de decisão do usuário sobre o bloqueio de identidade
(escopo reduzido a títulos reais x propagação de identidade FIN-08).
