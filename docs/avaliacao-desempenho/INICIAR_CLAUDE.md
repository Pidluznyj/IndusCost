# Iniciar o Claude Code neste worktree

Este arquivo existe só na pasta do Claude. O commit compartilhado não o inclui.

## Onde abrir

Pasta: `C:\Users\PauloPidluznyj\OneDrive - Lazarios Koppetel\Documentos\Lazarios\TI\IndusCost\induscost-claude`

Branch: `feature/avaliacao-desempenho-claude`

SHA: `2824a790c70e31ed091cc48c581e52c397b7293c`

Commit: `feat(rh): adiciona o ciclo de desempenho, cultura e potencial em proposta`

Não abra a pasta `IndusCost\IndusCost`. Ela é o worktree do Cursor, na branch `feat/desempenho-cultura-potencial`, no mesmo SHA. Os dois diretórios são worktrees do mesmo repositório `https://github.com/Pidluznyj/IndusCost.git`.

No Claude Code, use **Open Folder** nessa pasta `induscost-claude`.

## Leitura, nesta ordem

1. `docs/avaliacao-desempenho/HANDOFF_CLAUDE_CODE.md`
2. `docs/avaliacao-desempenho/RELATORIO_VALIDACAO_FINAL.md` (leia também a atualização no topo das métricas)
3. `docs/avaliacao-desempenho/DECISOES_PENDENTES.md`
4. `docs/avaliacao-desempenho/RFCs_v1.md`
5. `docs/avaliacao-desempenho/PROMPTS_v1.md`
6. `docs/avaliacao-desempenho/UI_CONTRACT.md`
7. `docs/avaliacao-desempenho/PILOTO_E_ACEITE.md`
8. `src/lib/hrPerformance/performanceDomain.ts`
9. `src/lib/hrPerformance/performanceService.ts`
10. `src/lib/hrPerformance/performanceRoutes.ts`
11. `src/components/hrPerformance/CycleDesk.tsx`

## Estado das 40 RFCs

3 PASS, 36 PARTIAL, 0 FAIL, 1 BLOCKED (RFC-037, LGPD). Não apto para piloto com operadores, não apto para homologação, não apto para produção. Confira no código antes de mudar esses números.

## O que ainda falta implementar

1. Editor visual das 12 perguntas, sem alterar versão publicada no lugar.
2. Formulários no lugar de `window.prompt`, inclusive troca de líder sem id cru.
3. PDF no `PrintDocumentShell` / `PrintHeader`, sem QR público da avaliação.
4. Gravação Prisma do agregado alterado, não replace do grafo inteiro.
5. Exceção de elegibilidade na tela.
6. Filtros da Nine-Box e comparação de histórico.
7. Teste no navegador do fluxo RH → QR → portal → líder → calibração → devolutiva → PDI → PDF.
8. Reauditoria RFC a RFC com evidência nova.

## Comandos locais seguros

Na pasta deste worktree:

```text
npm install
npx prisma generate
npx tsx --test src/lib/hrPerformance/performanceDomain.test.ts src/lib/hrPerformance/performanceService.test.ts src/lib/hrPerformance/performanceRoutes.test.ts src/lib/hrPerformance/performanceMigration.test.ts src/lib/hrPerformance/performancePdf.test.ts
```

`npm run dev` sobe API e SPA em `http://localhost:3000`. Só faça isso com banco local descartável. Para ver o módulo, `PERFORMANCE_CYCLE_ENABLED=1` no `.env` local, que não entra no Git. As outras três flags permanecem `0` até decisão humana. Reinicie o processo depois de mudar `.env`.

`npm run lint` (`tsc --noEmit`) falha por erros anteriores fora deste módulo. `npm test` é a suíte geral e pede PostgreSQL.

Não rode `prisma migrate` em banco compartilhado ou de produção. A migration `prisma/migrations/20261016180000_hr_performance_cycle/migration.sql` não foi aplicada.

## Validação

Um operador precisa concluir o ciclo pela interface, sem SQL e sem chamada manual de API. Resultados oficiais só depois da homologação. Cultura fora da Nine-Box. Conduta não muda nota. QR sozinho não abre o formulário. O código falado não sai na folha. Flags de ambiente compartilhado continuam desligadas.

## Restrições

Não fazer push, merge, deploy, SSH, Nomus, cron ou alteração de banco real. Não commitar `.env`. Não usar reset destrutivo, `git clean` ou force push. Não editar os worktrees `IndusCost-fix-purchases-performance` e `IndusCost-hr-competencies`. Não tratar proposta metodológica como política aprovada. A `main` local permanece em `9d833ade4547cecd1871d26067aff141a375ca87`.
