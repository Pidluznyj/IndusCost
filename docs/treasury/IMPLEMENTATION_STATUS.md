# Central de Tesouraria — Implementation Status

**Atualizado:** 2026-07-28  
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
| **26** | Regras puras data de movimento (projeção) | `DONE` | `b390439` | `treasuryMovementDateRules`: AR/AP × CONTRACTUAL/PROBABLE/CONFIRMED/MANUAL; fuso `America/Sao_Paulo`; vencido sem previsão ≠ hoje; testes virada de data; `test:treasury` 225/225 |
| **27** | Identidade e precedência financeira | `DONE` | `4f6cd19` | `treasuryFinancialIdentityRules`: precedência conciliado>baixa>realizado>previsão; chave lógica fonte+parcela; anti-dupla (pedido/NF/DS/previsão/baixa/transfer/parcial/cancelado); `test:treasury` 240/240 |
| **28** | Motor determinístico de projeção | `DONE` | `0ac7098` | `treasuryProjectionEngine`: fluxo 16 passos; Decimal string; datas+identidade; day lines + risco + composição; sem Express/Prisma; `test:treasury` 260/260 |
| **29** | Precisão Decimal + liquidez no motor | `DONE` | `3c6103a` | Money BigInt HALF_UP; aplicações IMMEDIATE/D+1/D+2/D+3; bloqueado; crédito separado; mínimo operacional; allowNegative; `test:treasury` 274/274 |
| **30** | Execução e persistência de projeção | `DONE` | `501056e` | ProjectionRun RUNNING/SUCCEEDED/FAILED; advisory lock empresa+cenário; source/algorithm version; não substitui anterior; latest válida; `test:treasury` 279/279 |
| **31** | Fila persistente de recálculo (PostgreSQL) | `DONE` | `9e3d51a` | Model/migration `TreasuryProjectionRecalcJob`; status/attempts/availableAt/lock/deduplicationKey/erro/conclusão; eventos AR/AP sync, baixa, cancelamento, expectativa, promessa, programação, lançamento, transferência, saldo, conciliação, reversão, fechamento, reabertura; dedupe ativos; worker+retry; sem broker; `test:treasury` 289/289 |
| **32** | Recálculo após sync AR/AP oficial | `DONE` | `4092a9b` | Hook `treasuryProjectionRecalc` nos syncs canônicos CR/CP; emite só após `finish*SourceSyncRun` SUCCESS + payloadComplete + mudanças; não emite em INCONCLUSIVE/preview/falha; período mínimo em payload (união no dedupe); checkpoint/exitCode intactos; sem cron novo; `test:treasury` 298/298 |
| **33** | APIs REST projeção + agenda | `DONE` | `faba85d` | `POST …/projections/calculate`, `GET …/latest`, `GET …/:id`, `GET …/:id/composition`, `GET …/agenda`; baseDate/endDate/cenário/contas/consolidação/detalhe dia; horizonte configurável (`TREASURY_PROJECTION_MAX_HORIZON_DAYS`); money string; freshness+sourceVersion+algorithmVersion; flag `treasury.projection.enabled`; `test:treasury` 304/304 |
| **34** | UI agenda financeira | `DONE` | `12037b0` | `/finance/treasury/agenda`; colunas dia (saldo inicial/final, entradas previstas/confirmadas/realizadas, saídas previstas/programadas/realizadas, transferências, risco textual); períodos hoje/7/15/30/60/90/custom; visão consolidada/conta/grupo; gráfico evolução + tabela detalhável; DTO/API enriquecidos multi-cenário; `test:treasury` 319/319 |
| **35** | Comparação contratual×provável×confirmado | `DONE` | `613f3ac` | `GET …/projections/compare` (só leitura, `recalculated:false`); UI `/finance/treasury/projections`; saldo/diff/incerteza/risco por dia; 1ª negativa + menor saldo; toggle local sem refetch; testes consistência; `test:treasury` 329/329 |
| **36** | Auditoria do motor de projeção | `DONE` | `7628e55` | Correções: multi-baixa, promisedAmount, dedupe seeds, transfer órfã, ledger×settlement, includeInConsolidated, índice apps; algoritmo `1.2.0`; testes lacunas; sem UI nova; `test:treasury` 338/338 |
| **37** | Transferências entre contas | `DONE` | `2cdcba4` | Model/migration `TreasuryTransfer`; status prevista→…→conciliada/cancelada; ACL nas 2 contas; em trânsito (SENT); audit+recalc; APIs + UI `/transfers`; motor `1.3.0`; `test:treasury` 351/351 |
| **38** | Model + serviço de exceções | `DONE` | `e4b823f` | `TreasuryException` + migration; upsert idempotente por `uniqueKey`; recorrência; resolve/ignore/ack; repo+service+testes; sem API/UI; `test:treasury` 361/361 |
| **39** | Motor determinístico de exceções | `DONE` | `5dcdc74` | 16 tipos; generate/update; auto-resolve só seguro; algo `1.0.0`; testes por tipo; sem API/UI; `test:treasury` 386/386 |
| **40** | APIs + UI Central de Exceções | `DONE` | `a9a95ac` | Status 6 canônicos; list/sort/assign/due/status/resolve/ignore; deep-link; flag; `/exceptions`; `test:treasury` 395/395 |
| **41** | Alertas no dashboard/agenda + config | `DONE` | `0e6e655` | 8 alertas; `TreasuryAlertSettings` singleton; GET/PUT settings; sem notificação externa; `test:treasury` 410/410 |
| **42** | Schema fechamento diário + reabertura | `DONE` | `f39279f` | Models closing/posição/pendências/exceções/ressalvas/reabertura; version+status+sourceHash; imutável; migration+índices; `test:treasury` 420/420 |
| **43** | Preview fechamento diário (GET) | `DONE` | `7313c86` | `GET /daily-closing/preview`; gates absolutos vs ressalva; sourceHash; canClose*; `test:treasury` 430/430 |
| **44** | Close/reopen/list/get fechamento | `DONE` | `c219f45` | POST/GET closing + reopen; lock; hash 409; ressalvas; audit; recalc; testes concorrência; `test:treasury` 441/441 |
| **45** | UI fechamento diário | `DONE` | `b955d68` | `/finance/treasury/closing`; preview+checklist+ressalvas+histórico+reabertura+comparação; refresh antes de confirmar; 409 orienta revisão; `test:treasury` 450/450 |
| **46** | Detecção pós-fechamento | `DONE` | `9760540` | `FINANCIAL_CHANGE_AFTER_CLOSING` (alias POST_CLOSING…); não reescreve CLOSED; diferença+tratamento; hooks sync/saldo; `test:treasury` 459/459 |
| **47** | Base segura importação OFX | `DONE` | `c4d09c1` | dep `ofx-data-extractor`; limite 5MiB; MIME; temp seguro+hash+descarte; parser OFX1/OFX2; sem persistir TX; `test:treasury` 468/468 |
| **48** | Schema importação bancária + movimentos | `DONE` | `3d5d1ab` | `TreasuryBankImportBatch` + `TreasuryBankMovement`; fingerprint/payload/conciliação; unicidade anti-duplicidade; migration `20260818120000_*`; sem raw OFX; `test:treasury` 475/475 |
| **49** | Preview OFX (`POST …/bank-imports/ofx/preview`) | `DONE` | `99b527f` | permissão+conta; parse/normalize/fingerprint; NEW/DUPLICATE/INVALID; período/totais; token temporário; sem gravar TX; `test:treasury` 483/483 |
| **50** | Apply OFX (`POST …/bank-imports/ofx/apply`) | `DONE` | `0465f29` | consome preview; TX; lote+movimentos; anti-dup; audit IMPORT; sugestões+recalc; idempotente por fileSha256; `test:treasury` 488/488 |
| **51** | UI movimentos bancários + OFX | `DONE` | `0fd8a77` | `/bank-movements`; upload/preview/confirm; lotes; filtros; detalhe; GET list; `test:treasury` 494/494 |
| **52** | Motor de sugestões de conciliação | `DONE` | `aa80d13` | Motor puro: valor/doc/CNPJ-CPF/data/nome/histórico/direção; faixas HIGH/MEDIUM/LOW; score+motivos; sem auto-match; exclui cancelados/realizados; `test:treasury` 505/505 |
| **53** | Conciliação bancária (match+allocations) | `DONE` | `e158344` | Models/migration; 1:1/1:N/N:1; parcial; fee/juros/desconto/abatimento/diferença/unidentified/transfer/manual; service TX; status; audit; recalc; sem baixa Nomus; `test:treasury` 523/523 |
| **54** | Reverse conciliação (`POST …/reconciliations/:id/reverse`) | `DONE` | `15f4102` | permissão reverse; justificativa+REVERTER; soft reverse; restaura movimentos; audit REVERSE; recalc; exceção dia fechado; UI confirmação forte; `test:treasury` 529/529 |
| **55** | Queries/APIs relatórios Tesouraria | `DONE` | `e7d6139` | `GET …/reports/:reportKey` (10 keys); período+contas autorizadas+filtros+totais+composição+paginação; agregações SQL; consistência totais; `test:treasury` 543/543 |
| **56** | Central de Relatórios (UI + exportações) | `DONE` | `6d08bb8` | `/reports` UI; seleção/período/filtros/visualização/impressão; CSV (anti formula-injection) + XLSX + PDF local; permissões view/export; `test:treasury` 553/553 |
| **57** | Auditoria de segurança do módulo | `DONE` | `adcbc63` | anti-IDOR contas em movimentos; rate limit ações críticas; path OFX; segredo preview prod; logs sanitizados; summaryJson redacted; CSV injection; testes segurança; `test:treasury` 566/566 |
| **58** | Auditoria de performance | `DONE` | `6ed1fb6` | batch ACL/saldos; OFX createMany; exception statuses IN; defer rawPayload CR/CP; índices; benchmarks antes/depois; `docs/treasury/PERFORMANCE_BENCHMARKS.md`; `test:treasury` 574/574 |
| **59** | Completar testes unitários (regras) | `DONE` | `b4cced6` | cobertura obrigatória contas/saldos/perms/expectativas/promessas/cobrança/pagamentos/projeção/dupla contagem/Decimal/datas/transferências/lançamentos/exceções/fechamento/OFX/conciliação/relatórios; `test:treasury` 592/592 |
| **60** | Testes de integração completos (DB seguro) | `DONE` | `462c74c` | gate `TREASURY_TEST_DATABASE_URL` (anti-prod); harness in-process TX/rollback; E2E conta→saldo→AR/AP→expectativa→promessa→programação→projeção→exceção→close→OFX→conciliar→reverter→reabrir→relatório; idempotência+auditoria; `test:treasury` 601/602 (1 skip gated Postgres) |
| **61** | Testes E2E fluxos críticos (tsx --test) | `DONE` | `PENDING` | `TreasuryCriticalFlows.e2e.test.tsx` (14 passos UI + denied + responsivo); fix drawers init síncrono; PermissionDenied transfers/OFX; className helpers `()`; `test:treasury` 604/605 (1 skip) |

    > **Nota de ordem:** …; segurança = **57**; performance = **58**; testes unitários = **59**; integração = **60**; E2E UI = **61**.

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
| Datas esperadas | `PARTIAL` | Schema P12 + mutação expectativa P15; resolução pura P26; motor P28 consome overlays por cenário; `dueDate` oficial intacto |
| Promessas de pagamento | `DONE` | Model + APIs + UI P16; P26 usa promessa ativa na data PROBABLE; não altera `dueDate`; histórico preservado |
| Ações de cobrança | `DONE` | Model + APIs + timeline P17; tipos telefone/WhatsApp/e-mail/reunião/comercial/análise/outro; cancelamento lógico; histórico preservado |
| Contestações | `DONE` | Model + APIs + timeline P17; motivo/valor/responsável/área/prazo/status; não muta saldo/vencimento oficiais |
| Programação de pagamentos | `DONE` | P20: complemento local (data/conta/valor/prioridade/responsável/status PROGRAMMED\|AUTHORIZED); parcial; impacto conta/consolidado; audit; sem mutar `dueDate` oficial |
| Projeção contratual / provável / confirmada | `DONE` | P25–P35: motor+fila+APIs+agenda+comparação UI/API (`/projections` + `/projections/compare`) |
| Agenda financeira | `DONE` | P33 API + P34 UI `/finance/treasury/agenda`; buckets multi-cenário; períodos/visões; gráfico+tabela; risco textual |
| Transferências | `DONE` | P37: model+API+UI; consolidado neutro; em trânsito enquanto SENT; cancelamento auditado |
| Lançamentos manuais | `NOT_STARTED` | — |
| Exceções / alertas | `DONE` | P23–P40 exceções; P41 alertas no dashboard/agenda + `TreasuryAlertSettings` (limites/severidade); sem push/e-mail |
| Fechamento diário | `DONE` | P42–P45: schema+preview+API+UI `/closing`; P46 detecta mudanças posteriores sem reescrever |
| Reabertura | `DONE` | P44 API + P45 UI; P46 aponta tratamento formal / reabertura via exceção pós-fechamento |
| Importação OFX | `PARTIAL` | P47–P51: parser+schema+preview+apply+UI; P52 motor de sugestões (sem auto-match) |
| Conciliação bancária | `PARTIAL` | P52–P54: sugestões + match/allocations + reverse API/UI; workspace completo ainda pendente |
| Relatórios tesouraria | `DONE` | P55 APIs + P56 UI `/finance/treasury/reports` com impressão/export |
| Exportações | `PARTIAL` | P56: CSV/XLSX/PDF dos relatórios Tesouraria; AR/AP/cash-flow já existiam |
| Auditoria domínio | `DONE` | `TreasuryAuditLog` append-only + writer TX-aware + helpers tipados |
| Permissões | `DONE` | Contrato `finance.treasury*` + bags; deny>allow; unknown deny |
| Observabilidade | `PARTIAL` | `/api/health`, logs console, Nomus sync logs |
| Testes domínio | `DONE` | Unitários P59 + integração P60 (DB seguro) + E2E UI P61 (`tsx --test` + `renderToStaticMarkup`) |
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

### 27 — Identidade e precedência financeira
- [x] Funções puras em `treasuryFinancialIdentityRules` (sem Prisma/I/O)
- [x] Precedência: conciliado → baixa oficial → realizado não conciliado → previsão
- [x] Chave lógica rastreável `{side}|{source}|{subject}|inst:{n}`
- [x] Pedido / NF / Documento de Saída não somam ao título
- [x] Previsão não soma ao realizado; baixa≠conciliação duplicada
- [x] Transferências `affectsConsolidated=false`; parcial usa saldo aberto; cancelados não projetam
- [x] Testes dos casos de dupla contagem conhecidos; `test:treasury` 240/240
- [x] Sem motor/API/UI neste passo; sem avanço automático

### 28 — Motor determinístico de projeção
- [x] `runTreasuryProjectionEngine` puro (sem Express/Prisma)
- [x] Fluxo: saldo-base → AR/AP/baixas/expectativas/promessas/programações/lançamentos/transferências → cancelados → saldo aberto → data cenário → agrupar → saldos → risco → composição
- [x] Reusa P26 (datas) + P27 (identidade); money string Decimal
- [x] Day lines com inflows/outflows/transfers/realized/uncertain/risk + composição `sourceRef`
- [x] Testes extensivos (cenários, parcial, transfer invariante, determinismo); `test:treasury` 260/260
- [x] Sem API/UI/persistência de run neste passo; sem avanço automático

### 29 — Precisão Decimal + liquidez
- [x] Money kit BigInt/centavos + arredondamento HALF_UP
- [x] Aplicações IMMEDIATE / D+1 / D+2 / D+3 (indisponíveis até liquidez)
- [x] Saldo bloqueado; limite de crédito separado; mínimo operacional; allowNegative
- [x] Day line: available/blocked/investments/credit/totalPosition
- [x] Testes obrigatórios (0.01+0.02, milhões, milhares de movimentos, centavos, transfer, liquidez); `test:treasury` 274/274
- [x] Sem avanço automático
---

### 30 — Execução e persistência de projeção
- [x] Cria `TreasuryProjectionRun` (PENDING → RUNNING → SUCCEEDED/FAILED)
- [x] Executa motor e persiste day lines/composição em lotes
- [x] Mantém `algorithmVersion` + `sourceVersion` (hash)
- [x] Não substitui projeção anterior; `getLatestValid` = último SUCCEEDED
- [x] Advisory lock (`pg_try_advisory_lock`) por empresa+cenário
- [x] Testes sucesso/falha/concorrência; `test:treasury` 279/279
- [x] Sem avanço automático
---

### 32 — Recálculo após sync AR/AP
- [x] Pontos: `scripts/nomusAccountsReceivableSync.ts` e `scripts/nomusAccountsPayableSync.ts` após `finish*SourceSyncRun`
- [x] Regras puras `treasuryProjectionRecalcAfterNomusSync` (apply + exit 0 + payloadComplete + SUCCESS + mudanças)
- [x] Hook canônico `treasuryProjectionRecalc` em `planPostSyncHooks` (AR/AP)
- [x] Payload com `affectedPeriodFrom/To` (janela covered); dedupe une período
- [x] Enqueue falha isolada — não altera checkpoint Nemus nem exitCode
- [x] Sem Redis/cron concorrente novo
- [x] Testes decisão/enqueue/wiring; `test:treasury` 298/298
- [x] Sem avanço automático
---

### 33 — APIs REST projeção e agenda
- [x] `POST /api/finance/treasury/projections/calculate` (Idempotency-Key)
- [x] `GET …/projections/latest`, `GET …/projections/:id`, `GET …/projections/:id/composition`
- [x] `GET /api/finance/treasury/agenda`
- [x] Filtros: baseDate, endDate, cenário, contas, consolidação, detalhamento por dia
- [x] Horizonte máximo configurável (`TREASURY_PROJECTION_MAX_HORIZON_DAYS`, default 90)
- [x] Valores monetários como string; freshness + sourceVersion + algorithmVersion
- [x] Flag `treasury.projection.enabled`; permissões dashboard.view / agenda.view
- [x] Testes autorização, filtros e consistência; `test:treasury` 304/304
- [x] Sem avanço automático
---

### 34 — UI agenda financeira
- [x] Tela `/finance/treasury/agenda` (nav + rota no `TreasuryModule`)
- [x] Colunas por dia: saldo inicial; entradas previstas/confirmadas/realizadas; saídas previstas/programadas/realizadas; transferências; saldo final; risco (código + rótulo textual)
- [x] Períodos: hoje, 7/15/30/60/90 dias, personalizado
- [x] Visões: consolidada, por conta, por grupo de contas (instituição)
- [x] Gráfico de evolução do saldo final + tabela detalhável (composição)
- [x] API/DTO enriquecidos (multi-cenário CONTRACTUAL/PROBABLE/CONFIRMED)
- [x] Sem cor como única indicação (rótulos de risco/status)
- [x] Testes domain/UI/API; `test:treasury` 319/319
- [x] Sem avanço automático
---

### 35 — Comparação contratual × provável × confirmado
- [x] `GET /api/finance/treasury/projections/compare` — lê latest SUCCEEDED dos 3 cenários (sem calculate)
- [x] Por dia: saldo de cada cenário; diferenças; recebíveis s/ previsão confiável; maior risco (rótulo textual)
- [x] Resumo: primeira data negativa; menor saldo do período (por cenário e geral)
- [x] UI `/finance/treasury/projections` com toggle local de cenários (sem refetch/recalc)
- [x] `recalculated: false` explícito no DTO
- [x] Testes de consistência das diferenças (money string); `test:treasury` 329/329
- [x] Sem avanço automático
---

### 36 — Auditoria exclusiva do motor de projeção
- [x] Checklist: dupla contagem, parcial, cancelado, transferência, realizado, promessa, data esperada, vencido s/ previsão, timezone SP, Decimal, liquidez, fora do consolidado, diferença por conta, composição, performance
- [x] Fix CRITICAL: múltiplas baixas parciais somam (`clusterRealizedClaims`)
- [x] Fix HIGH: `promisedAmount` limita open; dedupe seeds título+parcela; transfer com perna ausente é ignorada (ambas)
- [x] Fix MEDIUM: ledger linkado/nature baixa não duplica settlement; `includeInConsolidated` em movimentos; índice apps por conta
- [x] Algoritmo `1.2.0`; testes de lacunas; sem telas novas
- [x] `test:treasury` 338/338
- [x] Sem avanço automático
---

### 37 — Transferências entre contas
- [x] Model `TreasuryTransfer` + enum status FORECAST|SCHEDULED|SENT|RECEIVED|RECONCILED|CANCELLED + migration `20260812120000_*`
- [x] Regras: origem≠destino; valor positivo; saída/entrada; consolidado neutro; em trânsito (SENT); cancelamento auditado; ACL OPERATE nas duas contas
- [x] Service/repo/controllers/APIs (`GET/POST …/transfers`, schedule/send/receive/reconcile/cancel) + flag `treasury.transfers.enabled`
- [x] Recálculo de projeção (`transfer_*` → evento TRANSFER); seeds com status/pernas; algoritmo `1.3.0`
- [x] UI `/finance/treasury/transfers` (lista + dialog + transições)
- [x] Testes regras/integração/API/UI/schema; `test:treasury` 351/351
- [x] Sem avanço automático
---

### 38 — Model e serviço de exceções
- [x] Model `TreasuryException` + enums type/severity/status/entityKind + migration `20260813120000_*`
- [x] Campos: tipo, severidade, status, entidade, título, descrição, valor, detecção, prazo, responsável, resolução, justificativa ignorar, uniqueKey, recorrência, metadata
- [x] Idempotência `upsertByUniqueKey`: causa aberta não duplica; atualiza valor/dados; preserva/incrementa recorrência; reabre fechada
- [x] acknowledge / resolve (nota) / ignore (justificativa) auditados; sem exclusão física
- [x] Repository Prisma + memory; service; testes regras/integração/schema
- [x] Sem API/UI neste passo; `test:treasury` 361/361
- [x] Sem avanço automático
---

### 39 — Motor determinístico de exceções
- [x] Tipos mínimos (16): recebimento/pagamento esperado, vencido s/ ação, promessa, crítico s/ programação, abaixo do mínimo, projeção negativa conta/consolidado, saldo desatualizado, movimento s/ identificação, diferença conciliação, transferência em trânsito, título s/ responsável, sync atrasado, duplicidade, mudança pós-fechamento
- [x] Enums TS + Prisma + migration aditiva `20260814120000_treasury_exception_engine_types`
- [x] Motor puro `treasuryExceptionEngine` (algo `1.0.0`): candidatos + plano upsert/auto-resolve; dinheiro string; determinístico
- [x] Auto-resolve apenas tipos seguros; nunca `SUSPECTED_DUPLICATE` / `FINANCIAL_CHANGE_AFTER_CLOSING`
- [x] Orquestração `treasuryExceptionEngineService` via `upsertByUniqueKey` + `resolve`
- [x] Testes por tipo + integração apply; `test:treasury` 386/386
- [x] Sem API/UI neste passo; sem avanço automático
---

### 40 — APIs e tela da Central de Exceções
- [x] Status: OPEN / IN_ANALYSIS / WAITING_THIRD_PARTY / RESOLVED / IGNORED / CANCELLED (+ ACK legado); migration `20260815120000_*`
- [x] APIs: list (filtro/ordem), get, acknowledge, assign, due-at, status, resolve, ignore, cancel; flag `treasury.exceptions.enabled`
- [x] DTO: severidade, valor, idade, responsável, ação recomendada, `entityHref`
- [x] UI `/finance/treasury/exceptions` — filtros, ordenação, ações, abrir entidade
- [x] Testes permissão + fluxo API/UI; `test:treasury` 395/395
- [x] Sem avanço automático
---

### 41 — Alertas no dashboard e na agenda
- [x] 8 alertas: saldo negativo, abaixo do mínimo, recebimento relevante, concentração clientes, sync atrasada, saldo desatualizado, promessa vencida, pagamento crítico
- [x] Config `TreasuryAlertSettings` singleton GLOBAL (padrão MaterialMarket) + GET/PUT `/alert-settings`; limiares e severidade por kind
- [x] Motor puro `buildTreasuryAlerts`; integração dashboard (`alerts[]`) e agenda (`alerts[]` + por dia)
- [x] Sem notificações externas (infra inexistente)
- [x] Testes por tipo + permissão/fluxo settings; `test:treasury` 410/410
- [x] Sem avanço automático
---

### 42 — Models de fechamento diário (imutável + reabertura)
- [x] Models: `TreasuryDailyClosing`, `AccountPosition`, `FrozenPendency`, `FrozenException`, `Caveat`, `Reopening`
- [x] Campos: version, status OPEN\|CLOSED\|REOPENED, sourceHash/contentHash, saldo inicial/final, entradas/saídas realizadas, pendências, observados/conciliados/diferenças, exceções, ressalvas
- [x] Imutabilidade: triggers (CLOSED payload + filhos append-only); reabertura só via nova versão
- [x] Migration `20260817120000_treasury_daily_closing` + índices (unique empresa+data+versão; current OPEN\|CLOSED)
- [x] Regras puras `treasuryDailyClosingRules` + testes integridade/imutabilidade; `test:treasury` 420/420
- [x] Sem API/UI/serviço neste passo; sem avanço automático
---

### 43 — Preview do fechamento diário
- [x] `GET /api/finance/treasury/daily-closing/preview` (flag `treasury.dailyClosing.enabled` + `closing.view`)
- [x] Retorno: saldos por conta, resumo, bloqueios absolutos, avisos, CR/CP pendentes, não conciliados, saldos desatualizados, promessas vencidas, transferências em trânsito, sourceHash, `canCloseWithoutCaveats` / `canCloseWithCaveats`
- [x] Bloqueios absolutos: dia fechado, saldo observado ausente, negativo proibido, fonte indisponível, duplicidade suspeita aberta
- [x] Com ressalva: diferença conciliação, saldo stale, sync atrasada, pendências do dia, movimento não conciliado, promessa vencida, transferência SENT, abaixo do mínimo
- [x] Motor puro + facts repo + service; testes regras/API; `test:treasury` 430/430
- [x] Sem avanço automático
---

### 44 — Fechar / reabrir / listar / obter fechamento
- [x] `POST /daily-closing`, `GET /daily-closing`, `GET /daily-closing/:id`, `POST /daily-closing/:id/reopen`
- [x] Close: advisory lock empresa+data; valida `sourceHash` (409 se mudou); congela posição/pendências/ressalvas; exige caveats; audit CLOSE; recalc CLOSING
- [x] Reopen: permissão reopen; justificativa; versão anterior REOPENED + nova OPEN; audit REOPEN; recalc REOPENING
- [x] Testes concorrência/conflito/permissão; `test:treasury` 441/441
- [x] Sem avanço automático
---

### 45 — UI do fechamento diário
- [x] Rota `/finance/treasury/closing` + nav "Fechamento diário"
- [x] Preview: resumo, posição por conta, checklist, bloqueios, avisos, pendências, diferenças
- [x] Ressalvas obrigatórias + observações; confirmação com refresh do preview antes do POST
- [x] Conflito 409 → mensagem orientando revisar/atualizar preview
- [x] Histórico versionado; reabertura autorizada; comparação entre versões
- [x] Client API + permissions + UI helpers; testes UI (`TreasuryDailyClosingPage.test` + `treasuryDailyClosingUi.test`); `test:treasury` 450/450
- [x] Sem avanço automático
---

### 46 — Detecção de mudanças financeiras pós-fechamento
- [x] Tipo `FINANCIAL_CHANGE_AFTER_CLOSING` (alias requisito `POST_CLOSING_FINANCIAL_CHANGE`); nunca auto-resolve; não reescreve CLOSED
- [x] Regras puras: baixa/cancelamento/movimento bancário/saldo/sync; diferença frozen×atual; changeId estável
- [x] Serviço registra exceção com entidade/valor/diferença + link de reabertura/tratamento
- [x] Hooks: snapshot de saldo; sync Nomus AR/AP (scan CLOSED no período coberto)
- [x] UI exceções: mostra diferença + “Reabrir / tratar fechamento”
- [x] Testes: baixa tardia, cancelamento tardio, movimento bancário, alteração de saldo, reprocessamento idempotente; `test:treasury` 459/459
- [x] Sem avanço automático
---

### 47 — Base segura de importação OFX (parser isolado)
- [x] Dependência estável `ofx-data-extractor` (OFX 1 SGML + OFX 2 XML); multer já existia no projeto
- [x] Política: limite 5 MiB; MIME/extensões; rejeição de NUL; max 20k lançamentos
- [x] Temp storage exclusivo (`mkdtemp` + mode 0o700/0o600) + SHA-256 + descarte obrigatório
- [x] Parser isolado normaliza dinheiro Decimal-string; `persisted: false` (não grava TX)
- [x] Erros de parsing/malformado → `TreasuryDomainError` (VALIDATION_ERROR / PAYLOAD_TOO_LARGE)
- [x] Fixtures OFX1/OFX2/malformed + testes; sem API/UI/schema neste passo; `test:treasury` 468/468
- [x] Sem avanço automático
---

### 48 — Schema Prisma lote/movimento bancário
- [x] Models `TreasuryBankImportBatch` + `TreasuryBankMovement` (fingerprint, payload normalizado, conta, direção, valor, datas, descrição, documento, contraparte, status/valor conciliado)
- [x] Enums de lote/formato/direção/conciliação (inclui `PARTIAL`)
- [x] Unicidade anti-duplicidade: `(accountId, fileSha256)`, `(accountId, fingerprint)`, `(accountId, fitId)`
- [x] Sem raw OFX / sem número de conta completo; `amount` absoluto + `direction`; `reconciledAmount` 0..amount (CHECK)
- [x] Migration aditiva `20260818120000_treasury_bank_import_and_movements` (não aplicada em prod)
- [x] Contratos client-safe + helper de fingerprint; testes de integridade; `test:treasury` 475/475
- [x] Sem API/UI/import service neste passo; sem avanço automático
---

### 49 — Preview OFX (`POST /bank-imports/ofx/preview`)
- [x] Rota `POST /api/finance/treasury/bank-imports/ofx/preview` (multer `file` + `accountId`)
- [x] Flag `treasury.ofxImport.enabled` + permissão `finance.treasury.reconciliation` manage
- [x] Valida conta ativa + ACL operacional (OPERATE/MANAGE); sem bypass por só ter reconciliation
- [x] Processa arquivo (intake/temp/parse), normaliza, fingerprint, classifica NEW/DUPLICATE/INVALID
- [x] Período civil + totais (crédito/débito/líquido/contagens); `persisted: false`
- [x] Token de preview opaco assinado HMAC + TTL 15min (memória server-side; sem gravar TX)
- [x] Testes: válido, duplicado, inválido, conta sem permissão; `test:treasury` 483/483
- [x] Sem confirm/apply/UI neste passo; sem avanço automático
---

### 50 — Apply OFX (`POST /bank-imports/ofx/apply`)
- [x] Consome `previewToken` (HMAC+TTL+user) + opcional `contentHash`
- [x] Transaction segura: lote `PROCESSED` + movimentos NEW; skip DUPLICATE/INVALID
- [x] Idempotência `(accountId, fileSha256)` + unicidade fingerprint; reaplicar não duplica
- [x] Auditoria `OFX_IMPORT` / `IMPORT`; solicita sugestões (deferred) + recálculo projeção
- [x] Retorno: created / ignored / invalid / errors + flags deferred
- [x] Testes apply/idempotência/token inválido; `test:treasury` 488/488
- [x] Sem UI/matching real neste passo; sem avanço automático
---

### 51 — UI movimentos bancários / OFX
- [x] Rota `/finance/treasury/bank-movements` + aba no shell
- [x] Upload OFX → preview → confirmação (wizard) com estados/mensagens claras
- [x] Histórico de lotes + lista de movimentos + detalhe (conta/contraparte/descrição/valor/data)
- [x] Filtros: não conciliados / parcial / conciliados / duplicados (+ conta/empresa/busca/período)
- [x] GET `/bank-imports` e `/bank-movements` (+ `:id`); permissões reconciliation view/manage
- [x] Testes de fluxo UI + wiring; `test:treasury` 494/494
- [x] Sem matching real neste passo; sem avanço automático
---

### 52 — Motor de sugestões de conciliação
- [x] Motor puro `treasuryReconciliationSuggestionEngine` (sem Express/Prisma/I/O)
- [x] Critérios: valor exato, documento, CNPJ/CPF, proximidade de data, nome semelhante, histórico, direção compatível
- [x] Classificação HIGH / MEDIUM / LOW + pontuação 0..100 + motivos tipados
- [x] Exclui títulos cancelados e integralmente realizados; `autoMatched: false` no MVP
- [x] Service: `generateTreasuryReconciliationSuggestions` (seeds) + fila deferred intacta no apply OFX
- [x] Enums de confiança/motivos nos contratos client-safe
- [x] Testes de ranking + falsos positivos (direção, cancelado/settled, centavos, nome); `test:treasury` 505/505
- [x] Sem persistência de match / sem UI / sem auto-conciliação; sem avanço automático
---

### 53 — Conciliação bancária (match + allocations)
- [x] Models `TreasuryReconciliationMatch` + `MatchMovement` + `Allocation` + enums
- [x] Migration aditiva `20260819120000_treasury_reconciliation_match_and_allocations` (não deployada)
- [x] Allocations: TITLE, FEE, INTEREST, DISCOUNT, ABATEMENT, DIFFERENCE, TRANSFER, MANUAL_LEDGER, UNIDENTIFIED
- [x] Suporta 1:1, 1:N títulos, N:1 movimentos, parcial; covering net = soma movimentos
- [x] Service TX accept/unmatch; validação de valores; status PENDING/PARTIAL/MATCHED no movimento
- [x] Auditoria `RECONCILIATION_MATCH` CREATE/UPDATE; recálculo `reconciliation_matched|unmatched`
- [x] Não muta Nomus; `doesNotRealizeOfficial: true` (não duplica baixa oficial)
- [x] Testes regras + integridade schema + integração; `test:treasury` 523/523
- [x] Sem API/UI workspace neste passo; sem avanço automático
---

### 54 — Reverse de conciliação bancária
- [x] `POST /api/finance/treasury/reconciliations/:id/reverse` + GET list by `bankMovementId`
- [x] Permissão `finance.treasury.reconciliation.reverse` (execute); flag `treasury.reconciliation.enabled`
- [x] Justificativa obrigatória + confirmação forte `REVERTER`; não exclui registro (status UNMATCHED)
- [x] Desfaz alocações logicamente; restaura `reconciledAmount`/status do movimento
- [x] Audit action `REVERSE`; recálculo `reconciliation_reversed`
- [x] `notifyTreasuryPostClosingFinancialChange` (`RECONCILIATION_CHANGE`) se dia CLOSED
- [x] UI confirmação forte no detalhe de movimentos bancários
- [x] Testes permissão/consistência/fechamento + dialog; `test:treasury` 529/529
- [x] Sem avanço automático
---

### 55 — Queries e APIs de relatórios
- [x] `GET /api/finance/treasury/reports/:reportKey` com 10 chaves canônicas
- [x] Relatórios: posição diária, ponte de caixa, previsto×realizado, inadimplência, promessas, previsibilidade, posição por conta, exceções, conciliações, projeção por cenário
- [x] Suporte a período, contas autorizadas (ACL), filtros, totais, composição e paginação
- [x] Agregações eficientes (SQL SUM/COUNT/groupBy + joins)
- [x] Permissão `finance.treasury.reports` view; regras puras de consistência de totais
- [x] Testes de wiring/permissão + consistência de totais; sem UI/export neste passo
- [x] Sem avanço automático
---

### 56 — Central de Relatórios (UI + exportações)
- [x] Tela `/finance/treasury/reports` + aba no shell
- [x] Seleção do relatório, período, filtros, visualização (totais/composição/detalhe)
- [x] Impressão (`window.print`) com data/hora de geração e identificação dos filtros
- [x] Export CSV / Excel / PDF via `GET …/reports/:reportKey/export.{csv|xlsx|pdf}`
- [x] CSV protegido contra formula injection; PDF via `minimalPdfWriter` (sem serviço externo)
- [x] Permissões: `reports.view` para consulta; `finance.treasury` `export` para exportar (não degrada)
- [x] Testes básicos de exportações + UI; sem avanço automático
---

### 57 — Auditoria de segurança
- [x] Auth/autorização por ação revisadas nas rotas (requireAppAuth + requireResource + flags)
- [x] Anti-IDOR: movimentos/lotes bancários filtrados por contas autorizadas (ACL)
- [x] Máscaras de agência/conta mantidas; summaryJson redigido (sem payload OFX)
- [x] Upload OFX: MIME/tamanho/NUL; path containment no temp; segredo preview fail-closed em prod
- [x] CSV injection protegido; logs HTTP sanitizados; erros sem stack para o cliente
- [x] Rate limit em OFX preview/apply, reverse, close/reopen e export de relatórios (`RATE_LIMITED` 429)
- [x] CSRF conforme arquitetura: cookie sessão `SameSite=Lax` + requireAppAuth
- [x] Idempotência existente preservada (OFX fileSha256, balance Idempotency-Key, locks closing)
- [x] Testes de segurança (`treasurySecurity*`); sem avanço automático
---

### 58 — Auditoria de performance
- [x] Benchmarks antes/depois com volume representativo (títulos, movimentos, 90d, contas, exceções)
- [x] Eliminado N+1 de ACL/saldos (batch `listAccessForUser` + `findLatestByAccountIds`)
- [x] OFX apply: `createMany` + `skipDuplicates` (sem 1 insert/movimento)
- [x] Exception engine: uma query com `statuses` abertos
- [x] CR/CP: `rawPayload` adiado para a página (menor memória)
- [x] Índices aditivos + `docs/treasury/PERFORMANCE_BENCHMARKS.md`
- [x] Testes `treasuryPerformance*`; sem avanço automático
---

### 59 — Testes unitários (regras)
- [x] Checklist obrigatória coberta por testes de domínio (não só wiring)
- [x] Novos: query CR/CP, cobrança, contestação; extensões promessa/programação/ledger anti-dupla
- [x] Regras de cobrança/contestação extraídas para domínio e usadas pelos services
- [x] `treasuryUnitCoverage.audit.test.ts`; sem avanço automático
---

### 60 — Testes de integração completos (banco seguro)
- [x] Gate `treasurySafeTestDatabase`: só localhost/127.0.0.1/`_test`; recusa hosts de produção
- [x] Harness in-process com snapshot/rollback (TX); sem `DATABASE_URL` de produção
- [x] Fluxo E2E: conta → saldo → listar AR/AP → expectativa → promessa → programar pagamento → recalcular projeção → exceção → fechar dia → importar OFX → conciliar → reverter → reabrir → relatório
- [x] Cobertura de idempotência (saldo + OFX), rollback e auditoria append-only
- [x] Postgres externo gated por `TREASURY_TEST_DATABASE_URL` (skip sem env)
- [x] `test:treasury` 601/602 (1 skip); sem avanço automático
---

### 61 — Testes E2E fluxos críticos (ferramenta real)
- [x] Ferramenta do projeto: `tsx --test` + `renderToStaticMarkup` (sem Playwright no repo)
- [x] Fluxo 1–14: Central → saldo → dashboard → CR atrasado → promessa → projeção → programar CP → risco → transferência → fechar c/ ressalva → OFX → conciliar/reverter → relatório → reabrir
- [x] Estados sem permissão (dashboard/saldo/CR/CP/agenda/comparação/transfers/OFX/closing/reports)
- [x] Responsividade essencial (tabelas desktop/mobile, bottom-sheet `items-end`/`sm:items-center`)
- [x] Correções: init síncrono dos drawers Overlay; `PermissionDenied` transfers/bank; `className={helper()}`; mensagem manage saldo
- [x] `test:treasury` 604/605 (1 skip); sem avanço automático
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
| 2026-07-27 | Prompt 26: regras puras data de movimento (AR/AP × cenários + virada SP) — `b390439` |
| 2026-07-27 | Prompt 27: identidade e precedência financeira (anti-dupla contagem) — `4f6cd19` |
| 2026-07-27 | Prompt 28: motor determinístico de projeção (day lines/risco/composição) — `0ac7098` |
| 2026-07-27 | Prompt 29: precisão Decimal + liquidez no motor — `3c6103a` |
| 2026-07-27 | Prompt 30: execução e persistência de projeção — `501056e` |
| 2026-07-27 | Prompt 31: fila persistente de recálculo — `9e3d51a` |
| 2026-07-27 | Prompt 32: recálculo após sync AR/AP oficial — `4092a9b` |
| 2026-07-27 | Prompt 33: APIs REST projeção + agenda — `faba85d` |
| 2026-07-27 | Prompt 34: UI agenda financeira — `12037b0` |
| 2026-07-27 | Prompt 35: comparação contratual×provável×confirmado — `613f3ac` |
| 2026-07-27 | Prompt 36: auditoria motor de projeção — `7628e55` |
| 2026-07-27 | Prompt 37: transferências entre contas — `2cdcba4` |
| 2026-07-27 | Prompt 38: model + serviço de exceções — `e4b823f` |
| 2026-07-27 | Prompt 39: motor determinístico de exceções — `5dcdc74` |
| 2026-07-27 | Prompt 40: APIs + UI Central de Exceções — `a9a95ac` |
| 2026-07-27 | Prompt 41: alertas dashboard/agenda + config — `0e6e655` |
| 2026-07-27 | Prompt 42: schema fechamento diário + reabertura — `f39279f` |
| 2026-07-27 | Prompt 43: preview fechamento diário — `7313c86` |
| 2026-07-27 | Prompt 44: close/reopen/list/get fechamento — `c219f45` |
| 2026-07-27 | Prompt 45: UI fechamento diário — `b955d68` |
| 2026-07-27 | Prompt 46: detecção mudanças pós-fechamento — `9760540` |
| 2026-07-27 | Prompt 47: base segura OFX (parser/intake/temp) — `c4d09c1` |
| 2026-07-27 | Prompt 48: schema lote/movimento bancário OFX — `3d5d1ab` |
| 2026-07-27 | Prompt 49: preview OFX (token temporário) — `99b527f` |
| 2026-07-27 | Prompt 50: apply OFX (persistência idempotente) — `0465f29` |
| 2026-07-27 | Prompt 51: UI movimentos bancários + OFX — `0fd8a77` |
| 2026-07-27 | Prompt 52: motor de sugestões de conciliação — `aa80d13` |
| 2026-07-27 | Prompt 53: conciliação bancária match+allocations — `e158344` |
| 2026-07-27 | Prompt 54: reverse conciliação bancária — `15f4102` |
| 2026-07-27 | Prompt 55: queries/APIs relatórios Tesouraria — `e7d6139` |
| 2026-07-27 | Prompt 56: Central de Relatórios UI + exportações — `6d08bb8` |
| 2026-07-27 | Prompt 57: auditoria de segurança do módulo — `adcbc63` |
| 2026-07-28 | Prompt 58: auditoria de performance do módulo — `6ed1fb6` |
| 2026-07-28 | Prompt 59: completar testes unitários de regras — `b4cced6` |
| 2026-07-28 | Prompt 60: testes de integração E2E em DB seguro — `462c74c` |
| 2026-07-28 | Prompt 61: testes E2E UI fluxos críticos (`tsx --test`) — `PENDING` |
