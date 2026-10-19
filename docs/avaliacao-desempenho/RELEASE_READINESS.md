# Prontidão de release — Desempenho, Cultura e Potencial

Auditoria pré-commit de 19/10/2026. Nada foi commitado, enviado, mesclado ou implantado. Nenhum banco real foi acessado. Os comandos abaixo são **para executar depois**, por quem tiver autorização; nenhum foi rodado contra homologação ou produção.

## Veredito

| Etapa | Situação | Bloqueio exato |
| --- | --- | --- |
| Commit local | **APTO** | — (adicionar por caminho, lista na seção 2) |
| Abertura de PR | **APTO**, sem mesclar | Mesclar só depois da seção 3.3: sincronizar com a `main` atual (`e6b7e8af`), resolver 1 conflito de import em `server.ts` e repetir os gates no código mesclado |
| Deploy técnico em homologação | **NÃO APTO** | (1) código mesclado com a `main` ainda não testado; (2) o repositório só tem wrapper de deploy da `main` em `/opt/induscost`, então a homologação precisa de procedimento próprio e aprovado; (3) a migration nunca rodou sobre uma cópia do banco de homologação |
| Piloto com colaboradores | **NÃO APTO** | Decisões de RH e jurídico em aberto ([PENDENCIAS_HOMOLOGACAO.md](PENDENCIAS_HOMOLOGACAO.md) §1–3), portal sem exposição externa definida (§4), RFC-025/037/039/040 BLOCKED |
| Produção | **NÃO APTO** | Tudo acima, mais o piloto aprovado |

## Atualização de 19/10/2026 — integração com a `main` executada

A pedido do responsável, a `main` atual (`e6b7e8af`) foi mesclada no branch e o resultado publicado na `main`. **Sem deploy e sem flags ligadas.** Os gates da seção 14, itens 1–4, rodaram no código mesclado:

| Gate | Resultado |
| --- | --- |
| Conflitos | 3 resolvidos mantendo os dois lados: imports de `server.ts`, `test:competencies` + `test:performance` em `package.json`, lista `scripts/unit-test-files.txt` |
| Regressão encontrada no merge | `competencyScopePolicy.test.ts` (da `main`) proíbe `resolvePeopleAccessScope(` em `server.ts`. Por trás disso havia um defeito real: o Desempenho daria escopo ALL a líderes com `employees.view` (que chega pelo Organograma). Corrigido em commit próprio: o Desempenho passa a usar `resolveCompetencyAccessScope` (ALL só com `employees.edit`). O teste não foi alterado |
| `npm run test:performance` | 50/50 |
| `npm run test:competencies` | 159/159 (antes da correção: 158/159) |
| Navegação, sidebar, rotas, superfície pública | 105/105 |
| Suíte de unidade completa | mesclado 5173 testes, 4 falhas; `main` 5123 testes, 4 falhas; **as mesmas 4**, nenhuma nova (a diferença de 50 são os testes do módulo) |
| `tsc` completo | 1370 = 1370; zero erro novo, zero no módulo |
| Build de produção + `check:browser-bundle` | OK, 66 artefatos sem Prisma; `avaliacao.html` gerado |
| `check:frontend-server-imports` / `check:server-imports` | OK / OK |
| Migrations intercaladas (banco local descartável no estado da `main`, 241 migrations registradas) | `migrate deploy` aplicou `20261016180000` **fora de ordem** (depois de `20261017…20261020`) e `20261021120000`; `migrate diff` vazio; integração PostgreSQL 1/1 |
| Navegador real no código mesclado | 55/55, sem erro de console |

Observação: no log do servidor local apareceu uma vez `Unique constraint failed on the fields: (code)` em `hrEvaluation.server.ts` (`ensureEvaluationTemplates`). É uma corrida no primeiro acesso a um banco vazio, preexistente na `main` e fora do módulo; as chamadas seguintes funcionaram.

Com isso, os bloqueios (1) e (3) de "deploy técnico em homologação" foram atendidos no ambiente local. Ainda faltam o preflight e o backup no servidor de homologação (seções 4.2 e 5) e a aprovação do procedimento de deploy. **Atenção:** com o código na `main`, o próximo deploy de produção pelo wrapper oficial também aplica as duas migrations (aditivas, inertes com a flag desligada).

## 1. Referência

| Item | Valor |
| --- | --- |
| Worktree | `induscost-claude` |
| Branch | `feature/avaliacao-desempenho-claude` |
| Commit de origem (HEAD) | `2824a790c70e31ed091cc48c581e52c397b7293c` — o primeiro commit do módulo, que já traz a migration `20261016180000` |
| Base do branch | `9d833ade4547cecd1871d26067aff141a375ca87` |
| `main` remota em 19/10/2026 (`git ls-remote`) | `e6b7e8af4ea53eb399be762228575f4a1f2aad9e`, 16 commits à frente da base, com 9 migrations novas |
| Ref local `origin/main` deste clone | `8d7b2fa` (desatualizada; não foi feito `fetch`) |

## 2. Arquivos previstos para o commit

A lista exata está no apêndice A. Resumo: 107 caminhos — 28 modificados, 2 excluídos de propósito, 77 novos.

- **Exclusões intencionais:** `src/lib/hrPerformance/performancePdf.ts` e `performancePdf.test.ts`. Era um segundo padrão de PDF, substituído pelo impresso institucional (`PrintDocumentShell`). Nenhum código, script, `package.json` ou lista de testes os referencia; só documentos históricos citam o nome.
- **Registro de testes (feito nesta auditoria):** os testes do módulo não estavam em `scripts/unit-test-files.txt` nem tinham script npm. Desde o commit de origem, `npm test` e o CI nunca os executavam, ao contrário de Competências e Satisfação. Foram adicionados os 6 arquivos à lista canônica e o script `npm run test:performance`. Os dois rodam 50/50. A suíte ampla passa a ter cerca de 50 testes a mais que os 4918 registrados; a contagem nova não foi medida.
- **Não entram:** `node_modules` (junction local, ignorada), `tmp/` (ignorado), `.env` (não existe), saídas de build e bancos locais (fora do worktree).
- **Conferido:** nenhum segredo, token, senha, CPF ou e-mail real nos arquivos novos ou alterados. As capturas e PDFs mostram só pessoas `[DEMO]` e usuários "(teste)". Os documentos de trabalho (`INICIAR_CLAUDE.md`, `PROGRESSO_CLAUDE.md`) citam caminhos da estação local; `HANDOFF_CLAUDE_CODE.md`, já versionado, segue o mesmo padrão.

Comando sugerido (não executado). Adicionar por caminho, nunca `git add .`:

```bash
git add -- $(sed -n '/^```files$/,/^```$/p' docs/avaliacao-desempenho/RELEASE_READINESS.md | grep -v '^```')
```

## 3. Dependências e migrations

### 3.1 As duas migrations

| Migration | Origem | Conteúdo | Destrutivo | Depende de |
| --- | --- | --- | --- | --- |
| `20261016180000_hr_performance_cycle` | Commit `2824a790` (Cursor, 16/10/2026 18:51), sem alteração neste branch: checksum preservado | 17 tabelas `HrPerformance*`, índices (inclusive o único parcial "uma tarefa ativa por pessoa e tipo") e chaves estrangeiras | Nenhum `DROP`, `UPDATE`, `DELETE`, `RENAME` | `Employee.id` (3 FKs `ON DELETE RESTRICT`) e `gen_random_uuid()` (já usado desde `20260410120000`) |
| `20261021120000_hr_performance_cycle_rules` | Criada neste branch por `prisma migrate diff` do banco local contra o schema | `ADD COLUMN` em 9 tabelas do módulo (obrigatórias com default) e 1 tabela nova (`HrPerformanceReportIssue`) | Nenhum | A migration anterior. Nenhuma tabela fora do módulo |

O comentário no topo de `20261016180000` ("A migration não foi aplicada por este trabalho") é do commit de origem. Não foi editado de propósito: alterar uma migration muda o checksum.

**A data `20261021`** não é a data de execução nem de criação. O projeto usa um contador sintético de slot (`AAAAMMDD120000`, o próximo depois do último existente). Em 16/10 o último slot da `main` era `20261020120000` (EPIs), então `20261021120000` é o próximo. Nenhum branch local nem a `main` remota usa o prefixo `2026102x` além deste, então não há colisão.

### 3.2 Ordem real depois da integração com a `main`

```text
20261015153000_hr_department_competency_shift      (main)
20261016120000_hr_training_certificates            (main)
20261016180000_hr_performance_cycle                (este módulo)
20261017120000_hr_employee_external_certificates   (main)
20261018120000_hr_certificate_signer_employee      (main)
20261019120000_employee_termination_leave_details  (main)
20261020120000_hr_epi_catalog_deliveries           (main)
20261021120000_hr_performance_cycle_rules          (este módulo)
```

- As migrations ficam intercaladas, mas são independentes nos dois sentidos: nenhuma da `main` cita `HrPerformance*`, e as do módulo só referenciam `Employee.id`. `20261019120000` altera colunas de `Employee`, mas não a chave.
- Se o banco de destino já tiver aplicado `20261017…20261020`, a `20261016180000` entra "fora de ordem". O esperado é que `prisma migrate deploy` aplique toda migration pendente; mesmo assim, confirmar com `prisma migrate status` no preflight (seção 4) antes de aplicar.
- O schema mesclado (`main` + branch) foi validado offline com `prisma validate`: válido.

### 3.3 Integração com a `main` (simulada, sem alterar refs)

`git merge-tree` entre `e6b7e8af` e o estado atual do worktree:

- `prisma/schema.prisma` e `PeopleEmployeeProfileDialog.tsx`: mesclagem automática.
- `server.ts`: **1 conflito**, só no bloco de imports. A `main` trocou `resolvePeopleAccessScope` por `resolveCompetencyAccessScope` (política de escopo de Competências). O branch acrescenta os imports do módulo e ainda usa `resolvePeopleAccessScope` no escopo do Desempenho. Solução: manter as duas linhas e todos os imports do módulo.
- Depois de mesclar, repetir: `npm run test:performance`, `npm run test:competencies`, testes de navegação, `tsc` comparado com a nova base, `vite build` e `check:browser-bundle`. Também conferir que a elegibilidade considera a situação "Desligado/Afastado" introduzida pela `main` (`20261019120000`). Isso não foi testado no código mesclado.
- A integração usa o procedimento da sessão (`sync_with_base_branch` ou merge local pelo responsável). Não foi executada.

### 3.4 Cadeia de migrations em banco vazio

- `prisma migrate deploy` em banco vazio falha na primeira migration (`20260410120000_purchases_block1` faz FK para `"Material"`, que nenhuma migration cria). Os bancos reais nasceram de baseline. Já documentado em `AGENTS.md` e `docs/CODEBASE_MAP.md` (orientação: `prisma db push` em banco novo).
- **Efeito no deploy:** nenhum. Homologação e produção já têm o histórico em `_prisma_migrations`; `migrate deploy` aplica só as pendentes. O problema afeta apenas ambientes criados do zero (CI, banco descartável).
- **Como as migrations do módulo foram validadas:** schema da base aplicado por `migrate diff --from-empty`, 232 migrations anteriores marcadas como aplicadas, depois `migrate deploy` das duas do módulo. Resultado: sem drift e upgrade com dados antigos preservados (`EVIDENCIAS_TESTES.md` §2). **Não** foi validada a sequência intercalada com as 9 migrations novas da `main`; isso entra no preflight local da seção 4.

## 4. Preflight somente leitura

### 4.1 Local, antes do merge para a `main` (banco descartável)

1. Recriar um PostgreSQL local descartável a partir do schema da `main` atual, como em `EVIDENCIAS_TESTES.md` §2.
2. Aplicar a árvore mesclada com `prisma migrate deploy`. Esperado: as duas migrations do módulo aplicadas.
3. `prisma migrate diff --from-url <local> --to-schema-datamodel prisma/schema.prisma`: esperado vazio.
4. Rodar `bash scripts/performance-e2e/run-all.sh` sobre o código mesclado. Esperado: 55/55.

### 4.2 No servidor de homologação (sem escrita)

```bash
git status --short && git rev-parse HEAD
npx prisma validate
npx prisma migrate status
psql "$DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_name like 'HrPerformance%'"
psql "$DATABASE_URL" -Atc "select migration_name, finished_at from \"_prisma_migrations\" where migration_name like '2026101%' or migration_name like '2026102%' order by 1"
psql "$DATABASE_URL" -Atc "select count(*) from \"AppUser\" where role = 'SUPER_ADMIN' and \"isActive\""
env | grep -E '^PERFORMANCE_|^APP_PUBLIC_ORIGIN' || echo "nenhuma flag do módulo definida"
```

Esperado antes do deploy:

- `migrate status` lista como pendentes só as migrations novas da release.
- 0 tabelas `HrPerformance*`.
- Pelo menos 1 SUPER_ADMIN ativo.
- Nenhuma flag `PERFORMANCE_*` ligada.

## 5. Backup e recuperação

```bash
npm run backup:pre-deploy -- --reason=pre_deploy_desempenho_cultura
```

O wrapper oficial (`scripts/backupDatabaseBeforeDeploy.sh`) faz `pg_dump` sem alterar o banco. Guardar o caminho do arquivo gerado e conferir o tamanho antes de seguir.

Recuperação, em ordem de preferência:

1. **Desligar a flag** (`PERFORMANCE_CYCLE_ENABLED=0`) e reiniciar. Todas as rotas respondem 404, o menu some e as tabelas ficam inertes. Não precisa mexer no banco.
2. **Voltar o código** para o commit anterior. As colunas e tabelas novas não são lidas pelo código antigo, porque as migrations são aditivas.
3. **Restaurar o backup**, só se uma migration falhar no meio e deixar o banco inconsistente. Decisão do responsável pelo banco.

Não há migration de "down". Não apagar as tabelas `HrPerformance*` à mão: isso perde a auditoria.

## 6. Ordem de implantação

1. Merge na `main`, depois da revisão e dos gates no código mesclado.
2. Preflight da seção 4.2.
3. Backup (seção 5).
4. `npx prisma validate` → `npx prisma migrate deploy` → `npx prisma generate`. O wrapper de produção (`scripts/deploy-server-main-update.sh`) já segue essa ordem antes do build.
5. Build e reinício.
6. `npm run permissions:seed` (seção 7).
7. Smoke tests com a flag **desligada** (seção 9).
8. Só então ligar as flags, e só em homologação (seção 8).

**Atenção:** o wrapper oficial (`deploy-induscost.sh` → `deploy-server-main-update.sh`) faz `git pull --ff-only origin main` em `/opt/induscost`, que é produção. Depois do merge na `main`, o próximo deploy de produção aplica as duas migrations lá também, com a flag desligada e as tabelas vazias. Isso é seguro por serem aditivas, mas é uma decisão do responsável. O deploy de homologação roda os arquivos de teste alterados por completo: os 6 do módulo passam; o de integração fica pulado sem `PERFORMANCE_PG_TEST_URL`.

## 7. Seed de permissões

Recursos novos, já no contrato em código desde `2824a790` (`src/lib/security/permissionContract/resources.ts`):

| Recurso | Ações | Sensibilidade | Uso |
| --- | --- | --- | --- |
| `admin.employees.performance` | view, update (avaliar), manage | alta | menu, ciclos, modelos, equipe |
| `admin.employees.performance.calibration` | manage | alta | validação, calibração, revisão |
| `admin.employees.performance.reports` | view | alta | exportação e PDFs do ciclo |
| `admin.employees.performance.invites` | manage | alta | convites, QR, assistido |
| `admin.employees.performance.conduct` | manage | crítica | ocorrências; **estrito**, sem atalho de editor de RH |

Comportamento antes do seed:

- A autorização vem do contrato em código, não do banco.
- Com a flag desligada, tudo responde 404.
- Com a flag ligada e sem seed:
  - SUPER_ADMIN tem acesso total;
  - quem é editor de RH (`employees.edit`) recebe os quatro primeiros recursos pelo atalho existente, mas não `conduct`;
  - os demais são negados.
- O seed só leva o catálogo ao banco, para os recursos aparecerem no editor de perfis. Nenhum perfil recebe acesso padrão além do SUPER_ADMIN.

```bash
npm run permissions:seed -- --catalog-only
npm run permissions:seed -- --dry-run
npm run permissions:seed
npm run permissions:validate
```

Depois do seed:

- Montar um perfil de RH (os cinco recursos) e um perfil de líder (só `admin.employees.performance` view e update).
- Ligar o usuário do líder ao cadastro do colaborador.
- Alterar perfil incrementa `permissionsVersion`, e o `/me` recarrega sozinho.

## 8. Feature flags (só em homologação)

| Flag | Padrão | Ligar em homologação? |
| --- | --- | --- |
| `PERFORMANCE_CYCLE_ENABLED` | desligada | Sim, depois dos smoke tests com ela desligada |
| `PERFORMANCE_OFFICIAL_PUBLICATION` | `0` | **Não.** Com `0`, abrir ciclo exige o aceite explícito de piloto |
| `PERFORMANCE_IDENTITY_OTP` | `0` | Não (reservada; o código de 6 dígitos é sempre exigido) |
| `PERFORMANCE_REMINDERS_ENABLED` | `0` | Não (sem canal aprovado) |
| `APP_PUBLIC_ORIGIN` | vazio | Sim, com a origem que o celular alcança |
| `PERFORMANCE_PUBLIC_HOSTS` / `PERFORMANCE_PUBLIC_SURFACE_HEADER` | vazio | Só quando o túnel/gateway estiver aprovado |

Valores aceitos como ligado: `1`, `true`, `yes`, `on`, `enabled`. Conferido em `.env.example`: as quatro flags com `0` e as variáveis de exposição comentadas. As variáveis vão no ambiente do processo de homologação, nunca num `.env` versionado.

## 9. Smoke tests pós-deploy

Com a flag **desligada**:

```bash
curl -sS http://127.0.0.1:3000/api/health
curl -sS http://127.0.0.1:3000/api/app-version
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/hr/performance/me
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/public/performance/session
```

Esperado:

- `health` e `app-version` OK;
- `/api/hr/performance/me` responde 401 sem login e 404 (`FEATURE_DISABLED`) com login;
- a rota pública responde 404;
- o menu "Desempenho e Cultura" não aparece;
- as telas de Pessoas/RH e Competências continuam iguais.

Com a flag **ligada**, só em homologação e com dados fictícios:

1. SUPER_ADMIN vê as 7 abas.
2. Um usuário sem perfil recebe 403.
3. `/avaliacao` carrega o bundle próprio.
4. Criar modelo e ciclo de teste, emitir 1 convite para uma pessoa `[DEMO]` e abrir no celular.
5. Gerar um PDF e conferir código `DCP-…` e "Página X de Y".
6. Encerrar o ciclo de teste.

## 10. Verificações de integridade (somente leitura)

```sql
-- uma tarefa ativa por pessoa e tipo (o índice único parcial garante; conferir)
select "participantId", kind, count(*) from "HrPerformanceAssignment" where active group by 1,2 having count(*) > 1;
-- respostas órfãs
select count(*) from "HrPerformanceAnswer" a left join "HrPerformanceAssignment" t on t.id = a."assignmentId" where t.id is null;
-- no máximo um resultado ativo por participante
select "participantId", count(*) from "HrPerformanceResult" where active group by 1 having count(*) > 1;
-- sessões vivas depois de encerrar o ciclo de teste
select count(*) from "HrPerformanceSession" where not revoked and "expiresAt" > now();
-- auditoria só cresce: guardar a contagem e comparar depois
select count(*) from "HrPerformanceAuditEvent";
```

Todas as contagens de problema devem dar 0. Também conferir nos logs do servidor que não aparecem tokens, códigos de 6 dígitos nem respostas.

## 11. Critérios de rollback

Desligar a flag imediatamente (recuperação 1 da seção 5) se ocorrer qualquer um destes:

- erro 5xx fora do módulo depois do deploy, ou `/api/health` falhando;
- `migrate deploy` com erro ou `migrate status` mostrando falha;
- qualquer tela de Pessoas/RH, Competências ou Satisfação diferente do que era;
- um usuário sem perfil acessando dados do módulo;
- o host público servindo algo fora de `/avaliacao`, `/assets/` e `/api/public/performance/`;
- token ou código aparecendo em log;
- integridade (seção 10) com contagem diferente de 0.

Voltar o código (recuperação 2) se o problema continuar com a flag desligada. Restaurar o backup (recuperação 3) só com falha de migration no meio.

## 12. Restrições para dados reais

- Nenhum colaborador real em homologação até RH e jurídico fecharem as seções 1–3 de `PENDENCIAS_HOMOLOGACAO.md`.
- `PERFORMANCE_OFFICIAL_PUBLICATION` continua `0`: resultados são piloto, não decisão de RH.
- Não usar CPF, data de nascimento ou matrícula como código de acesso.
- Não expor o portal na internet sem o gateway aprovado e `PERFORMANCE_PUBLIC_HOSTS` configurado.
- O registro de ocorrências não é usado até existir processo aprovado.
- `scripts/seedPerformanceLocalDemo.ts` e `scripts/performance-e2e/` recusam qualquer URL que não seja local. Nunca apontar para homologação ou produção.

## 13. Pendências de RH e jurídico

Lista completa em [PENDENCIAS_HOMOLOGACAO.md](PENDENCIAS_HOMOLOGACAO.md):

- textos das 12 perguntas e exemplos;
- escala;
- 90 dias de observação, 3 de 4 respostas por pilar;
- cortes da Nine-Box e faixas de cultura;
- divergência e regra de evidência;
- entrega do código de acesso;
- tempos de sessão e de convite;
- LGPD (base legal, aviso, retenção, expurgo);
- processo de conduta;
- canal de lembrete.

Nada disso foi aprovado; o código trata tudo como proposta.

## 14. GO / NO-GO

**GO para deploy técnico em homologação** só quando **todos** forem verdadeiros:

1. PR revisado e mesclado na `main`, com o conflito de `server.ts` resolvido.
2. No código mesclado:
   - `npm run test:performance` 50/50;
   - `test:competencies` sem falha;
   - suíte de unidade sem falha nova em relação à `main`;
   - `tsc` sem erro novo;
   - build e `check:browser-bundle` OK.
3. Sequência intercalada de migrations validada em banco local descartável, sem drift (4.1).
4. Roteiro de navegador 55/55 no código mesclado.
5. Preflight 4.2 conforme esperado e backup gerado e conferido.
6. Responsável pelo ambiente de homologação aprovou o procedimento de deploy.

**GO para piloto com colaboradores** exige, além disso:

1. Decisões de RH registradas.
2. Parecer jurídico/LGPD.
3. Exposição do portal aprovada.
4. Perfis montados.
5. Smoke tests e integridade OK em homologação.
6. Autorização escrita para o piloto de 8 a 12 pessoas.

**NO-GO** imediato se qualquer critério da seção 11 aparecer, ou se alguém propuser ligar `PERFORMANCE_OFFICIAL_PUBLICATION`, OTP ou lembretes sem a decisão correspondente.

## 15. Observações menores (não bloqueiam)

- A captura `evidencias/02-modulo-rh.png` foi tirada com a lista de ciclos ainda carregando. As 7 abas aparecem e a verificação passou, mas a imagem não mostra a lista.
- O histórico na ficha (`PeoplePerformanceHistorySection.tsx:47`) mostra ponto duplo ("…no setor..") quando o texto da devolutiva já termina com ponto. É só visual, visível em `evidencias/39-ficha-colaborador-historico.png`. Não foi corrigido para não alterar o código já testado.
- A impressão da avaliação de experiência (`hr-evaluation-print.css`) provavelmente sai em branco pela mesma regra global de `src/reports-print.css`. Fora do escopo; não alterado.

## Apêndice A — arquivos do commit

Gerado com `git status --porcelain -uall` em 19/10/2026. Os caminhos excluídos (`performancePdf*`) entram na lista: `git add` registra a exclusão.

```files
.env.example
avaliacao.html
docs/avaliacao-desempenho/DECISOES_PENDENTES.md
docs/avaliacao-desempenho/EVIDENCIAS_TESTES.md
docs/avaliacao-desempenho/INICIAR_CLAUDE.md
docs/avaliacao-desempenho/MATRIZ_CONFORMIDADE_RFC.md
docs/avaliacao-desempenho/PENDENCIAS_HOMOLOGACAO.md
docs/avaliacao-desempenho/PROGRESSO_CLAUDE.md
docs/avaliacao-desempenho/RELATORIO_VALIDACAO_FINAL.md
docs/avaliacao-desempenho/RELEASE_READINESS.md
docs/avaliacao-desempenho/UI_CONTRACT.md
docs/avaliacao-desempenho/evidencias/02-modulo-rh.png
docs/avaliacao-desempenho/evidencias/04a-editor-modelo.png
docs/avaliacao-desempenho/evidencias/07b-previa-elegibilidade.png
docs/avaliacao-desempenho/evidencias/08-troca-lider.png
docs/avaliacao-desempenho/evidencias/10-abertura-piloto.png
docs/avaliacao-desempenho/evidencias/11-convites-emitidos.png
docs/avaliacao-desempenho/evidencias/11b-fichas-impressao.png
docs/avaliacao-desempenho/evidencias/12-celular-codigo.png
docs/avaliacao-desempenho/evidencias/13-celular-intro.png
docs/avaliacao-desempenho/evidencias/14a-celular-pergunta-1.png
docs/avaliacao-desempenho/evidencias/14c-celular-sem-internet.png
docs/avaliacao-desempenho/evidencias/16-celular-retomada.png
docs/avaliacao-desempenho/evidencias/16b-celular-320px.png
docs/avaliacao-desempenho/evidencias/17a-celular-revisao.png
docs/avaliacao-desempenho/evidencias/17d-assistido-confirmacao.png
docs/avaliacao-desempenho/evidencias/18-lider-equipe.png
docs/avaliacao-desempenho/evidencias/21-lider-enviada-com-autoavaliacao.png
docs/avaliacao-desempenho/evidencias/23a-encerrar-coleta-pendencias.png
docs/avaliacao-desempenho/evidencias/24a-calibracao-fila.png
docs/avaliacao-desempenho/evidencias/25a-lider-revisao-recebida.png
docs/avaliacao-desempenho/evidencias/26a-calibracao-ajuste.png
docs/avaliacao-desempenho/evidencias/28-ninebox-oficial.png
docs/avaliacao-desempenho/evidencias/30-pdi-acompanhamento.png
docs/avaliacao-desempenho/evidencias/33-painel.png
docs/avaliacao-desempenho/evidencias/35-admin-mobile.png
docs/avaliacao-desempenho/evidencias/35-admin-tablet.png
docs/avaliacao-desempenho/evidencias/36b-lider-devolutiva-pdi.png
docs/avaliacao-desempenho/evidencias/39-ficha-colaborador-historico.png
docs/avaliacao-desempenho/evidencias/execucao-navegador.txt
docs/avaliacao-desempenho/evidencias/fichas-convite.pdf
docs/avaliacao-desempenho/evidencias/relatorio-consolidado.pdf
docs/avaliacao-desempenho/evidencias/relatorio-devolutiva.pdf
docs/avaliacao-desempenho/evidencias/relatorio-individual.pdf
docs/avaliacao-desempenho/evidencias/relatorio-ninebox.pdf
package.json
prisma/migrations/20261021120000_hr_performance_cycle_rules/migration.sql
prisma/schema.prisma
scripts/performance-e2e/cdp.mjs
scripts/performance-e2e/common.mjs
scripts/performance-e2e/part1-hr-setup.mjs
scripts/performance-e2e/part2-portal.mjs
scripts/performance-e2e/part3-leader.mjs
scripts/performance-e2e/part4-hr-calibration.mjs
scripts/performance-e2e/part5-leader-revision.mjs
scripts/performance-e2e/part6-hr-close.mjs
scripts/performance-e2e/part7-leader-followup.mjs
scripts/performance-e2e/part8-profile-and-access.mjs
scripts/performance-e2e/resetModuleData.mts
scripts/performance-e2e/run-all.sh
scripts/performance-e2e/toggleLeader.mts
scripts/seedPerformanceLocalDemo.ts
scripts/unit-test-files.txt
server.ts
src/App.tsx
src/components/competencies/CompetencyModalFrame.tsx
src/components/hrPerformance/CycleDesk.tsx
src/components/hrPerformance/LeaderAssignmentPanel.tsx
src/components/hrPerformance/PeoplePerformanceHistorySection.tsx
src/components/hrPerformance/PerformanceCalibrationTab.tsx
src/components/hrPerformance/PerformanceCyclePage.tsx
src/components/hrPerformance/PerformanceCyclesTab.tsx
src/components/hrPerformance/PerformanceDashboardTab.tsx
src/components/hrPerformance/PerformanceFollowUpDialogs.tsx
src/components/hrPerformance/PerformanceInvitePrintPage.tsx
src/components/hrPerformance/PerformanceModelsTab.tsx
src/components/hrPerformance/PerformanceNineBoxTab.tsx
src/components/hrPerformance/PerformancePdiTab.tsx
src/components/hrPerformance/PerformancePortalPage.tsx
src/components/hrPerformance/PerformanceReportDocument.tsx
src/components/hrPerformance/PerformanceReportPrintView.tsx
src/components/hrPerformance/PerformanceTeamTab.tsx
src/components/hrPerformance/performance-portal.css
src/components/hrPerformance/performance-print.css
src/components/hrPerformance/performanceUi.tsx
src/lib/hrPerformance/performanceClient.ts
src/lib/hrPerformance/performanceDomain.test.ts
src/lib/hrPerformance/performanceDomain.ts
src/lib/hrPerformance/performanceInsights.ts
src/lib/hrPerformance/performanceInvite.ts
src/lib/hrPerformance/performanceMigration.test.ts
src/lib/hrPerformance/performancePdf.test.ts
src/lib/hrPerformance/performancePdf.ts
src/lib/hrPerformance/performancePortalClient.ts
src/lib/hrPerformance/performancePrisma.integration.test.ts
src/lib/hrPerformance/performancePrisma.ts
src/lib/hrPerformance/performancePublicSurface.test.ts
src/lib/hrPerformance/performancePublicSurface.ts
src/lib/hrPerformance/performanceRateLimit.ts
src/lib/hrPerformance/performanceRoutes.test.ts
src/lib/hrPerformance/performanceRoutes.ts
src/lib/hrPerformance/performanceService.test.ts
src/lib/hrPerformance/performanceService.ts
src/lib/hrPerformance/performanceState.ts
src/lib/hrPerformance/performanceTestFixtures.ts
src/public-performance/main.tsx
vite.config.ts
```
