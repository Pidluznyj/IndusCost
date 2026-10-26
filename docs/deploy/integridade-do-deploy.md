# Integridade do deploy — o que garante que uma falha do nosso código não afete o servidor

Origem: deploy de 26/10/2026. Um teste do gate falhou porque usava o lock real de Contas a Receber (a rotina
real estava rodando), e o rollback do executor apagou o banco antes de tentar restaurá-lo; a restauração falhou
por permissão do arquivo de backup. Nenhuma migration tinha sido aplicada.

## Camadas de proteção

| Camada | Onde | O que garante | Prova |
|---|---|---|---|
| 1. Locks reais nunca usados por testes | `src/lib/testSafeLockPath.ts`, aplicado nos 9 pontos de aquisição/liberação de lock | Dentro do test runner do Node, todo lock `induscost-*` em `/tmp`, `/run/lock` ou `/var/lock` vai para um diretório temporário do processo | `src/lib/testSafeLockPath.test.ts`; versão do teste do incidente passa 23/23 com os locks reais ocupados |
| 2. Testes sem efeito colateral no servidor | testes corrigidos (backfill, uploads de RH, diagnósticos, contrato canônico) | Nenhum teste escreve no banco, acessa rede externa ou grava fora do temporário | Auditoria de toda a suíte: `npm run test:side-effects:audit` (1.787 arquivos, banco PostgreSQL 17 com log de escrita por arquivo) |
| 3. Gate isolado no executor | `infra/deploy/induscost-deploy-safety.sh` → `ids_run_test_gate` | Testes rodam sem `.env`, com banco inalcançável, chaves do `.env` vazias e locks temporários | `src/lib/ops/deploySafety.test.ts` (D10, D10b, D11) |
| 4. Backup restaurável antes de qualquer mudança | `ids_prepare_backup_dir` + `ids_backup_db` | Dump gravado e conferido **como postgres**; inválido aborta o deploy antes do código novo | D2–D4 |
| 5. Rollback que nunca destrói | `ids_rollback_db_if_needed` | Banco só é restaurado se as migrations começaram; restaura num banco novo e troca os nomes; o atual fica preservado; nenhum `dropdb` | D5–D9; verificador `scripts/ops/checkDeployExecutorSafety.sh` (D12–D14) |
| 6. Ensaio antes do push | `npm run predeploy:gate -- --base=<commit do servidor>` | Executa os mesmos testes do gate do servidor, pelo mesmo caminho, com os locks reais ocupados e com flags de homologação | Reprova o commit do incidente (`21ad17c0`) e aprova a correção (`1a62bd45`) |

As camadas 1, 2 e 6 já protegem com o executor atual. As camadas 3, 4 e 5 exigem aplicar
[`infra/deploy/APLICAR.md`](../../infra/deploy/APLICAR.md) nos executores de produção e homologação.

## Rotina antes de cada push na `main`

1. Commit do servidor de destino: `git -C /opt/induscost log -1 --format=%H` (produção) ou o da homologação.
2. `npm run predeploy:gate -- --base=<commit>` — precisa terminar em `RESULTADO: OK`.
3. Se a entrega muda ou cria testes: `COMMISSION_PG17_BIN=<bin> npm run test:side-effects:audit -- tmp/side-effect-audit --files=<arquivos alterados>` — precisa terminar com 0 violações.
4. No servidor, antes do deploy: `sudo bash scripts/ops/checkDeployExecutorSafety.sh <executor>` — `RESULTADO: executor protegido.`

## Limites conhecidos

- Os testes de diagnóstico gravam, por desenho do módulo, em `tmp/diagnostic-bundles/` do projeto (gitignored)
  e removem o que geram ao terminar.
- O banco do executor de produção é restaurado só a partir do backup do próprio deploy; dados gravados por
  rotinas externas entre o backup e a falha ficam preservados no banco renomeado `<db>__failed_<ts>`.
