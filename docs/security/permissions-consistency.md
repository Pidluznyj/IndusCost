# Validador de consistência de permissões (P02)

**Status:** ativo — não altera runtime de auth.  
**Deps:** P01 (`permissionContract`).  
**Aceite:** detecta `admin.employees` no FE ausente do seed; strict impede **novos** gaps.

---

## Comandos

```bash
# Relatório (exit 0) + markdown em docs/generated/
npm run check:permission-consistency
npm run check:permission-consistency:report

# Estrito — exit 1 se houver gap fora do baseline
npm run check:permission-consistency:strict

# JSON opcional
npx tsx scripts/checkPermissionConsistency.ts --strict --json docs/generated/permission-consistency.json

# Sem merge do audit AST (mais rápido)
npx tsx scripts/checkPermissionConsistency.ts --strict --no-audit

# Regenerar baseline (revisar diff antes de commit)
npx tsx scripts/generatePermissionConsistencyBaseline.ts

# Testes
npm run test:permission-consistency
```

Aliases legados (Prompt 03 / audit AST):

```bash
npm run audit:permission-contract:strict
npm run test:permission-audit
```

---

## O que detecta

| Código | Significado |
|--------|-------------|
| `FE_RESOURCE_MISSING_FROM_SEED` | resourceKey no FE ∉ seed |
| `FE_RESOURCE_MISSING_FROM_CONTRACT` | no FE e em nenhum de seed/contrato |
| `SEED_RESOURCE_MISSING_FROM_CONTRACT` | seed sem ponte no contrato |
| `CONTRACT_RELATIONAL_MISSING_FROM_SEED` | relational do contrato ∉ seed |
| `SIDEBAR_*` / `PRIVATE_ROUTE_WITHOUT_RESOURCE` | menu/rota sem resource |
| `TAB_WITHOUT_RESOURCE` | aba/seção sem recurso |
| `ALIAS_DUPLICATE` / `ALIAS_WIDE` | aliases multi-recurso |
| `MEGA_KEY_AS_FINAL_ALIAS` | mega-key como alias preferencial |
| `FE_BE_KEY_MISMATCH` | ex.: `configuracoes` vs `admin.settings` |
| `PERMISSIVE_FALLBACK` | ROLE_MATRIX bag vazia; path unmapped allow |
| `CONTRACT_*` | parent/ciclo/ação inválida |
| `MUTATION_WITHOUT_PERMISSION_GUARD` / `AUDIT_ACTIONABLE_ERROR` | via audit AST |
| `RESOURCE_REGISTERED_NEVER_USED` | contrato sem uso FE/seed/sidebar |

---

## Baseline temporário

Arquivo: `src/lib/security/permissionConsistency/baseline.ts` (~150 entradas na varredura inicial).

- **Strict** falha só se `(code, subject)` **não** estiver no baseline.
- Gaps históricos (ex.: engineering/admin.employees fora do seed, aliases amplos FE, ROLE_MATRIX) ficam baselined — **não** corrigidos neste P02.
- Ao **corrigir** um gap: remova a linha do baseline.
- Ao **adicionar** gap novo: CI falha; só amplie o baseline com revisão explícita.

---

## Limitações

- Não lê banco / `AppUser.permissions[]`.
- Heurística de seções financeiras e AST de rotas (ver também `permissions-validator.md`).
- Baseline stale (entrada sem finding) é info; use `--fail-on-stale` só quando for limpar (não exposto no npm default).

---

## Relação com outros scripts

| Script | Papel |
|--------|--------|
| `check:permission-consistency` | **P02** — cruzamento contrato/seed/FE/sidebar + baseline |
| `audit:permission-contract` | Prompt 03 — AST uso catálogo + mutações |
| `permissions:validate` | setup/catálogo DB opcional |

---

## Código

- `src/lib/security/permissionConsistency/`
- `scripts/checkPermissionConsistency.ts`
- `scripts/generatePermissionConsistencyBaseline.ts`
