# Progresso do Claude Code — Desempenho, Cultura e Potencial

Arquivo de checkpoint. Quem retomar o trabalho lê este arquivo primeiro.

## Ambiente

| Item | Valor |
| --- | --- |
| Worktree | `C:\Users\PauloPidluznyj\OneDrive - Lazarios Koppetel\Documentos\Lazarios\TI\IndusCost\induscost-claude` |
| Branch | `feature/avaliacao-desempenho-claude` |
| HEAD de origem | `2824a790c70e31ed091cc48c581e52c397b7293c` |
| Main local preservada | `9d833ade4547cecd1871d26067aff141a375ca87` |
| Worktree do Cursor | `...\IndusCost\IndusCost`, branch `feat/desempenho-cultura-potencial`, não tocado |
| `node_modules` | junction para `C:\Dev\induscost-claude-deps\node_modules` (fora do OneDrive, `npm ci` do mesmo lockfile). Remover a junction com `[System.IO.Directory]::Delete(caminho, $false)`, nunca `Remove-Item -Recurse` |
| PostgreSQL local | `embedded-postgres` 17 em `C:\Dev\induscost-claude-deps\pgtool`, dados em `C:\Dev\induscost-claude-deps\pgdata`, porta `54329`, usuário `induscost_local`. Bancos `perf_empty` (validação da migration) e `perf_e2e` (navegador). Descartável. Script: `C:\Dev\induscost-claude-deps\pg-start.mjs` |

Nenhum push, merge, deploy, SSH, Nomus ou banco real. Nenhum `.env` criado: as variáveis vão no ambiente do processo.

## Checkpoints

### 1. Preflight (16/10/2026)

- Pasta, repositório, branch e HEAD conferidos. Working tree limpo, só `docs/avaliacao-desempenho/INICIAR_CLAUDE.md` não versionado.
- Worktrees: Cursor (`IndusCost`), Claude (`induscost-claude`), `IndusCost-fix-purchases-performance`, `IndusCost-hr-competencies`. Nenhum foi alterado.
- Linha de base dos testes do módulo: 21/21 (`npx tsx --test src/lib/hrPerformance/*.test.ts`).

### 2. Migration em banco local (16/10/2026)

- A cadeia de migrations do repositório não começa de banco vazio: `20260410120000_purchases_block1` já supõe a tabela `Material` (o banco original nasceu de baseline). `prisma migrate deploy` em banco vazio falha nessa migration, antes de chegar ao módulo. Isso é preexistente e não é do módulo.
- Procedimento usado: schema do commit `9d833ade` → `prisma migrate diff --from-empty` → `db execute`; as 232 migrations anteriores marcadas com `migrate resolve --applied`; `migrate deploy` aplicou `20261016180000_hr_performance_cycle` sem erro.
- `prisma migrate diff --from-url <local> --to-schema-datamodel prisma/schema.prisma`: migração vazia (sem drift).

## Próximas etapas

Ver a seção "Plano" abaixo. Ela é atualizada ao fim de cada etapa.

## Plano

1. Domínio: regras versionadas no modelo (cortes, mínimos, evidência), competência por pergunta, 12 textos do modelo inicial.
2. Persistência: gravação por diferença (insere/atualiza o que mudou, recusa exclusão) + nova tentativa automática quando outra gravação entra antes.
3. Migration aditiva `20261021120000_hr_performance_cycle_rules`.
4. Serviço e rotas: participantes incrementais com remoção lógica, elegibilidade com afastamento real, troca de líder por seletor, convites em lote, revogação, devolutiva e PDI pela liderança no escopo, calibração com ajuste justificado, emissão de relatório com código único.
5. Telas no padrão Competências (OverlayTabs, Overlay, PanelState, Toast) sem `window.prompt`.
6. Portal com salvamento por resposta, fila de reenvio, sessão expirada e confirmação assistida.
7. Relatórios no `PrintDocumentShell` / `PrintHeader`.
8. Testes de unidade, integração Prisma em PostgreSQL local e concorrência.
9. Navegador real (Chrome headless via CDP) com dados sintéticos.
10. Auditoria das 40 RFCs e documentação.

### 3. Backend, persistência e testes (16/10/2026)

- Domínio: regras por versão de modelo (`PerformanceRules`), competência por pergunta, 12 textos do modelo inicial (Qualidade… Desenvolvimento), escala com "Não sei responder / Não tive oportunidade".
- Serviço reescrito (`performanceService.ts`) e leituras separadas (`performanceInsights.ts`). Escopo obrigatório: ação de RH exige escopo ALL; líder só age na tarefa atribuída a ele.
- Persistência por diferença (`performancePrisma.ts`): grava só o criado/alterado, recusa exclusão e reescrita de auditoria (`HistoryIntegrityError`); trava de revisão + nova tentativa automática nas rotas (`mutate`).
- Migration aditiva `20261021120000_hr_performance_cycle_rules` gerada por diff do banco local e aplicada sem drift em `perf_empty` e `perf_e2e`.
- Testes: `npx tsx --test src/lib/hrPerformance/*.test.ts` → 44/44. Integração real: `PERFORMANCE_PG_TEST_URL=<local> npx tsx --test src/lib/hrPerformance/performancePrisma.integration.test.ts` → 1/1 (concorrência, conflito, auditoria só cresce, sem órfãos).
- O PDF texto (`performancePdf.ts`) saiu: o documento agora é o impresso institucional.

### 4. Interface (16/10/2026)

- Abas: Ciclos, Minha equipe, Calibração, Nine-Box, Devolutivas e PDI, Painel, Modelos. Nenhum `window.prompt`; líder escolhido por busca no cadastro.
- Portal em bundle público separado (`avaliacao.html` → `src/public-performance/main.tsx`), CSS próprio, guard de host `performancePublicSurface.ts` (desligado sem `PERFORMANCE_PUBLIC_HOSTS`).
- Impressos: `/performance-cycle/relatorio` (PrintDocumentShell + PrintHeader, código DCP-AAAAMMDD-XXXXXX, versão, emissor, paginação) e `/performance-cycle/convites` (QR sem código).
- Typecheck focado (`tsconfig.perf-check.json`, arquivo temporário) sem erro nos arquivos do módulo. O repositório não tem `@types/react`; `key` em componente próprio gera TS2322 em todo o projeto, por isso o módulo usa `React.Fragment key`.

### 5. Navegador (16/10/2026)

- Banco `perf_e2e` migrado; dados fictícios por `scripts/seedPerformanceLocalDemo.ts` (recusa URL não local; senha só por variável de ambiente, guardada fora do repositório).
- Servidor local: porta 3100, `PERFORMANCE_CYCLE_ENABLED=1` só no processo, agendadores externos desligados.
- Roteiro `scripts/performance-e2e/run-all.sh` (Chrome headless via CDP, 8 partes): 55/55 PASS, sem erro de console. Defeitos achados e corrigidos estão em `EVIDENCIAS_TESTES.md` §4.
- Capturas e PDFs reais em `docs/avaliacao-desempenho/evidencias/`.

### 6. Regressão, tipos e build (16/10/2026)

- Suíte de unidade: 4918 testes, mesmas 4 falhas na base `2824a790` e no branch.
- `tsc` completo: 1370 = 1370 (zero erro novo). Build de produção e `check:browser-bundle` OK. Portal sem caminhos `/api/hr/`.

### 7. Documentação e entrega (16/10/2026)

- `MATRIZ_CONFORMIDADE_RFC.md`: 36 PASS, 0 PARTIAL, 0 FAIL, 4 BLOCKED (025, 037, 039, 040).
- `EVIDENCIAS_TESTES.md`, `PENDENCIAS_HOMOLOGACAO.md`, `RELATORIO_VALIDACAO_FINAL.md` (veredito novo no topo, texto anterior preservado), `UI_CONTRACT.md` e `DECISOES_PENDENTES.md` (seções novas no fim).
- Nenhum commit, push, merge ou deploy. O responsável revisa e faz o commit.

## Para retomar

1. Recriar `node_modules` (`npm ci`) ou a junction para `C:\Dev\induscost-claude-deps\node_modules`.
2. Subir o PostgreSQL local (`node C:\Dev\induscost-claude-deps\pgtool\pg-start.mjs`), o seed e o servidor como em `EVIDENCIAS_TESTES.md` §6.

### 8. Auditoria pré-commit (19/10/2026)

- Git conferido (worktree, branch, HEAD `2824a790`, nada em stage), sem segredo nem dado real; `performancePdf*` sem referência restante.
- Testes do módulo registrados em `scripts/unit-test-files.txt` e `npm run test:performance` (50/50).
- `main` remota em `e6b7e8af` (9 migrations novas); merge simulado: 1 conflito de import em `server.ts`; schema mesclado válido.
- `RELEASE_READINESS.md` criado. Nenhum commit, push, merge ou deploy.
