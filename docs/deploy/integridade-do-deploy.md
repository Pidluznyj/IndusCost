# Integridade do deploy — o que garante que uma falha do nosso código não afete o servidor

Origem: deploy de 26/10/2026. Um teste do gate falhou porque usava o lock real de Contas a Receber (a rotina
real estava rodando), e o rollback do executor apagou o banco antes de tentar restaurá-lo; a restauração falhou
por permissão do arquivo de backup. Nenhuma migration tinha sido aplicada.

## Camadas de proteção

| Camada | Onde | O que garante | Prova |
|---|---|---|---|
| 1. Locks reais nunca usados por testes | `src/lib/testSafeLockPath.ts`, aplicado nos 9 pontos de aquisição/liberação de lock | Dentro do test runner do Node, todo lock `induscost-*` em `/tmp`, `/run/lock` ou `/var/lock` vai para um diretório temporário do processo | `src/lib/testSafeLockPath.test.ts`; versão do teste do incidente passa 23/23 com os locks reais ocupados |
| 2. Testes sem efeito colateral no servidor | testes corrigidos (backfill, uploads de RH, diagnósticos, contrato canônico) | Nenhum teste escreve no banco, acessa rede externa ou grava fora do temporário | Auditoria de toda a suíte: `npm run test:side-effects:audit` (1.787 arquivos, banco PostgreSQL 17 com log de escrita por arquivo) |
| 3. Gate isolado no executor | `ids_run_test_gate` | Testes rodam sem `.env`, com banco inalcançável, chaves do `.env` vazias e locks temporários | `deploySafety.test.ts` (G1, G2); ensaio do executor (E1, E2) |
| 4. Janela de manutenção seletiva + trava de escrita + prova | `ids_maintenance_begin/end/recover`, `ids_backup_db`, `ids_mark_db_changes_started`, `ids_migrate_watch_*`, `ids_open_for_app` | Só cron/timers/rotinas do IndusCost param (estado anterior restaurado exatamente); banco só leitura durante a janela; nenhuma escrita entre backup e migrations (tuplas, sequências, arquivos, estrutura, sessões) | `deploySafety.test.ts` (M1–M6); PostgreSQL 17 com binários reais (R1, R7, R8, R15–R17) |
| 5. Rollback por compatibilidade, nunca destrutivo | `ids_compat_report`, `ids_rollback_db_if_needed`, `ids_restore_db_safely`, `ids_recover_db_state` | Schema compatível → banco mantido; incompatível com prova → restauração fiel conferida e troca atômica; sem prova → bloqueio sem ação destrutiva; nenhum `dropdb` | `deploySafety.test.ts` (C1–C5); PostgreSQL 17 real (R2–R6, R9–R14, R18); ensaio do executor (E3–E6) |
| 6. Executor versionado e instalação reversível | `infra/deploy/induscost-deploy-executor.sh`, `environments/*.env`, `install-induscost-deploy.sh` | Fluxo completo sem edição manual; diferenças entre ambientes só no arquivo de ambiente; MANIFEST sha256; desinstalação byte a byte | Ensaio do executor (E1–E7, I1, I2); verificador (K1–K3) |
| 7. Ensaio antes do push | `npm run predeploy:gate -- --base=<commit do servidor>` | Executa os mesmos testes do gate do servidor, pelo mesmo caminho, com os locks reais ocupados e com flags de homologação | Reprova o commit do incidente (`21ad17c0`) e aprova a correção (`1a62bd45`) |

As camadas 1, 2 e 7 já protegem com o executor atual. As camadas 3 a 6 exigem instalar o executor versionado
(coleta, validação em homologação, produção): [`infra/deploy/APLICAR.md`](../../infra/deploy/APLICAR.md).

## Rotina antes de cada push na `main`

1. Commit do servidor de destino: `git -C /opt/induscost log -1 --format=%H` (produção) ou o da homologação.
2. `npm run predeploy:gate -- --base=<commit>` — precisa terminar em `RESULTADO: OK`.
3. Se a entrega muda ou cria testes: `COMMISSION_PG17_BIN=<bin> npm run test:side-effects:audit -- tmp/side-effect-audit --files=<arquivos alterados>` — precisa terminar com 0 violações.
4. No servidor, antes do deploy: `sudo bash scripts/ops/checkDeployExecutorSafety.sh <executor>` — `RESULTADO: executor protegido.`

## Limites conhecidos

- Os testes de diagnóstico gravam, por desenho do módulo, em `tmp/diagnostic-bundles/` do projeto (gitignored)
  e removem o que geram ao terminar.
- A trava de escrita é uma configuração do banco: um cliente que a desligue explicitamente na própria sessão
  consegue escrever. Isso é detectado:
  - antes das migrations, por tuplas, sequências e arquivos;
  - depois que a aplicação sobe, pelas mesmas medidas;
  - durante as migrations, pelo observador de sessões (20 ms). Uma sessão mais curta que isso não é vista. Ela
    exige desligar a trava de propósito e não é escrita legítima.
- A compatibilidade é estrutural. Uma migration que muda o **significado** de dados (por exemplo, um `UPDATE` de
  códigos) sem mudar o schema não é detectada; só `DELETE`/`TRUNCATE` em migration são tratados como incompatíveis.
- Objetos grandes (`pg_largeobject`): só a quantidade entra na prova, não o conteúdo. O IndusCost não os usa.
- systemd, cron e o health são simulados nas suítes locais (Windows). O ensaio no servidor
  (`scripts/ops/rehearseDeploySafety.sh`) e a validação em homologação cobrem `runuser`, as permissões reais e os
  binários do servidor.
- Collation ICU: restauração automática recusada (33) sem tocar no banco.
