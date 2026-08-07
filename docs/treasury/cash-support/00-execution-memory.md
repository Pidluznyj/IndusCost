# Apoio ao Caixa — memória de execução

## Git
- **Branch de trabalho atual: `feat/treasury-cash-support-v2`**, em worktree isolado:
  `C:\Users\paulo\...\IndusCost-cash-support` (separado de `C:\...\IndusCost`, onde
  roda o trabalho concorrente de materiais/Nomus). Estratégia oficial enquanto houver
  concorrência no repo principal — não remover o worktree entre sessões.
- `feat/treasury-cash-support` (v1, sem worktree) foi abandonada: acumulou commit de
  outro trabalho por cima. **Não usar, não apagar.**
- Base da v2: HEAD de `main` em `c8def01c2ebf15f1cf2a5cfc8588bafcfc3a2c32`, que já
  contém os 6 commits válidos (f0821d7, 24431e0, da55038, 92f50d6, 71a9a80, 9833277)
  mais docs/checklist (19f7169).
- Backups protegidos: `backup/cash-support-audit-f0821d7`,
  `backup/cash-support-before-full-implementation-20260806-da55038`.

## Grupos concluídos nesta branch (worktree)
- **Grupo A** (docs, backlog, P0): herdado de `main`, completo com os 2 resíduos fechados.
- **Grupo B** (contratos + adaptadores + read model) — **COMPLETO**:
  - CS-001 `4b5a618` — `cashSupportContracts.ts`/`.test.ts` (17 testes)
  - CS-002 `c981633` — adaptador canônico (8 testes)
  - CS-003 `104a386` — adaptador bancário/OFX (14 testes)
  - CS-004 `c05bd7c` — adaptador de conciliação (11 testes; achou e corrigiu bug real de soma em desconto)
  - CS-005 `f18f200` — read model unificado, função pura (11 testes)
  - Total: 61/61 testes passando em conjunto; zero erro de typecheck nos arquivos novos.
- **Grupo C** (API, workspace, sugestões) — **COMPLETO**:
  - CS-006 `2e0b7a4` — API read-only (`GET /cash-support`, `/summary`)
  - CS-007 `7dd93c3` — workspace read-only (`CashSupportPanel` + `CashSupportWorkspacePage`)
  - CS-008 `a3188a4` — sugestões somente leitura (reusa motor oficial, zero algoritmo novo)
- **Grupo D** (ações de escrita) — **COMPLETO**:
  - CS-000 residual (idempotencyKey no client) + CS-011/012/013/014/015/016 `b8fc237` —
    conciliação manual 1:1/1:N/N:1/parcial + ajustes + unmatch + reverse, tudo delegando
    ao motor oficial já corrigido pelo P0. Transferências: link para tela madura existente
    em vez de duplicar. Rota registrada em `/finance/treasury/cash-support`.
  - Regressão: 72/72 testes (P0 + conciliação + Cash Support completo).

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

## Matriz — números finais (Etapa 3)
48 requisitos: **25 REUTILIZAR · 14 REUTILIZAR COM ADAPTADOR · 6 LACUNA REAL ·
1 FORA DO ESCOPO · 2 BLOQUEADO parcial**.
Lacunas reais: #4 correções OFX · #6 saldo available · #8 cobertura de extrato ·
#27 rejeição de sugestão · **#30 concorrência (P0)** · #32 maker-checker.
(#31 idempotência foi reclassificada — o padrão `idempotencyKey` já existe na Tesouraria.)

## Estado da branch — aceito e congelado
- `feat/treasury-cash-support` aponta para descendente de `f0821d7` que também contém commits
  recentes de `main`. **Autorizado.**
- **Proibido** redefinir a branch para `f0821d7`, resetar, force push ou reescrever histórico
  publicado. `f0821d7` já está em `origin/main`.
- Ponto exato protegido em `backup/cash-support-audit-f0821d7`.

## DEFEITO CASH-SUPPORT-P0-CONCURRENCY-001 (permanente até resolução)
- Severidade **P0 — integridade financeira**. BLOQUEADOR PARA OPERAÇÕES DE ESCRITA.
- `treasuryReconciliationMatchService.server.ts` → `accept()`: capacidade lida fora da
  transação e reusada dentro dela.
- **Pode continuar:** documentação, contratos, adaptadores read-only, read model, API
  read-only, workspace read-only, sugestões sem aceite (CS-001…CS-010).
- **Bloqueado:** aceite, rejeição mutável, conciliação manual, parcial, 1:N, N:1, ajustes,
  transferências, reversões dependentes de capacidade, maker-checker, liberação produtiva
  de escrita (CS-011…CS-016, CS-019).
- **Obrigações:** corrigir no **motor oficial**; proibido contorno no frontend; proibido
  segundo motor; testes de **concorrência real** obrigatórios antes de liberar escrita.
- Mecanismo de correção é **reuso**: advisory lock já usado no fechamento diário
  (`pg_try_advisory_lock`) e `idempotencyKey` institucional.

## Bloqueios parciais remanescentes
Empresa (#41) e conta (#42): entregar com `null` + warning estruturado. **Não inventar** — em
especial, proibido casar título↔conta por semelhança de nome.

## CS-000 — correção do P0 (commit `92f50d6`)
Capacidade do movimento agora é relida e validada **dentro** da transação, após
`SELECT ... FOR UPDATE` em ordem determinística de id. Pernas repetidas do mesmo movimento são
agregadas antes de validar. 6 testes de concorrência + 20 de regressão passam. Sem migration.

**Gate de escrita ainda NÃO totalmente liberado** — dois resíduos (ver `08`):
1. **Residual do título sem lock**: valida contra o `openBalance` do payload, não contra saldo
   relido sob lock. Concorrência sobre o mesmo título via movimentos diferentes ainda pode
   exceder. Exige decisão de modelo (advisory lock por `officialTitleKey`).
2. **Idempotência ausente** no `accept`: exige coluna nova; adiada porque `prisma/schema.prisma`
   tem alterações não commitadas de outro trabalho (Planejamento de MP).

## Cobertura das 24 etapas (ver `13-full-implementation-checklist.md`)
3 CONCLUÍDAS (1,2,3) · 2 COM LIMITAÇÃO (20 + P0 transversal) · 5 BLOQUEADAS (12–16) ·
14 NÃO INICIADAS · 0 sem evidência. **A funcionalidade não está concluída.**

## Grupos (checkpoint)
- **Grupo A** (docs, backlog, P0): CONCLUÍDO COM LIMITAÇÃO — 2 resíduos do P0.
- **Grupos B a F**: não iniciados.

## Etapa concluída
Etapas 1–3 (documentação) + CS-000 (correção do P0, parcial) + checklist de cobertura.

## Próxima etapa autorizada — duas frentes independentes
1. **CS-000b** (fecha o Grupo A e destrava 5 etapas): advisory lock por `officialTitleKey` +
   coluna `idempotencyKey` (migration aditiva nullable). O impedimento do schema **já não
   existe** — working tree limpo desde `d0d5a45`.
2. **CS-001** (inicia o Grupo B): contratos do read model. Não depende do P0.
