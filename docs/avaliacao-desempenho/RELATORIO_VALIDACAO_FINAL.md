# Relatório de validação final — Avaliação de Desempenho, Cultura e Potencial

Data da revisão: 16/10/2026.  
Ambiente: Windows 10 local, repositório IndusCost, branch `feat/desempenho-cultura-potencial`, HEAD ainda `9d833ade4547cecd1871d26067aff141a375ca87` (nenhum commit desta entrega).  
Banco: a migration não foi aplicada. Nenhum `migrate`, backfill, Nomus, SSH, cron ou deploy.

## Veredito

**NÃO APTO PARA PILOTO LOCAL** com operadores de RH.  
**NÃO APTO para homologação institucional.**  
**NÃO APTO para produção.**

A jornada cabe na tela: ciclo, pessoas, convite com QR, código falado fora da folha, preenchimento assistido, calibração, devolutiva, PDI e PDF. Continua faltando passagem no navegador, editor completo das 12 perguntas, troca de líder sem digitar o identificador interno e o PDF no layout institucional de impressão. A migration não foi aplicada. As flags seguem em `0`. Abrir o ciclo não depende mais de editar arquivo: a tela pede confirmação de que a regra ainda é proposta.

O motor de regras, o RBAC e o portal têm testes automatizados e as flags nascem desligadas. Um operador não consegue, só pela tela, escolher participantes, imprimir o convite, calibrar, registrar devolutiva ou acompanhar PDI. As regras de corte, os textos e o canal de identidade continuam proposta. Isso impede tratar o módulo como piloto operacional.

NENHUMA ALTERAÇÃO EM PRODUÇÃO EXECUTADA NESTA AUDITORIA.

## Métricas

| Status | Quantidade |
| --- | ---: |
| PASS | 3 |
| PARTIAL | 36 |
| FAIL | 0 |
| BLOCKED | 1 |
| Total | 40 |

PASS aqui significa: a regra da RFC está no código e um teste que passou cobre o comportamento. Não significa homologação de RH.

### Atualização da mesma data, após a primeira auditoria

- Gravação Prisma só entra se `HrPerformanceGraphLock.revision` for a mesma lida. A segunda gravação concorrente recebe 409. Auditoria e check-in não são apagados nessa gravação.
- A tela do ciclo seleciona pessoas, gera convite, mostra o código para falar, imprime o QR sem esse código, abre o preenchimento assistido, pede revisão, valida, calibra, registra devolutiva e PDI, e baixa PDF.
- Encerrar a coleta com pendência exige confirmação (`PENDING_ASSIGNMENTS`).
- Abrir o ciclo com a flag institucional desligada exige confirmação na tela de que a regra ainda é proposta (`pilotAck`). Sem essa confirmação o teste continua vendo `GOVERNANCE_BLOCKED`.
- Testes do módulo nesta passagem: 21 passaram, 0 falharam, incluindo o PDF e o piloto com código falado.
- Não houve teste de navegador. `npx prisma generate` rodou. A migration não foi aplicada. Nenhum commit.

## Tabela RFC

| RFC | O que está coberto | Onde | Teste | Status | Risco | Correção mínima |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | Snapshot aponta para `Employee`. Sem cadastro paralelo. | `prisma/schema.prisma` modelos `HrPerformance*`; migration `20261016180000_hr_performance_cycle` | migration: cria tabelas, FK em Employee, sem `ALTER` em Employee ou avaliação de experiência | PARTIAL | Migration não aplicada; matrícula no snapshot fica nula porque o cadastro não tem número próprio | Aplicar só em banco descartável quando autorizado |
| 002 | Gestor, cargo e setor congelados no participante. Fila do líder exclui o próprio e quem está fora do escopo. | `performanceService.ts` `leaderQueue`; `performanceAccess.ts` | rotas: IDOR `tarefa-alheia` negado | PARTIAL | Mudança de gestor no meio do ciclo não tem tela de realocação | Tela de troca de avaliador com auditoria |
| 003 | Chaves `employees.performance.view/evaluate/manage/calibration/reports/invites/conduct`. Deny vence. | `permissionCatalog.ts`, `resources.ts`, `performanceRoutes.ts` | rotas: sem manage = 403; deny vence allow | PARTIAL | Várias ações só existem na API | Ligar cada ação a um botão com a mesma permissão |
| 004 | Histórico do ciclo na ficha, acima da avaliação de experiência. Conduta não entra nessa seção. | `PeoplePerformanceHistorySection.tsx`, `PeopleEmployeeProfileDialog.tsx` | não há teste de componente | PARTIAL | Aba depende da flag e da API | Conferir a ficha com a flag ligada e desligada |
| 005 | Pilares Técnico, Cultura e Potencial independentes. | `performanceDomain.ts` `PILLARS` | domínio: 4 perguntas por pilar | PARTIAL | Editor não mostra o pilar como bloco editável | Grade do modelo com os três blocos |
| 006 | 12 textos provisórios. Modelo nasce em validação. | `PROPOSED_BASE_QUESTIONS` | domínio: 12 itens e `proposal` | PARTIAL | Redação não é a oficial — o RFC não a traz | RH substituir os textos no rascunho antes de qualquer ciclo real |
| 007 | Escala de frequência e “não sei” diferente de zero e de pendente. | `FREQUENCY_SCALE`, `parseAnswer` | domínio: N/A não vira 0 | PASS | Corte ainda é proposta | Nenhuma no código até o RH mudar o rótulo |
| 008 | Campo `hint` por pergunta. | `updateDraftQuestion` | serviço: texto curto é recusado | PARTIAL | Não há exemplos por cargo | Catálogo opcional de dica, sem segundo cadastro de função |
| 009 | Publicado é imutável; alterar exige nova versão rascunho. | `publishModel`, `updateDraftQuestion` | serviço: snapshot imutável | PARTIAL | Tela só cria, lista e publica | Duplicar, editar texto e prévia na tela |
| 010 | Estados do rascunho até encerrado. Volta só com motivo. Abrir exige flag de publicação. | `performanceDomain.ts` transições; `transitionCycle` | serviço: `GOVERNANCE_BLOCKED` | PARTIAL | Tela só oferece Preparar e Abrir | Botões das fases seguintes, todos com motivo na volta |
| 011 | Elegível, não elegível e evidência insuficiente são estados diferentes. 90 dias é proposta. | `classifyEligibility` | domínio: admissão recente e exceção | PARTIAL | Sem prévia de elegíveis na tela | Lista filtrável antes de preparar |
| 012 | Uma autoavaliação e uma avaliação de líder ativas por participante. | índice único parcial na migration; `ensureAssignments` | serviço: envio não duplica | PARTIAL | Sem seleção de pessoas na tela | Ação “incluir elegíveis” idempotente |
| 013 | Contagens de elegíveis, não elegíveis, convites, envios, calibração, feedback e PDI. | `dashboardCounts` | coberto de forma indireta pelo serviço | PARTIAL | Sem filtro de setor/cargo e sem atraso na tela | Usar as contagens já calculadas nos filtros |
| 014 | Token de 32 bytes, só digest gravado, URL `/avaliacao#t=`. | `performanceInvite.ts` `buildInviteHashUrl` | serviço: QR sozinho não abre o formulário | PARTIAL | Não há imagem de QR nem impressão | QR com `qrcode.react`, só para quem tem `invites` |
| 015 | OTP com digest, 5 erros bloqueiam, flag desligada não autentica. | `verifyOtp`, rota pública | rotas: OTP desligado, mensagem sem a palavra token | PARTIAL | Não há canal. A API de emissão devolve o código a quem tem permissão de convite, para entrega manual | Decisão de canal antes de ligar a flag |
| 016 | Uma pergunta por tela, revisão, envio. | `PerformancePortalPage.tsx` | serviço: envio único | PARTIAL | Sem teste em 320/360/390 px nem zoom | Passagem no navegador |
| 017 | Gravação com `expectedVersion`. Pendente ≠ não observável. | `saveAnswers` | serviço: retomada no fluxo do portal | PARTIAL | Sem fila offline | Mensagem de rede já existe; falta repetir o último salvamento |
| 018 | `openAssisted` grava quem ajudou. | `POST .../assist` | não há teste de tela | PARTIAL | Sem tela. O aparelho do colaborador não deve ver o administrativo | Fluxo autenticado de RH que fecha a sessão ao terminar |
| 019 | Fila só de liderados, sem o próprio registro. | `leaderQueue`, aba Minha equipe | rotas: IDOR | PARTIAL | Lista sem filtro de prazo | Filtros em cima da fila já filtrada no servidor |
| 020 | Formulário do líder em terceira pessoa e exemplo nas notas 1 e 4. | `LeaderAssignmentPanel.tsx`, `evidenceSatisfied` | serviço: exemplo obrigatório | PARTIAL | Formulário novo, sem teste de navegador | Percorrer salvar, erro de exemplo e enviar |
| 021 | Divergência só depois do envio do líder. Devolução cria revisão. | `findDivergences`, `returnForRevision` | serviço: limiar e revisão | PARTIAL | Sem botão de devolver na tela | Botão com motivo mínimo já exigido no serviço |
| 022 | Média = soma ÷ respostas válidas. Duas casas só na exibição. | `nineBoxBand`, cultura | domínio: 2,499 / 2,5 / 3,499 / 3,5 e 2495/1000 | PASS | Autoavaliação não entra na nota oficial | Manter o teste de fronteira |
| 023 | Sem resposta do líder o técnico fica insuficiente, não “validado”. | `validateTechnical` | serviço: após só a autoavaliação | PARTIAL | Sem fila de validação na tela | Ação de validar com nota, separada do quadrante |
| 024 | Cultura em faixa própria. Nota 1 pede análise e não pune. | `cultureBand` | domínio | PARTIAL | Código de conduta não está versionado como documento aceito | Anexar o documento quando o RH indicar a fonte |
| 025 | Conduta gravada não muda o conjunto de resultados. | `recordConduct` | serviço: quadrante permanece | PARTIAL | Não há módulo de ocorrências para reutilizar; este é o contrato mínimo | Manter fora do painel geral |
| 026 | Eixos só com técnico validado e potencial. Sem evidência: `SEM_CLASSIFICACAO`. | `placeNineBox` | domínio | PASS | Posição oficial continua falsa até a homologação | Não promover preliminar a oficial na grade |
| 027 | Calibração no serviço, com escopo. | `POST .../calibration` | serviço | PARTIAL | Sem fila na tela | Fila com os três pilares e a divergência já calculada |
| 028 | Homologar exige todos calibrados e técnico não pendente. Auto-homologação recusada. | `homologateCycle` | serviço: `SELF_HOMOLOGATION` | PARTIAL | Sem tela | Botão condicionado à mesma regra |
| 029 | Devolutiva só com resultado oficial. Visualizou, ciência, concordou e contestou são distintos. | `createFeedback`, `acknowledge` | serviço: sem concordância forçada | PARTIAL | Sem tela | Formulário curto pós-homologação |
| 030 | Um PDI prioritário; extra exige justificativa. | `createPdi` | serviço | PARTIAL | Sem tela e sem anexo | Lista de uma ação, status no serviço |
| 031 | Check-in gravado. Sem disparo. | `addCheckin` | serviço: lembrete não enviado | PARTIAL | Sem calendário trimestral na tela | Registrar a data sugerida sem job |
| 032 | Painel com as contagens do serviço. | `PerformanceCyclePage.tsx` aba Painel | indireto | PARTIAL | Sem filtro | Reusar `dashboardCounts` |
| 033 | Grade 3×3, cultura ao lado, nomes do escopo, preliminar marcado. | `NineBox` | não há teste visual | PARTIAL | Células não são botões de detalhe | Card com técnico, potencial e cultura separados |
| 034 | Histórico usa cargo/setor do snapshot. | `employeeHistory` | não há teste de troca de cargo | PARTIAL | Sem comparação entre ciclos | Mostrar o snapshot, não o cargo atual |
| 035 | CSV neutralizado e PDF texto (`application/pdf`, começa com `%PDF`). Ficha de QR em HTML para impressão, sem o código falado. | `performancePdf.ts`, `GET /api/hr/performance/reports/document.pdf`, `PerformanceInvitePrintPage.tsx` | `performancePdf.test.ts` confere o texto no arquivo | PARTIAL | O PDF não usa o cabeçalho institucional de `PrintHeader` | Reusar `PrintDocumentShell` no relatório individual |
| 036 | Portal 404 com flag off, cookie `ic_perf_session` HttpOnly no caminho público, `no-store`, `no-referrer`. | `performanceRoutes.ts` | rotas: flag, OTP, IDOR | PARTIAL | CSRF, rate limit de borda, Cloudflare e Tailscale não foram exercitados | Marcar infra como não verificada até o ambiente existir |
| 037 | Segregação por escopo e conduta fora do histórico geral. | `employeeHistory` `includeInternal` | rotas de escopo | BLOCKED | Não há base legal nem prazo de retenção | Parecer jurídico antes de qualquer dado real |
| 038 | Eventos de auditoria no estado e na tabela nova. | `audit()` no serviço; `HrPerformanceAuditEvent` | serviço nos fluxos principais | PARTIAL | Adaptação Prisma é última gravação vence | Concorrência com versão no `UPDATE` |
| 039 | Plano de lembrete pode ser gravado. Disparo responde `REMINDERS_DISABLED`. | `dispatchReminders` | serviço | PARTIAL | Nenhum canal configurado | Manter o disparo recusado |
| 040 | Testes locais com dados fictícios no processo. Flags desligadas. | esta pasta | 18/18 do módulo | PARTIAL | Piloto de operador não executado | Checklist em `PILOTO_E_ACEITE.md` |

## Fluxos ponta a ponta

| Fluxo | Resultado |
| --- | --- |
| 1. Modelo rascunho, publicar, snapshot imutável | Coberto no teste de serviço |
| 2. Ciclo, elegibilidade, abrir só com regra aprovada | Transição coberta; seleção de pessoas sem tela |
| 3. Convite, revogação, QR sozinho não autentica | Coberto no teste de serviço e de rota |
| 4. 12 perguntas, não sei, salvar, retomar, enviar uma vez | Coberto no serviço; portal sem navegador |
| 5. Modo assistido | API apenas |
| 6. Líder sem ler a autoavaliação antes, exemplo nas notas extremas | Serviço coberto; formulário na tela sem navegador |
| 7. Divergência e devolução versionada | Serviço coberto; sem botão |
| 8. Três pilares, N/A não é zero, insuficiente sem classificação | Teste de domínio |
| 9. Validação técnica e conduta sem mudar nota | Teste de serviço |
| 10. Cortes sem arredondamento e homologação | Teste de domínio e serviço |
| 11. Feedback, ciência sem concordância, PDI | Serviço coberto; sem tela |
| 12. Painel, histórico, PDF | Painel e histórico parciais; PDF ausente |

## Segurança e privacidade

| Controle | Resultado |
| --- | --- |
| RBAC e IDOR do líder | Testado nas rotas |
| Token só como digest, fragmento em vez de query | Implementado |
| OTP desligado não autentica | Testado |
| Brute force de 5 tentativas | Implementado no serviço |
| Token em log | Não foi encontrado gravação do segredo em log desta feature |
| Referrer / cache | `no-referrer` e `no-store` na rota pública |
| Conduta no painel geral | Excluída do histórico comum |
| Usuário desativado / infra / SSRF / CSRF de borda | NÃO VERIFICADO EM AMBIENTE |
| Concorrência de gravação | P1: `performancePrisma.ts` substitui o grafo inteiro |

## Interface

Comparada ao contrato em `UI_CONTRACT.md`. A tela administrativa usa os botões e o painel de Competências, trilha textual e abas. O portal é uma coluna, uma pergunta por vez. Não houve verificação no navegador, então contraste, teclado, 320 px e overflow ficam não verificados.

## Qualidade

- Testes do módulo: 18 passaram, 0 falharam (comando em `PROGRESSO.md`).
- `npx tsc --noEmit` na primeira passagem apontou só o fragmento JSX da ficha. Isso foi corrigido. Uma segunda passagem abortou por falta de memória do processo (exit 134) e não serve como evidência de tipo. A passagem com heap maior está registrada no fim deste arquivo se tiver concluído antes da publicação do relatório; se o campo abaixo disser “pendente”, o typecheck completo não fechou.
- Build de produção (`npm run build`) não foi executado nesta auditoria.
- `npm run lint` do repositório já falha em `scripts/preview-commission-customer-exclusion-impact.ts`, fora deste escopo.
- Navegação: auditoria oficial `OK` com o item novo. Um assert antigo exige permissão não vazia em todo item e falha em Política Comercial, que já estava com lista vazia.
- Nenhum scheduler novo. Nenhuma chamada Nomus. Lockfile não alterado.

### Typecheck desta revisão

`npx tsc --noEmit` com `NODE_OPTIONS=--max-old-space-size=8192` termina com exit 2. O repositório já falha nesse comando por erros anteriores (por exemplo `server.ts`, auditoria Nomus e o item `reports` na sidebar).

Nesta entrega, o compilador apontou o módulo novo: sem `strictNullChecks`, `if (!result.ok)` não abre os campos do erro. A correção foi comparar com `result.ok === false`, inclusive no despacho de lembrete. A ficha do colaborador tinha dois elementos JSX sem um pai; ficou um fragmento.

A passagem seguinte, mesmo comando, não lista erro em `src/lib/hrPerformance`, `src/components/hrPerformance` nem em `PeopleEmployeeProfileDialog`. O `tsc` completo do repositório continua vermelho por causa do que já estava fora deste módulo.

## Pendências

### P0

Nenhuma falha explorável com as quatro flags em `0`. Ligar `PERFORMANCE_CYCLE_ENABLED` em ambiente compartilhado antes dos itens P1 abaixo passa a ser risco de dado.

### P1

- Tela de participantes, convite/QR, assistido, calibração, devolutiva e PDI.
- PDF ausente (RFC-035).
- Gravação Prisma em grafo inteiro, última escrita vence.
- Portal e formulário do líder sem passagem no navegador.
- Parecer de LGPD (RFC-037) antes de dado real.

### P2

- Editor com reordenação e prévia.
- Filtros do painel.
- Assert de navegação da Política Comercial, pré-existente.

## Pendências de pessoas

RH: redação das 12 perguntas, escala, 90 dias, 3 de 4, cortes 2,5 e 3,5, faixas de cultura, código de conduta, exemplos por função.  
Jurídico: base legal e retenção.  
Infraestrutura: canal do código, cache, borda, quando houver autorização. Nada disso foi ligado.  
UX: revisão em celular e notebook, ainda não feita.

## Checklist para uma homologação futura

Não executar agora.

1. Fechar `DECISOES_PENDENTES.md` por escrito.
2. Corrigir a gravação concorrente e repetir o teste de duas abas.
3. Completar as telas P1 e o PDF interno.
4. Aplicar a migration num banco local vazio.
5. Rodar `PILOTO_E_ACEITE.md` com pessoas fictícias.
6. Só então discutir flag em ambiente que não seja produção.

NENHUMA ALTERAÇÃO EM PRODUÇÃO EXECUTADA NESTA AUDITORIA.
