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
| CP3 Governança Person | pendente | transação, prévia sem efeito, `ensurePersonFromSource` com checagem, migration aditiva `PersonLinkEvent`/`mergedIntoPersonId` |
| CP4 Pessoas 360° v1 | pendente | |
| CP5 v1.1 escrita | pendente | |
| CP6 Frota/Comissões | pendente | |
| CP7 Qualidade/E2E/docs | pendente | |

## Como retomar
1. `git status` na branch; ler esta tabela.
2. Subir PG local: `cd C:/Dev/induscost-claude-deps/pgtool && node pg-start.mjs`.
3. Testes do checkpoint corrente: `npx tsx --test src/lib/security/superAdminRoleGuard.test.ts src/lib/security/userAccessLifecycle.test.ts src/lib/security/userPermissionAdminAudit.test.ts src/lib/accessProfilesApply.test.ts`; integração: `PEOPLE_PG_TEST_URL=postgresql://induscost_local:local_only_disposable@127.0.0.1:54329/perf_empty npx tsx --test src/lib/security/userAccessLifecycle.integration.test.ts`.
