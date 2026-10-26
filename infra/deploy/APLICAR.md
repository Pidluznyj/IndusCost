# Proteção dos executores de deploy — como aplicar (biblioteca v2)

Executores fora do repositório: produção AWS `/usr/local/bin/deploy-induscost-producao` (root, 0700) e
homologação `induscost-deploy-homologacao` (servidor-01). Esta pasta versiona a biblioteca que eles passam a usar
e o roteiro de troca. Ninguém aplica isto automaticamente: é uma alteração manual, feita por quem opera o servidor,
**depois** de conferir o executor completo (os trechos abaixo foram escritos a partir de partes do executor de
produção; o de homologação não foi visto).

## O incidente de 26/10/2026

1. O gate de testes falhou (um teste dependia do lock real de Contas a Receber, que a rotina real segurava).
2. O rollback do executor fez `dropdb teste_bi` + `createdb`, e o `pg_restore` (como `postgres`) não leu o dump:
   o diretório do backup era `root:root 0700`. A checagem `pg_restore -l` do backup rodava como **root**, então
   o problema só apareceu na hora de restaurar.
3. A falha aconteceu **antes** de `prisma migrate deploy`: o banco não precisava de restauração nenhuma.

Correções no código: o teste isola os locks (`testSafeLockPath`) e a suíte foi auditada contra efeitos
colaterais. Correção no executor: esta biblioteca.

## Garantias e códigos de saída

| Garantia | Função | Falha |
|---|---|---|
| G1 escritores parados: timers `induscost-*`, cron, processos Nomus/Exposure em execução; banco sem sessões | `ids_pause_writers` / `ids_resume_writers` | 40 rotina não terminou; 41 sessão aberta; 42 não retomou |
| G2 cerca de escrita: XID antes do `pg_dump` = XID antes das migrations | `ids_backup_db` / `ids_mark_db_changes_started` | 30 backup; 31/32 dump ilegível/vazio; 39 escrita durante o backup; 43 escrita/sessão depois do backup |
| G3 restaura só se as migrations começaram, mudaram o schema e a aplicação nova não subiu | `ids_rollback_db_if_needed` | 0 nada a fazer/restaurado; **2 decisão manual** |
| G4 restauração fiel em banco novo + conferência integral antes da troca | `ids_restore_db_safely` | 33 criar; 34 restore/propriedades; 38 conferência |
| G5 troca atômica (dois `RENAME` numa transação); `<db>__failed_<ts>` preservado; recuperação | `ids_recover_db_state` | 35 fechar conexões; 36 troca desfeita; 44 reabrir; 45 banco ausente |
| G6 gate de testes sem `.env`, banco, credenciais nem locks reais | `ids_run_test_gate` | código dos testes |

## Passo a passo (produção; homologação igual, com o banco, o serviço e o executor dela)

1. Backup do executor atual:

   ```bash
   sudo cp -p /usr/local/bin/deploy-induscost-producao /usr/local/bin/deploy-induscost-producao.before-safety-$(date +%Y%m%d_%H%M%S)
   ```

2. Instalar a biblioteca em local fixo (independe do commit em `/opt/induscost`):

   ```bash
   sudo install -d -m 0755 /usr/local/lib/induscost
   sudo install -m 0644 /opt/induscost/infra/deploy/induscost-deploy-safety.sh /usr/local/lib/induscost/induscost-deploy-safety.sh
   ```

3. Editar o executor (`sudo nano /usr/local/bin/deploy-induscost-producao`):

   a. Logo depois de `LOCK=…` (bloco de variáveis do topo):

   ```bash
   source /usr/local/lib/induscost/induscost-deploy-safety.sh
   ```

   e, depois de obter o lock, antes de qualquer passo:

   ```bash
   # Execução anterior interrompida no meio de uma restauração: reabre o banco ou para (45) sem mexer em nada.
   ids_recover_db_state "$DB" "" || exit 45
   ```

   b. No passo `5/11 BACKUP`, no lugar de `BACKUP_DIR=…`, `DB_BACKUP=…` e `install -d -m 0700 "$BACKUP_DIR"`:

   ```bash
   BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")"
   DB_BACKUP="${BACKUP_DIR}/database-before.dump"
   WRITERS_STATE="${BACKUP_DIR}/writers.state"
   ```

   e, **depois** de parar o serviço, no lugar do bloco `Gerando backup PG17` (de `TMP_DUMP=…` até
   `chmod 600 "$DB_BACKUP"`):

   ```bash
   # Retoma timers/cron em qualquer saída (idempotente). Se o executor já tem `trap … EXIT`, acrescentar esta
   # chamada ao trap existente em vez de substituí-lo.
   trap 'ids_resume_writers "$WRITERS_STATE" || true' EXIT
   if ! ids_pause_writers "$WRITERS_STATE" "$DB"; then
       echo "ERRO: rotinas/sessões ativas no banco — deploy abortado; código e banco não foram alterados."
       ids_resume_writers "$WRITERS_STATE"
       [[ "$SERVICE_WAS_ACTIVE" == 1 ]] && systemctl start "$SERVICE"
       exit 40
   fi
   echo "Gerando backup PG17..."
   if ! ids_backup_db "$DB" "$DB_BACKUP"; then
       echo "ERRO: backup inválido — deploy abortado; código e banco não foram alterados."
       ids_resume_writers "$WRITERS_STATE"
       [[ "$SERVICE_WAS_ACTIVE" == 1 ]] && systemctl start "$SERVICE"
       exit 31
   fi
   ```

   c. No passo dos testes do pacote, trocar o comando que executa os arquivos de teste (o `npx tsx --test …`
   ou equivalente) por `ids_run_test_gate` com os mesmos arquivos:

   ```bash
   ids_run_test_gate "${TEST_FILES[@]}"
   ```

   d. No passo `9/11 BUILD / MIGRATIONS`, imediatamente antes de `./node_modules/.bin/prisma migrate deploy`
   (falhou = houve escrita ou sessão desde o backup; o banco não foi tocado e segue o rollback normal):

   ```bash
   ids_mark_db_changes_started "$BACKUP_DIR" "$DB" || { rollback; exit 43; }
   ```

   e. Imediatamente antes de subir a aplicação nova (`systemctl start "$SERVICE"` / health check):

   ```bash
   ids_mark_app_starting "$BACKUP_DIR"
   ```

   f. Na função `rollback()`, substituir o bloco `--- banco ---` inteiro (do `pg_terminate_backend` até
   `DB_RC=$?`) por:

   ```bash
   ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_BACKUP" "$TS"
   DB_RC=$?
   if [[ "$DB_RC" == 2 ]]; then
       # Migrations aplicadas E a aplicação nova chegou a subir: pode haver escrita de negócio depois do backup.
       # Nada foi restaurado. Serviço e rotinas ficam PARADOS até a decisão (restaurar ou manter o schema novo).
       trap - EXIT
       echo "DECISÃO MANUAL — serviço $SERVICE e rotinas parados; estado de retomada em $WRITERS_STATE"
       exit 2
   fi
   ```

   Depois de reverter o código (o `git reset --hard "$OLD_COMMIT"` + `npm ci` + `prisma generate` + build que o
   executor já faz), conferir que o banco e o código antigo concordam antes do health:

   ```bash
   ./node_modules/.bin/prisma migrate status
   ```

   g. No fim do caminho de sucesso e no fim do `rollback()` (depois do health), retomar as rotinas
   explicitamente (o trap cobre saídas inesperadas):

   ```bash
   ids_resume_writers "$WRITERS_STATE"
   ```

4. Conferir sintaxe e proteções (somente leitura):

   ```bash
   sudo bash -n /usr/local/bin/deploy-induscost-producao
   sudo bash /opt/induscost/scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
   ```

   O verificador precisa terminar com `RESULTADO: executor protegido.` (inclui a conferência de que a cópia em
   `/usr/local/lib/induscost` é idêntica à do repositório).

5. Ajustar a permissão dos diretórios de backup já existentes (os novos já nascem certos):

   ```bash
   sudo chmod 0711 /var/backups/induscost-production /var/backups/induscost-production/deploys
   ```

6. Ensaio sem instalar nada: `sudo /usr/local/bin/deploy-induscost-producao --check`.

## Particularidades a confirmar antes de aplicar

- **Conexões permanentes** (BI, pgAdmin, réplica lógica, monitoramento) no banco: `ids_pause_writers` e o
  marcador recusam qualquer sessão (41/43). Conferir com
  `sudo -u postgres psql -Atc "select usename, application_name, client_addr from pg_stat_activity where datname = 'teste_bi'"`.
- **Outros bancos no mesmo cluster**: a cerca de XID é do cluster inteiro; escrita em outro banco (ex.: o de
  homologação, se estiver no mesmo PostgreSQL) aborta o deploy com 39/43 (falso positivo, nunca falso negativo).
- **Cron**: `systemctl stop cron` pausa todas as rotinas do host durante o deploy; execuções agendadas nessa janela
  não são repostas (os timers `induscost-legal-*` têm `Persistent=true` e são repostos). Se o host usa `crond`
  (não `cron`), ajustar ou usar `IDS_PAUSE_CRON=0` + pausa específica.
- **Collation ICU**: a restauração automática só aceita provedor `libc` (`datlocprovider = 'c'`); com ICU ela
  recusa (33) sem tocar no banco.

## Depois de um rollback com banco restaurado

O estado do banco no momento da falha fica em `teste_bi__failed_<ts>`; a conferência fica em
`<BACKUP_DIR>/restore-journal` e `<BACKUP_DIR>/restore-verification.diff`. Conferir e só então remover
manualmente:

```bash
sudo -u postgres psql -Atc "select datname, datallowconn from pg_database where datname like 'teste_bi%'"
```

## Restauração após "DECISÃO MANUAL" (DB_RC=2)

Só depois de avaliar se houve escrita de negócio relevante desde o backup:

```bash
sudo bash -c 'source /usr/local/lib/induscost/induscost-deploy-safety.sh && ids_restore_db_safely teste_bi <BACKUP_DIR>/database-before.dump <TS>'
```

## Atualizações da biblioteca

Ao mudar `infra/deploy/induscost-deploy-safety.sh`, repetir o passo 2 e o verificador do passo 4. Testes:

- `src/lib/ops/deploySafety.test.ts` — comandos simulados (pausa/retomada, gate, verificador);
- `src/lib/ops/deploySafety.pg17.integration.test.ts` — PostgreSQL 17 real e descartável
  (`COMMISSION_PG17_BIN=<bin>`): cerca de XID, sessões, decisão de rollback, restauração, conferência, troca
  atômica, queda entre os dois `RENAME` e recuperação.
