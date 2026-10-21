# Pessoas 360° — validação (resultados reais, ambiente local descartável)

Data: 2026-10-20 (fechamento do CP7 em 2026-10-21). Branch `feat/people-360-canonical-identity` (base `main` `97e71bc`). Implementação: [pessoas-360-implementation.md](pessoas-360-implementation.md). Runbook: [pessoas-360-deployment-runbook.md](pessoas-360-deployment-runbook.md).

**Veredito:** todos os gates executados têm resultado real registrado abaixo. Nenhum teste foi removido ou desabilitado. As 6 falhas remanescentes da suíte unitária foram reexecutadas no checkout da base (`C:/Dev/induscost-claude-base`, `97e71bc`) com as **mesmas mensagens** (§1.1); nenhuma é regressão desta branch. Nada foi executado contra dados ou ambientes reais.

Ambiente: PostgreSQL local descartável `127.0.0.1:54329` (`perf_e2e` com dados fictícios `[DEMO]`; `perf_empty` para integração), servidor local `http://localhost:3100`, Chrome real via DevTools Protocol. Saídas brutas em `C:/Dev/induscost-claude-deps/gates/` (fora do repositório) e capturas em `C:/Dev/induscost-claude-deps/e2e-p360/shots/`.

## 1. Gates

| Gate | Comando | Resultado | Observação |
|---|---|---|---|
| TypeScript (tsconfig.json real do projeto) | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | 1361 erros no total (base: 1369), exit 2 pela base | **0 erros novos** vs. `tsc-base-97e71bc.norm` (1369 na base); comparação por arquivo+código+mensagem (`gates/tsc-p360-final.norm`) |
| Suíte unitária | `node scripts/run-unit-tests.mjs` (lista canônica `scripts/unit-test-files.txt`, com os 8 arquivos novos) | **5540 testes, 5534 passam, 6 falham** | as 6 falhas são pré-existentes na base (§1.1); exit code 1 por causa delas |
| Integração PG | `PEOPLE_PG_TEST_URL=… npx tsx --test` × 3 suítes | `canonicalPersonGovernance` 6/6 · `personLinkOps` 8/8 · `userAccessLifecycle` 6/6 (exit 0) | sequenciais, banco `perf_empty`; reexecutadas no código final |
| Build | `npx vite build` | OK em 36 s (exit 0) | `dist/build-info.json` apagado após o build (só localmente, para não disparar o VersionWatcher em dev) |
| Contrato e consistência de permissões | `permissionContract.test.ts`, `permissionConsistency.test.ts`, `navigationGroups.test.ts`, `sidebarAuthorizedMenus.perm36.test.ts` | recurso `admin.employees.people` e mapeamento `people → admin.employees` adicionados; achados novos de consistência = 0 (restam só os 3 da base sobre `commercial-policy`) | ver §1.1 |
| E2E navegador (execução final, 2026-10-21 08:20, servidor reiniciado com o código final) | `PERF_E2E_OUT=<fora do repo> node scripts/performance-e2e/part15-people-360.mjs` | **21/21 PASS** (exit 0, ~2 min) | jornadas 1–5, matriz de autorização, E2–E4; reexecutadas depois das correções do fechamento (guarda E2 no restore de perfil, mapeamento `people`, teste de reversão); resultado bruto em [evidencias/e2e-part15-people-360-final.json](evidencias/e2e-part15-people-360-final.json), saída em `gates/e2e-p360-final.txt`; capturas em `C:/Dev/induscost-claude-deps/e2e-p360/shots/15-*.png` |
| Verificação manual no navegador (Claude Browser) | — | relink, unificação com step-up, reversão, desvínculo, CP6 via API | registrada no transcript |

### 1.1 Suíte unitária — investigação das 6 falhas

Método: os 5 arquivos que contêm as 6 falhas foram executados **isoladamente** na branch e no checkout da base `97e71bc` (`C:/Dev/induscost-claude-base`, mesmo `node_modules`). Resultado idêntico nos dois: 48 testes, 42 passam, 6 falham, mesmas mensagens de asserção.

| Arquivo / teste | Mensagem | Na base `97e71bc` | Classificação |
|---|---|---|---|
| `src/lib/commercial/corporateRelation.test.ts` → "gera análise pelo vínculo e mantém bloqueio crítico só na restrição própria" | `actual: 'LIBERADO', expected: 'EM_ANALISE'` | falha igual | pré-existente (Comercial), fora do escopo |
| `src/lib/customerCnpjRiskSummary.test.ts` → "grid de Clientes — contrato / sem rolagem horizontal…" | `actual: 7, expected: 6` (contagem de colunas) | falha igual | pré-existente (CRM UI), fixture desatualizada fora do escopo |
| `src/lib/proposalCommercialMarginUi.test.ts` → "save (POST/PUT) sempre recalcula a margem comercial na data de HOJE…" | regex sobre o código de `server.ts` não casa | falha igual | pré-existente (Comercial), teste de fonte fora do escopo |
| `src/lib/security/permissionConsistency/permissionConsistency.test.ts` → "modo report sempre ok" | `newFindingCount` 2 (base: 2) | falha igual | pré-existente: achados `SIDEBAR_MODULE_WITHOUT_RESOURCE`/`PRIVATE_ROUTE_WITHOUT_RESOURCE` para `commercial-policy` |
| idem → "modo strict verde no baseline atual" | `newFindingCount` 3 (base: 3) | falha igual | pré-existente (`commercial-policy` + `AUDIT_ACTIONABLE_ERROR`). **Durante o fechamento havia 2 achados a mais, causados por esta branch (`people` sem `resourceKey`): corrigidos mapeando `people → admin.employees` em `sidebarMenuResources.ts`; a contagem voltou à da base** |
| `src/lib/security/permissionContract/permissionContract.test.ts` → "módulos sidebar 1:1 cobertos por moduleId" | `SIDEBAR_MODULE_ORDER commercial-policy sem recurso appearsInSidebar` | falha igual | pré-existente. O módulo `people` tinha o mesmo problema nesta branch e foi corrigido com o recurso `admin.employees.people` |

Nenhuma das 6 é regressão desta branch; corrigi-las exige mudanças em Comercial/CRM/política comercial, fora do escopo da missão — ficam como **pendência conhecida**, com evidência em `gates/unit-p360-final.txt` e na execução comparativa acima.

Arquivos de teste novos nesta branch (todos verdes e incluídos na lista canônica): `superAdminRoleGuard.test.ts`, `userAccessLifecycle.test.ts`, `userPermissionAdminAudit.test.ts` (ampliado com a guarda do restore de perfil), `accessProfilesApply.test.ts`, `personProfile.test.ts`, `personLinkOps.test.ts`, `personIdentityResolve.test.ts`, `fleetDriverPersonLink.test.ts`, `commissionPersonLinkInvariance.test.ts` (unidade) e `canonicalPersonGovernance.integration.test.ts`, `personLinkOps.integration.test.ts`, `userAccessLifecycle.integration.test.ts` (PostgreSQL).

## 2. E2E — jornadas (part15, execução final 21/21 em 2026-10-21)

| # | Jornada | Resultado |
|---|---|---|
| 15.00 | Preparação: conta da Carla na Pessoa B; colaborador e CPF na Pessoa A (caso real reproduzido) | PASS (`CONFLICT`, `USER_ON_OTHER_PERSON`) |
| 15.01–02 | J1 lista (busca "Carla" → 2 Pessoas, sinalização) e ficha (cabeçalho, cartões, duplicidade, pendência) | PASS |
| 15.03–04 | J2 corrigir vínculo da conta B→A pela ficha: prévia, justificativa obrigatória, evento `RELINKED` com autor/motivo/`fromPersonId` | PASS |
| 15.05 | J3 unificar sem step-up → 403 `ADMIN_ELEVATION_REQUIRED` | PASS |
| 15.06–08 | J3 prévia, unificação com senha (B `MERGED` → A, evento reversível), B não propõe unificar com A | PASS |
| 15.09 | J3 reversão: B `ACTIVE`, `MERGED.revertedAt`, `MERGE_REVERTED` | PASS |
| 15.10–11 | J4 Frota recusa CPF sem checksum (400); CPF com duas Pessoas candidatas → motorista sem vínculo | PASS |
| 15.12–13 | J4 motorista aparece como pendência por CPF na ficha; vincular pela ficha → `LINKED` `CPF_EXACT` | PASS |
| 15.14 | J4 comissionável com vínculo explícito; desvincular remove só `personId` (nome/tipo intactos), `UNLINKED` | PASS |
| 15.15 | E2 conceder SUPER_ADMIN sem step-up → 403 (sessão nova, não elevada) | PASS |
| 15.16 | E3 DELETE de usuário → inativação lógica (`physicallyDeleted:false`), conta continua existindo | PASS |
| 15.17 | E4 criar conta a partir de colaborador → ficha da Pessoa mostra a conta nova vinculada | PASS |
| 15.18 | ADMIN não eleva, não unifica, não se promove (403) | PASS |
| 15.19–20 | Matriz de autorização (abaixo) | PASS |

Matriz real (status HTTP): `list` = `GET /api/people`, `ficha` = `GET /api/people/:id`, `link` = `POST …/links/preview`, `mergePreview` = `POST …/merge/preview`, `merge` = `POST …/merge`.

| Perfil | list | ficha | link | mergePreview | merge |
|---|---|---|---|---|---|
| SUPER_ADMIN sem step-up | 200 | 200 | 200 | 200 | 403 `ADMIN_ELEVATION_REQUIRED` |
| ADMIN (sem permissões do módulo) | 403 | 403 | 403 | 403 | 403 `PERMISSION_DENIED` |
| RH gestor (perfil Desempenho) | 403 | 403 | 403 | 403 | 403 |
| RH operacional (perfil Desempenho) | 403 | 403 | 403 | 403 | 403 |
| Comum (líder de produção) | 403 | 403 | 403 | 403 | 403 (UI também bloqueada) |

Observação: os perfis fictícios de RH do seed de Desempenho não têm `employees.view`; um RH real com `employees.view` vê lista e ficha e, com `admin.employees.links:manage`, vincula/corrige/desvincula; unificar continua exclusivo de SUPER_ADMIN elevado (`requireMergePrivilege`).

## 3. Matriz de aceite — 25 cenários (auditoria §20)

Legenda: **E2E** = part15; **INT** = integração PG; **UNIT** = unitário; **NAV** = verificação manual no navegador; **API** = chamada direta no servidor local.

| # | Cenário | Esperado | Evidência | Modo | Situação |
|---|---|---|---|---|---|
| 1 | Criar colaborador novo sem Pessoa | Pessoa criada na mesma transação, evento `PERSON_CREATED` | INT governança | automatizado | aprovado |
| 2 | Criar colaborador com CPF de Pessoa existente | Reutiliza a Pessoa (`LINKED`, `CPF_EXACT`), não duplica | INT governança | automatizado | aprovado |
| 3 | Criar colaborador com e-mail de outra Pessoa | 409, nada gravado | INT governança | automatizado | aprovado |
| 4 | Prévia de vínculo colaborador↔Pessoa | Somente leitura (`wouldCreatePerson`), nunca cria | INT governança ("prévia nunca cria Pessoa") | automatizado | aprovado |
| 5 | Validação do colaborador falha depois do plano | Pessoa não alterada/órfã (plano aplicado dentro da transação) | INT governança + código `server.ts` | automatizado | aprovado |
| 6 | Criar conta para colaborador | `AppUser.personId = employee.personId` | E2E 15.17; código | automatizado | aprovado |
| 7 | Criar conta para colaborador cuja Pessoa já tem conta | 409 `PERSON_ALREADY_HAS_USER` | leitura de código (`server.ts`, duas ocorrências) | revisão de código | **não executado** — sem teste de rota automatizado; pendência de homologação manual |
| 8 | Caso real: conta na Pessoa B, colaborador+CPF na A | Ficha de A mostra conflito; correção com prévia; `RELINKED` | E2E 15.00–15.04; NAV | automatizado + manual | aprovado |
| 9 | Correção concorrente (estado esperado mudou) | 409 `STALE`, nada sobrescrito | INT personLinkOps (CAS) | automatizado | aprovado |
| 10 | Unificar sem step-up | 403 `ADMIN_ELEVATION_REQUIRED` | E2E 15.05, 15.19 | automatizado | aprovado |
| 11 | Unificar com step-up | Absorvida `MERGED`, vínculos religados, campos vazios preenchidos, 2 eventos | E2E 15.07; INT | automatizado | aprovado |
| 12 | Unificar Pessoas com CPF divergente | Bloqueio `CPF_DIVERGENT` | INT personLinkOps; UNIT planPersonMerge | automatizado | aprovado |
| 13 | Unificar duas Pessoas com contas ativas / dois colaboradores | Bloqueio de cardinalidade | INT ("duas contas ativas é bloqueada"); UNIT | automatizado | aprovado |
| 14 | Reverter unificação | Absorvida `ACTIVE`, `revertedAt`, `MERGE_REVERTED` | E2E 15.09; INT | automatizado | aprovado |
| 15 | Reverter depois de vínculos novos na vencedora | 409 `NEWER_DEPENDENCIES`, absorvida continua `MERGED`, vínculo novo preservado | INT personLinkOps (caso adicionado no fechamento) | automatizado | aprovado |
| 16 | Pessoa `MERGED` recebe vínculo novo | Recusado (`PERSON_MERGED` 409 / `decideRelink`) | UNIT resolver + personLinkOps | automatizado | aprovado |
| 17 | Desvincular conta/motorista/comissionável | Só `personId = null`, evento `UNLINKED`, cadastro intacto | E2E 15.14; INT | automatizado | aprovado |
| 18 | Motorista com CPF inválido (admin/CSV) | 400 / linha inválida | E2E 15.10; UNIT fleetDriverPersonLink | automatizado | aprovado |
| 19 | Motorista com CPF de exatamente uma Pessoa | `personId` preenchido, sem criar Pessoa | UNIT resolver/fleet; API | automatizado + manual | aprovado |
| 20 | Motorista com CPF ambíguo (duas Pessoas) | `personId = null`, pendência na ficha | E2E 15.11–12 | automatizado | aprovado |
| 21 | Alterar CPF de motorista ligado a Pessoa com outro CPF | 409 `PERSON_CPF_MISMATCH` | UNIT fleetDriverPersonLink | automatizado | aprovado |
| 22 | Comissionável com `personId` explícito inválido/unificado | 404 / 409 | API (404 verificado); UNIT | automatizado + manual | aprovado |
| 23 | Vincular comissionável não altera comissões | Só `personId` escrito; nenhum modelo de comissão tocado | UNIT invariância | automatizado | aprovado |
| 24 | Dedupe de comissionáveis por nome | Não agrupa homônimos; só `nomusPersonId` | UNIT invariância | automatizado | aprovado |
| 25 | Desligamento com conta ativa (E1, flag ligada) / recontratação | Conta inativa + sessões revogadas + auditoria; recontratação não reativa; flag desligada = sem efeito | INT userAccessLifecycle (6/6) | automatizado | aprovado |

Resumo: 23 cenários aprovados com execução real (automatizada e/ou manual), 1 aprovado só por revisão de código (#7, pendente de homologação manual), 0 bloqueados. Critérios E1–E4: E1 (flag, INT), E2 (E2E 15.15/15.18, UNIT superAdminRoleGuard + userPermissionAdminAudit incl. restore de perfil, auditoria `SUPER_ADMIN_*`), E3 (E2E 15.16), E4 (E2E 15.17, INT propagação) — todos com resultado real.

**21 jornadas E2E aprovadas ≠ 25 cenários homologados:** as jornadas cobrem os cenários 6, 8, 10, 11, 14, 17, 18, 20 e a matriz de autorização; os demais vêm de integração/unidade; o #7 depende de homologação manual.

## 4. Correções encontradas durante a validação (e corrigidas na branch)

- **E2, caminho não guardado:** `restoreUserPermissionBaseline` (rotas `POST /api/admin/users/:id/permissions/restore-role-default` e `DELETE /api/admin/users/:id/permission-overrides`) aplicava o `roleBase` do perfil de acesso ao papel do usuário sem a guarda de SUPER_ADMIN — podia conceder (perfil com base SUPER_ADMIN) ou retirar o papel. Corrigido no fechamento do CP7: mesma guarda (`evaluateSuperAdminRoleChange`), negativa auditada (`SUPER_ADMIN_ROLE_CHANGE_DENIED`, `via: restore-access-profile`), ator resolvido nas rotas; 2 testes novos em `userPermissionAdminAudit.test.ts`.
- Módulo `people` sem `resourceKey` no mapa da sidebar gerava 2 achados novos de consistência de permissões: mapeado para `admin.employees`.

- Diálogo de step-up ficava **atrás** do diálogo de unificação (ambos `z-50`): `AdminStepUpDialog` → `z-[60]` e renderizado depois dos diálogos da ficha (`c55a0f6`).
- Pessoa `MERGED` propunha "unificar" com a vencedora: `findPendingLinksForPerson` retorna vazio para `MERGED`.
- Eventos de dois lados apareciam duplicados na ficha: deduplicação por chave preferindo o registro da própria Pessoa.
- Servidor local não recarrega código de servidor: CP6 só foi verificado após reiniciar o processo (registrado para o runbook: cada deploy reinicia o processo).
- Botões "Corrigir vínculo" tinham `data-testid` igual para entidades diferentes: agora incluem o `entityId`.
- O roteiro E2E escreveu o perfil do Chrome dentro do repositório e o watcher do Vite derrubou o servidor (`EBUSY`): o roteiro passa a ser executado com `PERF_E2E_OUT` fora do repositório.

## 5. Riscos residuais e limitações conhecidas

| Risco / limitação | Impacto | Mitigação / próximo passo |
|---|---|---|
| 6 falhas unitárias pré-existentes (Comercial, CRM, política comercial) | suíte não fica verde; mascaram regressões futuras nesses arquivos | pendência registrada; tratar em branch própria com os donos dos módulos |
| Cenário #7 (`PERSON_ALREADY_HAS_USER`) sem teste automatizado | regressão passaria despercebida | homologar manualmente; adicionar teste de rota numa próxima entrega |
| Volumes reais desconhecidos (CPF repetido, contas sem Pessoa) | fila de revisão pode ser grande | auditoria somente leitura antes de qualquer janela (runbook §0) |
| E1 atrás de flag | desligamento ainda não revoga acesso em produção | homologar com RH e ligar a flag em fase separada (runbook §4) |
| Pendências por CPF incluem motoristas `INACTIVE` | ruído na ficha de Pessoas com muitos cadastros antigos | avaliar filtro por status na próxima versão |
| Lista `/api/people` sem teste de carga | desempenho com dezenas de milhares de Pessoas não medido | paginação é no banco; medir em homologação |
| Importação de comissionáveis do Nomus não vincula Pessoa | vínculo manual necessário | sugestões por CPF/e-mail no formulário |

## 6. O que não foi validado (declarado)

- Nenhuma execução contra dados reais ou AWS (regra da missão). Volumes reais de duplicidade: só pela auditoria somente leitura (`npm run audit:people-identity`) na janela de homologação.
- E1 não foi exercitado no navegador (fica atrás da flag); coberto por integração.
- Importação de comissionáveis do Nomus com vínculo automático: não existe (sem documento na origem), portanto não testado.
- Carga/desempenho da lista `/api/people` com dezenas de milhares de Pessoas: paginação é no banco, mas não houve teste de carga.
