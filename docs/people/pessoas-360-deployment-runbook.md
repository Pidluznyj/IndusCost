# Pessoas 360° — runbook de implantação (NUNCA executar em produção sem autorização explícita)

Data: 2026-10-20. Branch: `feat/people-360-canonical-identity`. Implementação: [pessoas-360-implementation.md](pessoas-360-implementation.md). Validação: [pessoas-360-validation.md](pessoas-360-validation.md).

**Regras absolutas:** nenhum passo abaixo foi executado na AWS. Migration, backfill, correção de pessoas reais e deploy só acontecem com autorização por escrito, em janela combinada, depois de homologação. Nada aqui apaga dados: a migration é aditiva e idempotente; as operações de vínculo só escrevem `personId` e eventos.

## 0. Pré-condições

1. Branch revisada e mesclada em `main` **com autorização** (não feito).
2. Auditoria em dados reais executada **somente leitura** (`npm run audit:people-identity`, SQL da auditoria §23) e lida pela diretoria: volume de Pessoas sem CPF, CPFs repetidos, contas sem Pessoa, colaboradores com conta noutra Pessoa.
3. Backup lógico do banco (`pg_dump`) imediatamente antes da janela; ponto de restauração testado.
4. Variáveis de ambiente revisadas: `HR_TERMINATION_REVOKES_ACCESS` **ausente ou `0`** na primeira implantação (E1 fica desligado até o RH homologar).

## 1. Homologação (ambiente que não é produção)

1. Restaurar um dump recente em um PostgreSQL de homologação.
2. `npx prisma migrate deploy` → aplica `20261027120000_person_link_event` (só `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, índices `IF NOT EXISTS`). Verificar:
   ```sql
   select column_name from information_schema.columns where table_name='Person' and column_name='mergedIntoPersonId';
   select count(*) from "PersonLinkEvent";
   ```
3. Subir a aplicação e rodar o roteiro de aceite ([pessoas-360-validation.md](pessoas-360-validation.md) §3, 25 cenários) com um SUPER_ADMIN real, um ADMIN, um RH gestor, um RH operacional e um usuário comum.
4. Repetir os gates: `npm run build`, suíte unitária (`node scripts/run-unit-tests.mjs`), integração com PG de homologação (`PEOPLE_PG_TEST_URL=... npx tsx --test src/lib/canonicalPersonGovernance.integration.test.ts src/lib/people/personLinkOps.integration.test.ts src/lib/security/userAccessLifecycle.integration.test.ts`).

## 2. Janela de produção (só com autorização)

| Passo | Comando / ação | Reversão |
|---|---|---|
| 2.1 | Avisar usuários; congelar alterações em Usuários e RH durante a janela | — |
| 2.2 | `pg_dump` completo | restore |
| 2.3 | Deploy do build (`npm run build` + processo) **sem** `HR_TERMINATION_REVOKES_ACCESS` | voltar o build anterior (a migration abaixo não quebra o código antigo: coluna e tabela novas são ignoradas por ele) |
| 2.4 | `npx prisma migrate deploy` | a migration é aditiva; para reverter: `ALTER TABLE "Person" DROP COLUMN "mergedIntoPersonId"; DROP TABLE "PersonLinkEvent";` — só se nada tiver sido unificado |
| 2.5 | Fumaça: login SUPER_ADMIN → `/people` lista → abrir uma ficha → `POST /api/people/:id/merge` sem step-up retorna 403 `ADMIN_ELEVATION_REQUIRED` | — |
| 2.6 | Conferir `SecurityAuditLog`/`PermissionAuditLog` recebendo os novos eventos (`USER_CREATED`, `SUPER_ADMIN_*`) | — |

## 3. Caso real do super admin (duas Pessoas: CPF numa, login noutra) — procedimento seguro

Nunca por SQL. Sempre pela ficha, com prévia e justificativa, por um SUPER_ADMIN com step-up:

1. `/people?q=<nome>` → identificar a Pessoa **A** (tem o colaborador e o CPF validado) e a Pessoa **B** (tem só a conta). Confirmar na ficha de A a pendência "Conta do colaborador aponta para outra Pessoa".
2. Na ficha de A, no cartão Usuário IndusCost, "Corrigir vínculo para esta pessoa" → ler a prévia (origem B, destino A, evidência) → justificativa → confirmar. Resultado: `AppUser.personId = A`, evento `RELINKED` (autor, motivo, `fromPersonId = B`). Permissões, senha e sessões da conta não mudam.
3. Se B ficou vazia e tem o mesmo CPF: "Unificar com B" → prévia (0 ou mais movimentos; "Não muda" lista o que permanece) → justificativa → senha (step-up) → confirmar. B fica `MERGED` → A; evento `MERGED` reversível.
4. Verificar: ficha de A sem pendências; ficha de B com faixa "unificada em A". Se algo estiver errado: "Reverter unificação" na ficha de A (só enquanto A não receber vínculos novos).
5. Prevenção já embutida: criação de conta copia `employee.personId`; `ensurePersonFromSource` reutiliza a Pessoa pelo CPF; mudança de Pessoa do colaborador propaga para a conta.

## 4. Ligar E1 (desligamento revoga acesso) — fase separada

1. RH homologa o comportamento em homologação: desligar um colaborador com conta ativa → conta inativa, sessões revogadas, `USER_DEACTIVATED_BY_TERMINATION` auditado; recontratação **não** reativa.
2. Comunicar RH e TI; definir quem reativa contas (Configurações › Usuários, SUPER_ADMIN/ADMIN).
3. Só então definir `HR_TERMINATION_REVOKES_ACCESS=1` no ambiente e reiniciar o processo (com autorização).

## 5. Monitoramento pós-implantação (primeiros 7 dias)

- `select "eventKind", count(*) from "PersonLinkEvent" group by 1;` diariamente — unificações só devem aparecer por ação deliberada.
- `select count(*) from "Person" where status='MERGED';` — crescimento só em janela de saneamento.
- Logs 409 com códigos `STALE`, `UNIQUE_CONFLICT`, `PERSON_CPF_MISMATCH`, `PERSON_ALREADY_HAS_USER`: esperados em uso concorrente; investigar picos.
- Chamados de "não consigo vincular": quase sempre `PERSON_CPF_MISMATCH` (cadastro ligado a Pessoa com outro CPF) — resolver pela ficha, nunca pelo banco.

## 6. Rollback

- Código: voltar o build anterior. A coluna e a tabela novas não afetam o código antigo.
- Dados: unificações são reversíveis pela própria ficha (`merge/revert`) enquanto não houver vínculos novos; vínculos corrigidos podem ser corrigidos de volta (evento `RELINKED` guarda `fromPersonId`). Nada é apagado, portanto não há dado a restaurar além do backup de segurança.
