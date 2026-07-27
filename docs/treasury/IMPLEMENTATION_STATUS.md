# Central de Tesouraria â€” Implementation Status

**Atualizado:** 2026-07-27  
**Programa:** implementaÃ§Ã£o integral da Central de Tesouraria no IndusCost  
**Regra:** cada prompt atualiza este arquivo; nÃ£o avanÃ§ar etapas automaticamente.

---

## Legenda

| Status | Significado |
|--------|-------------|
| `NOT_STARTED` | Ainda nÃ£o iniciado |
| `IN_PROGRESS` | Em andamento |
| `DONE` | ConcluÃ­do com evidÃªncias |
| `BLOCKED` | Bloqueado (detalhar) |
| `N/A` | NÃ£o aplicÃ¡vel nesta fase |

---

## Progresso por prompt

| Prompt | TÃ­tulo | Status | Commit | EvidÃªncias |
|--------|--------|--------|--------|------------|
| **00a** | Discovery tÃ©cnico / auditoria do repositÃ³rio | `DONE` | `cbd77ef` (+ `eb411b3` hash) | `docs/treasury/01-DISCOVERY.md`; checks FE/server imports + startup OK |
| **00b** | Requirements mapping + plano de implementaÃ§Ã£o | `DONE` | `7dbf0b4` â€” `docs(treasury): mapear requisitos e plano da Central de Tesouraria` | `02-REQUIREMENTS-MAPPING.md`, `03-IMPLEMENTATION-PLAN.md`; anti-duplicaÃ§Ã£o documentada; sem cÃ³digo funcional |
| **00c** | Baseline real + branch `feature/treasury-center` | `DONE` | $hash — `chore(treasury): registrar baseline e branch feature/treasury-center` | `04-BASELINE.md`; `validate:treasury-baseline`; WIP LucroÃ—Caixa stashed; build OK; lint 1236 preexistente; cash-flow 441/441 |
| **01** | Foundation (flag, money, skeleton routes) | `NOT_STARTED` | â€” | Ver `03-IMPLEMENTATION-PLAN.md` |

---

## Capabilidades do domÃ­nio (visÃ£o agregada)

| Capabilidade | Status | Notas / reuso |
|--------------|--------|---------------|
| Contas financeiras | `NOT_STARTED` | Hoje sÃ³ `bankAccountId/Name` denormalizados em `NomusAccountsReceivable` / `NomusAccountsPayable` |
| Saldos manuais e histÃ³ricos | `NOT_STARTED` | Cash-flow: `hasInitialBankBalance: false` |
| Saldo observado / calculado / conciliado | `NOT_STARTED` | â€” |
| Contas a receber (tÃ­tulos) | `REUSE` | Model `NomusAccountsReceivable`; APIs `/api/finance/accounts-receivable/*` |
| Contas a pagar (tÃ­tulos) | `REUSE` | Model `NomusAccountsPayable`; APIs `/api/finance/accounts-payable/*` |
| Previsto vs realizado | `PARTIAL` | Fluxo de Caixa `projected`/`realized`/`combined` â€” nÃ£o Ã© caixa bancÃ¡rio |
| Datas esperadas | `NOT_STARTED` | Existe `scheduleDate` Nomus; nÃ£o substituir `dueDate` |
| Promessas de pagamento | `NOT_STARTED` | â€” |
| AÃ§Ãµes de cobranÃ§a | `NOT_STARTED` | â€” |
| ContestaÃ§Ãµes | `NOT_STARTED` | â€” |
| ProgramaÃ§Ã£o de pagamentos | `PARTIAL` | Due Radar / Daily Radar / classificaÃ§Ã£o CC |
| ProjeÃ§Ã£o contratual / provÃ¡vel / confirmada | `PARTIAL` | CenÃ¡rios cash-flow + portfolio forecast |
| Agenda financeira | `PARTIAL` | CalendÃ¡rio cash-flow |
| TransferÃªncias | `NOT_STARTED` | Regra: transferÃªncia interna nÃ£o altera caixa consolidado |
| LanÃ§amentos manuais | `NOT_STARTED` | â€” |
| ExceÃ§Ãµes / alertas | `PARTIAL` | Insights CFO derivados; sem exceÃ§Ãµes de tesouraria |
| Fechamento diÃ¡rio | `NOT_STARTED` | ImutÃ¡vel + versionado (requisito) |
| Reabertura | `NOT_STARTED` | â€” |
| ImportaÃ§Ã£o OFX | `NOT_STARTED` | â€” |
| ConciliaÃ§Ã£o bancÃ¡ria | `NOT_STARTED` | Distinto de `finance.portfolio_reconciliation` |
| RelatÃ³rios tesouraria | `NOT_STARTED` | Reusar padrÃ£o export XLSX/CSV |
| ExportaÃ§Ãµes | `PARTIAL` | Exports AR/AP/cash-flow existem |
| Auditoria domÃ­nio | `NOT_STARTED` | PadrÃ£o: `*AuditLog` por domÃ­nio |
| PermissÃµes | `NOT_STARTED` | Estender contrato (`finance.*` resources) |
| Observabilidade | `PARTIAL` | `/api/health`, logs console, Nomus sync logs |
| Testes domÃ­nio | `NOT_STARTED` | Runner: `tsx --test` / `test:unit` |
| DocumentaÃ§Ã£o | `IN_PROGRESS` | Discovery + mapping + plano (Prompt 00) feitos; runbook ainda nÃ£o |
| Feature flags | `NOT_STARTED` | PadrÃ£o env fail-closed (ex. sales-order-flow) |
| Scripts deploy/validaÃ§Ã£o | `NOT_STARTED` | ProduÃ§Ã£o: usuÃ¡rio aplica; Cursor nÃ£o deploya |

---

## InventÃ¡rio de reuso (Ã¢ncoras reais)

### Models Prisma (fonte de tÃ­tulos)

- `NomusAccountsReceivable`
- `NomusAccountsPayable`
- `NomusSourceSyncRun`
- `IntegrationRun`
- `NomusNfe` / `SalesOrder` / `SalesOrderNfeLink` / `Customer` / `FinancialSupplier`

### Auth / ACL

- Cookie `induscost_session` â†’ `AppSession`
- `requireAppAuth` / `requireResource` (`src/lib/appAuthMiddleware.ts`, `src/lib/security/requireResource.ts`)
- Resource keys finance: `src/lib/financeModulesAccess.ts`

### Datas / money

- `src/lib/financeCivilDate.ts`
- Prisma `Decimal` (`Decimal(20,2)` em AR/AP)
- Evitar padrÃ£o atual `decimalToNumber` em cÃ¡lculos crÃ­ticos da Tesouraria

### UI

- `src/components/FinanceModule.tsx`
- `src/components/ui/overlay/*`
- `src/components/finance/bi/*`

### Guardrails

- `npm run check:frontend-server-imports`
- `npm run check:server-imports`
- `npm run build:safe`

---

## Prompt 00 â€” checklist de conclusÃ£o

### 00a â€” Discovery
- [x] Estrutura FE/BE mapeada
- [x] Package manager e scripts mapeados (npm)
- [x] `server.ts` e registro de routers mapeados
- [x] `schema.prisma` auditado (finance spine)
- [x] Models AR/AP / baixas / sync mapeados
- [x] Clientes / fornecedores / pedidos / NFe mapeados
- [x] PermissÃµes e autenticaÃ§Ã£o mapeadas
- [x] Auditoria existente mapeada
- [x] Decimal e datas mapeados
- [x] Componentes UI reutilizÃ¡veis mapeados
- [x] ExportaÃ§Ãµes / testes / jobs / health / flags / logs mapeados
- [x] Migrations contadas (128)
- [x] Risco Prismaâ†’FE avaliado + checks OK
- [x] `docs/treasury/01-DISCOVERY.md` criado
- [x] Commit discovery â€” `cbd77ef`

### 00b â€” Mapping + plano
- [x] `docs/treasury/02-REQUIREMENTS-MAPPING.md` criado (30 requisitos + anti-duplicaÃ§Ã£o)
- [x] `docs/treasury/03-IMPLEMENTATION-PLAN.md` criado (prompts 01â€“29 ordenados)
- [x] ValidaÃ§Ã£o explÃ­cita: Tesouraria nÃ£o duplica financeiro oficial (tÃ­tulos Nomus, cash-flow, portfolio)
- [x] Nenhum cÃ³digo funcional alterado neste passo
- [x] Sem avanÃ§o automÃ¡tico para Prompt 01

### 00c â€” Baseline
- [x] Branch `feature/treasury-center` criada
- [x] WIP nÃ£o relacionado preservado (stashes + backup `%TEMP%`)
- [x] `docs/treasury/04-BASELINE.md` com resultados classificados
- [x] Script `npm run validate:treasury-baseline` + `scripts/runTreasuryBaseline.mjs`
- [x] Falhas preexistentes de `tsc` **nÃ£o** corrigidas
- [x] Sem avanÃ§o automÃ¡tico para Prompt 01

---

## ValidaÃ§Ã£o anti-duplicaÃ§Ã£o (Prompt 00b)

| Gate | Resultado |
|------|-----------|
| TÃ­tulos CR/CP oficiais permanecem `NomusAccountsReceivable` / `NomusAccountsPayable` | Documentado â€” overlays laterais apenas |
| Fluxo de Caixa nÃ£o vira extrato bancÃ¡rio | Documentado â€” fronteira explÃ­cita |
| Portfolio reconciliation â‰  conciliaÃ§Ã£o bancÃ¡ria | Documentado |
| Pedido/NF nÃ£o entram como caixa | Documentado (ref. `order-nfe-cr-financial-separation.md`) |
| Nenhum arquivo `src/lib/treasury/**` ou UI Tesouraria criado ainda | Confirmado (ausentes) |

---

## Riscos / pendÃªncias abertas

1. Working tree local contÃ©m WIP nÃ£o relacionado (LucroÃ—Caixa / nav) â€” nÃ£o misturar no commit da Tesouraria.
2. Engines financeiros atuais convertem Decimalâ†’number â€” dÃ­vida tÃ©cnica a endereÃ§ar no domÃ­nio Tesouraria (P01).
3. AusÃªncia total de model de conta bancÃ¡ria / ledger â€” primeira migration em P03.
4. Deploy produÃ§Ã£o permanece com o usuÃ¡rio (backup, pull, migrate deploy, build, restart).
5. Models `Treasury*` no mapping sÃ£o **propostos** â€” nomes finais confirmados no prompt de schema.

---

## HistÃ³rico curto

| Data | Evento |
|------|--------|
| 2026-07-27 | Prompt 00a: discovery completo; docs criados; validaÃ§Ãµes de leitura OK |
| 2026-07-27 | Prompt 00b: requirements mapping + implementation plan; sem cÃ³digo funcional |
| 2026-07-27 | Prompt 00c: baseline em `feature/treasury-center`; WIP LucroÃ—Caixa protegido; build/tests adjacentes OK |

