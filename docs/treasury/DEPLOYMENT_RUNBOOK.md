# Central de Tesouraria — Runbook de implantação (produção)

**Audiência:** operador humano no servidor (`/opt/induscost`).  
**Cursor / agentes:** **não** executam deploy, backup, migrate em produção nem restart.

> **Documento completo:** [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md)  
> **Rollback:** [ROLLBACK.md](./ROLLBACK.md)

## Pré-condições

1. Branch `main` revisada e mergeada (`origin/main`).
2. Backup de PostgreSQL concluído e verificado.
3. Migrations Prisma versionadas presentes em `prisma/migrations/` (inclui Tesouraria).
4. Variáveis de ambiente já existentes no servidor (não alterar `.env` via Cursor).
5. Flags Tesouraria: **opt-in** — mestra ausente = OFF; ativar com `TREASURY_MODULE_ENABLED=1` (ver [ACTIVATION.md](./ACTIVATION.md)).
6. Subflags: com mestra ON e ausentes = ON; fail-closed para flag/valor desconhecidos ([19-ROLLOUT.md](./19-ROLLOUT.md)). OFF não apaga dados.
7. Permissões ADMIN: `npm run treasury:permissions:seed` (dry-run) depois `--apply`. **Não** usar `--sync-role-defaults`.

## Sequência obrigatória (usuário)

```bash
cd /opt/induscost

# 1) Backup
bash scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_treasury

# 2) Pré-checagem (lock + git + prisma validate + validate:treasury:deploy)
bash scripts/treasury/predeploy-check.sh --require-backup

# 3) Deploy oficial (pull ff-only, migrate deploy, generate, build, restart)
bash scripts/deploy-induscost.sh
# Se package-lock mudou e o script não rodou deps: npm ci

# 4) Validação pós-deploy
bash scripts/treasury/postdeploy-validation.sh

# 5) Smoke autenticado (availability + UI)
```

## Validação pós-deploy (smoke)

- Script: `bash scripts/treasury/postdeploy-validation.sh`
- `GET /api/health` (global) OK.
- `GET /api/finance/treasury/health` — 200/auth ou 404 se flag OFF.
- `GET /api/finance/treasury/availability` com sessão autorizada.
- Nav `/finance/treasury` acessível apenas com `finance.treasury` + flag.
- Não usar `prisma db push` nem `prisma migrate dev` em produção.

## Backfill opcional (complementos)

Somente após migrate e com usuário válido:

```bash
npm run backfill:treasury:title-complements:preview -- --title-type=all --from=YYYY-MM-DD --to=YYYY-MM-DD
npm run backfill:treasury:title-complements:apply -- --created-by-user-id=<UUID> --checkpoint-file=.tmp/treasury-complement-backfill.json
```

## Rollback

Ver [ROLLBACK.md](./ROLLBACK.md). Resumo: restore de backup se migration/dados; checkout de commit bom + rebuild; flags OFF sem apagar dados.
