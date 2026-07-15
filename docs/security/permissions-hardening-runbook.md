# Runbook — deploy / migrate / seed / rollback (Prompt 16)

**Não executar estes comandos em produção neste ciclo de desenvolvimento.**  
Usar apenas em homologação / servidor autorizado.

## Checklist de deploy (código)

1. `git status` limpo no SHA liberado
2. `git pull --ff-only origin main`
3. `npm ci` (ou `npm install`)
4. Gates locais já verdes no RC (imports, test de permissões, build)
5. Backup DB antes de migrate
6. Migrar → seed → validate → restart → smoke

## Checklist de migration

```bash
cd "$INDUSCOST_APP_DIR"
npx prisma migrate status
npx prisma migrate deploy
npx prisma validate
```

Migration ACL: `prisma/migrations/20260723120000_permission_resource_rbac`

## Checklist de seed

```bash
npm run permissions:seed:contract:dry
npm run permissions:seed
npm run permissions:validate
# opcional live:
npx tsx scripts/validatePermissionsSetup.ts
```

Seed deve ser **idempotente** (reaplicar sem duplicar resources).

## Dry-runs (sem escrita destrutiva)

```bash
npm run permissions:seed:contract:dry
npm run permissions:dual-write:report
npm run permissions:compare:legacy-vs-resource
npm run audit:permission-contract:strict
npm run permissions:qa
```

## Smoke tests (pós-restart)

```bash
curl -I http://localhost:3000
# autenticado:
# - GET /api/auth/me (ou equivalente) → permissions carregadas
# - sidebar conforme persona
# - URL direta negada → Access Denied / redirect seguro
# - mutação sem permissão → 403
# - GET /api/test-db sem cookie → 401
```

## Rollback

1. **Código:** `git revert` do SHA RC **ou** checkout do SHA anterior estável + rebuild + restart.
2. **DB:** não dropar tabelas ACL se o código antigo ainda as ignora (bag legada continua).  
   Se migrate nova for o único problema: restore backup pré-migrate.
3. **Seed:** reaplicar seed do SHA estável (`permissions:seed`) se resources foram alterados.
4. Validar: login SUPER_ADMIN, um vendedor, um financeiro; smoke paths críticos.

## Endpoints sensíveis (amostra)

| Rota | Guard |
|------|--------|
| `GET /api/test-db` | `requireAppAuth` |
| Nomus sync manage | `settings.nomus.sync` |
| Commercial owner PATCH | `crm.customers.assign_seller` |
| Fleet reservations-cleanup | SUPER_ADMIN inline |
| Bootstrap super-admin | `requireBootstrapAdmin` |
