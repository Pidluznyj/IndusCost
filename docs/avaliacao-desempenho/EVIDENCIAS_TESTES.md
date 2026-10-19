# Evidências de testes — Desempenho, Cultura e Potencial

Execução de 16/10/2026, máquina Windows local, worktree `induscost-claude`, branch `feature/avaliacao-desempenho-claude` (origem `2824a790`). Tudo local e com dados fictícios. Nenhum banco real, servidor, Nomus, deploy ou push.

## 1. Testes automatizados do módulo

```text
npx tsx --test src/lib/hrPerformance/*.test.ts
```

| Arquivo | O que cobre |
| --- | --- |
| `performanceDomain.test.ts` | escala, médias, fronteiras 2,499/2,5/3,499/3,5, elegibilidade, cultura, Nine-Box |
| `performanceService.test.ts` | modelos, ciclo, participantes, elegibilidade, convites, portal, assistido, liderança, cálculo, calibração, homologação, reabertura, devolutiva, PDI, encerramento, relatórios, escopo de RH, exemplos por cargo |
| `performanceRoutes.test.ts` | flag, capacidades, deny, IDOR, ciclo inteiro pela API, cookie, limite de tentativas, só JSON, concorrência (duas gravações simultâneas, mesmo registro, envio duplicado, sobrescrita de finalizada), exclusão recusada, erro de banco sem derrubar o processo |
| `performanceMigration.test.ts` | migrations só aditivas, colunas obrigatórias com default, flags desligadas |
| `performancePublicSurface.test.ts` | allowlist do portal, travessia, cookie administrativo removido, CSP |
| `performancePrisma.integration.test.ts` | PostgreSQL real (pulado sem `PERFORMANCE_PG_TEST_URL` local) |

Resultado: **50 testes, 50 passam, 0 falham** (o de integração aparece como pulado quando não há banco local).

Integração em PostgreSQL 17 local (UTF-8):

```text
PERFORMANCE_PG_TEST_URL=postgresql://…@127.0.0.1:54329/perf_empty npx tsx --test src/lib/hrPerformance/performancePrisma.integration.test.ts
```

Resultado: **1/1**. Cobre: ciclo completo gravado por rotas reais, afastamento real (`HrAbsence`) virando evidência insuficiente, duas gravações simultâneas de pessoas diferentes (as duas ficam: 24 respostas), duas gravações simultâneas do mesmo registro (200 e 409), auditoria que só cresce, nenhuma resposta órfã, uma tarefa ativa por pessoa e tipo, emissão de relatório gravada.

## 2. Migrations em banco local descartável

PostgreSQL embutido (`embedded-postgres` 17) em `C:\Dev\induscost-claude-deps`, porta 54329, fora do OneDrive. A conexão foi conferida antes de cada comando (`@127.0.0.1:54329`).

1. A cadeia de migrations do repositório **não** começa de banco vazio: `20260410120000_purchases_block1` falha com `relation "Material" does not exist` (o banco original nasceu de baseline). Preexistente.
2. Procedimento: schema do commit `9d833ade` aplicado com `prisma migrate diff --from-empty` + `db execute`; as 232 migrations anteriores registradas como aplicadas; `prisma migrate deploy` aplicou `20261016180000_hr_performance_cycle` e `20261021120000_hr_performance_cycle_rules`.
3. `prisma migrate diff --from-url <local> --to-schema-datamodel prisma/schema.prisma`: **migração vazia** (sem drift) nos dois bancos (`perf_empty`, `perf_e2e`).
4. Atualização com dados: banco `perf_upgrade` com só a 1ª migration e dados no formato antigo (modelo, pergunta, ciclo, participante, tarefa, resultado); depois a 2ª migration. Nada perdido; colunas novas com default (`managerSource=CADASTRO`, `adjusted=false`, `addedAt`/`createdAt` preenchidos, `rules`/`ruleSnapshot`/`roleExamples` nulos e tratados pelo carregador).
5. O cluster embutido nasceu em WIN1252; os bancos foram recriados em UTF-8 (como produção) depois que um "≥" foi recusado. Detalhe do ambiente de teste, não do módulo.

Recuperação: as duas migrations só fazem `ADD COLUMN` com default e `CREATE TABLE`. Para desfazer, basta não ligar a flag; as colunas e a tabela nova ficam sem uso. Não há `DROP` nem `UPDATE` de dados existentes.

## 3. Navegador real (Chrome headless via DevTools Protocol)

Não há Playwright no repositório; o projeto já usa Chrome headless via CDP nas validações de tela. O roteiro está em `scripts/performance-e2e/` (portável) e foi executado contra o servidor real (`server.ts`, porta 3100, `PERFORMANCE_CYCLE_ENABLED=1` só no processo, agendadores PTAX/Brent/CRM/planilha desligados, sem token Nomus) e o banco `perf_e2e` com dados de `scripts/seedPerformanceLocalDemo.ts`.

Contextos isolados: RH (1440×900), celular (390×844 e 320/360), tablet assistido (820×1180), líder (1366×860). Cliques com mouse real (`Input.dispatchMouseEvent`) e digitação por `Input.insertText`.

Resultado final: **55 verificações PASS, 0 FAIL, nenhum erro de console** ([execucao-navegador.txt](evidencias/execucao-navegador.txt)).

| # | Passo da missão | Verificação | Evidência |
| --- | --- | --- | --- |
| 1 | Login do RH | PASS | — |
| 2 | Acesso ao módulo | PASS (7 abas) | [02](evidencias/02-modulo-rh.png) |
| 3 | Criação de modelo | PASS (12 perguntas) | — |
| 4 | Edição das 12 perguntas | PASS (texto, regra, reordenação, exemplo por cargo) | [04a](evidencias/04a-editor-modelo.png) |
| 5 | Publicação | PASS (fica somente leitura) | — |
| 6 | Criação de ciclo | PASS | — |
| 7 | Seleção de colaboradores | PASS (busca, lote, prévia de elegibilidade com afastamento real) | [07b](evidencias/07b-previa-elegibilidade.png) |
| 8 | Atribuição de líder | PASS (seletor visual, motivo, sem id) | [08](evidencias/08-troca-lider.png) |
| 9 | Preparação | PASS | — |
| 10 | Abertura | PASS (aceite de piloto obrigatório) | [10](evidencias/10-abertura-piloto.png) |
| 11 | Emissão de QR Code | PASS (lote, códigos na tela, folha sem código, 2 fichas por A4) | [11](evidencias/11-convites-emitidos.png), [fichas PDF](evidencias/fichas-convite.pdf) |
| 12 | Acesso pelo celular | PASS (token apagado da barra) | [12](evidencias/12-celular-codigo.png) |
| 13 | Confirmação de identidade | PASS (código errado avisado; certo abre) | [13](evidencias/13-celular-intro.png) |
| 14 | Preenchimento parcial | PASS (nada pré-selecionado, 390 px sem rolagem lateral) | [14a](evidencias/14a-celular-pergunta-1.png) |
| 14c | Conexão instável | PASS (aviso honesto, reenvio automático) | [14c](evidencias/14c-celular-sem-internet.png) |
| 15 | Interrupção | PASS | — |
| 16 | Retomada | PASS (volta na 1ª sem resposta; 320 e 360 px ok) | [16](evidencias/16-celular-retomada.png), [320 px](evidencias/16b-celular-320px.png) |
| 17 | Conclusão | PASS (revisão, envio único, QR não reabre) | [17a](evidencias/17a-celular-revisao.png) |
| 17d | Preenchimento assistido | PASS (motivo, confirmação da pessoa, aparelho liberado) | [17d](evidencias/17d-assistido-confirmacao.png) |
| 18 | Login do líder | PASS (só a própria equipe; workspace sem outro setor) | [18](evidencias/18-lider-equipe.png) |
| 19 | Avaliação | PASS (rascunho salvo) | — |
| 20 | Registro de evidências | PASS (retomada com exemplo; nota 1 sem exemplo bloqueia; exemplo do cargo visível) | — |
| 21 | Finalização | PASS (autoavaliação liberada; sem edição) | [21](evidencias/21-lider-enviada-com-autoavaliacao.png) |
| 22 | Login do RH | PASS | — |
| 23 | Consolidação | PASS (pendência exige confirmação explícita) | [23a](evidencias/23a-encerrar-coleta-pendencias.png) |
| 24 | Calibração | PASS (perspectivas, divergências, exemplos; revisão pedida bloqueia homologação) | [24a](evidencias/24a-calibracao-fila.png) |
| 25 | Revisão do líder | PASS (motivo visível, nova versão enviada) | [25a](evidencias/25a-lider-revisao-recebida.png) |
| 26 | Validação e calibração | PASS (ajuste justificado; original preservada) | [26a](evidencias/26a-calibracao-ajuste.png) |
| 27 | Homologação | PASS | — |
| 28 | Nine-Box | PASS (oficial, detalhe, cultura à parte, baixa amostra) | [28](evidencias/28-ninebox-oficial.png) |
| 29 | Feedback | PASS (ciência presencial sem concordância) | — |
| 30 | PDI e acompanhamento | PASS (check-in, conclusão com histórico) | [30](evidencias/30-pdi-acompanhamento.png) |
| 31 | Emissão de PDF | PASS (6 tipos, código `DCP-…` e versão) | [individual](evidencias/relatorio-individual.pdf), [devolutiva](evidencias/relatorio-devolutiva.pdf), [consolidado](evidencias/relatorio-consolidado.pdf), [Nine-Box](evidencias/relatorio-ninebox.pdf) |
| 32 | Encerramento | PASS (devolutiva pendente confirmada) | — |
| 33 | Painel | PASS (numerador/denominador, evolução) | [33](evidencias/33-painel.png) |
| 34 | Consulta histórica | PASS (API do histórico) | — |
| 35 | Responsividade administrativa | PASS (375, 768, 1280, 1920 px sem rolagem lateral) | [mobile](evidencias/35-admin-mobile.png), [tablet](evidencias/35-admin-tablet.png) |
| 36–37 | Líder após homologação | PASS (resultado liberado, devolutiva e PDI da equipe) | [36b](evidencias/36b-lider-devolutiva-pdi.png) |
| 38 | Negações no backend | PASS (relatório do ciclo, calibração, gestão e cadastro → 403) | — |
| 39 | Histórico na ficha do colaborador | PASS (aba Avaliações de Pessoas/RH) | [39](evidencias/39-ficha-colaborador-historico.png) |
| 40 | Usuário desativado | PASS (sessão aberta → 401) | — |

Estado gravado ao fim do roteiro (consulta direta no banco local): ciclo `CLOSED`; 7 participantes; 9 tarefas (1 versão inativa preservada pela revisão); 14 versões de resultado, 4 oficiais, 1 ajustada; 2 devolutivas (1 com ciência e sem concordância); 2 PDIs com 2 acompanhamentos; 4 convites; 6 documentos emitidos; 93 eventos de auditoria; 0 tarefa ativa duplicada; 0 sessão viva; 0 evento de auditoria com sequência longa parecida com token.

PDFs reais (`Page.printToPDF` sobre as rotas de impressão): o individual tem 2 páginas A4 com cabeçalho institucional, código e versão no rodapé de cada página e "Página X de Y".

## 4. Defeitos achados no navegador e corrigidos

| Defeito | Causa | Correção |
| --- | --- | --- |
| Editor de modelo ficava sempre "com alterações" | JSONB reordena chaves; comparação por `JSON.stringify` | Comparação campo a campo |
| Clique em "Salvar rascunho" não funcionava logo após criar | Toast (`z-[110]`) cobria o rodapé do modal | Toast do módulo centralizado e `pointer-events-none` |
| "Imprimir fichas" abria vazia | `window.open(..., "noopener")` não copia o `sessionStorage` | Abre sem `noopener`; a ficha zera `window.opener` |
| PDF saía em branco (só rodapé) | `src/reports-print.css` esconde `body *` em qualquer impressão | Revelação explícita na rota (padrão de `inventory-labels-print.css`) |
| Erro de banco derrubava o servidor inteiro | Promessa rejeitada em rota Express 4 | Todas as rotas do módulo respondem 500 neutro sem cair (teste "robustez") |
| Responsável da devolutiva do líder vazio | Contexto expõe `authUser`, não `user` | Campo corrigido |
| Card do líder dizia "4 sem líder" antes da abertura | Contava só tarefas | Antes da abertura conta o líder do participante |
| Grade da Nine-Box mostrava "[DEMO]" | Usava a primeira palavra do nome | Nome completo |
| Histórico do PDI com `IN_PROGRESS → DONE` | Código cru | Rótulo em português |

## 5. Regressão, tipos, build

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Suíte de unidade do repositório | `node scripts/run-unit-tests.mjs` (branch e commit `2824a790`, mesmo `node_modules`) | 4918 testes; 4914 passam nos dois; **as mesmas 4 falhas na base e no branch** (ex.: `commercial-policy sem recurso appearsInSidebar`, grade de Clientes, consistência de permissões). Nenhuma nova |
| Navegação, sidebar, rotas do App, superfície pública da Satisfação | `npx tsx --test src/lib/navigationGroups.test.ts src/lib/sidebarNavigation.test.ts src/lib/permissionTreeSidebarLayout.test.ts src/lib/sidebarGroupingFinalValidation.test.ts src/lib/appRouteComponents.test.tsx src/lib/satisfaction/satisfactionPublicSurface.test.ts` | 105/105 |
| Competências (moldura de modal alterada) | `npm run test:competencies` | 116/116 |
| Fronteira de imports | `npm run check:frontend-server-imports`, `npm run check:server-imports` | OK, OK |
| Typecheck completo | `NODE_OPTIONS=--max-old-space-size=9216 node node_modules/typescript/bin/tsc --noEmit` | 1370 erros na base `2824a790` e 1370 no branch; diferença normalizada só no par conhecido de `orderFullAuditService.ts` (caminho absoluto). **Zero erro novo**; zero erro nos arquivos do módulo |
| Build de produção | `vite build` (saída fora do OneDrive) | OK, entradas `index.html`, `satisfacao.html`, `avaliacao.html` |
| Bundle do navegador | `scripts/checkBrowserBundle.ts` | OK, 65 artefatos sem Prisma |
| Isolamento do portal | inspeção do `dist/avaliacao.html` | 11,9 KB próprios + React + domínio; **0** caminhos `/api/hr/` |
| Lint | `npm run lint` = `tsc --noEmit` | ver typecheck (o repositório já não passa; nada novo) |

O repositório não tem `@types/react`; por isso `key` em componente próprio gera TS2322 no projeto inteiro. O módulo usa `React.Fragment key` para não somar erros.

## 6. Como repetir

1. PostgreSQL local descartável e `DATABASE_URL` apontando para ele (nunca homologação/produção).
2. Aplicar o schema e as migrations como na seção 2.
3. `PERF_DEMO_PASSWORD=<12+ caracteres> npx tsx scripts/seedPerformanceLocalDemo.ts`.
4. Subir o servidor local com `PERFORMANCE_CYCLE_ENABLED=1`, `PORT=3100`, `APP_PUBLIC_ORIGIN=http://localhost:3100` e os agendadores externos desligados (`BRENT_COMMODITY_SCHEDULER_ENABLED=false`, `PTAX_SNAPSHOT_SCHEDULER_ENABLED=false`, `CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED=false`).
5. `PERF_DEMO_PASSWORD=… DATABASE_URL=… bash scripts/performance-e2e/run-all.sh` (capturas em `tmp/performance-e2e/shots`).

## 7. Auditoria pré-commit (19/10/2026)

- Os testes do módulo não estavam registrados em lugar nenhum (`scripts/unit-test-files.txt` nem `package.json`), então `npm test` não os rodava. Foram registrados os 6 arquivos na lista canônica e criado `npm run test:performance`. Nenhum teste foi alterado. `npm run test:performance` → 50/50; os mesmos arquivos pelo runner canônico (`node --import tsx --test …`) → 50/50. O teste de integração fica como suíte pulada sem `PERFORMANCE_PG_TEST_URL` (por isso `skipped 0` e `suites 22`).
- A suíte de unidade passa a ter os 50 testes do módulo além dos 4918 medidos na seção 5. A contagem nova não foi medida.
- Detalhes de release, integração com a `main` e GO/NO-GO: [RELEASE_READINESS.md](RELEASE_READINESS.md).
