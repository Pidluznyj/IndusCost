# O que coletar nos servidores antes de instalar o executor versionado

O executor versionado (`induscost-deploy-executor.sh`) não presume o comportamento dos executores atuais: tudo que
não foi visto está como `A_COLETAR` em `environments/<ambiente>.env`, e com isso o instalador e o executor recusam
rodar. Todos os comandos abaixo são **somente leitura**. Eles redigem segredos antes de imprimir. Cole a saída
completa na conversa; o arquivo de ambiente é preenchido a partir dela e os testes rodam de novo antes de qualquer
instalação.

## Produção (AWS, `induscost-prod-saopaulo`)

Do executor atual foram vistas só as linhas 1–25 e 350–690 (grep de 26/10/2026). Faltam:

| # | O quê | Por quê | Comando |
|---|---|---|---|
| P1 | Executor completo, com segredos redigidos | Linhas 25–349: resolução do alvo, `--check`, uso de `MODE_FILE`/drop-in de pré-cutover e onde `DB_OWNER` é definido. Linhas 484–512: rollback do código. Linhas 557–593: fetch/`npm ci`/seleção de testes. Linhas 620–666: migrations com falha, política de subida do serviço e laço do health | `sudo sed -E 's/((PASSWORD\|TOKEN\|SECRET\|KEY\|DATABASE_URL\|DIRECT_URL)[A-Z_]*=)[^[:space:]]+/\1<REDACTED>/g' /usr/local/bin/deploy-induscost-producao` |
| P2 | Modo do servidor | Preenche `EXPECTED_MODE` e `PRECUTOVER_EXPECTED` | `sudo cat /etc/induscost/deploy-mode; sudo ls -l /etc/systemd/system/induscost.service.d/; sudo cat /etc/systemd/system/induscost.service.d/10-precutover-isolation.conf` |
| P3 | Agendamentos do IndusCost | A janela pausa só `/etc/cron.d/induscost*` e `induscost-*`. Uma linha fora disso recusa o deploy (47) | `ls -l /etc/cron.d/; sudo grep -n induscost /etc/crontab /var/spool/cron/crontabs/* 2>/dev/null; systemctl list-units --all --plain --no-legend 'induscost*'; systemctl list-timers --all 'induscost*'` |
| P4 | Implementação do cron | O ensaio considera o `cron` do Debian/Ubuntu (relê `/etc/cron.d` a cada minuto) | `systemctl status cron --no-pager \| head -5` |
| P5 | Sessões permanentes no banco | Qualquer sessão (BI, pgAdmin, monitoramento) recusa a janela (41) | `sudo -u postgres psql -Atc "select usename, application_name, client_addr, backend_type from pg_stat_activity where datname = 'teste_bi'"` |
| P6 | Propriedades do banco e do cluster | Collation libc, trava ainda não usada, estatísticas ligadas, sem 2PC/assinaturas/pg_cron, outros bancos | `sudo -u postgres psql -Atc "select datname, datlocprovider, datcollate, datconnlimit from pg_database"`; `sudo -u postgres psql -Atc "select d.datname, s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase"`; `sudo -u postgres psql -Atc "show track_counts; show max_prepared_transactions; select count(*) from pg_subscription; select count(*) from pg_extension where extname = 'pg_cron'"` |
| P7 | Parâmetros da `DATABASE_URL` (sem credenciais) | A exceção da trava é anexada à URL; uma URL que já tenha `options`/`application_name` é recusada | `sudo grep -E '^(export )?DATABASE_URL=' /opt/induscost/.env \| sed -E 's#^[^?]*##; s#(password\|sslpassword)=[^&]*#\1=<REDACTED>#g'` (imprime só `?parâmetros`) |
| P8 | Espaço para backup e restauração | A restauração cria um banco do tamanho do atual antes da troca | `df -h /var/backups /var/lib/postgresql; sudo -u postgres psql -Atc "select pg_size_pretty(pg_database_size('teste_bi'))"` |
| P9 | Integridade do executor atual | Base do backup/desinstalação | `sudo sha256sum /usr/local/bin/deploy-induscost-producao*` |

## Homologação (servidor-01)

O executor `induscost-deploy-homologacao` nunca foi visto. Faltam os itens P1–P9 trocando banco, caminho e
executor, mais:

| # | O quê | Comando |
|---|---|---|
| H1 | Caminho e conteúdo do executor (redigido) | `command -v induscost-deploy-homologacao` e o `sed` de P1 sobre ele |
| H2 | Nome do serviço, health, raiz de backup | Saem de H1; conferir com `systemctl list-units --all --plain --no-legend 'induscost*'` |
| H3 | O host roda outros ambientes do IndusCost? | `ls /opt; ls -l /etc/cron.d/; systemctl list-units --all --plain --no-legend '*induscost*'` (define `CRON_GLOB`/`UNIT_GLOB` só desta homologação) |
| H4 | Banco e collation | `sudo -u postgres psql -Atc "select datname, datlocprovider, datcollate from pg_database where datname like 'teste_bi%'"` |

## Depois da coleta

1. Os valores coletados entram em `environments/<ambiente>.env`. Nenhum `A_COLETAR` pode sobrar.
2. As particularidades do executor atual que não estiverem no executor versionado (por exemplo, um passo extra de
   build ou de modo pré-cutover) entram no executor como configuração explícita, com teste.
3. As suítes rodam de novo: `deploySafety.test.ts`, `deploySafety.pg17.integration.test.ts` e
   `deployExecutor.pg17.e2e.test.ts`.
4. A validação em homologação segue [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md).
