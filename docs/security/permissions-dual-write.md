# Dual-write e materialização legada (P06)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Serviço central P06 — bag ainda é autoridade de runtime |
| **Código** | `src/lib/security/permissionDualWrite/` |
| **CLI** | `scripts/permissionDualWriteReport.ts` (somente dry-run / relatório) |

---

## Modelo

| Camada | Papel |
|--------|--------|
| **Estruturado** (`resourceKey` + eixos / overrides) | Fonte futura de verdade |
| **Bag legada** (`AppUser.permissions[]`) | Materialização temporária para login/guards/sidebar |
| **Mega-keys no runtime** | **Ainda presentes** (FE/API); dual-write **não** as expande N:1 |

## Algoritmo

### Estruturado → legado (`materializeUserLegacyBag` / `materializeStructuredToLegacy`)

1. Para cada chave legada do índice, usa **apenas o binding canônico 1:1** (recurso mais profundo).
2. Emite a chave se o eixo do canônico estiver permitido (`flagAllowsAlias`).
3. **Deny** (flag falsa no canônico) ⇒ chave mapeada **não** é reemitida (sai da bag).
4. Preserva chaves do bag anterior que estão no `PERMISSION_CATALOG` **sem** alias estrutural → `preservedUnmapped` + `unmappedReport`.
5. Chaves fora do catálogo → drop (relatório `outside_catalog`); opcional `preserveOutsideCatalog`.
6. Ordenação lexicográfica estável; idempotente.
7. **Não** injeta baseline VIEWER/role — o caller passa o mapa efetivo desejado.

### Legado → estruturado (projeção / backfill)

- Projeta cada chave só no recurso canônico 1:1.
- Apply de backfill grava **somente** overrides; **nunca** regrava `permissions[]` no mesmo passo.
- Exige `confirmBackfillApply=true`. **Não executar backfill em produção neste prompt.**

## Pontos de gravação

| Ponto | Comportamento P06 |
|-------|-------------------|
| `saveUserPermissionOverrides` | `materializeUserLegacyBag` (effective = role∪overrides) + tx |
| `applyRolePreset` / restore | Rematerializa preset; limpa overrides; preserve unmapped |
| `POST /api/admin/users` | **Sem** baseline silencioso se bag vazia |
| `applyAccessProfileToUsers` | Substitui bag pelo snapshot do perfil; **limpa overrides** (não acumula) |
| `AccessProfile` save | Só snapshot do perfil (anti-cascade) |
| `applyDualWrite` | Dry-run / apply com before/after; porta pluggable |

## Dry-run e comparação

```ts
materializeUserLegacyBag({ effectiveByResourceKey, previousLegacyPermissions, dryRun: true })
// → plan.beforeLegacy / afterLegacy / gainedLegacy / lostLegacy / unknownKeysReport
```

```bash
npm run permissions:dual-write:report
npm run test:permission-dual-write
```

## Limitações temporárias

- Runtime ainda lê a bag (não o resolvedor P03).
- Seed ainda lista aliases N:1 (colisões reportadas); materialização ignora não-canônicos.
- Criar usuário sem perfil e sem `permissions` → bag vazia (sem menu até assign/preset) — alinhado a P07.
- Modo restrição absoluta (Leticia) depende de mapa efetivo com DENY nos baselines (P05 `mode: absolute`).

## Rollback

1. Reaplicar preset / clear overrides.
2. Reaplicar perfil (`applyAccessProfileToUsers`).
3. Sem migration Prisma neste item.

## Produção

**Não** executar backfill apply nem migration em produção neste prompt.
