# Inclusão de participantes por hierarquia

Branch local sobre a `main` (`c397e62`). Desenvolvido e validado só localmente, com dados fictícios. Nada foi aplicado em homologação nem em produção; não há migration.

## 1. Diagnóstico do que já existia

| Peça | Onde | O que faz | Decisão |
| --- | --- | --- | --- |
| Hierarquia efetiva (fonte única) | `src/lib/orgHierarchy.ts` + `orgHierarchy.server.ts` | `resolve` (superior efetivo, origem, status, avisos), `directReports`, `descendants`, `leadershipChain`; lê `Employee.managerId`, `HrDepartment.leaderEmployeeId/parentDepartmentId`, `HrDirectorate.leaderEmployeeId/parentDirectorateId` | **Reutilizada.** Nenhuma segunda árvore foi montada |
| Cadastro para o ciclo | `server.ts` → `loadEmployees` | Devolve cada pessoa já com o superior efetivo (`managerId`, `managerSource`, `managerNote`) | Reutilizado |
| Retrato de liderança | `loadDirectReportsSnapshot` | Liderados diretos **ativos** pela organização inteira (regra oficial de "é líder") | Reutilizado na prévia e na inclusão |
| Prévia de elegibilidade | `POST /cycles/:id/participants/preview` | `classifyEligibility` + sinais de afastamento e mudança de função/setor | Mesma regra reutilizada |
| Inclusão | `POST /cycles/:id/participants` → `applyParticipants` | Só adiciona; deduplica por `employeeId`; reativa quem foi retirado; grava `managerId`/`managerSource` do cadastro; auditoria | **Estendida**, não substituída |
| Snapshot de liderança | `applyLeadershipSnapshot` na abertura | `isLeader`, `directReportCount`, `leadershipSnapshotAt` | Agora também gravado na inclusão; a abertura refaz |
| Mudanças de estrutura depois da abertura | `reassignLeader` (troca com motivo, versão anterior preservada), `syncParticipantLeaders` (só antes da abertura) | Já cobria o fluxo formal de substituição | Mantido |

## 2. O que mudou

### Serviço (puro): `src/lib/hrPerformance/performanceHierarchyInclusion.ts`
- `resolveInclusionScope`: quem entra por modo — `DIRECT` (líder + diretos), `TREE` (líder + descendentes), `REPORTS_ONLY` (só diretos), `INDIVIDUAL`, `ALL`. Só pessoas ativas, sem repetição, pela hierarquia efetiva.
- `buildHierarchyPreview`: por pessoa, cargo, setor, diretoria, superior efetivo e origem, aviso da hierarquia, `isLeader` (organização inteira) e quantidade de liderados, elegibilidade com motivo, situação (entra, já participa, volta ao ciclo) e "superior fora do ciclo". Resumo: encontradas, elegíveis, não elegíveis, evidência insuficiente, já incluídas, novas, líderes, sem superior, inconsistências. **Nunca grava.**
- `previewToken`: assinatura (SHA-256) de quem está no recorte, com qual superior, se lidera e a elegibilidade. Não inclui "já participa", para a mesma confirmação repetida ser idempotente.

### Rotas (`performanceRoutes.ts`)
- `POST /api/hr/performance/cycles/:id/participants/hierarchy/preview` — prévia; `400` sem modo ou sem líder; `409 CYCLE_FROZEN` fora de rascunho/preparado; `403` para `ALL` sem RH Gestor.
- `POST /api/hr/performance/cycles/:id/participants` — a rota existente aceita `{ hierarchy: { mode, leaderEmployeeId, token, confirmAll }, exceptions }`. O servidor refaz a prévia com a hierarquia atual e compara a assinatura: `409 PREVIEW_STALE` se a estrutura ou a elegibilidade mudou. Depois chama o mesmo `applyParticipants`, dentro do `mutateAdmin` (reaplica em conflito de gravação). Sem `hierarchy`, a rota continua igual (seleção individual), agora também gravando o retrato de liderança.
- Dependência nova: `loadHierarchyReader` (hierarquia efetiva + ativos), ligada no `server.ts`.

### `applyParticipants`
- `leadershipSnapshot` opcional grava `isLeader`, `directReportCount` e `leadershipSnapshotAt` na inclusão.
- `source` opcional muda a auditoria para `PARTICIPANTS_INCLUDED_BY_HIERARCHY` com modo, líder de referência, quantidade solicitada, incluída, duplicadas e exceções.

### Tela (`HierarchyAddOverlay.tsx`, botão "Adicionar por hierarquia" na mesa do ciclo)
Selecionar líder (busca por nome, cargo ou setor) → abrangência → prévia (indicadores + tabela) → "Confirmar inclusão de X participante(s)". Exceção do RH por pessoa na própria prévia (motivo, 8+ caracteres). "Toda a organização" só aparece para RH Gestor/SUPER_ADMIN e exige digitar "TODA A ORGANIZAÇÃO". Prévia desatualizada volta ao passo anterior com a mensagem. "Incluir pessoas" (seleção individual) continua como estava.

## 3. Regras

| Tema | Regra |
| --- | --- |
| Superior | Cada pessoa entra com o **próprio** superior efetivo. Incluir a árvore de Paulo não torna Paulo avaliador de Joseane; Joseane continua com José Eduardo |
| Líder | `isLeader` = tem liderado direto ativo na organização, mesmo que o liderado não esteja no ciclo. Cargo não entra |
| Elegibilidade | A regra existente (ativo, admissão ≥ observação mínima, afastamento, mudança de função/setor, exceção do RH). Estar abaixo do líder não torna ninguém elegível |
| Deduplicação | Por `employeeId`; árvores sobrepostas, repetição da prévia, clique duplo e requisições simultâneas resultam em `added = 0` para quem já está. Uma tarefa por pessoa e tipo (índice único já existente) |
| Snapshot | `managerId`, `managerName`, `managerSource`, `isLeader`, `directReportCount`, `leadershipSnapshotAt` na inclusão; a abertura refaz o retrato e congela (`frozen`) |
| Mudança de estrutura depois da abertura | Nada muda sozinho. Respostas enviadas ficam com o avaliador da época; tarefa pendente só muda por "Trocar líder" (motivo e auditoria). Ciclo homologado não muda |
| Líder fora do ciclo | A prévia avisa; o superior **não** é trocado. Com 180° a prontidão bloqueia a abertura; sem 180° só avisa (o líder avalia, mas não é avaliado). Nos dois casos oferece "Incluir os líderes" |
| Permissões | Preparar ciclo (`admin.employees.performance.cycles:manage` ou o `manage` anterior); `ALL` exige também homologação (RH Gestor) ou SUPER_ADMIN. Validado no servidor |

## 4. Testes

| Suíte | Cobertura |
| --- | --- |
| `performanceHierarchyInclusion.test.ts` (8) | abrangências; prévia sem gravação; superior preservado; `isLeader` pela organização; líder sem liderados; sem unidade; desligado fora; elegibilidade real; líder fora; já incluído; árvores sobrepostas; assinatura muda com a estrutura; rotas: prévia não grava, confirmação concorrente, idempotência, auditoria, `PREVIEW_STALE`, `PREVIEW_REQUIRED`, `CYCLE_FROZEN`, líder sem acesso, `ALL` só com RH Gestor e confirmação reforçada; abertura com 180° sem tarefas duplicadas e superior correto |
| Hierarquia (`orgHierarchy.test.ts`, 24 + integração 4) | múltiplas unidades, ciclos, referência inválida, estrutura incompleta (já existentes) |
| Navegador, parte 13 (`part13-hierarchy-add.mjs`) | Testes A, B, C, D e E com a cadeia fictícia Carla → Bruno → equipe; prévia desatualizada; RH Operacional sem `ALL` |

Rollback transacional: a gravação é uma única escrita do grafo (`store.write`), aplicada ou não; não há gravação parcial.

## 5. Validação em homologação (a fazer)

Cadeia real: Paulo Pidluznyj → José Eduardo Cardoso → Joseane Aparecida Correa. Usar um ciclo **de teste** novo; não tocar no ciclo "Teste homologação".

1. `npm run audit:org-hierarchy` sem ambiguidade na cadeia.
2. Criar ciclo de teste; "Adicionar por hierarquia" → José Eduardo → líder + diretos → prévia: José (líder, superior Paulo) e Joseane (sem liderados, superior José) → confirmar (Teste A).
3. No mesmo ciclo, Paulo → líder + toda a estrutura → prévia mostra José e Joseane como "Já participa", demais pessoas abaixo de Paulo como "Entra"; Joseane continua com José (Teste B). Confirmar; confirmar de novo: `0` incluídos (Teste C).
4. Conferir no banco (`HrPerformanceParticipant`): `managerId`, `managerSource`, `isLeader`, `directReportCount`, `leadershipSnapshotAt` (Teste D).
5. Não abrir o ciclo nem emitir convites para pessoas reais sem autorização do RH.

## 6. Pendências e riscos

- Modo `ALL` em organizações grandes: a prévia lista todo mundo (limite de 5000); para volumes maiores, paginar a tabela.
- A origem "Gestor do cadastro" aparece quando `Employee.managerId` é válido; o organograma só entra quando não há gestor explícito (regra da hierarquia efetiva). Se o RH quiser o inverso, é decisão de hierarquia, não desta tela.
- Quem avalia o topo continua decisão do RH (prontidão avisa).
