# Handoff — Avaliação de Desempenho, Cultura e Potencial

Transferência do Cursor para o Claude Code, no mesmo repositório Git, sem push e sem banco real.

Raiz do repositório: `C:\Users\PauloPidluznyj\OneDrive - Lazarios Koppetel\Documentos\Lazarios\TI\IndusCost\IndusCost`

Remote: `origin` = `https://github.com/Pidluznyj/IndusCost.git`

Branch deste trabalho: `feat/desempenho-cultura-potencial`. Ela já existia. Não foi criada outra branch para o Cursor. O SHA de origem, antes do commit deste handoff, era `9d833ade4547cecd1871d26067aff141a375ca87`, igual à `main` local. A `origin/main` local estava 8 commits atrás no momento da inspeção. Não atualize a `main` nesta transferência.

## 1. Objetivo e escopo

Entregar, só no repositório local, o ciclo de avaliação com três pilares (técnico, cultura, potencial), convite por QR, portal do colaborador, avaliação do líder, Nine-Box, calibração, devolutiva, PDI e PDF. O módulo reutiliza o cadastro oficial de `Employee`. Não altera avaliação de experiência, competência de posto, Nomus, custo ou folha.

Nada disso está homologado pelo RH nem pelo jurídico. Textos, 90 dias, 3 de 4, cortes 2,5/3,5 e faixas de cultura são proposta.

Veredito registrado em [RELATORIO_VALIDACAO_FINAL.md](RELATORIO_VALIDACAO_FINAL.md): não apto para piloto com operadores, não apto para homologação, não apto para produção.

## 2. Arquitetura

Express + React/Vite num processo (`server.ts`). PostgreSQL via Prisma. Testes com `npx tsx --test`.

O domínio é puro e em memória (`performanceService.ts` sobre `performanceState.ts`). A rota lê o grafo, aplica o caso de uso e grava de volta. A gravação Prisma só entra se `HrPerformanceGraphLock.revision` for a revisão lida. A segunda gravação concorrente responde 409. Dentro da transação vencedora, registros ausentes do estado ainda são removidos, exceto auditoria e check-in de PDI. Isso não é atualização linha a linha.

## 3. Documentos funcionais

Pasta: [docs/avaliacao-desempenho/](.)

| Arquivo | Uso |
| --- | --- |
| [RFCs_v1.md](RFCs_v1.md) | Catálogo das 40 RFCs, cópia local do arquivo de Downloads |
| [PROMPTS_v1.md](PROMPTS_v1.md) | Prompts 00 a 12 |
| [DECISOES_PENDENTES.md](DECISOES_PENDENTES.md) | Regras ainda em proposta |
| [UI_CONTRACT.md](UI_CONTRACT.md) | Contrato visual |
| [PROGRESSO.md](PROGRESSO.md) | Andamento dos prompts |
| [PILOTO_E_ACEITE.md](PILOTO_E_ACEITE.md) | Roteiro futuro, não executado |
| [RELATORIO_VALIDACAO_FINAL.md](RELATORIO_VALIDACAO_FINAL.md) | Auditoria. A tabela antiga e a seção “Atualização da mesma data” precisam ser lidas juntas |

Não há um segundo arquivo de especificação funcional além desses e do código.

## 4 e 5. RFCs e prompts

- RFCs: [docs/avaliacao-desempenho/RFCs_v1.md](RFCs_v1.md), RFC-001 a RFC-040.
- Prompts: [docs/avaliacao-desempenho/PROMPTS_v1.md](PROMPTS_v1.md).

## 6. Relatório

[docs/avaliacao-desempenho/RELATORIO_VALIDACAO_FINAL.md](RELATORIO_VALIDACAO_FINAL.md)

Contagem da última revisão escrita nesse arquivo: 3 PASS, 36 PARTIAL, 0 FAIL, 1 BLOCKED (RFC-037, LGPD). Não marque PASS novo sem teste executado.

## 7. Diretórios

- `src/lib/hrPerformance/` — domínio, serviço, rotas, Prisma, PDF, testes
- `src/components/hrPerformance/` — telas
- `prisma/migrations/20261016180000_hr_performance_cycle/migration.sql` — aditiva, não aplicada
- Integração pontual em `server.ts`, `src/App.tsx`, `prisma/schema.prisma`, permissões, sidebar e a ficha do colaborador

## 8. Rotas

Frontend, em `src/App.tsx`:

- `/avaliacao` — portal público, fora do login administrativo
- `/performance-cycle` — tela autenticada
- `/performance-cycle/convites` — impressão do QR

Backend, em `src/lib/hrPerformance/performanceRoutes.ts`. Com `PERFORMANCE_CYCLE_ENABLED` diferente de `1`, as rotas do módulo e do portal respondem 404 antes do banco. `GET /api/hr/performance/feature-status` exige sessão e devolve `{ enabled }`.

Principais caminhos administrativos, todos sob `/api/hr/performance/`:

- `models`, `models/:id`, `models/:id/publish`, `duplicate`, `archive`, `questions/:code`
- `cycles`, `cycles/:id/participants`, `transition`, `dashboard`, `workspace`, `reminders`, `export`
- `directory?q=`
- `team`, `assignments/:id`, `answers`, `submit`, `invites`, `return`, `assist`
- `participants/:id/validation`, `calibration`, `feedback`, `leader`
- `feedbacks/:id/ack`, `feedbacks/:id/pdi`
- `pdis/:id/status`, `pdis/:id/checkins`
- `employees/:id/history`
- `reports/document.pdf`
- `conducts`

Portal, sob `/api/public/performance/`: `session`, `verify`, `assist`, `form`, `answers`, `submit`.

O registro está em `server.ts`, na chamada `registerPerformanceRoutes`, imediatamente antes de `registerCompetencyRoutes`.

## 9. Componentes

- `src/components/hrPerformance/PerformanceCyclePage.tsx` — abas Ciclos, Modelos, Minha equipe, Painel
- `CycleDesk.tsx` — pessoas, convite, calibração, devolutiva, PDI, transições
- `LeaderAssignmentPanel.tsx` — formulário do líder
- `PerformancePortalPage.tsx` — uma pergunta por tela
- `PerformanceInvitePrintPage.tsx` — folhas de QR
- `PeoplePerformanceHistorySection.tsx` — histórico na ficha, acima da avaliação de experiência
- `usePerformanceFeature.ts` — lê a flag

A ficha está em `src/components/employee/profile/PeopleEmployeeProfileDialog.tsx`. O menu está em `src/components/layout/Sidebar.tsx` (ícone `Target`, item `performance-cycle`).

## 10. Serviços e domínio

- `performanceDomain.ts` — escala, 12 perguntas propostas, elegibilidade, transições, médias, cultura, Nine-Box, divergência, CSV
- `performanceService.ts` — casos de uso
- `performanceState.ts` — tipos e `graphRevision`
- `performanceAccess.ts` — escopo ALL / LIMITED; a fila do líder exclui o próprio
- `performanceInvite.ts` — token, digest, OTP, URL em fragmento
- `performancePrisma.ts` — carga e gravação
- `performanceClient.ts` — fetch do navegador
- `performancePdf.ts` — PDF texto, sem biblioteca nova

## 11. Schema e migration

Modelos `HrPerformance*` em `prisma/schema.prisma`, depois de `HrCompetencyLevelRequest`. FK de pessoa só para `Employee`. Trava: `HrPerformanceGraphLock`, id `graph`.

Migration: `prisma/migrations/20261016180000_hr_performance_cycle/migration.sql`.

Não foi executado `prisma migrate`. Foi executado `npx prisma generate` (cliente 5.22.0). Não aplique esta migration em banco real.

## 12. Dependências

Não houve pacote novo. QR usa `qrcode.react`, já usado na avaliação de experiência. PDF é gerado no próprio módulo. Pessoas vêm de `prisma.employee` em `loadEmployees` e `searchEmployees` dentro de `server.ts`. Escopo de acesso reutiliza `resolvePeopleAccessScope` e `loadDescendantEmployeeIds`.

## 13. Permissões

Recurso `admin.employees.performance` e filhos `calibration`, `reports`, `invites`, `conduct`. Chaves legadas `employees.performance.*` em `src/lib/permissionCatalog.ts` e `src/lib/permissionsClient.ts`. Conduta usa `requireResource` estrito. As demais ações de desempenho usam `requireResourceOrHrEditor`. Deny vence allow. O líder não lê tarefa de outro id (`tarefa-alheia` no teste de rotas).

Menu: módulo `performance-cycle`, grupo Gestão de pessoas, permissão de menu `employees.performance.view`. Some quando a flag do ciclo está desligada (`src/lib/hrPerformance/performanceNavigation.ts`).

## 14. Feature flags

Em `.env.example`, todas em `0`:

- `PERFORMANCE_CYCLE_ENABLED`
- `PERFORMANCE_OFFICIAL_PUBLICATION`
- `PERFORMANCE_IDENTITY_OTP`
- `PERFORMANCE_REMINDERS_ENABLED`

Implementação: `src/lib/hrPerformance/performanceFeatureFlags.ts`. O processo lê o ambiente na subida. `tsx` não recarrega `.env` sozinho.

`PERFORMANCE_OFFICIAL_PUBLICATION=0` não impede mais a abertura se a tela enviar `pilotAck: true`. Sem esse aceite, a transição para `OPEN` devolve `GOVERNANCE_BLOCKED`. O resultado oficial continua falso até a homologação do ciclo.

`PERFORMANCE_IDENTITY_OTP` não bloqueia mais a conferência do código de 6 dígitos gravado como digest. O código é mostrado ao RH na tela e não vai na folha. Não há SMS nem e-mail. Lembretes continuam recusados (`REMINDERS_DISABLED`), mesmo com a flag de lembrete ligada, porque não há canal.

## 15. QR

`issueInvite` grava só o digest do link e do OTP. A URL é `{origin}/avaliacao#t={token}`. A origem vem de `APP_PUBLIC_ORIGIN` ou `http://localhost:3000`. A folha em `PerformanceInvitePrintPage.tsx` lê `sessionStorage` `ic-perf-print-cards` e desenha o QR. O OTP fica na frase “Fale este código”, fora da impressão. Reemitir revoga o convite anterior. Cinco erros bloqueiam.

## 16. Portal

`PerformancePortalPage.tsx`. Uma pergunta, Voltar/Próxima, revisão e um envio. Hash `t` abre a sessão e é apagado da barra. Hash `a` é o modo assistido (`POST /api/public/performance/assist`). Cookie `ic_perf_session`, HttpOnly, `SameSite=Lax`, `Path=/api/public/performance`. Mensagem neutra: “Não foi possível abrir esta pesquisa.” O formulário só abre com sessão `VERIFIED` ou `ASSISTED`.

## 17. Líder

`GET /api/hr/performance/team` e `LeaderAssignmentPanel.tsx`. Notas 1 e 4 exigem exemplo com pelo menos 8 caracteres (proposta). A autoavaliação só aparece depois que a tarefa do líder está `SUBMITTED`. Devolução para revisão desativa a versão enviada e cria outra.

## 18. Cálculos

Média = soma das notas 1–4 ÷ quantidade de respostas válidas. “Não sei” não entra e não vira zero. Duas casas só na exibição. Mínimo proposto: 3 de 4. Nota oficial do técnico e do potencial usa a resposta do líder, não a autoavaliação. Algoritmo `performance-mean-v0`.

## 19. Nine-Box

Eixo X técnico validado, eixo Y potencial. Baixo se `soma * 2 < 5 * quantidade`. Alto se `soma * 2 >= 7 * quantidade`. Sem isso, ou sem validação técnica, o quadrante é `SEM_CLASSIFICACAO`. `official` só fica verdadeiro na homologação do ciclo. Regra `nine-box-proposal-unapproved-v0`. A grade está na aba Painel. O PDF `kind=ninebox` é texto, não a grade visual.

## 20. Cultura

Perguntas CU-01 a CU-04: respeito, comunicação, cooperação, honestidade. Faixa própria (`cultureBand`). Não é eixo da Nine-Box. Nota 1 pede análise e não reduz as outras notas. Conduta (`recordConduct`) não muda resultado e não entra no histórico geral.

## 21. Calibração

`calibrate` exige nota de pelo menos 8 caracteres e recusa a própria pessoa (`SELF_HOMOLOGATION`). Homologar o ciclo exige cada elegível calibrado e técnico fora de `PENDING_VALIDATION`. Quem é participante elegível não homologa o ciclo. A tela usa `window.prompt`.

## 22. Feedback e PDI

Devolutiva só com ciclo homologado ou encerrado e resultado `official`. Ciência, concordância e contestação são campos distintos. Um PDI prioritário; extra pede justificativa. Status: `PLANNED`, `IN_PROGRESS`, `DONE`, `SUSPENDED`, `CANCELLED`. Check-in não dispara mensagem.

## 23. PDFs

`GET /api/hr/performance/reports/document.pdf?cycleId=&kind=&participantId=` devolve `application/pdf`. O teste em `performancePdf.test.ts` confere `%PDF` e o texto. Não usa `PrintHeader` / `PrintDocumentShell`. CSV: `GET /api/hr/performance/cycles/:id/export`, com neutralização de fórmula.

## 24. Testes

Foco do módulo, 21 testes verdes na última execução desta sessão:

```text
npx tsx --test src/lib/hrPerformance/performanceDomain.test.ts src/lib/hrPerformance/performanceService.test.ts src/lib/hrPerformance/performanceRoutes.test.ts src/lib/hrPerformance/performanceMigration.test.ts src/lib/hrPerformance/performancePdf.test.ts
```

`npm test` é a suíte inteira e exige PostgreSQL. `npm run lint` é `tsc --noEmit` e já falha por erros anteriores fora deste módulo. Na última passagem, nenhum erro listado estava em `src/lib/hrPerformance` nem em `src/components/hrPerformance`.

Há um teste de navegação que exige `requiredPermissions.length > 0` em todo item do baseline. `commercial-policy` já estava com lista vazia. A auditoria `runNavigationGroupingAudit` foi ajustada para incluir `performance-cycle` e ficou `OK` na execução anterior a este handoff.

## 25. Bugs conhecidos

- A gravação ainda substitui o restante do grafo na transação vencedora. A trava evita a segunda escrita, mas não é update granular por agregado.
- Várias ações da mesa usam `window.prompt`, inclusive a troca de líder por id interno.
- O editor de pergunta na tela só oferece DT-01.
- O PDF não segue o impresso institucional.
- `options` das rotas são lidas na subida do processo.
- Não houve verificação no navegador.

## 26. Lacunas

Editor completo das 12 perguntas, prévia, reordenação, exceção de elegibilidade na tela, fila de calibração sem prompt, PDF com `PrintDocumentShell`, filtros da grade Nine-Box equivalentes aos da mesa, comparação de histórico entre ciclos, canal de lembrete, e testes de ponta a ponta no navegador.

## 27. Pendências institucionais

Lista em [DECISOES_PENDENTES.md](DECISOES_PENDENTES.md). LGPD sem base legal nem retenção. Sem parecer de RH sobre os textos. Sem canal de mensagem. Sem autorização para ligar flag em ambiente compartilhado nem para migrar banco real.

## 28. Prioridades para quem continua

1. Não religar flags nem migrar banco real.
2. Passar o fluxo no navegador local, com a flag só no `.env` local, se houver banco descartável.
3. Trocar prompts por formulários do design system e eliminar o id cru do líder.
4. Completar o editor das 12 perguntas sem editar versão publicada no lugar.
5. Levar o PDF para o shell de impressão já usado em `src/components/employee/ExperienceEvaluationPrintDocument.tsx`, sem QR público da avaliação.
6. Substituir o replace do grafo por escrita do agregado alterado, mantendo a trava ou versão por ciclo.
7. Reauditar as 40 RFCs no código, não só neste arquivo.

## 29. Aceite

O módulo só fica apto para piloto local quando um operador de RH, sem SQL e sem chamar a API à mão, cria o ciclo, escolhe pessoas, imprime o QR, o colaborador responde no celular, o líder avalia, o RH calibra e homologa, a Nine-Box separa preliminar de oficial, a devolutiva aceita ciência sem concordância, o PDI fica rastreável e o PDF confere com os registros. Flags de produção continuam desligadas. As regras continuam rotuladas como proposta até decisão humana.

## 30. Restrições do IndusCost

Não fazer deploy. Não aplicar migration em banco real. Não falar com Nomus, SSH, cron, Cloudflare, Tailscale ou AWS. Não alterar motores oficiais de custo, BOM, preço, estoque Nomus, contas a pagar ou pedido de venda. Migrations aditivas. Não usar `git add .`, reset destrutivo, `git clean` ou force push. Não commitar `.env`. A avaliação de experiência (`HrEmployeeEvaluation`) e a competência de posto (`HrCompetency`) não são este módulo.

Worktrees que já existiam e não devem ser tocados por este handoff:

- `IndusCost-fix-purchases-performance` na branch `fix/inventory-count-supplies-canonicalization`
- `IndusCost-hr-competencies` na branch `feat/hr-competency-matrix-fullscreen`
