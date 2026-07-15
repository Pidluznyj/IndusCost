# Seed hierárquico do catálogo (Prompt 05)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Seed de catálogo — **não** altera grants nem navegação runtime |
| **Fonte** | Contrato canônico P02 + seed PT legado (bridge) |
| **Código** | `src/lib/security/permissionCatalogSeed/` |
| **CLI** | `scripts/seedPermissionCatalogFromContract.ts` |

---

## Objetivo

Materializar a árvore canônica em `PermissionResource` de forma **idempotente**, preservando recursos PT legados (sem delete), sem tocar em:

- `AppUser.permissions[]`
- `RolePermission`
- `UserPermissionOverride`
- `AccessProfile`
- sidebar / guards efetivos

## Comandos

```bash
# Dry-run (padrão se só --dry-run ou sem --apply; offline se sem DATABASE_URL)
npm run permissions:seed:contract:dry

# Apply explícito (requer DATABASE_URL de **dev/teste** — nunca produção neste prompt)
npm run permissions:seed:contract:apply

# Só lista o plano
npx tsx scripts/seedPermissionCatalogFromContract.ts --plan-only

# Testes (mock in-memory; sem DB)
npm run test:permission-catalog-seed
```

Relatório: `docs/generated/permission-catalog-seed-report.md`

## Comportamento

1. Constrói plano: recursos do contrato + seed PT (`PERMISSION_RESOURCE_SEEDS`).
2. Chaves iguais (`dashboard`, `admin`): merge de aliases; canônico prevalece.
3. Legado com UI oculta: descrição com `[obsolete_ui]` / `[bridged_legacy]`; **`isActive` permanece true**.
4. Diff vs banco → create / update / unchanged.
5. Segunda apply sem drift → `create=0`, `update=0`.
6. Apply em transaction quando Prisma disponível; mock faz rollback em erro.

## Aliases

Não há coluna de alias no Prisma. Aliases ficam no **plano** (`legacyAliasKeys`) e embutidos na `description` para auditoria. Runtime de materialização legado (dual-write admin) continua no seed PT antigo.

## Seed antigo

`npm run permissions:seed` (`seedPermissionResources.ts`) permanece para o catálogo PT + RolePermission. O seed Prompt 05 é **paralelo** e focado em catálogo a partir do contrato.

## Produção

**Não** executar `--apply` nem migration em produção neste prompt.
