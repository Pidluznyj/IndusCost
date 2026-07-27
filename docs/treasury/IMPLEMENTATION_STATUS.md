# Central de Tesouraria — Implementation Status

**Atualizado:** 2026-07-27  
**Programa:** implementação integral da Central de Tesouraria no IndusCost  
**Regra:** cada prompt atualiza este arquivo; não avançar etapas automaticamente.

---

## Legenda

| Status | Significado |
|--------|-------------|
| `NOT_STARTED` | Ainda não iniciado |
| `IN_PROGRESS` | Em andamento |
| `DONE` | Concluído com evidências |
| `BLOCKED` | Bloqueado (detalhar) |
| `N/A` | Não aplicável nesta fase |

---

## Progresso por prompt

| Prompt | Título | Status | Commit | Evidências |
|--------|--------|--------|--------|------------|
| **00a** | Discovery técnico / auditoria do repositório | `DONE` | `cbd77ef` (+ `eb411b3` hash) | `docs/treasury/01-DISCOVERY.md`; checks FE/server imports + startup OK |
| **00b** | Requirements mapping + plano de implementação | `DONE` | `7dbf0b4` — `docs(treasury): mapear requisitos e plano da Central de Tesouraria` | `02-REQUIREMENTS-MAPPING.md`, `03-IMPLEMENTATION-PLAN.md`; anti-duplicação documentada; sem código funcional |
| **00c** | Baseline real + branch `feature/treasury-center` | `DONE` | *(este commit)* | `04-BASELINE.md`; `validate:treasury-baseline`; WIP Lucro×Caixa stashed; build OK; lint 1236 preexistente; cash-flow 441/441 |
| **01** | Foundation (flag, money, skeleton routes) | `NOT_STARTED` | — | Ver `03-IMPLEMENTATION-PLAN.md` |

---

## Capabilidades do domínio (visão agregada)

| Capabilidade | Status | Notas / reuso |
|--------------|--------|---------------|
| Contas financeiras | `NOT_STARTED` | Hoje só `bankAccountId/Name` denormalizados em `NomusAccountsReceivable` / `NomusAccountsPayable` |
| Saldos manuais e históricos | `NOT_STARTED` | Cash-flow: `hasInitialBankBalance: false` |
| Saldo observado / calculado / conciliado | `NOT_STARTED` | — |
| Contas a receber (títulos) | `REUSE` | Model `NomusAccountsReceivable`; APIs `/api/finance/accounts-receivable/*` |
| Contas a pagar (títulos) | `REUSE` | Model `NomusAccountsPayable`; APIs `/api/finance/accounts-payable/*` |
| Previsto vs realizado | `PARTIAL` | Fluxo de Caixa `projected`/`realized`/`combined` — não é caixa bancário |
| Datas esperadas | `NOT_STARTED` | Existe `scheduleDate` Nomus; não substituir `dueDate` |
| Promessas de pagamento | `NOT_STARTED` | — |
| Ações de cobrança | `NOT_STARTED` | — |
| Contestações | `NOT_STARTED` | — |
| Programação de pagamentos | `PARTIAL` | Due Radar / Daily Radar / classificação CC |
| Projeção contratual / provável / confirmada | `PARTIAL` | Cenários cash-flow + portfolio forecast |
| Agenda financeira | `PARTIAL` | Calendário cash-flow |
| Transferências | `NOT_STARTED` | Regra: transferência interna não altera caixa consolidado |
| Lançamentos manuais | `NOT_STARTED` | — |
| Exceções / alertas | `PARTIAL` | Insights CFO derivados; sem exceções de tesouraria |
| Fechamento diário | `NOT_STARTED` | Imutável + versionado (requisito) |
| Reabertura | `NOT_STARTED` | — |
| Importação OFX | `NOT_STARTED` | — |
| Conciliação bancária | `NOT_STARTED` | Distinto de `finance.portfolio_reconciliation` |
| Relatórios tesouraria | `NOT_STARTED` | Reusar padrão export XLSX/CSV |
| Exportações | `PARTIAL` | Exports AR/AP/cash-flow existem |
| Auditoria domínio | `NOT_STARTED` | Padrão: `*AuditLog` por domínio |
| Permissões | `NOT_STARTED` | Estender contrato (`finance.*` resources) |
| Observabilidade | `PARTIAL` | `/api/health`, logs console, Nomus sync logs |
| Testes domínio | `NOT_STARTED` | Runner: `tsx --test` / `test:unit` |
| Documentação | `IN_PROGRESS` | Discovery + mapping + plano (Prompt 00) feitos; runbook ainda não |
| Feature flags | `NOT_STARTED` | Padrão env fail-closed (ex. sales-order-flow) |
| Scripts deploy/validação | `NOT_STARTED` | Produção: usuário aplica; Cursor não deploya |

---

## Inventário de reuso (âncoras reais)

### Models Prisma (fonte de títulos)

- `NomusAccountsReceivable`
- `NomusAccountsPayable`
- `NomusSourceSyncRun`
- `IntegrationRun`
- `NomusNfe` / `SalesOrder` / `SalesOrderNfeLink` / `Customer` / `FinancialSupplier`

### Auth / ACL

- Cookie `induscost_session` → `AppSession`
- `requireAppAuth` / `requireResource` (`src/lib/appAuthMiddleware.ts`, `src/lib/security/requireResource.ts`)
- Resource keys finance: `src/lib/financeModulesAccess.ts`

### Datas / money

- `src/lib/financeCivilDate.ts`
- Prisma `Decimal` (`Decimal(20,2)` em AR/AP)
- Evitar padrão atual `decimalToNumber` em cálculos críticos da Tesouraria

### UI

- `src/components/FinanceModule.tsx`
- `src/components/ui/overlay/*`
- `src/components/finance/bi/*`

### Guardrails

- `npm run check:frontend-server-imports`
- `npm run check:server-imports`
- `npm run build:safe`

---

## Prompt 00 — checklist de conclusão

### 00a — Discovery
- [x] Estrutura FE/BE mapeada
- [x] Package manager e scripts mapeados (npm)
- [x] `server.ts` e registro de routers mapeados
- [x] `schema.prisma` auditado (finance spine)
- [x] Models AR/AP / baixas / sync mapeados
- [x] Clientes / fornecedores / pedidos / NFe mapeados
- [x] Permissões e autenticação mapeadas
- [x] Auditoria existente mapeada
- [x] Decimal e datas mapeados
- [x] Componentes UI reutilizáveis mapeados
- [x] Exportações / testes / jobs / health / flags / logs mapeados
- [x] Migrations contadas (128)
- [x] Risco Prisma→FE avaliado + checks OK
- [x] `docs/treasury/01-DISCOVERY.md` criado
- [x] Commit discovery — `cbd77ef`

### 00b — Mapping + plano
- [x] `docs/treasury/02-REQUIREMENTS-MAPPING.md` criado (30 requisitos + anti-duplicação)
- [x] `docs/treasury/03-IMPLEMENTATION-PLAN.md` criado (prompts 01–29 ordenados)
- [x] Validação explícita: Tesouraria não duplica financeiro oficial (títulos Nomus, cash-flow, portfolio)
- [x] Nenhum código funcional alterado neste passo
- [x] Sem avanço automático para Prompt 01

### 00c — Baseline
- [x] Branch `feature/treasury-center` criada
- [x] WIP não relacionado preservado (stashes + backup `%TEMP%`)
- [x] `docs/treasury/04-BASELINE.md` com resultados classificados
- [x] Script `npm run validate:treasury-baseline` + `scripts/runTreasuryBaseline.mjs`
- [x] Falhas preexistentes de `tsc` **não** corrigidas
- [x] Sem avanço automático para Prompt 01

---

## Validação anti-duplicação (Prompt 00b)

| Gate | Resultado |
|------|-----------|
| Títulos CR/CP oficiais permanecem `NomusAccountsReceivable` / `NomusAccountsPayable` | Documentado — overlays laterais apenas |
| Fluxo de Caixa não vira extrato bancário | Documentado — fronteira explícita |
| Portfolio reconciliation ≠ conciliação bancária | Documentado |
| Pedido/NF não entram como caixa | Documentado (ref. `order-nfe-cr-financial-separation.md`) |
| Nenhum arquivo `src/lib/treasury/**` ou UI Tesouraria criado ainda | Confirmado (ausentes) |

---

## Riscos / pendências abertas

1. Working tree local contém WIP não relacionado (Lucro×Caixa / nav) — não misturar no commit da Tesouraria.
2. Engines financeiros atuais convertem Decimal→number — dívida técnica a endereçar no domínio Tesouraria (P01).
3. Ausência total de model de conta bancária / ledger — primeira migration em P03.
4. Deploy produção permanece com o usuário (backup, pull, migrate deploy, build, restart).
5. Models `Treasury*` no mapping são **propostos** — nomes finais confirmados no prompt de schema.

---

## Histórico curto

| Data | Evento |
|------|--------|
| 2026-07-27 | Prompt 00a: discovery completo; docs criados; validações de leitura OK |
| 2026-07-27 | Prompt 00b: requirements mapping + implementation plan; sem código funcional |
| 2026-07-27 | Prompt 00c: baseline em `feature/treasury-center`; WIP Lucro×Caixa protegido; build/tests adjacentes OK |
