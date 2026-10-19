# Hierarquia efetiva entre pessoas

Correção de 19/10/2026, branch `fix/org-hierarchy-effective-manager` (a partir da `main` `ca8db5d`). Sem migration. Sem alteração de dados.

## A. Causa raiz

1. **Líder não tem superior no cadastro.** Desde `9cf1b00` (21/07/2026), o líder de diretoria ou departamento deixou de ser membro de departamento. `clearEmployeeMemberDepartmentForOrgLeader` e o `PUT /api/employees/:id` gravam `departmentId = null` e `managerId = null` em quem lidera uma unidade ativa. Cada vez que um líder é salvo, o superior dele some.
2. **Ninguém derivava o superior do líder.** `resolveForcedManagerFromOrgDepartment` só existe para membros (líder do departamento → departamento superior → diretoria). Ela nunca subia `parentDirectorateId` e era ignorada para quem lidera. Por isso José Eduardo (Comercial) e Paulo (Diretoria Administrativa e Presidência) estão com `managerId = NULL`.
3. **Equipes saem de `managerId`.** `DIRECT_REPORTS` e `DESCENDANTS` (Pessoas/RH, Competências, Desempenho) usavam `Employee.managerId` (consulta direta ou CTE). O líder de uma diretoria não enxergava os líderes de departamento abaixo dele nem as equipes deles.
4. **Desempenho copiava o `managerId` nulo.** O participante recebia `managerId` do cadastro. Na abertura, `ensureAssignments` simplesmente não criava a tarefa `LEADER`, e `pendingParticipants` só considerava pendente quem tinha `managerId`. Resultado: com 4 autoavaliações e nenhum líder, encerrar a coleta não acusava pendência.
5. **Calibração aceitava "Confirmar" sem avaliação do líder.** O resultado ficava `CALIBRATED` (sem quadrante, evidência insuficiente) e a homologação, que só exigia `CALIBRATED`, passava. Não houve nota inventada nem Nine-Box com evidência insuficiente, mas o ciclo foi homologado sem a avaliação que o modelo pressupõe.

## B. Solução

Fonte única, sem cadastro novo e sem gravar dados derivados:

| Peça | Arquivo | Papel |
| --- | --- | --- |
| Resolvedor puro | `src/lib/orgHierarchy.ts` | `buildOrgHierarchy` → `resolve`, `directReports`, `descendants`, `leadershipChain`, `ledUnits`; motivo, origem, cadeia, alertas, candidatos |
| Carregador | `src/lib/orgHierarchy.server.ts` | 3 consultas (`Employee`, `HrDirectorate`, `HrDepartment`) e resolução em memória; `assignableManager` para atribuições |
| Equipes | `src/lib/peopleProfileHierarchy.server.ts` | `loadDescendantEmployeeIds` e `loadDirectReportIds` passam a usar a hierarquia efetiva |
| Relatório | `scripts/auditOrgHierarchy.ts` (`npm run audit:org-hierarchy`) | Somente leitura, para homologação |

Regras (detalhe no topo de `orgHierarchy.ts`):

- `managerId` explícito válido tem precedência: existe, está ativo, não é a própria pessoa e não fecha ciclo. Se divergir do organograma, vira alerta.
- Membro: líder do departamento; se for a própria pessoa, sobe.
- Líder: sobe de cada unidade que lidera (departamento superior → diretoria → diretoria superior) até achar outra pessoa.
- Quem acumula unidades: só contam as mais altas. Se as cadeias dão superiores diferentes, a resolução fica **ambígua**, com os candidatos listados. O sistema nunca escolhe o primeiro.
- Topo: a cadeia termina sem outra pessoa. Unidade superior inativa encerra a cadeia, com alerta (mesma convenção do organograma). O topo vem das relações cadastradas, nunca do nome da unidade.
- Líder desligado ou inexistente na cadeia não é pulado: fica pendente, com motivo. Ciclos entre unidades ou pessoas são detectados, com limite de profundidade de 64.

**Por que não gravar em `managerId`:** o cadastro zera o `managerId` de líderes de propósito, e as unidades mudam de líder sem tocar nos colaboradores. Gravar o derivado exigiria atualização em massa, ressincronização em toda mudança de unidade e criaria uma segunda verdade. A resolução na leitura custa 3 consultas leves por requisição de escopo e fica sempre atual.

## C. Arquivos

| Arquivo | Mudança |
| --- | --- |
| `src/lib/orgHierarchy.ts` (novo) | Resolvedor e textos |
| `src/lib/orgHierarchy.server.ts` (novo) | Carregador e `assignableManager` |
| `src/lib/peopleProfileHierarchy.server.ts` | Equipe direta e descendentes pela hierarquia efetiva (a checagem de ciclo do gestor explícito continua por CTE) |
| `src/lib/peopleProfile.server.ts` | Acesso `DIRECT_REPORTS`/`DESCENDANTS` e lista visível pela hierarquia efetiva; cabeçalho da ficha mostra o superior efetivo quando o cadastro não tem gestor |
| `src/lib/competencies/competency.server.ts`, `competencyRoutes.ts` | `DIRECT_REPORTS` pela hierarquia efetiva (injetável; teste antigo segue com `managerId`) |
| `server.ts` | Lista de colaboradores com `effectiveManager`; Desempenho e Competências com a equipe efetiva; participante do Desempenho com o superior efetivo e origem |
| `src/types/employee.ts`, `src/components/employee/EffectiveManagerNote.tsx` (novo), `src/components/EmployeeModule.tsx` | Formulário: líder vê "Superior hierárquico" e a origem (ou o motivo); a própria pessoa sai da lista de gestores |
| `src/lib/hrOrgChart.ts`, `hrOrgChart.server.ts`, `src/components/employee/HrOrgChartPage.tsx` | Card do líder: "Responde a …" ou "Superior não definido" |
| `src/lib/hrPerformance/performanceService.ts` | Abertura bloqueia elegível sem líder (`LEADER_MISSING`); falta de tarefa do líder conta como pendência; `syncParticipantLeaders`; calibrar sem avaliação do líder exige `acceptMissingLeader` (auditado `RESULT_CALIBRATED_WITHOUT_LEADER`, sem ajuste de posição); homologação confere (`LEADER_EVALUATION_REQUIRED`) |
| `performanceRoutes.ts`, `performanceDomain.ts`, `performanceState.ts`, `performanceClient.ts` | Rota `POST /cycles/:id/participants/sync-leaders`; origem `ORGANOGRAMA`; prévia com motivo; calibração com a exceção |
| `CycleDesk.tsx`, `PerformanceCalibrationTab.tsx`, `PerformanceTeamTab.tsx`, `PerformanceCyclePage.tsx` | Botão "Atualizar líderes"; aviso de abertura; caixa de exceção na calibração; diagnóstico de usuário sem vínculo |
| `scripts/auditOrgHierarchy.ts` (novo), `package.json`, `scripts/unit-test-files.txt` | Relatório e registro dos testes |
| Testes | `orgHierarchy.test.ts` (24), `orgHierarchy.integration.test.ts` (4, PostgreSQL), `hrOrgChart.test.ts` (+1), `peopleProfile.server.test.ts` (+1, fakes com o grafo), `performanceService.test.ts` (+4, Fabi sem líder agora precisa de líder para abrir), `performanceRoutes.test.ts` (calibração sem líder) |

## D. Migrations

Nenhuma. `HrPerformanceParticipant.managerSource` já é `TEXT`; o valor novo `ORGANOGRAMA` não exige mudança de schema. Nenhum dado é atualizado.

## E. Política para ciclos

| Situação do ciclo | O que acontece |
| --- | --- |
| Rascunho / preparado | Participantes entram com o superior efetivo. "Atualizar líderes" reaplica a hierarquia (exceção do RH preservada, auditado `LEADERS_SYNCED`). Abrir exige líder para todo elegível. |
| Aberto, consolidação, calibração | Nada muda sozinho. Troca de líder só por "Trocar líder", com motivo; a avaliação anterior fica inativa e preservada. |
| Homologado / encerrado | Avaliador e resultado da época ficam como estão. Nenhum ciclo existente é reescrito. |

O ciclo de homologação já homologado (4 participantes, 0 avaliações de líder) **não foi alterado**. Ele continua válido como registro histórico de piloto. A regra nova vale para os próximos ciclos e para ciclos ainda não homologados.

## F. Validação na homologação (somente leitura)

```bash
npm run audit:org-hierarchy -- --name="Eduardo Cardoso" --name="Joseane" --name="Paulo Pidluznyj"
```

Esperado com a estrutura descrita:

- José Eduardo Cardoso → Paulo Pidluznyj, origem "Diretoria Administrativa → líder da diretoria".
- Joseane Aparecida Correa → José Eduardo Cardoso, origem "Departamento Comercial → líder do departamento".
- Paulo: sobe da Presidência para a unidade superior cadastrada (ex.: Conselho). Se nenhuma unidade acima tiver outro líder, fica no **topo**. Se ele liderar unidades em cadeias com superiores diferentes, aparece como **ambíguo**, com os candidatos. Isso é uma decisão do RH, não do sistema.

O relatório também lista quem está pendente, ambíguo, em ciclo ou com o gestor do cadastro divergente do organograma.

## G. Desempenho

1. Ao adicionar pessoas ao ciclo, o servidor resolve o superior efetivo e grava no participante `managerId` (id do **colaborador** avaliador, não do usuário) e `managerSource` (`ORGANOGRAMA` ou `CADASTRO`).
2. Antes de abrir, "Atualizar líderes" reaplica a hierarquia; a prévia mostra o motivo de quem ficou sem líder.
3. Na abertura, cada elegível recebe a tarefa `LEADER` para esse colaborador. Se faltar líder, o ciclo não abre e mostra os nomes.
4. "Minha equipe" lista as tarefas cujo `evaluatorEmployeeId` é o colaborador ligado ao usuário. O escopo de equipe usa a hierarquia efetiva, então o diretor vê os líderes de departamento. Usuário sem vínculo recebe o aviso para pedir o vínculo ao RH.

## H. Implantação

1. Merge na `main` depois da revisão.
2. Deploy normal (`scripts/deploy-server-main-update.sh`). Não há migration nem seed.
3. Na homologação, rodar `npm run audit:org-hierarchy` e conferir os casos da seção F. Resolver com o RH as linhas ambíguas ou pendentes, ajustando a liderança das unidades em Estrutura organizacional.
4. Conferir "Responde a …" no Organograma, o "Superior hierárquico" no cadastro de um líder e "Minha equipe" com um usuário líder.
5. Produção: mesmo deploy. O relatório pode rodar antes, em leitura, para antecipar pendências.

Rollback: voltar o commit. Não há dado a desfazer.

**Mudança de visibilidade a comunicar:** líderes com escopo de equipe (`employees.team.view` / `employees.team.descendants.view`) passam a ver os líderes das unidades subordinadas e as equipes deles (Pessoas/RH, Competências, Desempenho). Esse é o comportamento hierárquico esperado, mas amplia o que um diretor via antes.
