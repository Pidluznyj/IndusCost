# resolveEffectiveAccess (P03)

**Status:** shadow — não conectado a login, sidebar ou APIs.  
**Código:** `src/lib/security/effectiveAccess/`  
**Arquitetura:** `permissions-definitive-architecture.md` §3.5

## Comandos

```bash
npm run test:effective-access
npx tsx --test src/lib/security/effectiveAccess/effectiveAccess.test.ts
```

## Uso (puro)

```ts
import { resolveEffectiveAccess } from "@/src/lib/security/effectiveAccess";

const result = resolveEffectiveAccess({
  userId: "…",
  role: "VIEWER",
  profileSnapshot: {}, // substitui role preset
  overrides: { "finance.accounts_payable": { view: "allow" } },
  legacyPermissions: ["finance.accountsPayable.view"],
  legacyCompatMode: false, // bag ignorada
  permissionsVersion: 1,
});
```

## Diferenças vs modelo atual (shadow Leticia)

| Recurso | Atual (bag + aliases FE) | Novo resolvedor |
|---------|--------------------------|-----------------|
| Contas a Pagar | allow (bag) | allow |
| Financeiro genérico | allow (alias bleed) | **deny** perform; nav virtual |
| Conciliação | allow (alias cruzado) | **deny** |
| RH / Máquinas (sem costs.view) | deny | deny |

Mega-key `costs.view` em compat mode: **não** projeta RH/Máquinas (warning `LEGACY_MEGA_KEY_SKIPPED`).

## Resolvedores duplicados (ainda vivos)

| Módulo | Papel hoje |
|--------|------------|
| `appAuth.getEffectivePermissions` | Bag filtrada / SUPER_ADMIN = all keys |
| `permissionService.canAccessResource` | Seed PT + role + override null-merge + ancestral view obrigatório |
| `permissionsClient` ROLE_MATRIX | FE bag vazia |
| **`resolveEffectiveAccess`** | Autoridade alvo (P03) — shadow |

P04+ fará o cutover.
