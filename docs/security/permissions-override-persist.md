# Persistência de overrides — INHERIT / ALLOW / DENY (P05)

**Status:** implementado — encoding DB existente; sem migration Prisma.  
**Runtime consumers:** não trocados em massa (login/sidebar/APIs seguem bag). Resolvedor/DTO em shadow (P03/P04).

---

## Encoding (já no schema)

`UserPermissionOverride.canView | canExecute | canManage` = `Boolean?`:

| Estado   | Coluna |
|----------|--------|
| INHERIT  | `null` |
| ALLOW    | `true` |
| DENY     | `false` |

Constraint: `@@unique([userId, resourceKey])`. FK → `PermissionResource.key`.  
**Migration:** não necessária (defaults seguros já são `null` = herança).

---

## Regras

- Desmarcar concessão herdada (baseline `true` → draft `false`) → **DENY**.
- Limpar override (tudo INHERIT / DELETE) → volta à herança da role/perfil.
- ALLOW e DENY no mesmo eixo são impossíveis no encoding ternário.
- Recurso fora do catálogo seed → `UNKNOWN_RESOURCE` (400).
- Estado inválido → `INVALID_OVERRIDE_STATE` / `INVALID_AXIS_VALUE` (400).
- Modos de save:
  - `differential` (default): só diffs vs baseline da role.
  - `absolute`: não marcado → DENY (ex.: Leticia só Contas a Pagar). No serviço, completa DENY nos recursos do preset da role não enviados.

---

## Endpoints

| Método | Path | Notas |
|--------|------|--------|
| `PUT` | `/api/admin/users/:id/permission-overrides` | Body: `{ overrides, mode?, ifMatchOverrideCount?, reason? }` |
| `DELETE` | `/api/admin/users/:id/permission-overrides` | Clear → INHERIT; exige `confirm` |
| `GET` | `/api/admin/users/:id/permissions` | Árvore + overrides atuais |
| `POST` | `.../permissions/restore-role-default` | Rollback operacional |

**Concorrência:** `ifMatchOverrideCount` ≠ count atual → `CONFLICT` (409); não grava.  
**Transação:** deleteMany overrides + create + update `AppUser.permissions` (dual-write) + auditoria `PermissionAuditLog`.

---

## Round-trip

```
UI draft → overridesPayloadFromDraft / buildPersistableOverridesFromDraft
  → PUT (validateAndNormalizeOverrideInputs)
  → UserPermissionOverride + AppUser.permissions
  → buildEffectiveFlagsMap → materializeLegacyPermissionsFromFlags
  → mapSeedAxisOverridesToContract → resolveEffectiveAccess → EffectiveAccess DTO
```

---

## Diagnóstico / rollback

**Diagnóstico:** comparar `GET .../permissions` (overrides + bag) com `resolveEffectiveAccess` / DTO shadow. Aceite P05: VIEWER + deny `comercial` (+ `comercial.pedidos_venda`) → bag sem `crm.view`.

**Rollback (sem migration):**

1. `DELETE .../permission-overrides?confirm=1` — limpa overrides (INHERIT).
2. ou `POST .../permissions/restore-role-default` com confirmação.
3. Modo `absolute` só via API (`mode: "absolute"`); UI admin pode permanecer differential.

**Não executar** `prisma migrate` em produção para este item — não há migration nova.

---

## Testes

- `npm run test:permission-override` — encode/decode, validação, herança/allow/deny/absolute/Leticia/concorrência/auditoria.
- Relacionados: `test:permission-contract`, `test:effective-access`, `test:effective-access-dto`, `test:permission-dual-write`.

---

## Módulos

- `src/lib/security/permissionOverrideState.ts`
- `src/lib/security/permissionOverrideValidate.ts`
- `src/lib/security/userPermissionAdminService.ts` / `userPermissionAdminRoutes.ts`
- `src/lib/userPermissionsAdminUi.ts` / `userPermissionsAdminClient.ts`
