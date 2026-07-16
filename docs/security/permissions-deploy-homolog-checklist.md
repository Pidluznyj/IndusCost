# Checklist deploy / homologação — permissões (P23/P24)

**Não executar migrate/seed/deploy em produção neste ciclo.**  
Usar em homologação ou servidor autorizado após backup.

---

## 1. Backup e pré-requisitos

- [ ] Backup completo do PostgreSQL (bags `AppUser.permissions`, overrides, sessões)
- [ ] Export snapshot A: bags + overrides (`docs/security/permission-backfill-runbook.md`)
- [ ] Checagem sync Nomus (jobs agendados OK; sem sync destrutivo pendente)
- [ ] `git status` limpo no SHA liberado
- [ ] `git pull --ff-only origin main`

---

## 2. Dependências e gates locais (obrigatório antes do deploy)

```bash
cd "$INDUSCOST_APP_DIR"
npm ci
npx prisma validate
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
npm run check:permission-consistency:strict
npm run test:permission-hardening
npm run permissions:compare:legacy-vs-resource
npm run permissions:compare:legacy-vs-effective
npm run permissions:backfill:preview
npm run permissions:validate
npm run build
```

Todos devem passar antes de subir artefato.

---

## 3. Migrations (homolog primeiro)

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma validate
npx prisma generate
```

| Migration | Prompt | Notas |
|-----------|--------|-------|
| `20260723120000_permission_resource_rbac` | P01 | Catálogo RBAC |
| `20260729120000_app_user_permissions_version` | P21 | `permissionsVersion` + epoch sessão |

**Produção:** aplicar em janela planejada.

---

## 4. Seed (idempotente)

```bash
npm run permissions:seed:contract:dry
npm run permissions:seed
npm run permissions:validate
```

---

## 5. Dry-runs (sem escrita destrutiva)

```bash
npm run permissions:dual-write:report
npm run permissions:compare:legacy-vs-resource
npm run permissions:compare:legacy-vs-effective
npm run permissions:backfill:preview
npm run audit:permission-contract:strict
npm run permissions:qa
```

---

## 6. Build e restart

```bash
npm run build
systemctl restart induscost
```

---

## 7. Smoke manual (homolog)

| Persona | Verificar |
|---------|-----------|
| SUPER_ADMIN | Sidebar completa; último SA protegido |
| VIEWER vazio | Zero módulos |
| Leticia AP | AP OK; AR/RH/máquinas negados |
| Sessão stale | ACL change → 401 ou refresh |

---

## 8. Rollback

| Camada | Ação |
|--------|------|
| Código | revert SHA + rebuild |
| DB | restore backup pré-migrate |
| Bags/overrides | snapshot A |

---

## Comandos servidor (homolog)

```bash
cd /opt/induscost
git fetch origin && git pull --ff-only origin main
npm ci
npx prisma migrate deploy
npx prisma generate
npm run permissions:seed
npm run build
sudo systemctl restart induscost
```
