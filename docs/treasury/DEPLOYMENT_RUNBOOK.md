# Central de Tesouraria — Runbook de implantação (produção)

**Audiência:** operador humano no servidor (`/opt/induscost`).  
**Cursor / agentes:** **não** executam deploy, backup, migrate em produção nem restart.

## Pré-condições

1. Branch/tag revisada e mergeada conforme processo do time.
2. Backup de PostgreSQL concluído e verificado.
3. Migrations Prisma versionadas presentes em `prisma/migrations/` (inclui Tesouraria).
4. Variáveis de ambiente já existentes no servidor (não alterar `.env` via Cursor).
5. Flag `TREASURY_MODULE_ENABLED` deliberada (fail-closed se ausente/false).

## Sequência obrigatória (usuário)

```bash
# 1) Backup (procedimento local do ambiente)
# 2) Código
cd /opt/induscost
git pull

# 3) Dependências (se necessário)
npm ci

# 4) Migrations — somente deploy
npx prisma migrate deploy

# 5) Generate client
npx prisma generate

# 6) Build
npm run build

# 7) Restart do processo Node (systemd/pm2/etc. do ambiente)

# 8) Validação local segura (sem escrita)
npm run validate:treasury:deploy
```

## Validação pós-deploy (smoke)

- `GET /api/health` (global) OK.
- `GET /api/finance/treasury/health` com módulo habilitado → HTTP 200 / `ok:true`.
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

1. Restaurar backup de banco se migration/dados forem o problema.
2. Reverter commit/tag no código e rebuild/restart.
3. Não apagar histórico financeiro Tesouraria para “esconder” divergência.
