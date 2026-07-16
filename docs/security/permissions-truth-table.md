# Tabela-verdade — modelo alvo de permissões (P01)

**Status:** executável em `src/lib/security/permissionContract/truthTable.ts`.  
**Não conectada ao runtime** — espelha as decisões de `permissions-definitive-architecture.md` §3.

---

## 1. Entradas do sujeito

```ts
{
  role: string;           // SUPER_ADMIN | VIEWER | …
  baseline?: {            // snapshot perfil / role preset
    [resourceKey]: { view?: true, … }
  };
  overrides?: {           // allow | deny
    [resourceKey]: { view?: "allow" | "deny", … }
  };
}
```

- Ausência de override = **herdar** baseline.
- `AppUser.permissions[]` **não** entra neste resolvedor (compat temporária).

---

## 2. Ordem de avaliação (`resolvePermissionTruth`)

| # | Condição | Resultado | `reason` |
|---|----------|-----------|----------|
| 1 | `role === SUPER_ADMIN` e recurso+ação suportados | ALLOW | `SUPER_ADMIN_BYPASS` |
| 2 | resourceKey inexistente | DENY | `UNKNOWN_RESOURCE` |
| 3 | ação desconhecida ou não suportada no recurso | DENY | `UNSUPPORTED_ACTION` |
| 4 | algum ancestral com override/baseline? **override view = deny** | DENY | `ANCESTOR_VIEW_DENY` |
| 5 | override local `deny` | DENY | `OVERRIDE_DENY` |
| 6 | override local `allow` | ALLOW | `OVERRIDE_ALLOW` |
| 7 | baseline local `true` | ALLOW | `BASELINE_ALLOW` |
| 8 | default | DENY | `DEFAULT_DENY` |

**Precedência local:** deny > allow > herança (baseline) > DENY.

---

## 3. Navegação vs capacidade

| API | Significado |
|-----|-------------|
| `canPerformPermissionTruth(subject, resource, action)` | Capacidade real (API / gate) |
| `canRevealPermissionNavigation(subject, resource)` | UX: item/accordion revelável |

**Parent virtual:** se o recurso não tem view allow, mas **algum descendente** tem, e não há deny view na cadeia → `canRevealNavigation = true` e `canPerform(view) = false`.

Isso cobre: “navegar pelo parent estritamente necessário” **sem** liberar Financeiro geral / APIs do parent.

---

## 4. Matriz condensada

| Cenário | Decisão |
|---------|---------|
| SUPER_ADMIN + ação suportada | ALLOW |
| Recurso desconhecido | DENY |
| Ação não suportada | DENY |
| Override deny (mesmo com baseline allow) | DENY |
| Override allow (baseline vazio) | ALLOW* |
| Baseline allow, sem override | ALLOW* |
| Baseline vazio, sem override (VIEWER) | DENY |
| Parent view deny + child allow | DENY (filho) |
| Child allow; parent sem grant | Child ALLOW; parent perform DENY; parent reveal ALLOW (virtual) |
| Child allow; sibling sem grant | Sibling DENY |

\* Ainda sujeito a `ANCESTOR_VIEW_DENY`.

---

## 5. Caso Leticia (VIEWER · só Contas a Pagar)

**Sujeito alvo:**

```ts
{
  role: "VIEWER",
  baseline: {},
  overrides: { "finance.accounts_payable": { view: "allow" } }
}
```

| Recurso | perform `view` | reveal navegação |
|---------|----------------|------------------|
| `finance.accounts_payable` | ALLOW | sim |
| `finance` (Financeiro geral) | DENY | sim (virtual) |
| `finance.portfolio_reconciliation` | DENY | não |
| `finance.accounts_receivable` | DENY | não |
| `finance.cash_flow` | DENY | não |
| `admin.employees` (RH) | DENY | não |
| `operations.machines` | DENY | não |
| `engineering` | DENY | não |

Implementação: `evaluateLeticiaAccountsPayableCase()` / `truthTable.test.ts`.

**Nota:** o runtime atual (diagnóstico `48ef617`) **não** se comporta assim — aliases/mega-keys ainda abrem demais. Este documento é o **alvo**.

---

## 6. Configuração do filho

Parent sem grant (herda DENY por default) **não** remove o override do filho. O resolvedor só consulta; não muta `overrides`.

Parent com **deny** explícito de view bloqueia o filho na avaliação (inconsistência a ser rejeitada no admin em fases posteriores).

---

## 7. Relação com mega-keys

A tabela-verdade opera em `resourceKey` × `action` canônicos.  
Mega-keys (`costs.view`, etc.) **não** expandem grants neste modelo. Classificação: `megaKeys.ts` + `permissions-megakey-migration.md`.
