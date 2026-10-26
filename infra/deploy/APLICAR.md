# Proteção dos executores de deploy — como aplicar

Executores fora do repositório: produção AWS `/usr/local/bin/deploy-induscost-producao` (root, 0700) e
homologação `induscost-deploy-homologacao` (servidor-01). Esta pasta versiona a biblioteca que eles passam a usar
e o roteiro de troca. Ninguém aplica isto automaticamente: é uma alteração manual, feita por quem opera o servidor.

## O incidente de 26/10/2026

1. O gate de testes falhou (um teste dependia do lock real de Contas a Receber, que a rotina real segurava).
2. O rollback do executor fez `dropdb teste_bi` + `createdb`, e o `pg_restore` (como `postgres`) não leu o dump:
   o diretório do backup era `root:root 0700`. A checagem `pg_restore -l` do backup rodava como **root**, então
   o problema só apareceu na hora de restaurar.
3. A falha aconteceu **antes** de `prisma migrate deploy`: o banco não precisava de restauração nenhuma.

Correções no código (já na `main`): o teste isola os locks e a suíte foi auditada contra efeitos colaterais.
Correção no executor: esta biblioteca.

## O que muda

| Trecho do executor | Antes | Depois |
|---|---|---|
| Diretório do backup | `install -d -m 0700` (root) | `ids_prepare_backup_dir` — dono `postgres`, pais `0711` |
| Backup | `pg_dump` em `/tmp` + `mv` + `pg_restore -l` como root | `ids_backup_db` — grava direto e confere **como postgres**; inválido aborta o deploy antes do código |
| Testes do pacote | rodam com o `.env` real (banco, Nomus, integrações) e locks reais | `ids_run_test_gate` — sem `.env`, banco inalcançável, chaves do `.env` vazias, locks temporários |
| Antes das migrations | — | `ids_mark_db_changes_started "$BACKUP_DIR"` |
| Rollback do banco | `dropdb` + `createdb` + `pg_restore` sempre | `ids_rollback_db_if_needed` — só se as migrations começaram; restaura num banco novo e troca os nomes; o banco atual fica como `<db>__failed_<ts>`; nunca `dropdb` |

## Passo a passo (produção; homologação igual, com o banco e o executor dela)

1. Backup do executor atual:

   ```bash
   sudo cp -p /usr/local/bin/deploy-induscost-producao /usr/local/bin/deploy-induscost-producao.before-safety-$(date +%Y%m%d_%H%M%S)
   ```

2. Instalar a biblioteca em local fixo (independe do commit em `/opt/induscost`):

   ```bash
   sudo install -d -m 0755 /usr/local/lib/induscost
   sudo install -m 0644 /opt/induscost/infra/deploy/induscost-deploy-safety.sh /usr/local/lib/induscost/induscost-deploy-safety.sh
   ```

3. Editar `/usr/local/bin/deploy-induscost-producao` (`sudo nano …`):

   a. Logo depois de `LOCK=…` (bloco de variáveis do topo):

   ```bash
   source /usr/local/lib/induscost/induscost-deploy-safety.sh
   ```

   b. No passo `5/11 BACKUP`, trocar a criação do diretório e o bloco `Gerando backup PG17` (de
   `TMP_DUMP=…` até `chmod 600 "$DB_BACKUP"`) por:

   ```bash
   BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")"
   DB_BACKUP="${BACKUP_DIR}/database-before.dump"
   ```

   (no lugar de `BACKUP_DIR=…`, `DB_BACKUP=…` e `install -d -m 0700 "$BACKUP_DIR"`) e

   ```bash
   echo "Gerando backup PG17..."
   if ! ids_backup_db "$DB" "$DB_BACKUP"; then
       echo "ERRO: backup inválido — deploy abortado; código e banco não foram alterados."
       [[ "$SERVICE_WAS_ACTIVE" == 1 ]] && systemctl start "$SERVICE"
       exit 31
   fi
   ```

   c. No passo dos testes do pacote, trocar o comando que executa os arquivos de teste (o `npx tsx --test …`
   ou equivalente) por `ids_run_test_gate` com os mesmos arquivos, por exemplo:

   ```bash
   ids_run_test_gate "${TEST_FILES[@]}"
   ```

   d. No passo `9/11 BUILD / MIGRATIONS`, imediatamente antes de `./node_modules/.bin/prisma migrate deploy`:

   ```bash
   ids_mark_db_changes_started "$BACKUP_DIR"
   ```

   e. Na função `rollback()`, substituir o bloco `--- banco ---` inteiro (do `pg_terminate_backend` até
   `DB_RC=$?`) por:

   ```bash
   ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_OWNER" "$DB_BACKUP" "$TS"
   DB_RC=$?
   ```

4. Conferir sintaxe e proteções (somente leitura):

   ```bash
   sudo bash -n /usr/local/bin/deploy-induscost-producao
   sudo bash /opt/induscost/scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
   ```

   O verificador precisa terminar com `RESULTADO: executor protegido.`

5. Ajustar a permissão dos diretórios de backup já existentes (os novos já nascem certos):

   ```bash
   sudo chmod 0711 /var/backups/induscost-production /var/backups/induscost-production/deploys
   ```

6. Ensaio sem instalar nada: `sudo /usr/local/bin/deploy-induscost-producao --check`.

## Depois de um rollback com banco restaurado

O estado do banco no momento da falha fica em `teste_bi__failed_<ts>`. Conferir e só então remover manualmente:

```bash
sudo -u postgres psql -Atc "select datname from pg_database where datname like 'teste_bi__%'"
```

## Atualizações da biblioteca

Ao mudar `infra/deploy/induscost-deploy-safety.sh`, repetir o passo 2 e o verificador do passo 4. Os testes da
biblioteca estão em `src/lib/ops/deploySafety.test.ts` (rodam com comandos de banco simulados; nada toca o
PostgreSQL).
