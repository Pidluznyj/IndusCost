# Migration e seed — permissionamento relacional

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Plano** | `docs/security/permissions-model-plan.md` |
| **Inventário** | `docs/security/permissions-current-inventory.md` |
| **Migration** | `prisma/migrations/20260723120000_permission_resource_rbac` |
| **Seed** | `scripts/seedPermissionResources.ts` |
| **Dados** | `src/lib/permissionResourceSeedData.ts` |

---

## 1. Verificação prévia (o que já existia)

| Artefato | Existe? | Decisão |
|----------|---------|---------|
| `AppUser` / `AppUserRole` / `AppSession` | Sim | **Reutilizar** — não alterar roles |
| `AccessProfile` + `AppUser.permissions[]` | Sim | **Manter** como fonte de runtime atual |
| `PERMISSION_CATALOG` (código) | Sim | **Manter**; aliases no seed |
| Tabelas `Permission` / `RolePermission` / `UserPermission` | Não | Criar modelo novo |
| `AppUserChangeLog` | Não | — |
| AuditLogs de domínio (Fleet, Inventory, Finance CC, Market Quote, …) | Sim | **Não reutilizar** (escopo de domínio, sem target role/user ACL) |

Conclusão: criar tabelas ACL dedicadas é seguro e **aditivo**. Não há duplicata a fundir.

---

## 2. Modelo criado

### Enum

- `PermissionResourceType`: `MENU` | `SUBMENU` | `TAB` | `ACTION`

### Tabelas

1. **`PermissionResource`** — catálogo hierárquico (`key` unique, `parentKey` → self).
2. **`RolePermission`** — defaults por `AppUserRole` + `resourceKey` (`canView` / `canExecute` / `canManage`).
3. **`UserPermissionOverride`** — exceções por usuário (flags nullable = sem override naquele eixo).
4. **`PermissionAuditLog`** — auditoria de ACL (não havia padrão de app-user ACL).

`AppUser` ganhou relações opcionais para overrides e audit; **nenhum campo de role/permissions existente foi removido ou renomeado**.

---

## 3. Runtime (importante)

| Camada | Comportamento após esta entrega |
|--------|----------------------------------|
| Login / `getEffectivePermissions` | **Inalterado** (SUPER_ADMIN bypass + `AppUser.permissions[]`) |
| API guards / menu / tabs | **Inalterado** |
| Novas tabelas | Preparação para cutover futuro; seed popula defaults |

Não há dual-read ainda. Isso evita quebrar roles e sessões atuais.

---

## 4. Migration

- Arquivo: `prisma/migrations/20260723120000_permission_resource_rbac/migration.sql`
- **Não aplicar em produção neste prompt.**
- Local (quando houver `DATABASE_URL` de dev):

```bash
npx prisma validate
npx prisma generate
# somente em ambiente local/dev autorizado:
# npx prisma migrate deploy
# ou: npx prisma migrate dev
```

---

## 5. Seed idempotente

```bash
npx tsx scripts/seedPermissionResources.ts
npx tsx scripts/seedPermissionResources.ts --dry-run
npx tsx scripts/seedPermissionResources.ts --sync-role-defaults
```

| Comportamento | Detalhe |
|---------------|---------|
| Resources | Upsert por `key` (label, type, parent, module, sortOrder, isActive) |
| RolePermission SUPER_ADMIN | Sempre sincroniza full (`view`+`execute`+`manage`) |
| RolePermission demais | **Create-only** por padrão (não sobrescreve customização) |
| `--sync-role-defaults` | Recarrega flags da matriz seed nos roles não-SUPER_ADMIN |
| Deletes | **Nunca** remove `RolePermission`, overrides ou resources |
| `AppUser.permissions` | **Nunca** alterado |
| SUPER_ADMIN usuário | Só **verifica** presença; não cria usuário/senha |
| `PERMISSION_SEED_REQUIRE_SUPER_ADMIN=1` | Falha o seed se não houver SUPER_ADMIN ativo |
| Audit | Grava `PermissionAuditLog.action = SEED_PERMISSION_RESOURCES` |

Catálogo seed mínimo: dashboard, financeiro (+ conciliação e 3 tabs, CR, CP, fluxo, presidencial), comercial (+ pedidos, CRM), comissões, suprimentos (+ inteligência), admin (+ usuários, permissões, action.manage).

---

## 6. Testes

- Unitários (sem DB): `src/lib/permissionResourceSeedData.test.ts`
  - hierarquia, matriz, SUPER_ADMIN full, ADMIN sem manage ACL crítica, política de update
- Seed contra DB: só após migrate local + `DATABASE_URL`

---

## 7. Critérios de aceite

- [x] Prisma schema + migration no repositório
- [x] `prisma validate` / `prisma generate`
- [x] Seed idempotente + política anti-delete
- [x] SUPER_ADMIN full no seed de RolePermission
- [x] Checagem de ≥1 SUPER_ADMIN (warn / fail opcional)
- [x] Sem alteração de UI / guards / `AppUser.permissions`
- [x] Docs nesta pasta

---

## 8. Próximos passos (fora deste prompt)

1. Aplicar migrate em dev.
2. Rodar seed.
3. Implementar resolver dual-read (RolePermission + override + legado String[]).
4. Ligar PermissionEditor / API admin às novas tabelas.
5. Remover OR legado financeiro após backfill.
