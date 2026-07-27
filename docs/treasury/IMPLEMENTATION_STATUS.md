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
| **00c** | Baseline real + branch `feature/treasury-center` | `DONE` | `2cdc68e` — `chore(treasury): registrar baseline e branch feature/treasury-center` | `04-BASELINE.md`; `validate:treasury-baseline`; WIP Lucro×Caixa stashed; build OK; lint 1236 preexistente; cash-flow 441/441 |
| **01** | Foundation modular (flag, money, routes, scaffold FE) | `DONE` | `af2deff` — `feat(treasury): scaffold modular da Central de Tesouraria` | `src/lib/treasury/**`, `src/components/finance/treasury/**`, `GET /api/finance/treasury/availability`; `test:treasury` 16/16; build OK; sem regras financeiras |
| **02** | Feature flags + permissões Tesouraria | `DONE` | `31800a0` — `feat(treasury): adicionar feature flags e permissões da Central de Tesouraria` | Contrato `finance.treasury*`; bags; flags `treasury.*.enabled`; `requireResource` na availability; `test:treasury` 31/31 |
| **03** | Contratos client-safe (enums/DTOs/schemas) | `DONE` | `56780b5` — `feat(treasury): adicionar contratos client-safe da Central de Tesouraria` | `src/lib/treasury/contracts/**`; money/date/timestamp/pagination/sort; parse tipado (sem Zod); FE importa contratos; `test:treasury` 45/45; `check:frontend-server-imports` OK |
| **04** | Schema Prisma contas + acesso + snapshots | `DONE` | `365a4d8` — `feat(treasury): adicionar schema Prisma de contas, acesso e snapshots` | `TreasuryFinancialAccount`, `TreasuryFinancialAccountAccess`, `TreasuryBalanceSnapshot`; migration `20260805120000_*`; FKs `AppUser`; `companyCode` (sem model Company); prisma format/validate/generate OK; `test:treasury` 47/47; build OK; **não** aplicada em prod |
| **05** | Auditoria central Tesouraria | `DONE` | `07c4036` — `feat(treasury): adicionar auditoria central append-only com suporte a transaction` | `TreasuryAuditLog` append-only + trigger; `writeTreasuryAuditLog` aceita TX; helpers tipados; testes create/update/rollback/imutabilidade; migration `20260806120000_*`; `test:treasury` 54/54 |
| **06** | Repository + service contas financeiras | `DONE` | `e7bc851` — `feat(treasury): adicionar repository e service de contas financeiras` | CRUD lógica (list/get/create/update/deactivate/reactivate/sort/min balance/liquidity/consolidado/access); ACL+máscara+optimistic lock+audit; sem exclusão com histórico; `test:treasury` 64/64; rotas/UI ainda pendentes |
| **07** | APIs REST contas financeiras | `DONE` | `80fc494` — `feat(treasury): adicionar APIs REST de contas financeiras` | `GET/POST /accounts`, `GET/PATCH /accounts/:id`, deactivate/reactivate, access GET/PUT; auth+flag+requireResource; DTOs; erros+requestId; `test:treasury` 70/70 |
| **08** | UI contas financeiras | `DONE` | `6a81b79` — `feat(treasury): adicionar tela de contas financeiras` | `/finance/treasury/accounts`; listar/criar/editar/desativar/reativar; saldo mín./liquidez/consolidado/acessos; máscara; estados vazio/loading/erro/sem permissão; responsivo; `test:treasury` 80/80 |
| **09** | Backend/APIs snapshots de saldo | `DONE` | `30cfdb5` — `feat(treasury): adicionar APIs de snapshots de saldo` | `GET …/balances`, `GET …/balances/latest`, `POST …/balance-snapshots` + Idempotency-Key; observado/operacional/bloqueado/aplicações/limite; previousSnapshot; audit; Decimal+auth+idempotência; `test:treasury` 90/90 |
| **10** | UI atualização de saldo | `DONE` | `eed8642` — `feat(treasury): adicionar UX de atualização de saldo` | `/finance/treasury/accounts/:id/balances`; form pt-BR→decimal API; histórico; stale; confirmação; conflito; `test:treasury` 100/100 |
| **11** | Adapter read-only títulos oficiais Nomus (CR/CP) | `DONE` | `29ce7e4` | DTOs `OfficialReceivableView`/`OfficialPayableView`; mappers; adapter Prisma + memory; repo; docs `05-OFFICIAL-AR-AP-ADAPTER.md`; sem cópia de títulos; `test:treasury` 106/106 |
| **12** | Schema complemento operacional de títulos | `DONE` | `1ffd2ab` | `TreasuryTitleOperationalComplement` (RECEIVABLE/PAYABLE); unicidade tipo+título; datas/valores esperados/confirmados/programados; status/prioridade/conta/responsável; versionamento + cancelamento; migration `20260807120000_*` (não deployada); repo base + testes integridade; `test:treasury` 113/113 |
| **13** | API consulta Contas a Receber (oficial + complemento) | `DONE` | `03fec64` | `GET /api/finance/treasury/receivables` + `/:titleId`; filtros (cliente/CNPJ/doc/pedido/NF/vendedor/resp./venc./esperada/promessa/status/atraso/valor/conta/prioridade); paginação/sort; batch join sem N+1; cálculos aberto/recebido/atraso/status/ações; `test:treasury` 119/119 |
| **14** | UI Contas a Receber | `DONE` | `1becae6` | `/finance/treasury/receivables`; tabela server-paginated; filtros; summary qtd/valor; badges; atraso/prioridade/ações; drawer Overlay; mobile columns; estados vazio/erro/loading/stale; `test:treasury` 127/127 |
| **15** | Alterar expectativa operacional CR | `DONE` | `a0e8255` | `PUT …/receivables/:titleId/expectation`; data/conta/responsável/prioridade/ação/motivo/obs; sem mutar vencimento oficial; justificativa ao mudar data; saldo aberto; bloqueio cancelado; optimistic lock; audit before/after; stub recálculo projeção; form no drawer; `test:treasury` 134/134 |
| **16** | Promessas de pagamento CR | `DONE` | `0b7907f` | Model/migration `TreasuryPaymentPromise`; repo/service/APIs; parcial + acima do saldo c/ confirmação; expiração; cumprimento parcial; cancelamento; audit; projeção PROBABLE; UI no drawer; `test:treasury` 143/143 |
| **17** | Ações de cobrança + contestações CR | `DONE` | `8109a2f` | Models/migration `TreasuryCollectionAction` + `TreasuryDispute`; APIs append-only (cancel/status lógico); timeline no drawer; filtro `nextAction`; audit; sem DELETE; `test:treasury` 154/154 |
| **18** | Visão financeira resumida do cliente (CR) | `DONE` | `5eaba13` | `GET …/receivables/:titleId/customer-summary`; totais aberto/vencido/a vencer; atrasos; promessas; índice cumprimento; recebimentos; histórico cobrança; vendedor≠comercial≠cobrança; batch queries; UI drawer; `test:treasury` 159/159 |
| **19** | API consulta Contas a Pagar (oficial + complemento) | `DONE` | `b678929` | `GET /api/finance/treasury/payables` + `/:titleId`; filtros fornecedor/CNPJ/doc/categoria/CC/venc./programada/status/valor/conta/prioridade/responsável; batch complemento+CC; `test:treasury` 165/165 |
| **20** | Programação de pagamentos (CP) | `DONE` | `5d06c5a` | `POST/PUT …/payables/:titleId/program-payment` + `/cancel`; parcial; acima do saldo c/ justificativa; impacto conta/consolidado + alerta negativo; optimistic lock; audit; recálculo; flag `payablesProgramming`; `test:treasury` 176/176 |
| **21** | UI Contas a Pagar | `DONE` | `3240f2f` | `/finance/treasury/payables`; tabela paginada; filtros; totais; status/prioridade/programada/conta; impacto caixa; drawer; form programação com confirmação (saldo conta/consolidado/risco); bloqueio/adiamento/obs/histórico; responsivo; `test:treasury` 183/183 |
| **22** | Serviço de posição financeira atual | `DONE` | `bedc17c` | Rules + service `getCurrentPosition`; observado/operacional/calculado/conciliado/diferença/bloqueado/aplicações/limite/por conta/consolidado; origem por valor; último snapshot válido + movimentos oficiais; divergências explícitas; repos stub movimentos/conciliado; `test:treasury` 191/191 |
| **23** | Dashboard diário Tesouraria | `DONE` | `ed88f66` | `GET /api/finance/treasury/dashboard`; freshness; observado/calculado/conciliado/diferença; CR/CP previsto/realizado/pendente; saldo atual + projetado encerramento; qtd títulos; posição por conta; exceções prioritárias; composição detalhável; filtros date/accountIds/scenario; agregação SQL; `test:treasury` 200/200 |
| **24** | UI tela principal Central de Tesouraria | `DONE` | `9876f03` | `/finance/treasury` dashboard; filtros data/período/conta/cenário; última atualização; cards saldo; previsto×realizado; posição por conta; CR/CP do dia; exceções/alertas/atalhos; detalhe Overlay; money pt-BR; estados loading/vazio/erro/denied/stale/recalculando; `test:treasury` 206/206 |
| **25** | Schema Prisma execução de projeção | `DONE` | `7bfbc43` | Models `TreasuryProjectionRun` / `DayLine` / `CompositionItem`; cenários CONTRACTUAL\|PROBABLE\|CONFIRMED\|MANUAL; source/algorithm version; período; status; falhas; linhas com saldos/fluxos/risco/itens; migration `20260810120000_*`; índices; testes integridade; `test:treasury` 211/211 |
| **26** | Regras puras data de movimento (projeção) | `DONE` | `_pending_` | `treasuryMovementDateRules`: AR/AP × CONTRACTUAL/PROBABLE/CONFIRMED/MANUAL; fuso `America/Sao_Paulo`; vencido sem previsão ≠ hoje; testes virada de data; `test:treasury` 225/225 |

    > **Nota de ordem:** …; UI visão geral = **24**; schema projeção = **25**; regras data movimento = **26**.

---

## Capabilidades do domínio (visão agregada)

| Capabilidade | Status | Notas / reuso |
|--------------|--------|---------------|
| Contas financeiras | `DONE` | Schema + service/repo + APIs REST + UI `/finance/treasury/accounts` |
| Saldos manuais e históricos | `DONE` | Schema + service/repo + APIs REST (histórico/latest/create + Idempotency-Key + audit) |
| Saldo observado / calculado / conciliado | `DONE` | P22: serviço posição atual; observado≠calculado≠conciliado; divergência explícita; consolidado exclui `includeInConsolidated=false`; API/UI ainda pendentes |
| Contas a receber (títulos) | `PARTIAL` | Adapter P11 + API P13 + UI P14 + expectativa P15 + promessas P16 + cobrança/contestação P17 + resumo cliente P18; APIs oficiais `/api/finance/accounts-receivable/*` |
| Contas a pagar (títulos) | `PARTIAL` | Adapter P11 + query API P19 + programação P20 + UI P21 (`/finance/treasury/payables`); APIs oficiais `/api/finance/accounts-payable/*` |
| Previsto vs realizado | `PARTIAL` | P23 dashboard dia (previsto/realizado/pendente CR/CP por cenário); cash-flow permanece separado |
| Dashboard diário Tesouraria | `DONE` | P23 API + P24 UI `/finance/treasury`; freshness; posição; previsto×realizado; exceções/alertas; detalhe ao clicar |
| Datas esperadas | `PARTIAL` | Schema P12 + mutação expectativa P15; resolução pura P26 (prioridade por cenário); `dueDate` oficial intacto; motor de projeção ainda stub |
| Promessas de pagamento | `DONE` | Model + APIs + UI P16; P26 usa promessa ativa na data PROBABLE; não altera `dueDate`; histórico preservado |
| Ações de cobrança | `DONE` | Model + APIs + timeline P17; tipos telefone/WhatsApp/e-mail/reunião/comercial/análise/outro; cancelamento lógico; histórico preservado |
| Contestações | `DONE` | Model + APIs + timeline P17; motivo/valor/responsável/área/prazo/status; não muta saldo/vencimento oficiais |
| Programação de pagamentos | `DONE` | P20: complemento local (data/conta/valor/prioridade/responsável/status PROGRAMMED\|AUTHORIZED); parcial; impacto conta/consolidado; audit; sem mutar `dueDate` oficial |
| Projeção contratual / provável / confirmada | `PARTIAL` | P25 schema; P26 regras puras de data por cenário (AR/AP); motor de cálculo ainda stub |
| Agenda financeira | `PARTIAL` | Calendário cash-flow |
| Transferências | `NOT_STARTED` | Regra: transferência interna não altera caixa consolidado |
| Lançamentos manuais | `NOT_STARTED` | — |
| Exceções / alertas | `PARTIAL` | P23: exceções prioritárias derivadas (divergência/negativo/prioridade dia); CRUD `TreasuryException` ainda pendente |
| Fechamento diário | `NOT_STARTED` | Imutável + versionado (requisito) |
| Reabertura | `NOT_STARTED` | — |
| Importação OFX | `NOT_STARTED` | — |
| Conciliação bancária | `NOT_STARTED` | Distinto de `finance.portfolio_reconciliation` |
| Relatórios tesouraria | `NOT_STARTED` | Reusar padrão export XLSX/CSV |
| Exportações | `PARTIAL` | Exports AR/AP/cash-flow existem |
| Auditoria domínio | `DONE` | `TreasuryAuditLog` append-only + writer TX-aware + helpers tipados |
| Permissões | `DONE` | Contrato `finance.treasury*` + bags; deny>allow; unknown deny |
| Observabilidade | `PARTIAL` | `/api/health`, logs console, Nomus sync logs |
| Testes domínio | `PARTIAL` | `npm run test:treasury` 211/211; suíte plena em P28 |
| Contratos DTO/schema | `DONE` | Enums, DTOs, parse tipado, paginação, sort whitelist, money/date/timestamp |
| Documentação | `IN_PROGRESS` | Discovery + mapping + plano (Prompt 00) feitos; runbook ainda não |
| Feature flags | `DONE` | Mestra + 7 subflags fail-closed (`treasury.*.enabled`) |
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
| Scaffold Tesouraria não grava/copia títulos Nomus | Confirmado (P01 + P11 adapter read-only; sem upsert) |

---

### 01 — Foundation modular
- [x] `src/lib/treasury/` com routers/controllers/services/repositories/domain/queries/mappers/jobs/contracts
- [x] FE `src/components/finance/treasury/` (placeholder, sem Prisma)
- [x] `registerTreasuryRoutes` no `server.ts` (registro mínimo)
- [x] `GET /api/finance/treasury/availability` (auth + flag fail-closed)
- [x] Money kit string decimal + feature flag
- [x] `npm run test:treasury` 16/16
- [x] `check:frontend-server-imports` OK; `build` OK
- [x] Sem regras financeiras / sem schema Prisma novo
- [x] Sem avanço automático para Prompt 02

### 02 — Flags + permissões
- [x] Flags `treasury.enabled` + subflags (accounts/projection/promises/payablesProgramming/dailyClosing/reconciliation/ofxImport)
- [x] Bags mínimas no `permissionCatalog`
- [x] Recursos `finance.treasury*` no contrato (`resources.ts`)
- [x] `financeModulesAccess` + Leticia deny list + pilot availability
- [x] `requireResource(finance.treasury, view)` na availability
- [x] Testes deny>allow, unknown deny, isolation irmãos; `test:treasury` 31/31
- [x] Sem avanço automático para Prompt 03

### 03 — Contratos client-safe
- [x] Enums de domínio (side, accountType, ledger, promise, projection, closing, etc.)
- [x] DTOs compartilhados (accounts, balances, ledger, transfers, overlays, closing…)
- [x] Schemas de validação (parse tipado IndusCost — projeto sem Zod)
- [x] Paginação + ordenação autorizada (unknown sort denied)
- [x] Filtros de lista/intervalo civil
- [x] Money string decimal; civil YYYY-MM-DD; timestamp ISO com offset
- [x] Códigos de erro + constantes/limites de tamanho
- [x] Helpers sem Prisma; FE importa `contracts/` sem bundle Prisma
- [x] Testes money/dates/enums/pagination/required/limits; `test:treasury` 45/45
- [x] Sem schema Prisma / sem avanço automático para accounts schema

### 04 — Schema Prisma contas + acesso + snapshots
- [x] `TreasuryFinancialAccount` (empresa via `companyCode`, instituição, tipo, moeda, máscaras, consolidado, saldo mínimo, negativo, liquidez, origem padrão, sortOrder, ativo, criação/desativação)
- [x] `TreasuryFinancialAccountAccess` (user ↔ conta, nível, saldo view/mutate)
- [x] `TreasuryBalanceSnapshot` (referenceAt, disponível/bloqueado/aplicações/limite, origem, notes, attachment, user, previousSnapshot, idempotency)
- [x] FKs reais em `AppUser`; sem model Company no IndusCost (`companyCode` operacional)
- [x] Migration aditiva versionada `20260805120000_treasury_financial_accounts_and_balance_snapshots`
- [x] `prisma format` + `validate` (URL dummy) + `generate`
- [x] `test:treasury` 47/47; `check:frontend-server-imports` OK; `build` OK
- [x] Migration **não** aplicada em produção
- [x] Sem avanço automático para CRUD contas

### 05 — Auditoria central
- [x] Model `TreasuryAuditLog` (entity, id, action, before/after, metadata, justification, requestId, session, user, occurredAt)
- [x] Writer aceita `PrismaClient | TransactionClient` (mesma TX da ação principal)
- [x] Helpers tipados (`buildTreasuryCreatedAudit` / `Updated` / access / snapshot)
- [x] Imutabilidade: API nega update/delete + trigger SQL BEFORE UPDATE OR DELETE
- [x] Testes: criação, alteração, rollback conjunto, imutabilidade
- [x] Migration `20260806120000_treasury_audit_log` (não aplicada em prod)
- [x] `test:treasury` 54/54; prisma validate/generate OK
- [x] Sem avanço automático para CRUD contas

### 06 — Repository + service contas
- [x] Listar contas acessíveis (ACL + SUPER_ADMIN total)
- [x] Consultar / criar / atualizar / desativar / reativar
- [x] Ordenar; saldo mínimo; liquidez; inclusão no consolidado
- [x] Gerenciar acesso por usuário (grant/revoke)
- [x] Sem exclusão física com histórico; máscara por permissão
- [x] Optimistic lock via `expectedUpdatedAt`; auditoria na mesma TX
- [x] Helper origem≠destino para transferências futuras
- [x] Testes unitários (rules) + integração (memory repo); `test:treasury` 64/64
- [x] Sem rotas/UI neste passo

### 07 — APIs REST contas
- [x] `GET/POST /api/finance/treasury/accounts`
- [x] `GET/PATCH /api/finance/treasury/accounts/:id`
- [x] `POST …/deactivate` e `…/reactivate`
- [x] `GET/PUT …/access`
- [x] Auth + flag + `requireResource` (view/manage) + acesso por conta no service
- [x] Validação tipada; erros padronizados (`code` + `requestId`); DTOs (sem Prisma)
- [x] Auditoria via service; paginação na listagem
- [x] Testes de API (wiring + handlers + 401/403); `test:treasury` 70/70
- [x] Sem UI neste passo

### 22 — Posição financeira atual
- [x] Contratos: origens `TREASURY_POSITION_VALUE_ORIGINS` + DTOs por conta/consolidado
- [x] Rules: observado, operacional disponível, calculado, conciliado, diferença, bloqueado, aplicações, limite utilizado
- [x] Calculado = último snapshot válido + movimentos realizados oficiais ACTIVE após `referenceAt`
- [x] Origem explícita por valor; `MISSING` e divergências nunca omitidas/zeradas
- [x] Consolidado exclui contas `includeInConsolidated=false`; conta negativa e ausência de saldo cobertas
- [x] Service `getCurrentPosition` (ACL view) + repos stub movimentos oficiais / saldo conciliado
- [x] Testes rules + integração (multi-conta, fora consolidado, liquidez, bloqueado, negativo, ausência)
- [x] `npm run test:treasury` 191/191
- [x] Sem API/UI neste passo; sem avanço automático

### 23 — Dashboard diário
- [x] `GET /api/finance/treasury/dashboard` (auth + flag + `finance.treasury.dashboard` view)
- [x] Freshness das fontes (snapshots, sync CR/CP, complementos)
- [x] Observado / calculado / conciliado / diferença + posição por conta (via P22)
- [x] Recebimentos/pagamentos previstos, realizados e pendentes (agregação SQL + memória testes)
- [x] Saldo atual + saldo projetado de encerramento; quantidade de títulos
- [x] Exceções prioritárias + composição detalhável com origem
- [x] Filtros: `date`, `accountIds`, `scenario` (CONTRACTUAL/PROBABLE/CONFIRMED)
- [x] Testes de consistência dos totais (composição ≡ resumo; projeção; divergência)
- [x] `npm run test:treasury` 200/200
- [x] Sem UI neste passo; sem avanço automático

### 24 — UI tela principal (visão geral)
- [x] `/finance/treasury` consome `GET …/dashboard`
- [x] Filtros: data, período, conta, cenário; última atualização
- [x] Cards de saldo; previsto×realizado; posição por conta; recebimentos/pagamentos do dia
- [x] Exceções, alertas (freshness/divergência), atalhos
- [x] Detalhamento Overlay ao clicar nos totais; rótulos textuais (não só cor)
- [x] Formatação monetária pt-BR
- [x] Estados: loading, vazio, erro, sem permissão, dados desatualizados, recálculo em andamento
- [x] Testes UI + helpers; `test:treasury` 206/206
- [x] Sem avanço automático

### 25 — Schema Prisma projeção
- [x] `TreasuryProjectionRun` (cenário, período, sourceVersion, algorithmVersion, status, falhas)
- [x] `TreasuryProjectionDayLine` (conta, data, saldos, entradas/saídas/transferências/realizados, recebíveis incertos, mínimo, risco, itemCount)
- [x] `TreasuryProjectionCompositionItem` (rastreabilidade)
- [x] Cenários CONTRACTUAL / PROBABLE / CONFIRMED / MANUAL
- [x] Migration aditiva `20260810120000_treasury_projection_run_and_day_lines` + índices/FKs
- [x] Contratos client-safe alinhados; `prisma validate` OK
- [x] Testes schema + integridade; `test:treasury` 211/211
- [x] Migration **não** aplicada em produção; sem avanço automático

### 26 — Regras puras data de movimento
- [x] Funções puras em `treasuryMovementDateRules` (sem Prisma/I/O)
- [x] Recebível: CONTRACTUAL=vencimento; PROBABLE=promessa→esperada→vencimento não vencido; CONFIRMED=confirmação/realização
- [x] Pagável: CONTRACTUAL=vencimento; PROBABLE=programada→esperada→vencimento; CONFIRMED=realizado/AUTHORIZED/PROGRAMMED/confirmação
- [x] Vencido sem previsão **não** entra automaticamente em hoje
- [x] Fuso `America/Sao_Paulo` + testes de virada de data
- [x] `npm run test:treasury` 225/225
- [x] Sem motor de projeção / API / UI neste passo; sem avanço automático

---

## Riscos / pendências abertas

1. Branch `feat/finance-lucro-caixa` coexiste — não misturar commits.
2. Seed DB (`permissions:seed:contract:apply`) ainda a cargo do usuário/ops — contrato tipado já está no código.
3. Migrations Tesouraria criadas mas **não deployadas** — usuário aplica com `migrate deploy`.
4. Deploy produção permanece com o usuário.
5. Shell Tesouraria em `/finance/treasury/*` (standalone); aba no `FinanceModule` principal ainda não (proposital — evita ripple de `FinanceSectionId`).
6. Alias relacional PT `financeiro.tesouraria` ainda não criado no seed legado (de propósito nesta etapa).
7. IndusCost não tem model `Company` — Tesouraria usa `companyCode`/`companyName` até existir entidade canônica.

---

## Histórico curto

| Data | Evento |
|------|--------|
| 2026-07-27 | Prompt 00a: discovery completo; docs criados; validações de leitura OK |
| 2026-07-27 | Prompt 00b: requirements mapping + implementation plan; sem código funcional |
| 2026-07-27 | Prompt 00c: baseline em `feature/treasury-center`; WIP Lucro×Caixa protegido; build/tests adjacentes OK |
| 2026-07-27 | Prompt 01: scaffold modular + availability endpoint; test:treasury 16/16; build OK |
| 2026-07-27 | Prompt 02: flags + permissões Tesouraria; test:treasury 31/31 |
| 2026-07-27 | Prompt 03: contratos client-safe (enums/DTOs/schemas); test:treasury 45/45; FE sem Prisma |
| 2026-07-27 | Prompt 04: schema Prisma contas/acesso/snapshots + migration aditiva; generate/build OK; sem deploy |
| 2026-07-27 | Prompt 05: auditoria central append-only + TX; test:treasury 54/54; migration não deployada |
| 2026-07-27 | Prompt 06: repository/service contas financeiras; test:treasury 64/64 |
| 2026-07-27 | Prompt 07: APIs REST contas financeiras; test:treasury 70/70 |
| 2026-07-27 | Prompt 08: UI contas financeiras; test:treasury 80/80 |
| 2026-07-27 | Prompt 09: APIs snapshots de saldo; test:treasury 90/90 |
| 2026-07-27 | Prompt 10: UI atualização de saldo; test:treasury 100/100 |
| 2026-07-27 | Prompt 11: adapter/repo read-only AR/AP oficiais Nomus; DTOs canônicos; test:treasury 106/106 |
| 2026-07-27 | Prompt 12: schema/repo complemento operacional de títulos; migration aditiva; test:treasury 113/113 |
| 2026-07-27 | Prompt 13: query service/API receivables (oficial+complemento); filtros/paginação; test:treasury 119/119 |
| 2026-07-27 | Prompt 14: UI Contas a Receber Tesouraria; drawer; responsivo; test:treasury 127/127 |
| 2026-07-27 | Prompt 15: PUT expectativa operacional CR + form drawer + audit/409/permissão — `a0e8255` |
| 2026-07-27 | Prompt 16: promessas de pagamento CR (model/API/UI/audit/expiração) — `0b7907f` |
| 2026-07-27 | Prompt 17: ações de cobrança + contestações CR (model/API/timeline/filtro nextAction/audit) — `8109a2f` |
| 2026-07-27 | Prompt 18: visão financeira resumida do cliente no detalhe CR — `5eaba13` |
| 2026-07-27 | Prompt 19: API consulta Contas a Pagar Tesouraria (repo/query/APIs/batch) — `b678929` |
| 2026-07-27 | Prompt 20: programação de pagamentos CP (program/alterar/cancelar + impacto + audit) — `5d06c5a` |
| 2026-07-27 | Prompt 21: UI Contas a Pagar Tesouraria (tabela/filtros/drawer/programação/impacto) — `3240f2f` |
| 2026-07-27 | Prompt 22: serviço posição financeira atual (observado/calculado/conciliado/consolidado + origens) — `bedc17c` |
| 2026-07-27 | Prompt 23: dashboard diário Tesouraria (`GET /dashboard` + agregações + consistência totais) — `ed88f66` |
| 2026-07-27 | Prompt 24: UI tela principal Central de Tesouraria (visão geral dashboard) — `9876f03` |
| 2026-07-27 | Prompt 25: schema Prisma execução de projeção (run/linhas/composição) — `7bfbc43` |
| 2026-07-27 | Prompt 26: regras puras data de movimento (AR/AP × cenários + virada SP) — `_pending_` |
