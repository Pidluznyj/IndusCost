# Pessoas 360° — acompanhamento da implementação (ponto de retomada)

Branch: `feat/people-360-canonical-identity` (base `main` = `97e71bc`). Sem push, sem deploy, sem migration em ambiente real. Referência: [auditoria-cadastro-unico-pessoas-induscost.md](auditoria-cadastro-unico-pessoas-induscost.md).

Ambiente local: PostgreSQL descartável `127.0.0.1:54329` (`perf_e2e` para navegador, `perf_empty` para integração via `PEOPLE_PG_TEST_URL`/`PERFORMANCE_PG_TEST_URL`). Gates em `C:/Dev/induscost-claude-deps/gates/`.

| Checkpoint | Estado | Evidência |
|---|---|---|
| CP1 Baseline | feito | branch criada; tsc baseline em `tsc-base-97e71bc.norm` |
| CP2 Segurança E2 (SUPER_ADMIN) | código + testes | `superAdminRoleGuard.ts/.test.ts`; guarda em `PATCH /api/admin/users/:id`, `PUT /:id/role`, `apply-preset`, `access-profiles/:id/apply`; auditoria `SUPER_ADMIN_ROLE_GRANTED/REVOKED/CHANGE_DENIED` |
| CP2 Segurança E3 (sem exclusão física) | código + testes | `DELETE /api/admin/users/:id` → inativação + revogação + `USER_DELETE_REQUEST_CONVERTED`; `PATCH isActive` audita e revoga |
| CP2 Segurança E4 (conta nasce com Pessoa) | código + testes | `POST /api/admin/users` copia `employee.personId`; `PERSON_ALREADY_HAS_USER`; `PUT /api/employees/:id` propaga (`canonicalPersonSync.server.ts`) |
| CP2 Segurança E1 (desligamento revoga) | código + testes (flag) | `userAccessLifecycle(.server).ts`; flag `HR_TERMINATION_REVOKES_ACCESS` (default off) |
| CP3 Governança Person | feito (adf90ea) | prévia sem escrita; `ensurePersonFromSource` reutiliza por CPF/recusa e-mail; plano+aplicação na transação do colaborador; migration `20261027120000_person_link_event`; `canonicalPersonGovernance.integration.test.ts` 6/6 |
| CP4 Pessoas 360° v1 | feito (8ec96e9) | `/people`, `/people/:id`; `GET /api/people`, `/api/people/:id`; verificado no navegador (lista, ficha, conflito do caso real) |
| CP5 v1.1 escrita | feito (2c34782, c55a0f6) | prévia/vincular/corrigir/desvincular/unificar/reverter; `personLinkOps.integration.test.ts` 7/7; correção do caso real verificada no navegador |
| CP6 Frota/Comissões | feito (bdcba11) | `personIdentityResolve.server.ts`; motorista/CSV/QR com checksum e `personId`; comissionável com `personId` + sugestões; dedupe só por `nomusPersonId`; testes 21/21 |
| CP7 Qualidade/E2E/docs | **encerrado** (c4510a1 + commit de fechamento) | tsc 0 novos vs base; integração 19/19; build OK; E2E `part15-people-360.mjs` 21/21; [pessoas-360-implementation.md](pessoas-360-implementation.md), [pessoas-360-validation.md](pessoas-360-validation.md), [pessoas-360-deployment-runbook.md](pessoas-360-deployment-runbook.md) |

## Como retomar
1. `git status` na branch; ler esta tabela.
2. Subir PG local: `cd C:/Dev/induscost-claude-deps/pgtool && node pg-start.mjs`.
3. Testes do checkpoint corrente: `npx tsx --test src/lib/security/superAdminRoleGuard.test.ts src/lib/security/userAccessLifecycle.test.ts src/lib/security/userPermissionAdminAudit.test.ts src/lib/accessProfilesApply.test.ts`; integração: `PEOPLE_PG_TEST_URL=postgresql://induscost_local:local_only_disposable@127.0.0.1:54329/perf_empty npx tsx --test src/lib/security/userAccessLifecycle.integration.test.ts`.

## Encerramento do CP7 (2026-10-21)

- E2E final (21/21, exit 0) reexecutado em 2026-10-21 com o servidor reiniciado no código final. Gates finais reexecutados no código final: ver [pessoas-360-validation.md](pessoas-360-validation.md) §1 (números e exit codes).
- 6 falhas unitárias investigadas uma a uma contra o checkout da base: todas pré-existentes, nenhuma regressão (validação §1.1).
- Correções do fechamento: guarda E2 no restore/clear de perfil de acesso; `people` no contrato e no mapa de recursos da sidebar; teste de integração `NEWER_DEPENDENCIES`.
- Resultado: **PRONTO COM RESSALVAS** — pendências: 6 falhas unitárias pré-existentes fora do escopo; cenário #7 só por revisão de código; E1 atrás de flag.
- Sem push, sem merge, sem deploy, sem migration fora do PG local.
