# Contrato tipado de permissões (P01)

**Status:** implementado como fonte tipada — **não** conectado ao runtime de auth.  
**Escopo:** apenas contrato + helpers + tabela-verdade. Sem mudança em login, sidebar, rotas, APIs, banco ou seed de produção.  
**Base:** commits `48ef617` (diagnóstico), `234ef7b` (arquitetura/plano); docs `permissions-definitive-architecture.md`, `permissions-remediation-plan.md`, `permissions-megakey-migration.md`.

---

## 1. Fonte única

| Camada | Path | Papel |
|--------|------|--------|
| Fonte editável | `src/lib/security/permissionContract/resources.ts` | Lista canônica de recursos/ações/aliases legados |
| Tipos | `…/types.ts` | Actions, groups, resource, catalog entry, truth subject |
| Catálogo normalizado | `buildPermissionContractCatalog()` em `helpers.ts` | Visão tipada definitiva com todos os campos P01 |
| Mega-keys | `…/megaKeys.ts` | Inventário de incompatibilidades temporárias |
| Tabela-verdade | `…/truthTable.ts` | Precedência deny > allow > herança (puro) |
| Validação estrutural | `…/validate.ts` | Ciclos, parents, aliases relacionais, etc. |

**Não é autoridade de runtime.** `AppUser.permissions[]` permanece compatibilidade temporária fora deste módulo.

---

## 2. Campos do catálogo tipado (`PermissionContractCatalogEntry`)

| Campo | Origem |
|-------|--------|
| `resourceKey` | recurso |
| `label` | recurso |
| `group` | `groupId` |
| `parentKey` | hierarquia |
| `order` | `sortOrder` |
| `supportedActions` | `actions[].action` |
| `sensitivity` | recurso |
| `metadata` | route, sidebar, tab, detail, endpoints, moduleId, relational keys |
| `legacyAliases` | cada legacy key + `aliasStatus` |
| `deprecated` | default `false` |
| `replacementKeys` | default `[]` |
| `migrationStatus` | `active` \| `deprecated` \| `pending_split` \| `legacy_compat` |

### Status de alias (`aliasStatus`)

| Valor | Significado |
|-------|-------------|
| `canonical_1_1` | Alias final permitido (1 recurso) |
| `mega_key_temporary` | Mega-key (`costs.view`, `finance.view`, …) |
| `cross_resource_bleed_temporary` | Chave “dedicada” ainda usada em >1 recurso |
| `deprecated` | Alias a remover |

**Regra alvo:** aliases finais = **1:1**. Mega-keys = incompatibilidade temporária.

---

## 3. Ações canônicas

```
view, create, update, delete, export, execute,
approve, close, reopen, reprocess, manage
```

Recurso ou ação desconhecida / não suportada → **DENY** (tabela-verdade).

---

## 4. Helpers puros

| Helper | Função |
|--------|--------|
| `isKnownPermissionResource` / `isKnownPermissionAction` | Validar existência |
| `getPermissionParentKey` / `listPermissionAncestors` / `listPermissionChildren` / `listPermissionDescendants` | Hierarquia |
| `hasPermissionParentCycle` / `listPermissionParentCycles` | Ciclos |
| `listSupportedActions` / `supportsPermissionAction` | Ações do recurso |
| `classifyLegacyAliasStatus` / `listLegacyAliasesForResource` / `getCanonicalLegacyAlias` | Aliases |
| `isDeprecatedPermissionResource` / `listReplacementKeys` | Depreciação |
| `listPermissionMegaKeyRecords` / `detectCrossResourceLegacyKeys` | Mega-keys |
| `buildPermissionContractCatalog` | Fonte tipada completa |

---

## 5. Decisões fechadas (codificadas na tabela-verdade)

| Decisão | Valor |
|---------|--------|
| Autoridade | Backend (este módulo = contrato puro até P0x ligar runtime) |
| Precedência | deny > allow > herança (baseline) |
| Sem override | herda baseline; sem grant → DENY |
| Desconhecido | DENY |
| VIEWER vazio | sem acesso |
| Perfil | snapshot = `baseline` |
| SUPER_ADMIN | bypass em ações suportadas |
| Parent deny(view) | bloqueia filho |
| Filho allow | não apaga config; não concede parent/irmãos |
| Bag `permissions[]` | fora do resolvedor alvo |
| Aliases finais | 1:1 |
| Mega-keys | temporárias |

Detalhe executável: `docs/security/permissions-truth-table.md`.

---

## 6. Contas a Pagar (piloto Leticia)

| Campo | Valor |
|-------|--------|
| `resourceKey` | `finance.accounts_payable` |
| Parent | `finance` |
| Alias canônico preferencial | `finance.accountsPayable.view` |
| Alias amplo residual no binding | `finance.view` → `mega_key_temporary` |

Caso Leticia: ver tabela-verdade e `evaluateLeticiaAccountsPayableCase()`.

---

## 7. Mega-keys marcadas

Ver `listPermissionMegaKeyRecords()` e `docs/security/permissions-megakey-migration.md`.

Principais: `costs.view`, `costs.edit`, `finance.view`, bleed histórico de `finance.accountsPayable.view`, `reports.view`, `settings.view`.

---

## 8. Testes

- `permissionContract.test.ts` — estrutura / matriz
- `helpers.test.ts` — helpers P01
- `truthTable.test.ts` — precedência + Leticia
- `permissionsRuntimeDiagnosis.test.ts` — diagnóstico do runtime **atual** (não é o alvo)

---

## 9. Fora de escopo (P01)

Não alterar: runtime auth, login, sidebar, rotas, APIs, Prisma seed de produção, dual-write.  
Não iniciar P02 (validador CI de consistência).
