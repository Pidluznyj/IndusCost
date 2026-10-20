# Hierarquia efetiva de liderança — diagnóstico, regra e correção

Análise de 20/10/2026 sobre o resolvedor central (`src/lib/orgHierarchy.ts`), feita só com código e dados fictícios. Nenhum banco de produção foi alterado; a auditoria de produção é somente leitura e fica a cargo de quem tem acesso.

## 1. Diagnóstico do resolvedor

O resolvedor já era a fonte única (cadastro, Desempenho, organograma, Competências, Minha equipe, inclusão por hierarquia e prontidão leem dele). Conferido caso a caso contra a regra pedida:

| Regra pedida | Como estava | Situação |
| --- | --- | --- |
| Pular a própria pessoa ao subir a cadeia | `climb` já ignorava a unidade cujo líder é a própria pessoa | ✓ |
| Camadas repetidas da mesma pessoa não criam outro nível | `topmostLed` descarta unidades lideradas que estão abaixo de outra liderada pela mesma pessoa (Montagem sob Fabricação, Administrativa sob Presidência) | ✓ |
| Um superior por colaborador; membro de unidade responde ao líder dela | `climb` com origem na unidade; um resultado por pessoa | ✓ |
| Gestor explícito válido prevalece, com divergência registrada | primeira passada | ✓ |
| Ciclos de unidades e de pessoas detectados; sem laço infinito | `ancestors` com `seen` e `MAX_DEPTH`; segunda passada `findCycle` | ✓ |
| Ambiguidade não escolhe um superior arbitrário | `AMBIGUOUS` com os candidatos | ✓ |
| **Liderados diretos só ativos** | `directReports` incluía pessoas desligadas cujo superior efetivo é a pessoa | **corrigido** |
| **Pessoa que lidera diretoria e departamentos de cadeias diferentes** | virava `AMBIGUOUS` mesmo quando a posição mais alta era clara | **corrigido** |

## 2. Causa-raiz do que se via

Não havia duplicação de tarefas (as tarefas são por `employeeId` e ciclo, com índice único por pessoa e tipo). O que podia aparecer:
1. **Contagem de liderados** diferente entre telas quando havia gente desligada abaixo do líder: o resolvedor contava a pessoa; o retrato da abertura não. Agora o resolvedor só conta ativos, e todos os consumidores batem.
2. **Conflito indevido** para quem lidera uma diretoria e também um departamento ligado a outra diretoria: dois candidatos diferentes, sem decisão. Agora a posição mais alta (diretoria) define o superior e o departamento fica registrado como alerta `LOWER_UNIT_CHAIN_IGNORED`.
3. No **organograma administrativo**, a mesma pessoa aparece em cada unidade que lidera. Isso é correto para o organograma e não entra na avaliação, que é entre pessoas.

## 3. Algoritmo (como está)

Para cada colaborador:
1. **Gestor explícito** (`Employee.managerId`): se existe, está ativo e não é a própria pessoa, prevalece. Divergência do organograma vira alerta. Se fecha ciclo entre pessoas, é ignorado e volta ao organograma.
2. **Líder de unidades**: das unidades que lidera (ativas), ficam só as mais altas que não estão abaixo de outra liderada por ela (consolida camadas repetidas). Entre elas, só as do tipo mais alto (diretoria sobre departamento). Para cada uma, sobe pelos pais (departamento → departamento pai → diretoria → diretoria pai), pulando unidades cuja liderança é a própria pessoa, até o primeiro líder ativo e distinto. Resultados iguais → `RESOLVED`; diferentes → `AMBIGUOUS` com candidatos; sem ninguém acima → `TOP`.
3. **Membro de departamento**: líder do próprio departamento; se é a própria pessoa, sobe como acima.
4. **Sem departamento, sem liderança e sem gestor**: `UNRESOLVED / NO_PLACEMENT`.
5. Referência inválida (líder inexistente ou desligado, departamento inexistente ou inativo): `UNRESOLVED` com o motivo; não se pula para o próximo.
6. **Liderados diretos** = pessoas ativas cujo superior efetivo é a pessoa (cada uma uma vez). **Líder** = tem pelo menos um liderado direto. Independe de qualquer ciclo.

Rastreabilidade devolvida por pessoa: `status`, `managerId`, `source`, `unit`, `path`, `reason`, `warnings`, `candidates`, `ledUnits`.

## 4. Casos da estrutura real (fixture no formato da produção)

`src/lib/orgHierarchy.production.test.ts` (13 casos) + `orgHierarchy.test.ts` (24) + integração PostgreSQL (4):

| Caso | Resultado |
| --- | --- |
| Fabricação e Montagem → Alexsandro, uma vez; Alexsandro → líder da diretoria Fabricação | ✓ |
| Expedição → Andresa; Andresa → Alexsandro (departamento pai); equipe da Expedição não liga direto a Alexsandro | ✓ |
| Presidência e Administrativa + Compras, Financeiro e RH → Paulo responde ao Conselho, sem autogestão, sem conflito | ✓ |
| Comercial: Joseane → José → Paulo | ✓ |
| Engenharia e Ferramentaria + diretoria Fabricação → Carlos responde a Paulo, uma vez | ✓ |
| Topo (Sidney) é ausência legítima | ✓ |
| Líder sem `managerId` não é erro; líder = tem liderado ativo | ✓ |
| Desligado não conta como liderado | ✓ |
| Diretoria + departamento de outra cadeia: diretoria decide, com alerta | ✓ |
| Dois departamentos irmãos sem diretoria comum: `AMBIGUOUS`, sem escolher | ✓ |
| Líder desligado: referência inválida | ✓ |
| Ciclo de unidades detectado; membros continuam com o líder da unidade | ✓ |
| Gestor explícito prevalece e liderados seguem o superior efetivo | ✓ |

As 180° (uma autoavaliação de liderança por líder, uma ascendente por liderado, uma avaliação do superior) e a deduplicação por `employeeId` já são cobertas em `performanceLeadershipService.test.ts` e `performanceHierarchyInclusion.test.ts`.

## 5. Auditoria somente leitura

`npm run audit:org-hierarchy` (ou `npx tsx scripts/auditOrgHierarchy.ts`), agora com **todos os ativos**, a classificação pedida (`CORRETO`, `TOPO_HIERARQUICO`, `CONFLITO`, `SEM_SUPERIOR`, `REFERENCIA_INVALIDA`, `CICLO_HIERARQUICO`), gestor do cadastro, unidade, líder da unidade, liderança superior, superior efetivo, origem, caminho, liderados diretos, líder, topo, conflito, candidatos, alertas e data de referência. `--csv` e `--json` para exportar; `--name=` para filtrar. Só `findMany`: pode rodar em produção.

Quem não tem `managerId` mas lidera unidade sai como `CORRETO` ou `TOPO_HIERARQUICO`, nunca como inconsistência por isso.

## 6. Impacto sobre ciclos existentes

Nenhum. O retrato de cada ciclo (`managerId`, `managerSource`, `isLeader`, `directReportCount`, `leadershipSnapshotAt`) fica como foi gravado; só ciclos novos (ou "Atualizar líderes" antes da abertura, ou "Trocar líder" com motivo depois) leem o resolvedor corrigido. Não há migration.

## 7. Validação em homologação (a fazer)

1. `npm run audit:org-hierarchy --csv > hierarquia.csv` em homologação e em produção (leitura): conferir Alexsandro, Andresa, Paulo, José e Carlos contra a seção 4.
2. Ciclo de **teste** novo em homologação: "Adicionar por hierarquia" → Alexsandro, líder + árvore → prévia com Fabricação e Montagem sob Alexsandro, Expedição sob Andresa, Andresa sob Alexsandro; abrir; conferir no banco uma tarefa `LEADER` por pessoa, uma `LEADERSHIP_UPWARD` por liderado, uma `LEADERSHIP_SELF` por líder.
3. Não abrir ciclo oficial nem emitir convites a pessoas reais sem aval do RH.

## 8. Riscos residuais

- Se em produção um departamento liderado por Paulo estiver ligado a uma diretoria que **não** é dele, a regra "diretoria decide" faz Paulo responder ao Conselho e registra o alerta; a auditoria mostra. Se o RH preferir outro desenho, é decisão de organograma, não do resolvedor.
- Líder de unidade desligado continua como referência inválida (não se pula). É proposital: exige correção no cadastro.
