# Central de Tesouraria — Relatório Final de Entrega

**Data:** 2026-07-28  
**Programa:** Prompts 00–68 (implementação) + relatório documental final (Prompt 69)  
**Branch de entrega:** `main`  
**Último commit funcional Tesouraria:** `c5b0800`  
**Merge de integração em main:** `e14a655` (`merge(treasury): integrate Treasury Center into main`)  
**Escopo deste documento:** consolidação da entrega — **sem novas funcionalidades**.  
**Fontes de verdade:** `src/lib/treasury/**`, `src/components/finance/treasury/**`, `prisma/schema.prisma`, `prisma/migrations/*treasury*`, `docs/treasury/**`, contrato `finance.treasury*`.

---

## 1. Visão geral

A **Central de Tesouraria** é um domínio novo do IndusCost para operação de caixa: contas financeiras, saldos, overlays operacionais sobre títulos oficiais Nomus (CR/CP), projeção de caixa, agenda, transferências, lançamentos manuais, exceções/alertas, fechamento diário, importação OFX, conciliação bancária, relatórios e auditoria.

**Não substitui** Fluxo de Caixa, Faturamento nem Conciliação de Carteira. Títulos oficiais permanecem em `NomusAccountsReceivable` / `NomusAccountsPayable` (leitura via adapter). Money em API/DTO é **string decimal**; datas civis operacionais usam **America/Sao_Paulo**; exclusões de domínio são lógicas (cancel/reverse/version), sem DELETE físico.

- Rotas Express: `registerTreasuryRoutes` em `server.ts` → `src/lib/treasury/treasuryRoutes.ts` (**89** handlers HTTP sob `/api/finance/treasury`).
- UI: shell `TreasuryModule` em `/finance/treasury/*`.

---

## 2. Funcionalidades entregues

| Área | Capacidade |
|------|------------|
| Contas | CRUD, acesso por usuário, máscara, deactivate/reactivate, saldo mínimo/liquidez/consolidado |
| Saldos | Snapshots versionados (observado/operacional/bloqueado/aplicações/limite), idempotência |
| Posição | Camadas observado / calculado (snapshot + ledger ACTIVE) / conciliado (OFX ledgerBalance) / divergência explícita |
| CR Tesouraria | Consulta oficial+complemento; expectativa; promessas; cobrança; contestações; resumo do cliente |
| CP Tesouraria | Consulta oficial+complemento; programação/hold; agenda de pagamentos |
| Dashboard | Posição do dia, previsto×realizado, exceções/alertas, freshness |
| Projeção | Motor CONTRACTUAL/PROBABLE/CONFIRMED(+MANUAL); persistência; compare; calculate FE |
| Agenda | Buckets multi-cenário, períodos, visão consolidada/conta/grupo |
| Transferências | Ciclo schedule→send→receive→reconcile/cancel; consolidado neutro |
| Ledger | Lançamentos manuais ACTIVE/REVERSED |
| Exceções | Motor tipado + central (ack/assign/resolve/ignore/cancel) |
| Alertas | 8 kinds; settings GET/PUT + UI; sem push externo |
| Fechamento | Preview/gates/ressalvas; close imutável; reopen versionado; detecção pós-fechamento |
| OFX | Intake seguro, preview token, apply idempotente (fingerprint/fileSha256) |
| Conciliação | Sugestões; accept/unmatch/reverse; workspace + bank-movements |
| Relatórios | 10 keys + export CSV/XLSX/PDF |
| Auditoria | Append-only `TreasuryAuditLog` + UI listagem |
| Ops | Flags fail-closed; rollout; backfill complementos; scripts pre/post deploy |

---

## 3. Arquitetura

Camadas (ver também `docs/treasury/10-ARCHITECTURE.md`):

```text
UI (components/finance/treasury) → contracts (client-safe)
  → controllers → services (.server) → repositories / domain (puro)
  → Prisma / adapter Nomus (read-only)
```

Pipeline HTTP: `requireAppAuth` → flag mestra → subflag → `requireResource` → service → audit/recalc.

Anti-duplicação: não espelhar títulos Nomus; não somar pedido/NF/título; não somar previsão+realização; transferência não altera consolidado; não mutar `dueDate` oficial.

---

## 4. Models e migrations

### 4.1 Models Prisma (`Treasury*` — 27)

`TreasuryFinancialAccount`, `TreasuryFinancialAccountAccess`, `TreasuryBalanceSnapshot`, `TreasuryAuditLog`, `TreasuryTitleOperationalComplement`, `TreasuryPaymentPromise`, `TreasuryCollectionAction`, `TreasuryDispute`, `TreasuryProjectionRun`, `TreasuryProjectionDayLine`, `TreasuryProjectionCompositionItem`, `TreasuryProjectionRecalcJob`, `TreasuryLedgerEntry`, `TreasuryTransfer`, `TreasuryException`, `TreasuryAlertSettings`, `TreasuryDailyClosing`, `TreasuryDailyClosingAccountPosition`, `TreasuryDailyClosingFrozenPendency`, `TreasuryDailyClosingFrozenException`, `TreasuryDailyClosingCaveat`, `TreasuryDailyClosingReopening`, `TreasuryBankImportBatch`, `TreasuryBankMovement`, `TreasuryReconciliationMatch`, `TreasuryReconciliationMatchMovement`, `TreasuryReconciliationAllocation`.

### 4.2 Migrations aditivas (`prisma/migrations/*treasury*` — 17)

| Migration | Conteúdo |
|-----------|----------|
| `20260805120000_treasury_financial_accounts_and_balance_snapshots` | Contas, acesso, snapshots |
| `20260806120000_treasury_audit_log` | Auditoria append-only |
| `20260807120000_treasury_title_operational_complement` | Complemento operacional |
| `20260808120000_treasury_payment_promise` | Promessas |
| `20260809120000_treasury_collection_action_and_dispute` | Cobrança + disputa |
| `20260810120000_treasury_projection_run_and_day_lines` | Projeção run/linhas/composição |
| `20260811120000_treasury_projection_recalc_queue` | Fila de recálculo |
| `20260812120000_treasury_transfer` | Transferências |
| `20260813120000_treasury_exception` | Exceções |
| `20260814120000_treasury_exception_engine_types` | Tipos do motor |
| `20260815120000_treasury_exception_center_statuses` | Status da central |
| `20260816120000_treasury_alert_settings` | Settings de alertas |
| `20260817120000_treasury_daily_closing` | Fechamento + satélites |
| `20260818120000_treasury_bank_import_and_movements` | OFX lote/movimentos |
| `20260819120000_treasury_reconciliation_match_and_allocations` | Match/allocations |
| `20260820120000_treasury_perf_indexes` | Índices performance |
| `20260821120000_treasury_ledger_entry` | Ledger manual |

**Produção:** aplicar só com `prisma migrate deploy` (nunca `db push` / `migrate dev` / reset). Estado de aplicação em prod é responsabilidade do ops.

---

## 5. Endpoints

Prefixo: `/api/finance/treasury` — **89** rotas registradas em `treasuryRoutes.ts`.

### Disponibilidade / ops
- `GET /availability`
- `GET /health`

### Dashboard / previsto×realizado / alertas / audit
- `GET /dashboard`
- `GET /forecast-vs-actual`
- `GET /alerts`
- `GET|PUT /alert-settings`
- `GET /audit`

### Contas e saldos
- `GET|POST /accounts`
- `GET|PATCH /accounts/:id`
- `POST /accounts/:id/deactivate|reactivate`
- `GET|PUT /accounts/:id/access`
- `GET /accounts/:id/balances`, `…/balances/latest`
- `POST /accounts/:id/balance-snapshots`
- `GET /accounts/:id/balance-position`

### CR / CP / overlays
- `GET /receivables`, `GET /receivables/:titleId`
- `GET /receivables/:titleId/customer-summary`
- `PUT /receivables/:titleId/expectation`
- `GET|POST /receivables/:titleId/promises`
- `POST /promises/:promiseId/cancel|mark-fulfilled`
- `GET|POST /receivables/:titleId/collection-actions`
- `POST /collection-actions/:actionId/cancel`
- `GET|POST /receivables/:titleId/disputes`
- `PATCH /disputes/:disputeId`
- `GET /payables`, `GET /payables/:titleId`
- `POST|PUT /payables/:titleId/program-payment`, `POST …/cancel`
- `POST /payables/:titleId/hold|release-hold`
- `GET /payment-schedule`

### Projeção / agenda
- `POST /projections/calculate`
- `GET /projections/latest|compare|:id|:id/composition`
- `GET /agenda`

### Transferências / ledger
- `GET|POST /transfers`, `GET /transfers/:id`
- `POST /transfers/:id/schedule|send|receive|reconcile|cancel`
- `GET|POST /ledger-entries`, `GET /ledger-entries/:id`, `POST …/:id/reverse`

### Exceções
- `GET /exceptions`, `GET /exceptions/:id`
- `POST /exceptions/:id/acknowledge|assign|due-at|status|resolve|ignore|cancel`

### Fechamento
- `GET /daily-closing/preview`
- `GET|POST /daily-closing`, `GET /daily-closing/:id`
- `POST /daily-closing/:id/reopen`

### OFX / conciliação
- `POST /bank-imports/ofx/preview|apply`
- `GET /bank-imports`, `GET /bank-movements`, `GET /bank-movements/:id`
- `GET|POST /reconciliations`, `GET /reconciliations/:id`
- `POST /reconciliations/:id/reverse|unmatch`
- `GET /reconcile/workspace`

### Relatórios
- `GET /reports/:reportKey`
- `GET /reports/:reportKey/export.csv|xlsx|pdf`

**Report keys:** `daily-position`, `cash-bridge`, `planned-vs-actual`, `delinquency`, `promises`, `predictability`, `position-by-account`, `exceptions`, `reconciliations`, `projection-by-scenario`.

---

## 6. Telas (UI)

Shell: `/finance/treasury` — `TREASURY_UI_SECTIONS` em `treasuryFeatureUi.ts` (**17** seções de navegação).

| Rota UI | Página / conteúdo |
|---------|-------------------|
| `/finance/treasury` | Dashboard |
| `…/accounts` | Contas |
| `…/accounts/:accountId/balances` | Histórico/atualização de saldo (rota aninhada) |
| `…/receivables` | CR (+ drawers overlays) |
| `…/payables` | CP (+ programação) |
| `…/payment-schedule` | Agenda de programação CP |
| `…/agenda` | Agenda financeira |
| `…/projections` | Comparação + recalcular |
| `…/transfers` | Transferências |
| `…/manual-entries` | Ledger manual |
| `…/bank-movements` | Movimentos + OFX |
| `…/ofx` | Alias da mesma página OFX |
| `…/reconcile` | Workspace conciliação |
| `…/exceptions` | Central de exceções |
| `…/alert-settings` | Configuração de alertas |
| `…/closing` | Fechamento diário |
| `…/reports` | Relatórios + export |
| `…/audit` | Auditoria |

---

## 7. Permissões

Contrato em `src/lib/security/permissionContract/resources.ts` — `finance.view` **não** abre Tesouraria.

| Resource key | Ações típicas |
|--------------|---------------|
| `finance.treasury` | `view`, `export` |
| `finance.treasury.dashboard` | `view` |
| `finance.treasury.agenda` | `view` |
| `finance.treasury.receivables` | `view`, `manage` |
| `finance.treasury.receivables.promise` | execute |
| `finance.treasury.receivables.collection` | execute |
| `finance.treasury.payables` | `view`, `manage` |
| `finance.treasury.payables.program` | execute |
| `finance.treasury.accounts` | `view`, `manage` |
| `finance.treasury.balances` | `manage` |
| `finance.treasury.transfers` | `view`, `manage` |
| `finance.treasury.manual_entries` | `view`, `manage` |
| `finance.treasury.reconciliation` | `view`, `manage` |
| `finance.treasury.reconciliation.reverse` | reverse/execute |
| `finance.treasury.exceptions` | `view`, `manage` |
| `finance.treasury.closing` | `view`, `close`, `reopen` |
| `finance.treasury.audit` | `view` |
| `finance.treasury.reports` | `view` (+ export via root) |

Backend: `requireResource` em `treasuryRoutes.ts`. Seed/apply de bags: ops (`permissions:seed:contract:apply`).

---

## 8. Feature flags

Fonte: `src/lib/treasury/treasuryFeatureFlags.ts` — **fail-closed** (ausente/false = off). Subflags exigem mestra ON. Catálogo `TREASURY_FEATURE_FLAG_IDS`: **15** ids (1 mestra + 14 subflags).

| Flag id | Env |
|---------|-----|
| `treasury.enabled` | `TREASURY_MODULE_ENABLED` |
| `treasury.accounts.enabled` | `TREASURY_ACCOUNTS_ENABLED` |
| `treasury.balances.enabled` | `TREASURY_BALANCES_ENABLED` |
| `treasury.dashboard.enabled` | `TREASURY_DASHBOARD_ENABLED` |
| `treasury.receivables.enabled` | `TREASURY_RECEIVABLES_ENABLED` |
| `treasury.payables.enabled` | `TREASURY_PAYABLES_ENABLED` |
| `treasury.projection.enabled` | `TREASURY_PROJECTION_ENABLED` |
| `treasury.promises.enabled` | `TREASURY_PROMISES_ENABLED` |
| `treasury.payablesProgramming.enabled` | `TREASURY_PAYABLES_PROGRAMMING_ENABLED` |
| `treasury.transfers.enabled` | `TREASURY_TRANSFERS_ENABLED` |
| `treasury.exceptions.enabled` | `TREASURY_EXCEPTIONS_ENABLED` |
| `treasury.dailyClosing.enabled` | `TREASURY_DAILY_CLOSING_ENABLED` |
| `treasury.reconciliation.enabled` | `TREASURY_RECONCILIATION_ENABLED` |
| `treasury.ofxImport.enabled` | `TREASURY_OFX_IMPORT_ENABLED` |
| `treasury.reports.enabled` | `TREASURY_REPORTS_ENABLED` |

Ordem de ativação: `docs/treasury/19-ROLLOUT.md` / `TREASURY_ROLLOUT_ACTIVATION_ORDER`.

---

## 9. Integrações

| Integração | Direção | Comportamento |
|------------|---------|---------------|
| Nomus AR/AP | Leitura | Adapter read-only; overlays locais |
| Sync Nomus AR/AP | Evento | Após SUCCESS + mudanças → enqueue recalc |
| OFX arquivo | Entrada | Preview (token) → apply idempotente |
| Exportações | Saída | CSV/XLSX/PDF locais (reports) |
| Backfill | Ops CLI | `scripts/treasuryTitleComplementBackfill.ts` (create-only) |

---

## 10. Jobs / filas

- **Fila real:** `TreasuryProjectionRecalcJob` (PostgreSQL) — worker/retry/dedupe; eventos de mutação e sync.
- **Cron in-process:** `src/lib/treasury/jobs/treasuryJobs.ts` — catálogo com `treasury.alerts.scan` **disabled**; `startTreasuryScheduledJobs` é no-op (sem setInterval).

---

## 11. Testes

Script: `npm run test:treasury` (tsx --test; unitário + integração + E2E UI `renderToStaticMarkup`).

| Evidência | Resultado (reexecução auditoria final / residual `c5b0800`) |
|-----------|--------------------------------------------------------------|
| `test:treasury` | **636 pass / 0 fail / 1 skipped** |
| Skip | Full-flow Postgres gated (`TREASURY_TEST_DATABASE_URL` segura ausente) — intencional |

Cobertura inclui regras de domínio, APIs, schema integrity, segurança, performance, wiring de gaps, E2E fluxos críticos.

---

## 12. Resultados dos builds / gates locais

| Gate | Resultado |
|------|-----------|
| `npx prisma validate` (DATABASE_URL dummy) | OK |
| `npm run check:frontend-server-imports` | OK (FE sem Prisma/server) |
| `npm run check:server-imports` | OK |
| `npm run validate:treasury:deploy` | OK (10 checks) |
| `npm run build` (Vite) | OK |
| `npm run check:browser-bundle` | OK (`dist/` livre de Prisma) |

**Não executado por este relatório:** deploy/migrate/restart em produção.

---

## 13. Cobertura de requisitos

Matriz oficial: `docs/treasury/REQUIREMENTS-TRACEABILITY.md` (**R01–R30**).

| Situação | IDs |
|----------|-----|
| DONE | R01–R30 (nenhum MISSING) |
| Lacunas documentadas (não bloqueantes) | R03 conciliado MISSING sem OFX ledgerBalance; R17 sem push externo; R21 UI workspace usa UNIDENTIFIED (TITLE via API); R26 métricas básicas; R27 1 skip gated; R28 PRD/TDD externos ausentes |

Princípios anti-duplicação do Prompt 00: cobertos (ver matriz § princípios).

---

## 14. Riscos residuais

1. Migrations Tesouraria podem ainda não estar aplicadas em produção — ops deve confirmar `prisma migrate status`.
2. Seed de permissões `finance.treasury*` a cargo do ops.
3. Soft-launch: flags OFF preservam dados mas escondem UI/API (fail-closed).
4. Camada conciliada depende de `ledgerBalance` no OFX; sem o campo permanece MISSING (explícito).
5. Coexistência com WIP Lucro×Caixa / outros módulos — não misturar commits/flags.
6. Sem model `Company` canônico — Tesouraria usa `companyCode` string.
7. Shell Tesouraria standalone (`/finance/treasury/*`); não embutido como aba do `FinanceModule` principal.

---

## 15. Limitações conhecidas

- Sem notificação externa de alertas (e-mail/push).
- Cron de varredura de alertas desabilitado (alertas gerados no fluxo dashboard/agenda/fechamento).
- Workspace de conciliação FE: accept mínimo com allocation `UNIDENTIFIED` (match TITLE completo via API).
- Transferências: invariante consolidado no domínio; dual-leg ledger completo via motor de projeção (não 2 rows ledger espelhadas).
- Path UI `/closing` vs mapping legado `/closings` (equivalente funcional).
- Scaffold legado (`TreasuryScaffoldPage`, queries stub) mantido só por estrutura/testes — não é fluxo operacional.
- 1 teste de integração full-flow exige Postgres de teste isolado.

---

## 16. Passos de deploy

Documento canônico: `docs/treasury/PRODUCTION-DEPLOYMENT.md`.

Resumo (operador em `/opt/induscost`, branch `main`):

1. Janela + decisão de flags (`TREASURY_*`).
2. Backup: `bash scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_treasury`.
3. Pré-check: `bash scripts/treasury/predeploy-check.sh --require-backup`.
4. Deploy: `bash scripts/deploy-induscost.sh` (pull ff-only, `migrate deploy`, build, restart porta 3000).
5. Pós-check técnico: `bash scripts/treasury/postdeploy-validation.sh`.
6. Checklist funcional: `POST-DEPLOY-CHECKLIST.md` (classes A/B/C).
7. Ativar flags conforme `19-ROLLOUT.md`.

**Cursor não executa produção.**

---

## 17. Passos de rollback

Documento canônico: `docs/treasury/ROLLBACK.md`.

- Preferir ajustar flags (fail-closed) se só config.
- Rollback de processo (restart `NODE_ENV=production`) se app não sobe.
- Rollback de código para SHA bom + rebuild **sem** `migrate reset`.
- Se migration já aplicada e incompatível: **restore backup PostgreSQL** + redeploy do código anterior.
- **Nunca** apagar tabelas/histórico Tesouraria para “limpar” erro; evitar `git reset --hard` / `db push` como primeira opção.

---

## 18. Checklist pós-deploy

Documento canônico: `docs/treasury/POST-DEPLOY-CHECKLIST.md`.

| Classe | Escopo |
|--------|--------|
| **A** | Leitura: health, availability, migrate status, existência de tabelas, permissões/flags, dashboards/relatórios |
| **B** | Dados de teste/homolog: conta, saldo, expectativa, projeção, OFX seguro, conciliação, fechamento |
| **C** | Manual financeiro: operação real com aprovação |

Smoke técnico mínimo: `bash scripts/treasury/postdeploy-validation.sh`.

---

## 19. Homologação obrigatória do financeiro

Itens que **exigem** validação humana do financeiro (não substituíveis por teste automatizado):

1. Cadastro de contas (tipo, liquidez, consolidado, máscaras, acessos).
2. Política de saldo mínimo / allowNegative / crédito.
3. Interpretação das camadas observado × calculado × conciliado × divergência.
4. Overlays CR (expectativa/promessa) sem alterar vencimento oficial.
5. Programação CP e impacto em caixa/consolidado.
6. Cenários de projeção (contratual/provável/confirmado) vs realidade operacional.
7. Critérios de fechamento diário (gates absolutos vs ressalvas).
8. Processo OFX (conta destino, tratamento de duplicatas, ledgerBalance).
9. Política de conciliação (parcial, fee/juros/desconto, UNIDENTIFIED, reverse com frase REVERTER).
10. Relatórios oficiais para diretoria (totais e exports).
11. Quem pode `close`/`reopen`/`reverse`/`export`.
12. Ordem de ativação de flags em produção (soft-launch).

---

## 20. Lista completa dos commits da funcionalidade

Critério: commits no histórico do repositório cujo subject contém escopo `(treasury)` (**162** entradas, ordem cronológica crescente), incluindo `feat|fix|test|perf|docs|chore|merge`.

Nota: merges auxiliares de `main` → branch Tesouraria sem escopo `(treasury)` no subject não entram nesta lista.

```text
cbd77ef docs(treasury): mapear discovery da Central de Tesouraria (Prompt 00)
eb411b3 docs(treasury): registrar hash do commit do Prompt 00
7dbf0b4 docs(treasury): mapear requisitos e plano da Central de Tesouraria
d52a986 docs(treasury): registrar hash do mapping Prompt 00b
2cdc68e chore(treasury): registrar baseline e branch feature/treasury-center
eaa73ef docs(treasury): registrar hash do baseline Prompt 00c
3c484c7 docs(treasury): corrigir status do baseline Prompt 00c
af2deff feat(treasury): scaffold modular da Central de Tesouraria
8eaf22c docs(treasury): registrar hash do scaffold Prompt 01
31800a0 feat(treasury): adicionar feature flags e permissões da Central de Tesouraria
7faafc3 docs(treasury): registrar hash do Prompt 02 (flags e permissões)
56780b5 feat(treasury): adicionar contratos client-safe da Central de Tesouraria
8c394f5 docs(treasury): registrar hash do Prompt 03 (contratos client-safe)
365a4d8 feat(treasury): adicionar schema Prisma de contas, acesso e snapshots
53170cb docs(treasury): registrar hash do Prompt 04 (schema Prisma)
07c4036 feat(treasury): adicionar auditoria central append-only com suporte a transaction
bff8539 docs(treasury): registrar hash do Prompt 05 (auditoria central)
e7bc851 feat(treasury): adicionar repository e service de contas financeiras
0c7a3a4 docs(treasury): registrar hash do Prompt 06 (service contas)
80fc494 feat(treasury): adicionar APIs REST de contas financeiras
e3d3d81 docs(treasury): registrar hash do Prompt 07 (APIs contas)
6a81b79 feat(treasury): adicionar tela de contas financeiras
455674f docs(treasury): registrar hash do Prompt 08 (UI contas)
30cfdb5 feat(treasury): adicionar APIs de snapshots de saldo
d56d4cb docs(treasury): registrar hash do Prompt 09 (snapshots saldo)
eed8642 feat(treasury): adicionar UX de atualização de saldo
ea9b135 docs(treasury): registrar hash do Prompt 10 (UI saldo)
29ce7e4 feat(treasury): adicionar adapter read-only de titulos oficiais Nomus
b1a0a38 docs(treasury): registrar hash do Prompt 11 (adapter AR/AP oficial)
1ffd2ab feat(treasury): adicionar complemento operacional de titulos oficiais
55c3062 docs(treasury): registrar hash do Prompt 12 (complemento operacional)
03fec64 feat(treasury): adicionar API de consulta de contas a receber
4b2a872 docs(treasury): registrar hash do Prompt 13 (API receivables)
1becae6 feat(treasury): adicionar tela de contas a receber
1fdcd88 docs(treasury): registrar hash do Prompt 14 (UI receivables)
a0e8255 feat(treasury): permitir alterar expectativa operacional de CR
57508e1 docs(treasury): registrar hash do Prompt 15 (expectativa CR)
0b7907f feat(treasury): adicionar promessas de pagamento de contas a receber
2f2cee5 docs(treasury): registrar hash do Prompt 16 (promessas CR)
d60697a docs(treasury): completar evidências do Prompt 16
8109a2f feat(treasury): adicionar ações de cobrança e contestações de CR
ea041d8 docs(treasury): registrar hash do Prompt 17 (cobrança e contestações CR)
5eaba13 feat(treasury): adicionar visão financeira resumida do cliente no detalhe de CR
f98fead docs(treasury): registrar hash do Prompt 18 (resumo financeiro do cliente CR)
1794e89 docs(treasury): completar evidências do Prompt 18
b678929 feat(treasury): adicionar consulta e APIs de contas a pagar
578f691 docs(treasury): registrar hash do Prompt 19 (consulta Contas a Pagar)
5d06c5a feat(treasury): adicionar programacao de pagamentos de contas a pagar
b4366f1 docs(treasury): registrar hash do Prompt 20 (programacao de pagamentos CP)
c891bc4 docs(treasury): completar evidencias do Prompt 20
3240f2f feat(treasury): adicionar tela de contas a pagar com programacao e impacto
b0e202b docs(treasury): registrar hash do Prompt 21 (UI Contas a Pagar)
bedc17c feat(treasury): adicionar servico de posicao financeira atual
c5cfb77 docs(treasury): registrar hash do Prompt 22 (posicao financeira)
ed88f66 feat(treasury): adicionar dashboard diario com agregacoes e consistencia
6835850 docs(treasury): registrar hash do Prompt 23 (dashboard diario)
9876f03 feat(treasury): adicionar tela principal do dashboard da Central de Tesouraria
d324753 docs(treasury): registrar hash do Prompt 24 (UI dashboard)
7bfbc43 feat(treasury): adicionar schema Prisma de execucao de projecao
2689c87 docs(treasury): registrar hash do Prompt 25 (schema projecao)
b390439 feat(treasury): adicionar regras puras de data de movimento na projecao
a8ff63e docs(treasury): registrar hash do Prompt 26 (regras data movimento)
4f6cd19 feat(treasury): adicionar resolvedor de identidade e precedencia financeira
8575425 docs(treasury): registrar hash do Prompt 27 (identidade e precedencia)
0ac7098 feat(treasury): adicionar motor deterministico de projecao de caixa
b67a001 docs(treasury): registrar hash do Prompt 28 (motor de projecao)
3c6103a feat(treasury): endurecer motor com precisao Decimal e liquidez
327f000 docs(treasury): registrar hash do Prompt 29 (precisao e liquidez)
b762458 docs(treasury): completar status do Prompt 29 na tabela e checklist
501056e feat(treasury): adicionar servico de execucao e persistencia de projecao
cbde0a4 docs(treasury): registrar hash do Prompt 30 (execucao de projecao)
9e3d51a feat(treasury): adicionar fila persistente de recalculo de projecao
a68035a docs(treasury): registrar hash do Prompt 31 (fila de recalculo)
59809a0 fix(treasury): restaurar schema.prisma com diff aditivo da fila
cdb8274 fix(treasury): remover duplicacao do model da fila de recalculo
4092a9b feat(treasury): enfileirar recalculo apos sync oficial AR/AP
4405cea docs(treasury): registrar hash do Prompt 32 (recalculo apos sync AR/AP)
faba85d feat(treasury): adicionar APIs de projecao e agenda
6a1096b docs(treasury): registrar hash do Prompt 33 (APIs projecao e agenda)
12037b0 feat(treasury): adicionar tela de agenda financeira
2304dab docs(treasury): registrar hash do Prompt 34 (UI agenda financeira)
613f3ac feat(treasury): adicionar comparacao contratual x provavel x confirmado
300cb26 docs(treasury): registrar hash do Prompt 35 (comparacao de cenarios)
7628e55 fix(treasury): corrigir lacunas do motor de projecao (auditoria)
3a84700 docs(treasury): registrar hash do Prompt 36 (auditoria do motor)
2cdcba4 feat(treasury): implementar transferencias internas entre contas
54bf0b6 docs(treasury): registrar hash do Prompt 37 (transferencias)
e4b823f feat(treasury): implementar model e servico de excepcões idempotente
b7b208a docs(treasury): registrar hash do Prompt 38 (excepcões)
fd8a40e docs(treasury): registrar hash do Prompt 38 (excepcões)
5dcdc74 feat(treasury): implementar motor deterministico de excepcoes
9145a72 docs(treasury): registrar hash do Prompt 39 (motor de excepcoes)
a9a95ac feat(treasury): implementar APIs e UI da Central de Excecoes
c3a08a9 docs(treasury): registrar hash do Prompt 40 (Central de Excecoes)
0e6e655 feat(treasury): integrar alertas ao dashboard e agenda com config
18a94dd docs(treasury): registrar hash do Prompt 41 (alertas)
f39279f feat(treasury): adicionar schema imutavel de fechamento diario e reabertura
d7a199e docs(treasury): registrar hash do Prompt 42 (fechamento diario)
7313c86 feat(treasury): adicionar preview do fechamento diario com gates e ressalvas
4333c03 docs(treasury): registrar hash do Prompt 43 (preview fechamento)
c219f45 feat(treasury): implementar close reopen e consulta do fechamento diario
7e08d1c docs(treasury): registrar hash do Prompt 44 (close reopen)
b955d68 feat(treasury): adicionar UI de fechamento diario com preview e historico
0232ab9 docs(treasury): registrar hash do Prompt 45 (UI fechamento)
9760540 feat(treasury): detectar mudancas financeiras apos fechamento diario
24b5022 docs(treasury): registrar hash do Prompt 46 (pos-fechamento)
c4d09c1 feat(treasury): adicionar base segura de parser e intake OFX
99b9952 docs(treasury): registrar hash do Prompt 47 (base OFX)
3d5d1ab feat(treasury): adicionar schema de lote e movimentos bancarios OFX
cd60728 docs(treasury): registrar hash do Prompt 48 (schema import OFX)
99b527f feat(treasury): adicionar preview OFX com token temporario seguro
99beffe docs(treasury): registrar hash do Prompt 49 (preview OFX)
0465f29 feat(treasury): aplicar importacao OFX com persistencia idempotente
362e70a docs(treasury): registrar hash do Prompt 50 (apply OFX)
b5f495d docs(treasury): completar hash do Prompt 50 no historico
0fd8a77 feat(treasury): adicionar tela de movimentos bancarios e importacao OFX
9b6c2a8 docs(treasury): registrar hash do Prompt 51 (UI movimentos OFX)
4af1a17 docs(treasury): completar hash do Prompt 51 no historico
aa80d13 feat(treasury): adicionar motor de sugestoes de conciliacao bancaria
abf8330 docs(treasury): registrar hash do Prompt 52 (motor sugestoes)
e158344 feat(treasury): adicionar conciliacao bancaria com match e allocations
2abb81b docs(treasury): registrar hash do Prompt 53 (match allocations)
4d6d5cf docs(treasury): completar hash do Prompt 53 no historico
15f4102 feat(treasury): adicionar reverse de conciliacao bancaria
4988c42 docs(treasury): registrar hash do Prompt 54 (reverse conciliacao)
3b03136 docs(treasury): completar hash do Prompt 54 no historico
e7d6139 feat(treasury): adicionar queries e APIs de relatorios
bb150db docs(treasury): registrar hash do Prompt 55 (relatorios)
4f0caa8 docs(treasury): completar hash do Prompt 55 no historico
6d08bb8 feat(treasury): adicionar Central de Relatorios com exportacoes
d7f3ebb docs(treasury): registrar hash do Prompt 56 (central relatorios)
adcbc63 fix(treasury): reforcar seguranca do modulo apos auditoria
2f8bb9a docs(treasury): registrar hash do Prompt 57
6ed1fb6 perf(treasury): otimizar hotspots apos auditoria de performance
cf83f84 docs(treasury): registrar hash do Prompt 58
b4cced6 test(treasury): completar cobertura unitaria de regras do dominio
82dbd88 docs(treasury): registrar hash do Prompt 59
462c74c test(treasury): adicionar integração E2E completa em banco de teste seguro
3a32ed5 docs(treasury): registrar hash do Prompt 60
3e24528 test(treasury): adicionar E2E dos fluxos críticos com tsx --test
2da155d docs(treasury): registrar hash do Prompt 61
59f5783 feat(treasury): adicionar backfill preview/apply de complementos operacionais
5298e70 docs(treasury): registrar hash do Prompt 62
0b687bb feat(treasury): fechar lacunas da rastreabilidade e auditoria formal
67c1f98 docs(treasury): registrar hash do Prompt 63
929ac4f docs(treasury): completar hash do Prompt 63 no changelog
889a05b docs(treasury): adicionar documentação completa e manuais operacionais
4d7fa8c docs(treasury): registrar hash do Prompt 64
43d338f docs(treasury): completar hash do Prompt 64 no changelog
10fc53a feat(treasury): finalizar controle de rollout por submódulo
d39fa99 docs(treasury): registrar hash do Prompt 65
4ca54c4 fix(treasury): expand field limits and align contracts/tests
e14a655 merge(treasury): integrate Treasury Center into main
e44b9f2 docs(treasury): adicionar scripts e runbook de implantação em produção
3e08a8c docs(treasury): registrar hash do Prompt 66
965ef35 docs(treasury): adicionar checklist de validação funcional pós-deploy
019bd41 docs(treasury): registrar hash do Prompt 67
9b4f526 feat(treasury): close RC gaps for reconcile, balances and civil dates
7688f82 docs(treasury): registrar hash do Prompt 68
c5b0800 fix(treasury): close residual RC gaps for alerts, projection and SP dates
4034b49 docs(treasury): registrar hash residual do Prompt 68
b016f1a docs(treasury): completar histórico residual do Prompt 68
```

---

## 21. Documentação de apoio

| Documento | Uso |
|-----------|-----|
| `IMPLEMENTATION_STATUS.md` | Status por prompt 00–69 |
| `REQUIREMENTS-TRACEABILITY.md` | Matriz R01–R30 |
| `RELEASE-CANDIDATE-VALIDATION.md` | Gates RC e achados auditoria |
| `10-ARCHITECTURE.md` … `19-ROLLOUT.md` | Técnicos |
| `PRODUCTION-DEPLOYMENT.md` / `ROLLBACK.md` / `POST-DEPLOY-CHECKLIST.md` | Ops |
| `manuals/*` | Usuário financeiro |

---

## 22. Verificação deste relatório vs código

| Afirmação | Evidência no repo |
|-----------|-------------------|
| 89 rotas HTTP | Contagem `app.(get\|post\|…)` em `treasuryRoutes.ts` |
| 27 models `Treasury*` | `grep ^model Treasury` em `schema.prisma` |
| 17 migrations | pastas `prisma/migrations/*treasury*` |
| 15 flags (1 mestra + 14 sub) | `TREASURY_FEATURE_FLAG_IDS` |
| 17 seções UI | `TREASURY_UI_SECTIONS` |
| 10 report keys | `TREASURY_REPORT_KEYS` |
| 162 commits `(treasury)` | `git log --grep='(treasury)'` |
| Gates | Reexecução local na auditoria final Prompt 68 / residual |

**Fim do relatório de entrega.** Cursor/agente **para** após o commit documental deste arquivo.
