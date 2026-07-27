# Prompt 00 — Mapeamento de requisitos: Central de Tesouraria

**Projeto:** IndusCost  
**Data:** 2026-07-27  
**Base:** `docs/treasury/01-DISCOVERY.md`  
**Escopo:** desenho técnico definitivo com nomes reais — **sem alteração de código funcional**

---

## 0. Princípios anti-duplicação (obrigatórios)

| # | Regra | Implicação no desenho |
|---|-------|------------------------|
| A | Nomus é fonte oficial dos títulos CR/CP | Não criar `TreasuryReceivable` / `TreasuryPayable` espelhando o título inteiro |
| B | Local = complementos operacionais | Tabelas novas referenciam `externalId` / `id` do stage Nomus; não regravam `amountReceivable` etc. |
| C | Não somar pedido + NF + CR + previsão | Tesouraria lê CR/CP/baixas; não mistura `SalesOrder.totalNetValue` nem `NomusNfe` como caixa |
| D | Não somar previsão e realização do mesmo título | Overlay “previsto” e baixa Nomus são camadas distintas, nunca somadas |
| E | Fluxo de Caixa atual ≠ caixa bancário | `/finance/cash-flow` permanece projeção AR+AP; Tesouraria é saldo/extrato/conciliação |
| F | Conciliação de Carteira ≠ conciliação bancária | `finance.portfolio_reconciliation` continua O2C; banco é domínio Tesouraria |
| G | Transferência interna não altera caixa consolidado | Ledger gera 2 linhas (débito/crédito) com `transferGroupId`; consolidado zera |
| H | Nunca substituir vencimento original | `dueDate` Nomus imutável na UI/tesouraria; `expectedDate` / promessa são overlays locais |
| I | Sem exclusão física de histórico | Cancelamento / reversão / versionamento + `TreasuryAuditLog` |
| J | DTOs monetários = strings decimais | Novo money kit Tesouraria; não reutilizar `decimalToNumber` em cálculos críticos |

### Fronteira oficial vs Tesouraria

```text
[OFICIAL — já existe, não duplicar]
  NomusAccountsReceivable / NomusAccountsPayable  ← títulos e baixas Nomus
  NomusNfe / SalesOrder                            ← faturamento / pedido (não são caixa)
  /finance/cash-flow                               ← projeção AR+AP
  /finance/portfolio-reconciliation                ← O2C / carteira

[TESOURARIA — novo]
  Contas financeiras locais + saldos + ledger
  Overlays CR/CP (expected date, promessa, cobrança, contestação, programação)
  OFX + matching bancário + fechamento diário
  Agenda / alertas / relatórios de caixa bancário
```

### Convenção de nomes neste documento

- **Existente:** nome real já no repo.
- **Proposto:** nome planejado (ainda não existe no schema). Prefixo `Treasury*` para models novos.

Resource key canônica proposta (única raiz):

| Resource | Actions |
|----------|---------|
| `finance.treasury` | `view`, `create`, `update`, `execute`, `manage`, `export` |
| Filhos (opcional, prompts de ACL) | `finance.treasury.accounts`, `.reconcile`, `.close`, `.ofx`, `.transfers`, `.overlays` |

Feature flag proposta: `TREASURY_MODULE_ENABLED` (env, fail-closed) + resource gate, espelhando `salesOrderFlowFeatureFlags.ts`.

---

## 1. Contas financeiras

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `FinanceModule` / nav (`financeNavigation.ts`, `financeModulesAccess.ts`); Overlay CRUD; `FinancialSupplier` só como lookup opcional de contraparte — **não** como conta |
| **Novo componente necessário** | `TreasuryAccountService`, `TreasuryAccountRepository`, `registerTreasuryAccountRoutes`, UI `TreasuryAccountsPage` / form Overlay |
| **Model oficial relacionado** | Nenhum model de conta bancária hoje. Referência lógica: `NomusAccountsReceivable.bankAccountId` / `bankAccountName` (denormalizado Nomus) para **sugestão de mapeamento**, não como PK |
| **Dados locais complementares** | **Proposto** `TreasuryFinancialAccount` (`id`, `code`, `name`, `bankCode`, `agency`, `accountNumber`, `accountType`, `currency`, `isActive`, `nomusBankAccountId?`, timestamps). Sem soft-delete físico |
| **Endpoint** | `GET/POST /api/finance/treasury/accounts`, `GET/PATCH /api/finance/treasury/accounts/:id` |
| **Tela** | `/finance/treasury/accounts` |
| **Permissão** | `finance.treasury` `view`/`create`/`update`/`manage` |
| **Teste** | `src/lib/treasury/treasuryAccount*.test.ts` |
| **Dependências** | Prompt schema + permissões + flag |
| **Riscos** | Colisão de identidade com `bankAccountId` Nomus (muitos-para-um / nomes mudam); mapear via campo opcional, não FK rígida ao Nomus |

---

## 2. Saldos manuais e históricos

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `financeCivilDate.ts`; padrão audit de `FinancialCostCenterAuditLog` |
| **Novo componente necessário** | `TreasuryBalanceService` (abertura/ajuste manual versionado) |
| **Model oficial relacionado** | Nenhum saldo bancário oficial. Cash-flow declara `hasInitialBankBalance: false` em `financeCashFlowDashboardTypes.ts` |
| **Dados locais complementares** | **Proposto** `TreasuryBalanceSnapshot` (`accountId`, `civilDate`, `observedBalance` Decimal(20,2), `source` MANUAL\|OFX\|CLOSING, `version`, `supersedesId?`, `createdBy`) |
| **Endpoint** | `POST /api/finance/treasury/accounts/:id/balances`, `GET …/balances` |
| **Tela** | Overlay na conta + histórico na ficha da conta |
| **Permissão** | `finance.treasury` `create`/`update` (ajuste); `view` (histórico) |
| **Teste** | versionamento, imutabilidade de snapshot antigo, Decimal string DTO |
| **Dependências** | Contas financeiras |
| **Riscos** | Ajuste silencioso escondendo divergência — proibido; todo ajuste gera audit + motivo obrigatório |

---

## 3. Saldo observado, calculado e conciliado

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Conceito de “camadas” do cash-flow (`projected`/`realized`) só como **analogia UX**, não como fonte |
| **Novo componente necessário** | `TreasuryBalanceEngine` — calcula três saldos sem misturar com `buildFinanceCashFlowDashboard` |
| **Model oficial relacionado** | Baixas Nomus: `amountReceived`/`amountPaid` + datas; **não** são saldo de conta até haver matching |
| **Dados locais complementares** | Engine over: snapshots + ledger (`TreasuryLedgerEntry` proposto) + matches OFX. Campos derivados (não persistir como verdade única se puder recalcular): `observed`, `calculated`, `reconciled`, `divergence` |
| **Endpoint** | `GET /api/finance/treasury/accounts/:id/balance-position?date=` |
| **Tela** | Cards no dashboard Tesouraria + ficha da conta |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | fixtures com divergência explícita; assert de não-zero-hide |
| **Dependências** | Contas, saldos, ledger (mínimo) |
| **Riscos** | UI confundir com `netCashPosition` do Fluxo de Caixa — labels obrigatórios “Saldo bancário” vs “Fluxo projetado” |

---

## 4. Contas a receber (títulos)

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Model `NomusAccountsReceivable`; APIs `financeAccountsReceivableRoutes.ts`; engines `financeAccountsReceivable*.ts`; sync `settingsNomusSyncRoutes` / scripts Nomus AR |
| **Novo componente necessário** | Adapter de leitura `treasuryReceivableRead.ts` (projection DTO string) + UI aba Tesouraria que **consome** títulos oficiais |
| **Model oficial relacionado** | **`NomusAccountsReceivable`** (oficial) |
| **Dados locais complementares** | Apenas overlays (§7–11); **não** copiar título |
| **Endpoint** | Reuso: `GET /api/finance/accounts-receivable/titles` **ou** facade `GET /api/finance/treasury/receivables` (proxy read-only + joins de overlay) |
| **Tela** | `/finance/treasury/receivables` (ou aba) — deep-link para `/finance/accounts-receivable` quando for gestão oficial |
| **Permissão** | Leitura títulos: `finance.accounts_receivable` `view` **e** shell Tesouraria `finance.treasury` `view` |
| **Teste** | contrato: facade não persiste cópia; overlay join por `externalId` |
| **Dependências** | Sync Nomus AR saudável |
| **Riscos** | Segunda base de CR — **proibido**. Facade não pode `upsert` título |

---

## 5. Contas a pagar (títulos)

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `NomusAccountsPayable`; `financeAccountsPayableRoutes.ts`; Due Radar; alocação CC `AccountsPayableCostCenterAllocation` |
| **Novo componente necessário** | Adapter `treasuryPayableRead.ts` + overlays locais |
| **Model oficial relacionado** | **`NomusAccountsPayable`** |
| **Dados locais complementares** | Overlays programação/contestação; não duplicar `amountPayable` |
| **Endpoint** | Reuso `/api/finance/accounts-payable/*` ou facade read-only Tesouraria |
| **Tela** | `/finance/treasury/payables` + deep-link `/finance/accounts-payable` |
| **Permissão** | `finance.accounts_payable` `view` + `finance.treasury` `view` |
| **Teste** | isolamento: bag AP não abre Tesouraria e vice-versa (seguir `FINANCE_SIBLING_ISOLATION_KEYS`) |
| **Dependências** | Sync Nomus AP |
| **Riscos** | Usar `FinancialSupplier` como se fosse título — incorreto |

---

## 6. Previsto versus realizado

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Cash-flow `viewMode` `projected`/`realized`/`combined` (`financeCashFlowDashboard*`); Daily Radar |
| **Novo componente necessário** | Visão Tesouraria: previsto = overlays/agenda/programação; realizado = baixas Nomus **matched** ao ledger/OFX |
| **Model oficial relacionado** | AR: `amountReceivable`/`amountReceived`/`balanceReceivable`/`settlementDate`; AP: análogos `amountPaid`/`paymentDate` |
| **Dados locais complementares** | Flags de camada no DTO; sem nova tabela de “título previsto” |
| **Endpoint** | `GET /api/finance/treasury/forecast-vs-actual` |
| **Tela** | Dashboard Tesouraria + charts (`FinanceBi*` shell) |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | nunca soma previsto+realizado do mesmo `externalId` |
| **Dependências** | Overlays + leitura AR/AP |
| **Riscos** | Duplicar KPIs do `/finance/cash-flow` sem declarar diferença de significado |

**Anti-duplicação:** manter cash-flow como está; Tesouraria não substitui nem recalcula `buildFinanceCashFlowDashboard`.

---

## 7. Datas esperadas

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `dueDate` oficial Nomus; `scheduleDate` Nomus (somente leitura); `financeCivilDate.ts` |
| **Novo componente necessário** | `TreasuryExpectedDateService` |
| **Model oficial relacionado** | `NomusAccountsReceivable.dueDate` / `NomusAccountsPayable.dueDate` (**imutáveis** na Tesouraria) |
| **Dados locais complementares** | **Proposto** `TreasuryTitleOverlay` (ou `TreasuryExpectedDate`): `side` AR\|AP, `nomusExternalId`, `expectedDate`, `reason`, `status`, `version`, `createdBy` |
| **Endpoint** | `PUT /api/finance/treasury/overlays/:side/:externalId/expected-date` |
| **Tela** | Coluna “Data esperada” nas listas Tesouraria + Overlay edit |
| **Permissão** | `finance.treasury` `update` |
| **Teste** | assert `dueDate` inalterado após PUT expected |
| **Dependências** | Contas overlays schema |
| **Riscos** | UI sobrescrever visualmente vencimento — layout deve mostrar ambos |

---

## 8. Promessas de pagamento

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Overlay UI; civil dates |
| **Novo componente necessário** | `TreasuryPaymentPromiseService` |
| **Model oficial relacionado** | Título oficial via `nomusExternalId` → AR/AP |
| **Dados locais complementares** | **Proposto** `TreasuryPaymentPromise` (`nomusExternalId`, `side`, `promisedDate`, `promisedAmount` Decimal string, `contactNote`, `status` ACTIVE\|FULFILLED\|BROKEN\|CANCELLED, versionamento) |
| **Endpoint** | `POST/GET/PATCH /api/finance/treasury/promises` |
| **Tela** | Drawer do título + agenda |
| **Permissão** | `finance.treasury` `create`/`update`/`view` |
| **Teste** | promessa não altera `dueDate` nem `balance*` |
| **Dependências** | Overlay title |
| **Riscos** | Tratar promessa como baixa — proibido |

---

## 9. Ações de cobrança

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Overlay; `CommercialAuditLog` só como referência de padrão (domínio diferente) |
| **Novo componente necessário** | `TreasuryCollectionActionService` |
| **Model oficial relacionado** | `NomusAccountsReceivable` (+ `suspendCollection` read-only) |
| **Dados locais complementares** | **Proposto** `TreasuryCollectionAction` (`receivableExternalId`, `actionType`, `performedAt`, `channel`, `notes`, `nextActionAt`, `createdBy`) |
| **Endpoint** | `POST/GET /api/finance/treasury/collection-actions` |
| **Tela** | Timeline no drawer CR |
| **Permissão** | `finance.treasury` `create`/`view` |
| **Teste** | append-only / cancelamento lógico |
| **Dependências** | Overlay AR |
| **Riscos** | Misturar com CRM `CommercialActivity` — escopos distintos; link opcional futuro, não merge |

---

## 10. Contestações

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Overlay; padrão status cancelável (fiscal guides) |
| **Novo componente necessário** | `TreasuryDisputeService` |
| **Model oficial relacionado** | AR/AP oficiais |
| **Dados locais complementares** | **Proposto** `TreasuryDispute` (`side`, `nomusExternalId`, `openedAt`, `reason`, `amountDisputed`, `status` OPEN\|RESOLVED\|CANCELLED, `resolutionNote`) |
| **Endpoint** | `POST/PATCH/GET /api/finance/treasury/disputes` |
| **Tela** | Badge + drawer |
| **Permissão** | `finance.treasury` `create`/`update`/`view` |
| **Teste** | contestação não zera `balance*` oficial |
| **Dependências** | Overlays |
| **Riscos** | Esconder título vencido via contestação sem alerta — alertas devem listar disputa aberta |

---

## 11. Programação de pagamentos

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Due Radar (`financeDueRadarRoutes.ts`); Daily Radar payables; CC allocation |
| **Novo componente necessário** | `TreasuryPaymentScheduleService` (intenção de pagamento local) |
| **Model oficial relacionado** | `NomusAccountsPayable` |
| **Dados locais complementares** | **Proposto** `TreasuryPaymentScheduleItem` (`payableExternalId`, `scheduledDate`, `scheduledAmount`, `priority`, `accountId?`, `status` PLANNED\|APPROVED\|EXECUTED\|CANCELLED) |
| **Endpoint** | `GET/POST/PATCH /api/finance/treasury/payment-schedule` |
| **Tela** | `/finance/treasury/payment-schedule` |
| **Permissão** | `finance.treasury` `view`/`create`/`update`/`execute` |
| **Teste** | parcial preserva saldo aberto (scheduleAmount ≤ balancePayable) |
| **Dependências** | Contas + AP read |
| **Riscos** | Duplicar Due Radar — UI deve deixar claro: Radar = vencimento oficial; Schedule = intenção tesouraria |

---

## 12. Projeção contratual, provável e confirmada

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Cash-flow forecast/cenários; `PortfolioReconciliationFact.forecastSource` (RECEIVABLE\|NFE\|ORDER\|UNRESOLVED) — **somente leitura contextual**, não fonte de caixa bancário |
| **Novo componente necessário** | `TreasuryCashProjectionEngine` com 3 camadas: CONTRACTUAL / PROBABLE / CONFIRMED |
| **Model oficial relacionado** | CR/CP oficiais + overlays (promessa/expected) + schedules |
| **Dados locais complementares** | Regras de classificação em código (+ config JSON opcional); sem copiar fatos portfolio |
| **Endpoint** | `GET /api/finance/treasury/projections` |
| **Tela** | Charts no dashboard Tesouraria (`FinanceBiChartExpandModal`) |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | matriz de classificação; não incluir `SalesOrder` como CONFIRMED |
| **Dependências** | Overlays + AR/AP |
| **Riscos** | Confundir com portfolio forecast — documentar: portfolio = O2C; treasury = caixa |

---

## 13. Agenda financeira

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Calendário cash-flow; Due Radar; civil dates |
| **Novo componente necessário** | `TreasuryAgendaService` + `TreasuryAgendaPage` |
| **Model oficial relacionado** | `dueDate` AR/AP + overlays/promises/schedules |
| **Dados locais complementares** | View model agregada (pode ser não persistida) |
| **Endpoint** | `GET /api/finance/treasury/agenda?from=&to=` |
| **Tela** | `/finance/treasury/agenda` |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | ordenação civil; camadas etiquetadas |
| **Dependências** | Overlays + schedules |
| **Riscos** | Virar segundo Daily Radar — escopo: agenda operacional de caixa/conta |

---

## 14. Transferências

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Overlay confirmação; Decimal rigoroso |
| **Novo componente necessário** | `TreasuryTransferService` (transação atômica 2 pernas) |
| **Model oficial relacionado** | Nenhum existente |
| **Dados locais complementares** | **Proposto** `TreasuryTransfer` + 2× `TreasuryLedgerEntry` com mesmo `transferGroupId`, `entryType` TRANSFER_OUT/IN |
| **Endpoint** | `POST /api/finance/treasury/transfers`, `GET …/transfers` |
| **Tela** | Overlay transferir + extrato |
| **Permissão** | `finance.treasury` `execute`/`view` |
| **Teste** | consolidado invariante (soma contas = 0 impacto); cancelamento gera reversão |
| **Dependências** | Contas + ledger |
| **Riscos** | Contabilizar transferência como receita/despesa no cash-flow — **não integrar** assim |

---

## 15. Lançamentos manuais

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Overlay forms; audit pattern |
| **Novo componente necessário** | `TreasuryManualEntryService` |
| **Model oficial relacionado** | Opcional link lógico a AR/AP `externalId` (não obrigatório) |
| **Dados locais complementares** | **Proposto** `TreasuryLedgerEntry` (`accountId`, `civilDate`, `amount`, `direction` DEBIT\|CREDIT, `nature` MANUAL\|TRANSFER\|OFX_MATCH\|ADJUSTMENT\|REVERSAL, `memo`, `counterpartRef?`, `status` ACTIVE\|REVERSED) |
| **Endpoint** | `POST /api/finance/treasury/ledger-entries`, `POST …/:id/reverse` |
| **Tela** | Extrato da conta + formulário |
| **Permissão** | `finance.treasury` `create`/`execute` (reverse) |
| **Teste** | reverse não delete; audit trail |
| **Dependências** | Contas; bloqueio se dia fechado |
| **Riscos** | Lançamento manual “simulando” baixa Nomus — UI deve impedir marcar como baixa oficial |

---

## 16. Exceções

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Padrão de issues (`CommissionAuditIssue` como analogia) |
| **Novo componente necessário** | `TreasuryExceptionService` |
| **Model oficial relacionado** | Divergências saldo/OFX/match; títulos com overlay inconsistente |
| **Dados locais complementares** | **Proposto** `TreasuryException` (`type`, `severity`, `payload Json`, `status` OPEN\|ACK\|RESOLVED\|CANCELLED, `accountId?`, `nomusExternalId?`) |
| **Endpoint** | `GET/PATCH /api/finance/treasury/exceptions` |
| **Tela** | Painel Exceções no dashboard |
| **Permissão** | `finance.treasury` `view`/`update` |
| **Teste** | resolução exige nota; não auto-fecha divergência de saldo |
| **Dependências** | Balance engine + OFX |
| **Riscos** | Auto-resolução silenciosa — proibida |

---

## 17. Alertas

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `ExecutiveAlert` UI; CFO insights cash-flow (não copiar regras) |
| **Novo componente necessário** | `TreasuryAlertEngine` + opcional job/cron shell |
| **Model oficial relacionado** | Saldos, vencidos AR (`financeAccountsReceivableOverdue*`), schedules, fechamentos |
| **Dados locais complementares** | Exceções + feed derivado; config mínima em **proposto** `TreasurySettings` key/value **ou** env |
| **Endpoint** | `GET /api/finance/treasury/alerts` |
| **Tela** | Banner/lista no dashboard Tesouraria |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | regras determinísticas com fixtures |
| **Dependências** | Exceptions + balances |
| **Riscos** | Spam vs. silêncio; não reutilizar score CFO cash-flow como se fosse bancário |

---

## 18. Fechamento diário

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Padrão versionamento (`CommissionMonthlyClosing.supersededByClosingId`, `FiscalApurationPeriod` CLOSED) |
| **Novo componente necessário** | `TreasuryDailyClosingService` |
| **Model oficial relacionado** | Nenhum fechamento de caixa bancário hoje |
| **Dados locais complementares** | **Proposto** `TreasuryDailyClosing` (`civilDate`, `status` OPEN\|CLOSED\|REOPENED`, `version`, `immutablePayload Json`, `closedBy`, `closedAt`, `contentHash`) — imutável após CLOSED |
| **Endpoint** | `POST /api/finance/treasury/closings`, `GET …/closings/:date` |
| **Tela** | `/finance/treasury/closings` |
| **Permissão** | `finance.treasury` `execute`/`manage`/`view` |
| **Teste** | mutação de payload fechado falha; nova versão só via reopen flow |
| **Dependências** | Balances + ledger + exceptions gate |
| **Riscos** | Fechar com divergência oculta — gate obrigatório (ack explícito) |

---

## 19. Reabertura

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Supersession pattern (closings/comissões) |
| **Novo componente necessário** | `TreasuryReopenClosingService` |
| **Model oficial relacionado** | `TreasuryDailyClosing` (proposto) |
| **Dados locais complementares** | Novo registro versionado + motivo; anterior permanece imutável |
| **Endpoint** | `POST /api/finance/treasury/closings/:date/reopen` |
| **Tela** | Ação na ficha de fechamento |
| **Permissão** | `finance.treasury` `manage` |
| **Teste** | audit obrigatório; permissões manage-only |
| **Dependências** | Fechamento |
| **Riscos** | Reabertura “in-place” — proibida |

---

## 20. Importação OFX

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `DataImportDialog`; multer (já em deps); `IntegrationRun` como run log genérico **ou** run dedicado |
| **Novo componente necessário** | `TreasuryOfxParser`, `TreasuryOfxImportService` (idempotente por hash) |
| **Model oficial relacionado** | Conta financeira local (mapeamento) |
| **Dados locais complementares** | **Proposto** `TreasuryOfxImport` + `TreasuryOfxTransaction` (`fitId`/`hash` unique por conta, `postedDate`, `amount`, `memo`, `raw`, `matchStatus`) |
| **Endpoint** | `POST /api/finance/treasury/ofx/import`, `GET …/ofx/imports` |
| **Tela** | `/finance/treasury/ofx` |
| **Permissão** | `finance.treasury` `execute`/`view` |
| **Teste** | reimport mesmo arquivo = 0 duplicatas; Decimal parse |
| **Dependências** | Contas; flag |
| **Riscos** | Parser OFX incompleto (bancos BR) — começar strict + quarantine de linhas inválidas |

---

## 21. Conciliação bancária

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | UX drawers de portfolio **apenas como padrão de UI**, não engine O2C |
| **Novo componente necessário** | `TreasuryBankReconciliationService` (match OFX ↔ ledger ↔ baixa Nomus) |
| **Model oficial relacionado** | Baixas em `NomusAccountsReceivable`/`Payable` (datas/valores); **não** `PortfolioReconciliationFact` |
| **Dados locais complementares** | **Proposto** `TreasuryReconciliationMatch` (`ofxTxId`, `ledgerEntryId?`, `nomusSide?`, `nomusExternalId?`, `status`, `confidence`) |
| **Endpoint** | `POST /api/finance/treasury/reconcile/matches`, `GET …/reconcile/workspace` |
| **Tela** | `/finance/treasury/reconcile` |
| **Permissão** | `finance.treasury` `execute`/`view` |
| **Teste** | match parcial; unmatch; não alterar título Nomus |
| **Dependências** | OFX + ledger + AR/AP read |
| **Riscos** | Nome “conciliação” conflitar com portfolio — labels: **Conciliação bancária** |

---

## 22. Relatórios

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Shell executivo (`FinanceExecutivePageHeader`); print branding helpers |
| **Novo componente necessário** | `TreasuryReportService` (posição, movimentação, conciliação, aging caixa) |
| **Model oficial relacionado** | Contas/ledger/OFX/closings + leitura AR/AP |
| **Dados locais complementares** | Queries/read models |
| **Endpoint** | `GET /api/finance/treasury/reports/:reportKey` |
| **Tela** | `/finance/treasury/reports` |
| **Permissão** | `finance.treasury` `view`/`export` |
| **Teste** | totais batem com balance engine |
| **Dependências** | Domínio core |
| **Riscos** | Relatório misturar faturamento (`NomusNfe`) — escopo caixa only |

---

## 23. Exportações

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Padrão `*Export*.ts` + `export.xlsx` (xlsx dep); botões Daily Radar / Horizon |
| **Novo componente necessário** | `treasury*Export.ts` |
| **Model oficial relacionado** | Mesmos do relatório |
| **Dados locais complementares** | — |
| **Endpoint** | `GET /api/finance/treasury/.../export.xlsx` (+ csv onde fizer sentido) |
| **Tela** | Botões nas páginas Tesouraria |
| **Permissão** | `finance.treasury` `export` (não degradar para `view` como cash-flow) |
| **Teste** | content-disposition + colunas Decimal string |
| **Dependências** | Relatórios |
| **Riscos** | Export com number float — usar strings |

---

## 24. Auditoria

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Padrão `PermissionAuditLog`, `FinancialCostCenterAuditLog`, writers por domínio |
| **Novo componente necessário** | `writeTreasuryAuditLog` |
| **Model oficial relacionado** | — |
| **Dados locais complementares** | **Proposto** `TreasuryAuditLog` (`action`, `entityType`, `entityId`, `beforeJson`, `afterJson`, `actorUserId`, `performedAt`, `correlationId`) |
| **Endpoint** | `GET /api/finance/treasury/audit` (manage/view restrito) |
| **Tela** | Drawer auditoria / admin |
| **Permissão** | `finance.treasury` `manage` (ou `view` audit se policy permitir) |
| **Teste** | toda ação crítica gera 1 log |
| **Dependências** | Todos os writes |
| **Riscos** | Log sem before/after em money — exigir payload |

---

## 25. Permissões

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `permissionContract/resources.ts`, `requireResource`, seed `permissions:seed:contract:*`, `financeModulesAccess.ts`, `useAuthorizedTabs` |
| **Novo componente necessário** | Entradas contrato `finance.treasury*`; nav em `financeNavigation` / sidebar resources; testes isolation |
| **Model oficial relacionado** | `PermissionResource`, `RolePermission`, `UserPermissionOverride`, `PermissionAuditLog` |
| **Dados locais complementares** | Seed catalog only |
| **Endpoint** | Existentes admin permissions; guards nas rotas Tesouraria |
| **Tela** | Matriz admin + tab Financeiro |
| **Permissão** | bootstrap via seed |
| **Teste** | `treasuryPermissions.test.ts` + contrato truth table |
| **Dependências** | Prompt ACL cedo |
| **Riscos** | Abrir Tesouraria com `finance.view` bag — proibido (seguir isolamento de irmãos) |

---

## 26. Observabilidade

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `GET /api/health`; logs `console.*`; Nomus sync log dir; opcional `INDUSCOST_PERF_BASELINE` |
| **Novo componente necessário** | Health detalhado Tesouraria; métricas de import OFX / closings; correlationId em audit |
| **Model oficial relacionado** | `IntegrationRun` / runs OFX |
| **Dados locais complementares** | Status fields nos runs |
| **Endpoint** | `GET /api/finance/treasury/health` (auth) |
| **Tela** | Indicadores no dashboard / settings |
| **Permissão** | `finance.treasury` `view` |
| **Teste** | health fail-closed se flag off |
| **Dependências** | Flag + routes |
| **Riscos** | Logar payload OFX sensível — mascarar |

---

## 27. Testes

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | Runner `tsx --test`; scripts `test:finance:*`; `scripts/unit-test-files.txt` / `test:unit` |
| **Novo componente necessário** | Suíte `npm run test:treasury` agregando `src/lib/treasury/**/*.test.ts` (+ UI contract tests) |
| **Model oficial relacionado** | — |
| **Dados locais complementares** | Fixtures Decimal string |
| **Endpoint** | — |
| **Tela** | — |
| **Permissão** | testes de guard |
| **Teste** | money, transfer invariant, closing immutability, overlay non-mutation, OFX idempotency, no Prisma in FE graph |
| **Dependências** | Cada entrega |
| **Riscos** | Testes só de string de arquivo — preferir testes de engine puros |

---

## 28. Documentação

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `docs/finance/*`, `docs/treasury/01-DISCOVERY.md` |
| **Novo componente necessário** | Este arquivo + plano + runbooks futuros (`04+`) |
| **Model oficial relacionado** | — |
| **Dados locais complementares** | — |
| **Endpoint** | — |
| **Tela** | — |
| **Permissão** | — |
| **Teste** | — |
| **Dependências** | Cada prompt atualiza `IMPLEMENTATION_STATUS.md` |
| **Riscos** | Docs divergirem do schema — status obrigatório |

---

## 29. Feature flags

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `salesOrderFlowFeatureFlags.ts` (padrão fail-closed) |
| **Novo componente necessário** | `treasuryFeatureFlags.ts` — `TREASURY_MODULE_ENABLED` + `requireTreasuryEnabled` |
| **Model oficial relacionado** | Nenhum FeatureFlag model |
| **Dados locais complementares** | Env only (+ resource) |
| **Endpoint** | Rotas retornam 404/403 se off |
| **Tela** | Nav oculta se off / sem grant |
| **Permissão** | resource ainda exigido quando on |
| **Teste** | fail-closed matrix |
| **Dependências** | Prompt foundation |
| **Riscos** | Flag on sem migration aplicada |

---

## 30. Scripts seguros de implantação e validação

| Campo | Conteúdo |
|-------|----------|
| **Componente existente reutilizado** | `backup:pre-deploy`; padrão scripts `preview`/`apply`; `permissions:validate`; checks import |
| **Novo componente necessário** | `scripts/treasuryValidate*.ts`, runbook `docs/treasury/DEPLOYMENT_RUNBOOK.md` (prompt futuro) — **Cursor não executa produção** |
| **Model oficial relacionado** | migrations Prisma versionadas |
| **Dados locais complementares** | — |
| **Endpoint** | — |
| **Tela** | — |
| **Permissão** | — |
| **Teste** | dry-run validation script |
| **Dependências** | Schema estável |
| **Riscos** | `prisma db push` / `migrate dev` em prod — **proibido**; só `migrate deploy` pelo usuário |

---

## 31. Matriz resumida — oficial vs local

| Dado | Onde vive | Tesouraria pode escrever? |
|------|-----------|---------------------------|
| Título CR/CP, valores, vencimento, baixa Nomus | `NomusAccountsReceivable` / `Payable` | **Não** |
| Pedido / NF-e | `SalesOrder` / `NomusNfe` | **Não** (leitura contextual mínima) |
| Fluxo de Caixa dashboard | engines cash-flow | **Não** alterar |
| Portfolio O2C facts | `PortfolioReconciliation*` | **Não** |
| Conta bancária IndusCost, saldo, ledger, OFX, fechamento | models `Treasury*` (propostos) | **Sim** |
| Expected date, promessa, cobrança, disputa, schedule | overlays `Treasury*` | **Sim** |
| Match bancário | `TreasuryReconciliationMatch` | **Sim** (não muta Nomus) |

---

## 32. Estrutura de código alvo (não implementar neste prompt)

```text
src/lib/treasury/
  treasuryFeatureFlags.ts
  treasuryMoney.ts              # Decimal + DTO string (shared-safe)
  treasuryMoney.server.ts       # Prisma.Decimal bridges
  domain/ …
  services/ …
  repositories/ …
  schemas/ …
  *Routes.ts
  *.test.ts

src/components/finance/treasury/
  TreasuryModule pages…

prisma/schema.prisma            # models Treasury* (prompts de schema)
```

Registro: `registerTreasuryRoutes(app, auth)` chamado em `server.ts` (1 linha), sem lógica de negócio no `server.ts`.
