# DTO de acesso efetivo — `/api/auth/me` (P04)

**Status:** implementado em **shadow** — flag `EFFECTIVE_ACCESS_DTO_IN_ME` (default off).  
**Autoridade de sessão hoje:** `user.permissions` / `user.effectivePermissions` (bag).  
**Resolvedor:** P03 `resolveEffectiveAccess`.

---

## Contrato público (`EffectiveAccessMeDto`)

```ts
{
  permissionsVersion: number;      // placeholder 0 até migration AppUser.permissionsVersion
  role: string;
  isSuperAdmin: boolean;           // true → listas vazias (payload compacto)
  allowedResources: string[];      // resourceKeys com ≥1 allow
  actionsByResource: Record<string, Action[]>;
  navigationReveal: string[];      // incl. parent virtual
  capabilities: Record<string, { canView; canExecute; canManage }>;
  compatibility: {
    mode: "shadow";
    legacyBagAuthoritative: true;  // runtime ainda usa permissions[]
    legacyPermissionsPresent: boolean;
    legacyCompatApplied: boolean;
  };
}
```

**Não inclui:** aliases, sources internas, mega-keys, denies em massa, PII, baseline completo.

**Admin (fora do /me):** `EffectiveAccessAdminDto` = Me + `denies` (só `OVERRIDE_DENY` / `ANCESTOR_VIEW_DENY`) + `warnings` sanitizados.

---

## Resposta `/api/auth/me`

### Não autenticado (inalterado)

```json
{ "authenticated": false, "user": null }
```

### Autenticado (flag off — default)

```json
{ "authenticated": true, "user": { /* SafeAppUser com permissions[] */ } }
```

### Autenticado (flag on)

```json
{
  "authenticated": true,
  "user": { /* SafeAppUser — permissions[] intactas */ },
  "effectiveAccess": { /* EffectiveAccessMeDto */ }
}
```

AuthContext **ignora** `effectiveAccess` por enquanto (comportamento de sessão inalterado).

---

## Flags

| Env | Default | Efeito |
|-----|---------|--------|
| `EFFECTIVE_ACCESS_DTO_IN_ME` | off | Anexa `effectiveAccess` no `/me` |
| `EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT` | off | Projeta bag 1:1 **dentro do DTO** (não muda auth) |

---

## Código

| Path | Papel |
|------|--------|
| `src/lib/effectiveAccessDtoTypes.ts` | Tipos FE-safe |
| `src/lib/effectiveAccessDtoValidate.ts` | Validação / serialização estável |
| `src/lib/security/effectiveAccessDto/*` | Builder + attach `/me` |
| `src/lib/appAuthClient.ts` | `AuthMeResponse.effectiveAccess?` |

```bash
npm run test:effective-access-dto
```

---

## Plano para retirar `permissions[]`

1. **P04 (agora):** DTO shadow; bag autoridade; `legacyBagAuthoritative: true`.
2. **P05–P06:** deny real + dual-write 1:1; bag materializada do resolvedor.
3. **P07:** remover ROLE_MATRIX FE; bag vazia = sem acesso.
4. **P04 cutover:** FE `canView(resourceKey)` só do DTO; guards BE usam `resolveEffectiveAccess`.
5. **Deprecar:** `user.permissions` / `effectivePermissions` read-only → remoção após telemetria zero.
6. **Migration:** coluna `permissionsVersion` + bump em save ACL (P21).

Rollback do shadow: desligar `EFFECTIVE_ACCESS_DTO_IN_ME` (clients ignoram campo ausente).
