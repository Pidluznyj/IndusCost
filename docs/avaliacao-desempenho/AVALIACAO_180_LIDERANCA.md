# Avaliação 180° de liderança

Branch `feat/performance-leadership-180`, criado sobre `feat/performance-cycle-lifecycle`, que por sua vez está sobre `fix/org-hierarchy-effective-manager`. Desenvolvido e testado só localmente, em banco descartável. Nada foi aplicado em homologação nem em produção. As competências, os textos e os limites abaixo são **proposta em validação com o RH**, não política aprovada.

## 1. O que é

Quem lidera pessoas recebe, no mesmo ciclo da avaliação individual, uma avaliação de liderança em três perspectivas, sobre as mesmas oito competências e a mesma escala de 1 a 4:

| Perspectiva | Quem responde | Tarefa (`kind`) |
| --- | --- | --- |
| Autoavaliação de liderança | O próprio líder | `LEADERSHIP_SELF` |
| Avaliação da equipe | Cada liderado direto elegível no ciclo | `LEADERSHIP_UPWARD` |
| Avaliação do superior | O superior efetivo do líder | `LEADERSHIP_SUPERIOR` |

A liderança **não entra na Nine-Box** nem no resultado individual. Tem calibração, homologação, documento e bloco de painel próprios.

### Quem é líder

Quem tem pelo menos um liderado direto **ativo** na hierarquia efetiva (`docs/hr/hierarquia-efetiva.md`). A regra é lida do cadastro e do organograma na **abertura do ciclo**. O sistema grava um retrato em cada participante (`isLeader`, `directReportCount`, `leadershipSnapshotAt`), e mudanças posteriores no organograma não reescrevem o ciclo aberto. Quem está no topo da estrutura (`managerSource = TOPO`) é líder sem superior e não bloqueia a abertura por falta de líder.

Sem organograma, o sistema **não presume** topo: a pessoa sem gestor fica "sem líder" e a abertura pede a correção (`LEADER_MISSING`), como antes.

## 2. Competências propostas (LD-01 a LD-08)

Clareza, Respeito, Comunicação, Apoio, Justiça, Feedback, Desenvolvimento e Exemplo. Cada competência tem um comportamento observável e três frases, uma por perspectiva. Muda só o sujeito: "Eu…", "Meu líder…", "A pessoa…". O RH edita os textos no modelo de liderança enquanto ele está em rascunho. Depois de publicado, o modelo fica somente leitura; para mudar, cria-se nova versão.

Regras do modelo (`rules.leadership`, com padrão em `PROPOSED_LEADERSHIP_RULES`):

| Regra | Padrão | Limite |
| --- | --- | --- |
| Mínimo de respostas da equipe para divulgar a média (`minRespondents`) | 5 | nunca abaixo de 3 |
| Letras mínimas do comentário em nota 1 ou 4 (`commentMinLetters`) | 15 | — |
| Divergência que pede justificativa na calibração (`divergenceThreshold`) | 1,5 ponto | — |

## 3. Decisões aprovadas pelo RH para esta versão

Aprovadas em conversa com o RH antes da implementação, como recomendações para o piloto:

1. **Comentário da equipe:** fica guardado, mas **ninguém lê** no sistema: nem o líder, nem o superior, nem o RH, nem o SUPER_ADMIN. Líder e calibrador veem só agregados.
2. **Média da equipe:** só aparece com 5 ou mais respostas válidas, por líder e por competência. O mínimo é configurável no modelo e nunca fica abaixo de 3.
3. **Nota calibrada:** inteira de 1 a 4, decidida pelo superior com justificativa. Não é média automática.
4. **Índice geral:** média simples das competências com dado válido, mostrada com a cobertura. Falta de dado nunca conta como zero.

## 4. Fluxo

1. **Modelo.** O RH cria um modelo de liderança (já nasce com LD-01..LD-08), revisa os textos e publica.
2. **Ciclo.** Na criação do ciclo (ou até a preparação), o RH escolhe o modelo de liderança. Sem ele, o ciclo funciona como antes, sem 180°.
3. **Abertura.** O retrato da hierarquia efetiva é gravado e as tarefas de liderança são criadas (`LEADERSHIP_ASSIGNMENTS_CREATED` na auditoria). Liderado fora do ciclo não recebe tarefa.
4. **Jornada no celular**, no mesmo convite (QR) e na mesma sessão, sem novo código:
   - autoavaliação individual, sempre primeiro;
   - avaliação do meu líder, se a pessoa tem líder que também está no ciclo;
   - minha liderança, se a pessoa é líder.

   A tela mostra "Etapa X de Y". A sessão só termina depois da última etapa. Se a pessoa fecha no meio, a próxima abertura retoma a etapa pendente. A etapa já enviada não volta.
5. **Comentário obrigatório.** Nota 1 ou 4 pede um comentário que descreva um comportamento observado (15 letras, sem repetição artificial). O rascunho é salvo no toque, mesmo antes do comentário, e o botão "Próxima" só libera com comentário válido. O servidor confere de novo no envio.
6. **Superior.** Na aba "Minha equipe", o superior avalia a liderança de cada líder direto, com o mesmo critério de comentário.
7. **Encerramento da coleta.** A média da equipe só passa a existir com a coleta encerrada (consolidação ou calibração) e com a amostra mínima.
8. **Calibração.** O superior (na aba "Minha equipe") ou o RH com permissão de calibração (na aba "Calibração") veem as três perspectivas lado a lado e definem a nota calibrada de cada competência. Pede justificativa quando a nota é extrema, difere do superior ou se afasta da média da equipe, e sempre pede fundamentação geral. Sem autoavaliação ou sem avaliação do superior (por exemplo, no topo da estrutura), a calibração só passa com **exceção registrada** e motivo, e o status fica `EXCEPTION`. Cada nova calibração cria uma versão; a anterior fica inativa.
9. **Homologação.** O ciclo com 180° só homologa com todos os líderes elegíveis calibrados (`LEADERSHIP_CALIBRATION_REQUIRED`). Na homologação, os resultados de liderança ficam oficiais. Uma reversão da homologação os desmarca.
10. **Documento e PDI.** O documento "Avaliação de liderança (180°)" é emitido pelo superior ou pelo RH, só depois da calibração. Mostra as perspectivas, a nota calibrada, a síntese e as regras, e nunca os comentários da equipe. O PDI de quem é líder no ciclo aceita ação ligada a uma competência LD; para quem não é líder, essa ligação é recusada (`INVALID_COMPETENCY`).
11. **Painel.** Bloco "Liderança (180°)", separado da Nine-Box: líderes, calibradas, exceções, homologadas e avaliações da equipe. A média por competência só aparece com o mínimo de lideranças calibradas.

## 5. Confidencialidade (como está garantida)

| Garantia | Onde |
| --- | --- |
| Comentário da equipe nunca é serializado | `storedOf` devolve só tipo e nota; nenhuma rota lê `evidence` de tarefa `LEADERSHIP_UPWARD`. Teste de varredura das rotas em `performanceLeadershipService.test.ts`; E2E 9.17 confere RH, superior e líder. |
| Resposta individual da equipe não sai | `teamPerspective` devolve só médias, e só com coleta encerrada e amostra mínima. Abaixo do mínimo: "Amostra insuficiente para divulgação", sem número (E2E 9.11/9.11b). |
| Líder não abre a avaliação da equipe nem a própria comparação | `GET /assignments/:id` responde 403 para `LEADERSHIP_UPWARD` e `LEADERSHIP_SELF` fora do portal; a comparação exige ser o superior ou o RH (E2E 9.08). |
| RH não responde pela pessoa | Gravação de `LEADERSHIP_UPWARD` e `LEADERSHIP_SELF` só pela própria pessoa no portal, ou no modo assistido. |

**Limite conhecido:** no modo assistido (aparelho da empresa, aberto pelo RH), quem ajuda vê a tela enquanto a pessoa responde, inclusive a avaliação do líder. Isso é inerente ao modo e está registrado como pendência de RH/LGPD: definir se a avaliação da equipe pode ser assistida e por quem.

## 6. Modelo de dados

Migration `20261023120000_hr_performance_leadership_180`, aditiva: só `ADD COLUMN` com padrão, `CREATE TABLE`, índices e chaves novas. Aplicar depois de `20261022120000_hr_performance_cycle_lifecycle` e **antes** do código.

| Tabela | Mudança |
| --- | --- |
| `HrPerformanceModel` | `kind` (`INDIVIDUAL` padrão, `LEADERSHIP`) |
| `HrPerformanceQuestion` | `upwardText` (frase da equipe) |
| `HrPerformanceCycle` | `leadershipModelId` (FK, `RESTRICT`) |
| `HrPerformanceParticipant` | `isLeader`, `directReportCount`, `leadershipSnapshotAt` |
| `HrPerformanceAssignment` | `subjectParticipantId` (o líder avaliado pela equipe; FK `CASCADE`) e `modelId` (FK) |
| `HrPerformanceLeadershipResult` (nova) | versões da calibração: notas, justificativas, fundamentação, exceção, fontes, amostra, oficial. Índice único parcial: uma versão ativa por pessoa. |

Dados existentes não mudam: modelos ficam `INDIVIDUAL`, ciclos ficam sem liderança, participantes ficam `isLeader = false`.

## 7. Código

| Arquivo | Papel |
| --- | --- |
| `src/lib/hrPerformance/performanceLeadership.ts` | Regras puras: competências, comentário, perspectivas, comparação, índice, justificativas. |
| `src/lib/hrPerformance/performanceLeadershipService.ts` | Modelo, retrato e tarefas na abertura, jornada, respostas, superior, calibração, homologação. |
| `performanceService.ts`, `performanceRoutes.ts`, `performanceInsights.ts` | Integração com abertura, portal, homologação, documento, painel e PDI. |
| `src/components/hrPerformance/PerformanceLeadershipUi.tsx` | Telas de modelo, superior e calibração. |
| `PerformancePortalPage.tsx` | Jornada em etapas e comentário. |
| `PerformanceReportDocument.tsx` | Documento de liderança. |

Rotas novas: `POST /models/leadership`, `PUT /models/:id/leadership-questions/:code`, `PUT /cycles/:id/leadership`, `GET /cycles/:id/leadership`, `GET /participants/:id/leadership`, `POST /participants/:id/leadership/calibration`.

## 8. Testes

| Camada | Cobertura |
| --- | --- |
| Unitários puros (`performanceLeadership.test.ts`) | comentário, amostra mínima, índice com cobertura, justificativas, pontos fortes e prioridades. |
| Serviço (`performanceLeadershipService.test.ts`) | abertura com retrato, jornada em etapas, rascunho × envio, confidencialidade (inclusive varredura das rotas), calibração com e sem exceção, homologação, documento e PDI. |
| Módulo inteiro | `npx tsx --test src/lib/hrPerformance/*.test.ts`: 93/93. |
| Navegador (Chrome real, local) | `scripts/performance-e2e/part9-leadership-180.mjs`: 18 passos, mais `check180.mts` com 10 conferências de integridade no PostgreSQL. Ver `EVIDENCIAS_TESTES.md`. |

Como repetir o roteiro de navegador (só banco local):

```bash
npx tsx scripts/performance-e2e/resetModuleData.mts
npx tsx scripts/seedPerformanceLocalDemo.ts
npx tsx scripts/performance-e2e/seedLeadership180.mts
node scripts/performance-e2e/part9-leadership-180.mjs
npx tsx scripts/performance-e2e/check180.mts
```

Com `DATABASE_URL` local, `PERF_DEMO_PASSWORD` e o servidor local na porta 3100 (`PERFORMANCE_CYCLE_ENABLED=1` só no processo).

## 9. Implantação (quando autorizada)

1. Homologação primeiro. Produção só com autorização expressa.
2. Backup, depois `prisma migrate deploy`: aplica `20261022120000` e `20261023120000` antes do código.
3. Rodar `npm run audit:org-hierarchy` e corrigir líderes ambíguos ou sem gestor **antes** de abrir um ciclo com 180°. O retrato da abertura depende dessa estrutura.
4. Criar e publicar o modelo de liderança com os textos validados pelo RH. Criar um ciclo **de teste** com 180° e repetir o roteiro com dados fictícios.
5. Rollback: o código anterior ignora as colunas novas. A migration é aditiva e não precisa ser revertida.

## 10. Pendências

- RH: validar as oito competências, as frases e os três limites (5 respostas, 15 letras, 1,5 ponto).
- RH/LGPD: base legal e aviso sobre o comentário guardado e não lido; prazo de retenção; se a avaliação da equipe pode ser assistida.
- RH: o líder recebe o resultado hoje pelo documento emitido pelo superior na devolutiva; não há tela própria para ele. Decidir se haverá.
- RH: se o topo da estrutura deve ter avaliação de liderança por outra pessoa (conselho, diretoria) em vez de exceção.
