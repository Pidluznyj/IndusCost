# Permissions — Hardening / Release Candidate (Prompt 16)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Escopo** | Validação ponta a ponta do permissionamento; correções bloqueantes; docs de homologação |
| **Produção** | **Não** executar migrate/seed/deploy neste run |

---

## 1. Critérios de liberação (RC)

| Critério | Meta | Resultado deste run |
|----------|------|---------------------|
| Gaps críticos / altos (audit actionable) | 0 | **0** (`actionableErrors=0`) |
| API de mutação sem guard | 0 (exceto known médios SUPER_ADMIN inline) | **OK** — test-db autenticado; commercial-owner com perm; Nomus sync alinhado |
| Divergência FE/BE conhecida | 0 | **OK** — mismatch Nomus removido |
| Revogação involuntária legado → efetivo | 0 | **PASS** (`permissions:compare:legacy-vs-resource`) |
| Build / prisma validate / imports / bundle | verde | **OK** |
| Migrate + seed | idempotentes em teste; não aplicados em prod | **Documentado** — não executado em prod |

**Veredicto código:** critérios de liberação para **homologação** atendidos neste workstation.  
**Veredicto produção:** **não liberado** até migrate + seed + smoke no servidor (comandos no runbook — **não** executados aqui).

---

## 2. Arquitetura final (resumo)

```
AppUser.permissions[]  ──dual-write──►  RolePermission / UserPermissionOverride
        │                                         │
        ▼                                         ▼
 permissionCatalog / contract              permissionService (resource tree)
        │                                         │
        └────────────► FE/BE guards ◄─────────────┘
                         │
            canViewModule / requirePermission
                         │
              sidebar · rotas · abas · botões · APIs
```

- **Fonte de verdade runtime atual:** bag legada + `ROLE_MATRIX` FE + guards Express; árvore relacional é overlay + dual-write.
- **Navegação view:** `resourceNavigationAccess` (`canViewResource` / `canViewModule`).
- **SUPER_ADMIN:** bypass total; último SA protegido em admin API (`isLastSuperAdmin`).

---

## 3. Correções RC deste passo

| Item | Correção |
|------|----------|
| `finance.executiveReport.view` | Incluída no `PERMISSION_CATALOG` |
| `GET /api/test-db` | `requireAppAuth` |
| Nomus / billing sync | Guards BE só `settings.nomus.sync` (alinhado ao FE) |
| `PATCH .../commercial-owner` | `requirePermission(assign_seller)` |
| Aliases financeiro / conciliação | Paridade com `canAccessModule` (AR/AP/`reports.view`/…) |
| Seed `comissoes.tab.fechamentos` | Presente na ROLE_MATRIX do seed |
| Known gaps | Removidos itens já fechados; documentados cleanup fleet + bootstrap SA |

---

## 4. Inventário (este run)

| Métrica | Valor |
|---------|------:|
| Recursos (contrato) | 76 |
| Bindings action no contrato | 140 |
| Chaves catálogo legado | 176 |
| Seed resources | 45 |
| Rotas auditadas | 719 |
| Findings error / warn / info | 0 / 9 / 73 |
| Known gaps (info) | 81 |
| Erros acionáveis | 0 |

---

## 5. Matriz oficial de personas

Arquivo: `src/lib/security/permissionPersonaMatrix.ts`  
Doc: `docs/security/permissions-persona-matrix.md`

---

## 6. Comparação legado → efetivo

```bash
npm run permissions:compare:legacy-vs-resource
```

Resultado deste run: **PASS — 0 revogações involuntárias** (297 células / 11 personas).

---

## 7. Checklists e comandos (servidor — NÃO executar aqui)

Ver `permissions-hardening-runbook.md`.

---

## 8. Homologação e rollback

- Roteiro: `permissions-homologation-script.md`
- Rollback: `permissions-hardening-runbook.md` § Rollback
