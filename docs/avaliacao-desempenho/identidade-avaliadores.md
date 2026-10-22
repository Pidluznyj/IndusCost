# Identidade dos avaliadores — diagnóstico, correção e regularização

Data: 2026-10-21. Branch: `feat/performance-evaluator-identity` (base `main` `1c35ac8`). Sem push, sem merge, sem deploy. Nada foi lido ou gravado em bancos reais.

**Veredito:** a trava `EVALUATOR_WITHOUT_USER` estava certa no que bloqueava e errada no que dizia. O módulo usa uma única identidade operacional — a conta ATIVA ligada ao colaborador por `AppUser.employeeId` — na prontidão, em "Minha equipe" e nas respostas. Contas legadas (como a do "Avaliador A" abaixo) têm a Pessoa canônica certa, mas `employeeId` nulo: sem esse vínculo o líder de fato não veria a equipe. O defeito era a falta de caminho de correção: a tela mandava para Configurações › Usuários, que não grava `employeeId`, e não distinguia "não tem conta" de "tem conta da mesma Pessoa sem vínculo". A correção mantém a régua de segurança e torna a pendência específica, com a regularização auditada de Pessoas 360° como única via de gravação.

## 1. Causa raiz (comprovada no código)

| Ponto | Código | O que faz |
|---|---|---|
| Prontidão | `performanceRoutes.ts` `readinessOf` → `deps.loadLinkedEmployeeIds` (server.ts) | conta ativa com `employeeId ∈ avaliadores` |
| Bloqueio | `performanceReadiness.ts` `cycleReadiness` | avaliador fora desse conjunto → `EVALUATOR_WITHOUT_USER` (BLOCK) |
| Escopo do líder | server.ts `loadScope` | `actorEmployeeId = authUser.employeeId` |
| Minha equipe / respostas | `performanceService.ts` `leaderQueue`, `readLeaderForm`, `canActOnLeaderAssignment` | comparam `evaluatorEmployeeId` com `actorEmployeeId` |

As quatro usam o mesmo campo. Com `AppUser.employeeId` nulo, `actorEmployeeId` é nulo, a fila do líder é vazia e as tarefas dele nunca seriam respondidas — a trava apenas antecipa isso. Usar a Pessoa canônica só na prontidão (o "fallback superficial") deixaria a trava verde e a fila vazia; usá-la também em `loadScope` daria escopo de equipe por coincidência de identidade, que a missão proíbe. Portanto a regra operacional foi mantida e o legado é corrigido com regularização.

Exemplos sintéticos (os identificadores reais ficam fora do repositório, no registro da demanda):

**Avaliador A (conta SUPER_ADMIN legada):** Pessoa `<pessoa-A>`, colaborador `<colaborador-A>` com essa Pessoa, conta `<conta-A>` SUPER_ADMIN ativa com essa Pessoa e `employeeId` nulo → classificação `ACCOUNT_NOT_LINKED`.

**Avaliador B (topo que também avalia):** causa não verificada — não há acesso ao banco de homologação a partir desta máquina. A prontidão nova informa o motivo exato (sem conta, conta inativa, conta da Pessoa sem vínculo, conflito ou Pessoa inativa/unificada). Ser topo **e** avaliador de uma pessoa é coerente com a metodologia (o topo avalia os liderados diretos; ninguém o avalia individualmente) e produz dois itens independentes: `TOP_WITHOUT_EVALUATOR` (WARN) e, se for o caso, um dos bloqueios de acesso.

## 2. Correção

- `src/lib/hrPerformance/evaluatorIdentity.ts` — classificação pura: `LINKED`, `ACCOUNT_NOT_LINKED`, `ACCOUNT_INACTIVE`, `IDENTITY_CONFLICT`, `PERSON_NOT_ACTIVE`, `NO_ACCOUNT`. Só `LINKED` é utilizável. Nome e e-mail nunca entram.
- `src/lib/hrPerformance/evaluatorIdentity.server.ts` — carga em lote, **somente leitura**. `loadLinkedEmployeeIds` do servidor passa a ser `loadLinkedEvaluatorIds` (mesma regra de antes: conta ativa com `employeeId`), e `loadEvaluatorIdentities` explica o motivo.
- `performanceReadiness.ts` — bloqueios separados, todos BLOCK: `EVALUATOR_ACCOUNT_NOT_LINKED` (ação `REGULARIZE_ACCOUNT`), `EVALUATOR_ACCOUNT_INACTIVE` (`REVIEW_ACCOUNT`), `EVALUATOR_IDENTITY_CONFLICT` (`REVIEW_IDENTITY`) e `EVALUATOR_WITHOUT_USER` (`LINK_USERS`, agora apontando para "Habilitar acesso" na ficha). Cada pessoa leva o `personId` para abrir a ficha. `TOP_WITHOUT_EVALUATOR` inalterado (WARN, `SET_EVALUATOR`).
- `CycleReadinessPanel.tsx` — botões "Regularizar na ficha", "Habilitar acesso na ficha", "Abrir ficha" e Usuários só para conta inativa.
- Pessoas 360° (`personProfile.server.ts`, `PersonProfilePage.tsx`) — pendência `ACCOUNT_WITHOUT_EMPLOYEE` no cartão Usuário ("Ligar conta ao colaborador", abre a regularização já preenchida) e sinal `USER_WITHOUT_EMPLOYEE_LINK`.
- `scripts/auditPeopleIdentity.ts` — categoria `USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO` (somente leitura).

Serviço de gravação reutilizado: `attachAccountToPerson` (Pessoas 360° › Regularizar vínculo existente) — prévia, justificativa, comparação-e-troca em `personId`/`employeeId`, trava da Pessoa, `PersonLinkEvent` + `SecurityAuditLog.USER_IDENTITY_LINKED`, conta SUPER_ADMIN só por SUPER_ADMIN com step-up. Duas mudanças nesta missão: a prévia não lista mais `personId` quando ele não muda, e a decisão (`personAccountLink.ts`) recusa regularizar **a própria conta** (`SELF_LINK_FORBIDDEN`), salvo SUPER_ADMIN com step-up — ligar a própria conta a um colaborador daria a quem opera o escopo da equipe dele. A pendência em Pessoas 360° só aparece para Pessoa ativa e colaborador não desligado (o que a regularização aceita). Nenhum GET, login ou prontidão grava vínculo. Sem mudança de schema.

## 3. Casos obrigatórios

| Caso | Resultado | Evidência |
|---|---|---|
| 1 conta ativa com `employeeId` | `LINKED`, sem mudança de comportamento | UNIT, INT |
| 2 conta ativa da mesma Pessoa sem `employeeId` | `ACCOUNT_NOT_LINKED` (BLOCK com ação de regularizar); após a regularização autorizada → `LINKED` e a prontidão libera | UNIT, INT (Avaliador A), rota GET antes/depois |
| 3 conta inativa | `ACCOUNT_INACTIVE` (BLOCK) | UNIT, INT |
| 4 sem conta | `NO_ACCOUNT`; nenhuma conta é criada | UNIT, INT |
| 5 conta de outro colaborador / Pessoa com dois colaboradores | `IDENTITY_CONFLICT` (o segundo é impossível no banco: `Employee.personId` é único) | UNIT, INT |
| 6 Pessoa MERGED/INACTIVE | `PERSON_NOT_ACTIVE`; nenhum vínculo novo para Pessoa unificada | UNIT, INT |
| 7 SUPER_ADMIN | regularização só por SUPER_ADMIN elevado; editor de RH recebe 403; 10 campos da conta e a sessão preservados | INT |
| 8 líder fora do ciclo | inalterado (`LEADER_OUTSIDE_CYCLE`) | testes existentes |
| Topo sem avaliador | independente do acesso; ciclo TEST abre só com o aviso | UNIT |

## 4. Regularização em homologação (procedimento — não executado)

Pré-condições: deploy da branch em homologação conforme [../people/pessoas-360-homologacao-cadastro-mestre.md](../people/pessoas-360-homologacao-cadastro-mestre.md) §0–§3 (backup, SHA confirmado). Sem migration.

1. Diagnóstico somente leitura: `npm run audit:people-identity -- --only=USUARIO_PESSOA_COM_COLABORADOR_SEM_VINCULO,USUARIO_SEM_PESSOA,USUARIO_COLABORADOR_PESSOA_INATIVA` e abrir a prontidão do ciclo de teste (Desempenho › ciclo › Prontidão). Anotar o código mostrado para cada avaliador bloqueado (no caso informado: Avaliador A e Avaliador B).
2. Avaliador A (`ACCOUNT_NOT_LINKED` esperado): "Regularizar na ficha" → ficha `<pessoa-A>` → cartão Usuário → "Ligar conta ao colaborador" → a prévia deve mostrar a conta `<conta-A>` (SUPER_ADMIN) e o colaborador `<colaborador-A>` anotados no passo 1, com mudança só `app_user.employeeId: — → <colaborador-A>` → justificativa → confirmar → senha (step-up de um SUPER_ADMIN, que não pode ser o próprio Avaliador A sem step-up). Conferir: prontidão sem o bloqueio; `SecurityAuditLog` com `USER_IDENTITY_LINKED`.
3. Avaliador B: agir conforme o código exibido — `NO_ACCOUNT`: decisão humana sobre criar acesso ("Habilitar acesso" na ficha; nasce VIEWER sem permissões) ou trocar o avaliador; `ACCOUNT_NOT_LINKED`: mesmo procedimento do passo 2; `ACCOUNT_INACTIVE`: reativar em Usuários se autorizado; `IDENTITY_CONFLICT`/`PERSON_NOT_ACTIVE`: revisar a ficha, nada automático.
4. `TOP_WITHOUT_EVALUATOR` do Avaliador B: decisão funcional — definir avaliador formal ("Definir avaliador") ou seguir com calibração por exceção registrada. Não altera o organograma.

Rollback: código — voltar ao SHA anterior e reiniciar só a homologação; dados — a regularização é reversível pela ficha (Corrigir/Desvincular, auditado). O backup de §1 do procedimento cobre o restante.

## 5. Validação local ponta a ponta (2026-10-22)

Servidor real (porta 3100) contra o PostgreSQL descartável `perf_e2e`, sessões HTTP reais, 39 verificações, todas aprovadas (reexecutadas depois do §8, sem diferença). Dados fictícios do seed local ([DEMO]/[LEGADO]). Fixture: as contas do líder Bruno (VIEWER) e do "Admin Legado" (login `legado.superadmin`, SUPER_ADMIN) no estado legado (`personId` certo, `employeeId` nulo). Ciclo TEST com 9 participantes; Iris avaliada pelo Admin Legado; Otávio por Marcos; Carla é topo e avalia Bruno e Marcos.

| Ponto | Evidência |
|---|---|
| Prontidão | Antes: `EVALUATOR_ACCOUNT_NOT_LINKED` (BLOCK) para Bruno e Admin Legado, nenhum em `EVALUATOR_WITHOUT_USER`; abrir → 409 `READINESS_BLOCKED`. Depois: nenhum código `EVALUATOR_*`; o ciclo abre (200). |
| `actorEmployeeId` | `GET /api/hr/performance/me` com o **mesmo cookie** de antes: `null` → id do colaborador, para as duas contas; papel, capacidades e `accessScope` iguais. |
| Tarefas | Bruno vê exatamente Ana, Bia e Hugo; abre, salva e envia a da Ana. Nas de Otávio (Marcos) e Iris (Admin Legado): GET/PUT/POST → 403. Admin Legado vê só Iris e a responde; não responde nem envia a da Bia (403). Marcos continua vendo só Otávio. |
| Integridade | Pessoas, contas e colaboradores com a mesma contagem; `PermissionAuditLog` inalterado; +2 `PersonLinkEvent` e +2 `USER_IDENTITY_LINKED` com o ator; 12 campos de cada conta iguais, exceto `employeeId`; sessões não revogadas; prévia só com `app_user.employeeId`; SUPER_ADMIN sem step-up do ator → 403 sem gravar; repetir → 409. |
| Topo | `TOP_WITHOUT_EVALUATOR` (WARN, Carla) idêntico antes e depois e não impede abrir; Carla, topo e avaliadora, nunca recebe bloqueio de acesso. |

Suíte unitária completa: as 6 falhas são as mesmas da base `1c35ac8` (rodada limpa na mesma máquina): mesmos testes, mensagens e valores esperados/obtidos, em arquivos que a branch não toca.

## 6. Riscos residuais

- Contas criadas sem colaborador (externos) nunca serão avaliadoras; a prontidão mostra `NO_ACCOUNT`/`ACCOUNT_NOT_LINKED` corretamente.
- O diagnóstico em homologação/produção depende de execução autorizada (somente leitura) — não feito.
- SUPER_ADMIN (e quem tem a permissão de resultados) **lê** avaliações de terceiros por papel, não por vínculo — comportamento anterior, inalterado. Escrever continua restrito ao avaliador atribuído.
- Pessoa em revisão (`NEEDS_REVIEW`) é tratada como identidade a revisar (`EVALUATOR_IDENTITY_CONFLICT`), não como regularização direta: conclui-se a revisão antes.
- Pré-existente, fora do escopo: participante sem líder que não é topo não aparece na prontidão; só é barrado ao abrir (`LEADER_MISSING`).
- Pré-existente, fora do escopo: `personMaster` e `canonicalPersonGovernance` (integração) usam os mesmos CPFs fixos e colidem se rodarem em paralelo; isolados passam.

## 7. Caminho alternativo: vínculo conta ↔ colaborador pelo cadastro de RH (2026-10-22)

**Causa raiz (comprovada).** `POST /api/employees/:id/link-user` ligava a conta cujo login é igual ao e-mail corporativo do colaborador, sem perguntar quem operava. A permissão efetiva da rota (`admin.employees.user_link:manage`) vem também de `employees.edit`, que permite editar esse e-mail. Quem tinha `employees.edit` podia trocar o e-mail corporativo de um líder pelo próprio login e vincular: a própria conta recebia o `employeeId` e a Pessoa do líder, e com isso o escopo de "Minha equipe" e as avaliações dele. Reproduzido na base `1c35ac8` (a gravação incluía `employeeId` e `personId` do líder). O desvincular também não verificava a própria conta, e as duas operações só deixavam log em stdout.

**Correção.** Política única em `src/lib/security/accountIdentityLinkPolicy.ts`, usada pelas cinco operações que mudam a identidade de uma conta (regularizar, corrigir e desvincular em Pessoas 360°; vincular e desvincular no RH):

- conta SUPER_ADMIN só por SUPER_ADMIN com step-up (regra E2 existente);
- nunca a própria conta, salvo SUPER_ADMIN com step-up (`SELF_LINK_FORBIDDEN`); a "elevação" de quem não é SUPER_ADMIN não conta;
- na rota do RH, e-mail igual não basta: exige a mesma Pessoa canônica na conta e no colaborador (`IDENTITY_CONFIRMATION_REQUIRED`); fora disso, a regularização de Pessoas 360° (prévia, confirmação explícita, justificativa);
- sem ator identificado, a rota do RH recusa (`ACTOR_REQUIRED`); a sessão e a guarda contam as duas para reconhecer a própria conta;
- gravação por comparação-e-troca (`updateMany` com o estado lido) e unicidade do banco → `STALE`/`EMPLOYEE_ALREADY_HAS_USER` (409);
- auditoria persistida: `SecurityAuditLog` `USER_IDENTITY_LINKED` (`HR_LINK_USER`) e o novo `USER_IDENTITY_UNLINKED` (`HR_UNLINK_USER`), com ator e alvo.

O status (`GET /user-link-status`) aplica a mesma régua sem gravar nada: não oferece o botão para a própria conta nem para vínculo só por e-mail, e explica o motivo no cartão de acesso do colaborador.

**Validação local (HTTP, permissões efetivas, 26 verificações).** Usuário comum e ADMIN sem `employees.edit`: 403 pela permissão. RH e ADMIN com `employees.edit`: a própria conta → 403 por e-mail, por Pessoa forjada e pela ficha; conta de outra pessoa com Pessoa confirmada → 200, auditado; duas confirmações simultâneas → 200 + 409. SUPER_ADMIN: própria conta sem step-up → 403, com step-up → 200 (vincular e desvincular, auditados); RH/ADMIN em conta SUPER_ADMIN → 403. Só e-mail → 409, nada gravado. Nenhuma Pessoa ou conta criada.

**Mudança de comportamento.** Contas legadas sem Pessoa (ou colaborador sem Pessoa) deixam de ser ligadas pelo botão do RH; a regularização passa pela ficha em Pessoas 360°.


## 8. Fechamento: autorização em todos os caminhos de escrita (2026-10-22)

Auditoria multiagente (4 lentes, 2 céticos por achado: 18 achados confirmados, 6 refutados) e, depois da correção, red-team (4 lentes, 2 refutadores por alegação: 4 mantidas e corrigidas, 9 refutadas).

**Achados e causa.** O `employeeId` da conta só é gravado pelos cinco caminhos interativos, mas a evidência que o RH aceita ("mesma Pessoa") podia ser criada por outros: mover o colaborador do líder para a Pessoa do próprio operador (Pessoas 360° ou formulário do colaborador), ligar uma conta a uma Pessoa pelos formulários de colaborador e de cliente (`ensurePersonFromSource`), a propagação E4 e o backfill por CLI. Além disso, corrigir/desvincular a Pessoa de uma conta exigia só `links:manage`, e a política aceitava ator ausente.

**Regras finais (política única, `src/lib/security/accountIdentityLinkPolicy.ts`).**

| Situação | Resultado |
|---|---|
| Sem usuário identificado | `403 ACTOR_REQUIRED` em qualquer caminho (antes de olhar papel) |
| Sem a permissão efetiva de vínculo com usuário (`admin.employees.user_link:manage`, mesma régua de `requireResourceOrHrEditor`) | `403 ACCOUNT_LINK_PERMISSION_REQUIRED` ao corrigir/desvincular a Pessoa de uma conta, ao pôr colaborador na Pessoa de uma conta sem colaborador, e na propagação E4 (vira pendência) |
| A própria conta | `403 SELF_LINK_FORBIDDEN`, salvo SUPER_ADMIN com step-up |
| Conta SUPER_ADMIN | só SUPER_ADMIN com step-up |
| Formulários de colaborador/cliente com origem `app_user` sem Pessoa, ou colaborador reaproveitando por CPF a Pessoa de uma conta sem colaborador | `409 ACCOUNT_REGULARIZATION_REQUIRED` (Pessoas 360°) |
| Regularização: colaborador entrou na Pessoa entre a prévia e a confirmação | `409 STALE` (a prévia fixa `expected.linkEmployeeId`) |
| Cartão "Acesso ao sistema" | selo "Usuário disponível para vínculo" só quando o vínculo está de fato disponível; senão `match_blocked` ("Usuário encontrado — vínculo bloqueado", âmbar) com o motivo |

**Concorrência.** Quem põe colaborador **ou** conta numa Pessoa trava `account-link:<pessoa>` (advisory lock da transação, `lockPersonAccountLinks`) antes de decidir: relink, regularização, formulário do colaborador, propagação, criação de conta pela Pessoa e vínculo do RH.

**Interativo × rotina interna.** Os caminhos interativos recebem ator e permissão da sessão. Rotinas internas não passam pela política e estão no registro formal `ACCOUNT_IDENTITY_WRITERS`; um teste de fonte falha se aparecer outro arquivo que grave `AppUser.employeeId/personId`.

| Rotina | Autorização |
|---|---|
| Backfill (`scripts/canonical-person-backfill.ts --apply --confirm-apply`) | CLI com acesso ao banco; segura (`heldForRegularization`) conta SUPER_ADMIN e qualquer ligação que criaria a evidência conta ↔ colaborador |
| Criação de conta (`createAppUserAccount`) | `admin.settings.security:manage`; conta nova, recheca colaboradores da Pessoa sob trava |
| `linkStage1RoleToPerson` | sem chamador de produção (teste de fonte garante) |
| Seeds de E2E | só banco local |

**Validação.** Testes unitários da política, rotas e registro; integração em PostgreSQL local com atores reais (8 casos novos, mais as suítes de Pessoas 360°, ciclo de vida e governança atualizadas); HTTP local com sessões reais (o ramo "links:manage sem vínculo com usuário" não é configurável no banco local, que não tem o catálogo canônico de recursos — coberto pelos testes de serviço); reexecução das validações HTTP anteriores sem diferença.

**Pendências da propagação recusada.** Quando quem edita o colaborador não tem a permissão de vínculo com usuário, a conta fica onde estava (o escopo do líder não muda) e o desencontro aparece em Pessoas 360°: filtro de pendência "divergência" na lista (sinais "Conta do colaborador aponta para outra Pessoa" / "Conta do colaborador sem Pessoa"), item pendente na ficha da Pessoa nova ("Corrigir vínculo para esta pessoa" / "Vincular a esta pessoa") e categorias `USUARIO_PESSOA_DIVERGE_DO_COLABORADOR` / `USUARIO_SEM_PESSOA` da auditoria somente leitura. Só regulariza quem tem a permissão de vínculo com usuário, nunca o dono da conta; a correção grava `PersonLinkEvent` com ator e motivo (teste de integração dedicado).

**Mudanças de comportamento.** Formulários de colaborador e de cliente não ligam mais conta de acesso (vai para Pessoas 360°); a propagação E4 só move a conta quando quem edita tem a permissão de vínculo com usuário; o backfill deixa os casos de conta para regularização; o código de desfecho da propagação passou de `SUPER_ADMIN_ELEVATION_REQUIRED` para `ACCOUNT_IDENTITY_DENIED` (com `code`).
