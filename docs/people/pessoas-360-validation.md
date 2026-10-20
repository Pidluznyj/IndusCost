# Pessoas 360° — validação (resultados reais, ambiente local descartável)

Data: 2026-10-20. Branch `feat/people-360-canonical-identity` (base `main` `97e71bc`). Implementação: [pessoas-360-implementation.md](pessoas-360-implementation.md). Runbook: [pessoas-360-deployment-runbook.md](pessoas-360-deployment-runbook.md).

**Veredito:** todos os gates executados têm resultado real registrado abaixo. Nenhum teste foi removido ou desabilitado. As falhas remanescentes da suíte unitária são as mesmas do `main` de base (pré-existentes, fora do escopo) e estão nomeadas. Nada foi executado contra dados ou ambientes reais.

Ambiente: PostgreSQL local descartável `127.0.0.1:54329` (`perf_e2e` com dados fictícios `[DEMO]`; `perf_empty` para integração), servidor local `http://localhost:3100`, Chrome real via DevTools Protocol. Saídas brutas em `C:/Dev/induscost-claude-deps/gates/` (fora do repositório) e capturas em `C:/Dev/induscost-claude-deps/e2e-p360/shots/`.

## 1. Gates

| Gate | Comando | Resultado | Observação |
|---|---|---|---|
| TypeScript | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | 1361 erros (base: 1369) | **0 erros novos** vs. `tsc-base-97e71bc.norm`; 8 erros da base corrigidos de passagem. As 5 linhas com texto diferente são as mesmas mensagens da base em arquivos de Finanças não tocados |
| Suíte unitária | `node scripts/run-unit-tests.mjs` (lista canônica `scripts/unit-test-files.txt`, agora com os 8 arquivos novos) | **5538 testes, 5532 passam, 6 falham** | as 6 falhas são pré-existentes na base (§1.1) |
| Integração PG | `PEOPLE_PG_TEST_URL=… npx tsx --test` × 3 suítes | `canonicalPersonGovernance` 6/6 · `personLinkOps` 7/7 · `userAccessLifecycle` 6/6 | sequenciais, banco `perf_empty` |
| Build | `npx vite build` | OK em 29 s | `dist/build-info.json` apagado após o build (só localmente, para não disparar o VersionWatcher em dev) |
| E2E navegador | `node scripts/performance-e2e/part15-people-360.mjs` | **21/21 PASS** | jornadas 1–5, matriz de autorização, E2–E4 |
| Verificação manual no navegador (Claude Browser) | — | relink, unificação com step-up, reversão, desvínculo, CP6 via API | registrada no transcript |

### 1.1 Suíte unitária — detalhe

Execução antes de incluir os arquivos novos na lista canônica: 5478 testes, 5472 passam, 6 falham. Falhas, todas presentes também em `unit-base.txt` (main `97e71bc`) ou pré-existentes:

| Teste | Na base? | Área |
|---|---|---|
| `permissionContract` → "módulos sidebar 1:1 cobertos por moduleId" | sim (`commercial-policy` sem recurso) | contrato de permissões (não é Pessoas; o recurso `admin.employees.people` foi adicionado e a falha restante continua sendo `commercial-policy`) |
| `permissionConsistency` → "modo strict verde no baseline atual" e "modo report sempre ok" | sim | consistência de permissões |
| "grid de Clientes — contrato" → "sem rolagem horizontal…" | sim | CRM UI |
| `corporateRelation` → "gera análise pelo vínculo…" | falha igualmente no checkout da base | Comercial |
| `proposalCommercialMargin` → "save (POST/PUT) sempre recalcula…" | falha igualmente no checkout da base | Comercial |

Arquivos de teste novos nesta branch (todos verdes isoladamente e incluídos na lista canônica): `superAdminRoleGuard.test.ts`, `userAccessLifecycle.test.ts`, `userPermissionAdminAudit.test.ts`, `accessProfilesApply.test.ts`, `personProfile.test.ts`, `personLinkOps.test.ts`, `personIdentityResolve.test.ts`, `fleetDriverPersonLink.test.ts`, `commissionPersonLinkInvariance.test.ts` (unidade) e `canonicalPersonGovernance.integration.test.ts`, `personLinkOps.integration.test.ts`, `userAccessLifecycle.integration.test.ts` (PostgreSQL). Reexecução completa com a lista atualizada (`gates/unit-p360-cp7b.txt`): 5538 testes, 5532 passam, as mesmas 6 falhas pré-existentes.

## 2. E2E — jornadas (part15, 21/21)

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

| # | Cenário | Esperado | Evidência | Resultado |
|---|---|---|---|---|
| 1 | Criar colaborador novo sem Pessoa | Pessoa criada na mesma transação, evento `PERSON_CREATED` | INT governança | OK |
| 2 | Criar colaborador com CPF de Pessoa existente | Reutiliza a Pessoa (`LINKED`, `CPF_EXACT`), não duplica | INT governança | OK |
| 3 | Criar colaborador com e-mail de outra Pessoa | 409, nada gravado | INT governança | OK |
| 4 | Prévia de vínculo colaborador↔Pessoa | Somente leitura (`wouldCreatePerson`), nunca cria | INT governança ("prévia nunca cria Pessoa") | OK |
| 5 | Validação do colaborador falha depois do plano | Pessoa não alterada/órfã (plano aplicado dentro da transação) | INT governança + código `server.ts` | OK |
| 6 | Criar conta para colaborador | `AppUser.personId = employee.personId` | E2E 15.17; código | OK |
| 7 | Criar conta para colaborador cuja Pessoa já tem conta | 409 `PERSON_ALREADY_HAS_USER` | UNIT/código (`server.ts`) | OK (código + teste de guarda) |
| 8 | Caso real: conta na Pessoa B, colaborador+CPF na A | Ficha de A mostra conflito; correção com prévia; `RELINKED` | E2E 15.00–15.04; NAV | OK |
| 9 | Correção concorrente (estado esperado mudou) | 409 `STALE`, nada sobrescrito | INT personLinkOps (CAS) | OK |
| 10 | Unificar sem step-up | 403 `ADMIN_ELEVATION_REQUIRED` | E2E 15.05, 15.19 | OK |
| 11 | Unificar com step-up | Absorvida `MERGED`, vínculos religados, campos vazios preenchidos, 2 eventos | E2E 15.07; INT | OK |
| 12 | Unificar Pessoas com CPF divergente | Bloqueio `CPF_DIVERGENT` | INT personLinkOps; UNIT planPersonMerge | OK |
| 13 | Unificar duas Pessoas com contas ativas / dois colaboradores | Bloqueio de cardinalidade | INT ("duas contas ativas é bloqueada"); UNIT | OK |
| 14 | Reverter unificação | Absorvida `ACTIVE`, `revertedAt`, `MERGE_REVERTED` | E2E 15.09; INT | OK |
| 15 | Reverter depois de vínculos novos na vencedora | 409 `NEWER_DEPENDENCIES` | código `revertPersonMerge`; UNIT | OK (código) |
| 16 | Pessoa `MERGED` recebe vínculo novo | Recusado (`PERSON_MERGED` 409 / `decideRelink`) | UNIT resolver + personLinkOps | OK |
| 17 | Desvincular conta/motorista/comissionável | Só `personId = null`, evento `UNLINKED`, cadastro intacto | E2E 15.14; INT | OK |
| 18 | Motorista com CPF inválido (admin/CSV) | 400 / linha inválida | E2E 15.10; UNIT fleetDriverPersonLink | OK |
| 19 | Motorista com CPF de exatamente uma Pessoa | `personId` preenchido, sem criar Pessoa | UNIT resolver/fleet; API | OK |
| 20 | Motorista com CPF ambíguo (duas Pessoas) | `personId = null`, pendência na ficha | E2E 15.11–12 | OK |
| 21 | Alterar CPF de motorista ligado a Pessoa com outro CPF | 409 `PERSON_CPF_MISMATCH` | UNIT fleetDriverPersonLink | OK |
| 22 | Comissionável com `personId` explícito inválido/unificado | 404 / 409 | API (404 verificado); UNIT | OK |
| 23 | Vincular comissionável não altera comissões | Só `personId` escrito; nenhum modelo de comissão tocado | UNIT invariância | OK |
| 24 | Dedupe de comissionáveis por nome | Não agrupa homônimos; só `nomusPersonId` | UNIT invariância | OK |
| 25 | Desligamento com conta ativa (E1, flag ligada) / recontratação | Conta inativa + sessões revogadas + auditoria; recontratação não reativa; flag desligada = sem efeito | INT userAccessLifecycle (6/6) | OK |

Critérios E1–E4: E1 (flag, INT), E2 (E2E 15.15/15.18, UNIT superAdminRoleGuard, auditoria `SUPER_ADMIN_*`), E3 (E2E 15.16), E4 (E2E 15.17, INT propagação) — todos com resultado real.

## 4. Correções encontradas durante a validação (e corrigidas na branch)

- Diálogo de step-up ficava **atrás** do diálogo de unificação (ambos `z-50`): `AdminStepUpDialog` → `z-[60]` e renderizado depois dos diálogos da ficha (`c55a0f6`).
- Pessoa `MERGED` propunha "unificar" com a vencedora: `findPendingLinksForPerson` retorna vazio para `MERGED`.
- Eventos de dois lados apareciam duplicados na ficha: deduplicação por chave preferindo o registro da própria Pessoa.
- Servidor local não recarrega código de servidor: CP6 só foi verificado após reiniciar o processo (registrado para o runbook: cada deploy reinicia o processo).
- Botões "Corrigir vínculo" tinham `data-testid` igual para entidades diferentes: agora incluem o `entityId`.
- O roteiro E2E escreveu o perfil do Chrome dentro do repositório e o watcher do Vite derrubou o servidor (`EBUSY`): o roteiro passa a ser executado com `PERF_E2E_OUT` fora do repositório.

## 5. O que não foi validado (declarado)

- Nenhuma execução contra dados reais ou AWS (regra da missão). Volumes reais de duplicidade: só pela auditoria somente leitura (`npm run audit:people-identity`) na janela de homologação.
- E1 não foi exercitado no navegador (fica atrás da flag); coberto por integração.
- Importação de comissionáveis do Nomus com vínculo automático: não existe (sem documento na origem), portanto não testado.
- Carga/desempenho da lista `/api/people` com dezenas de milhares de Pessoas: paginação é no banco, mas não houve teste de carga.
