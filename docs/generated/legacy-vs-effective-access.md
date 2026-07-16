# Comparação legado × novo (requireResource)

| Gerado | 2026-07-16T18:05:27.461Z |
| Dry-run | true |
| Subjects | 17 |
| Probes (recurso×ação migrados) | 144 |
| Lockout risk | 2 |
| Mega-key bleed removido | 78 |
| Sem mapeamento | 0 |
| Conflito | 0 |

## Categorias (global)

| Categoria | Count |
|-----------|-------|
| both_denied | 1974 |
| conflict | 0 |
| lockout_risk | 2 |
| mega_key_bleed | 78 |
| new_legitimate_access | 95 |
| permissive_fallback | 0 |
| preserved_intentional | 299 |
| removed_by_deny | 0 |
| unmapped_resource | 0 |

## Cenário Leticia (AP only)

| subjectRef | 53817c43f05f |
| lockout_risk | 0 |
| mega_key_bleed | 3 |

### Diffs

- `finance` / `view`: **mega_key_bleed** (legado=true novo=false source=DENY_DEFAULT)
- `finance.cash_flow` / `view`: **mega_key_bleed** (legado=true novo=false source=DENY_DEFAULT)
- `finance.portfolio_reconciliation` / `view`: **mega_key_bleed** (legado=true novo=false source=DENY_DEFAULT)

## Lockout risk (amostra)

### 40ce03babcd4 (VIEWER)
- `finance.opex:view`
### c51d3c86ada1 (VIEWER)
- `finance.accounts_receivable:export`

---

Read-only. Bleed/mega-key histórico nunca classificado como preservado intencional. Sem escrita em AppUser/overrides.