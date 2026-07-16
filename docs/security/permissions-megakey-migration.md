# Migração de mega-keys e aliases amplos

**Status:** P09 hotfix aplicado (2026-07-16) — bleed AP e `costs.view` cross-module removidos do runtime FE/seed/guards principais.  
**Regra definitiva:** um alias de compatibilidade **não** pode conceder acesso a um recurso diferente daquele que a chave representa.  
**Código:** `src/lib/security/permissionMegaKeyMigration.ts` (mapa + dry-run + política 1:1).

---

## 1. Definição

**Mega-key:** chave legada cuja presença em `hasPermission` / `legacyAliasKeys` libera **≥2 recursos sem relação canônica** (módulos distintos).

**Alias amplo ilegal (corrigido em P09):**

- ~~`finance.accountsPayable.view` → `financeiro` **e** `financeiro.conciliacao_carteira`~~ → só `financeiro.contas_pagar`
- ~~`costs.view` → RH, Máquinas, Suprimentos, Simulações, …~~ → só `finance.opex` (camada legado identificada)

**Alias 1:1 legal (alvo):**

- `finance.accountsPayable.view` ↔ **somente** `financeiro.contas_pagar`
- `employees.view` ↔ **somente** `admin.employees` (view)
- `machines.view` ↔ **somente** `operations.machines`

---

## 2. Matriz (pós-P09)

| Mega-key / bleed | Recursos liberados hoje | Substituta | Compat | Remoção |
|------------------|-------------------------|------------|--------|---------|
| `finance.accountsPayable.view` | só Contas a Pagar | — (já 1:1) | shell `/finance` via filho | feito P09 |
| `costs.view` | só OPEX | `opex.view`, `employees.view`, … | opex_only | P15–P16 + P19 |
| `finance.view` | MENU financeiro (+ suppliers OR) | filhos 1:1 | finance_module_shell | pós P19 |
| `crm.view` | comercial + CRM | `comercial.crm` | dual-write 1:1 | aperto parent |
| `sales_orders.view` | pedidos (+ âncora comercial) | `comercial.pedidos_venda` | temporário | alinhamento comercial |
| `dashboard.view` | dashboard | — | 1:1 | manter |

**Dry-run:** `runMegaKeyMigrationDryRun()` — reporta fanout FE/seed, residuals e policy findings. **Não** regrant automático.

**Usuários/perfis impactados:** Leticia (AP only) deixa de ver Conciliação; quem dependia de `costs.view` para RH/Máquinas precisa de keys canônicas (regrant manual após snapshot).

---

## 3. Inventário automático

```ts
import { runMegaKeyMigrationDryRun, assertNoResidualP09Bleeds } from "@/src/lib/security/permissionMegaKeyMigration.js";
const report = runMegaKeyMigrationDryRun();
assertNoResidualP09Bleeds(report);
```

CI / testes: `permissionMegaKeyMigration.test.ts` + diagnóstico Leticia.

Aliases novos fora de `ALIAS_WIDE_ALLOWLIST` com fanout >1 → **error**.

---

## 4. Ordem restante

1. ~~Bleed AP → Conciliação/pai~~ **feito**  
2. ~~`costs.view` → RH / Máquinas / Suprimentos / Simulações~~ **feito** (opex retido)  
3. Desacoplar `products.view` de `operations.performance`  
4. Decompor `finance.view`  
5. Apertar `crm.view` / parent comercial  
6. Ban mega-keys no catálogo (deprecated → delete)

**Proibido:** regrant automático de bleed; restaurar `costs.view`→`employees`.

---

## 5. Caso Leticia (aceite P09)

| Bag | Efeito |
|-----|--------|
| só `finance.accountsPayable.view` | Contas a Pagar + shell `/finance`; **sem** Conciliação; MENU sidebar Financeiro **não** eleva |
| + `costs.view` | + OPEX; **sem** RH/Máquinas |
| bag vazia VIEWER | nada (P07) |

---

## 6. Critérios de pronto (P09)

- [x] Seed/FE sem `finance.accountsPayable.view` em conciliação/pai  
- [x] `EMPLOYEES_VIEW_PERMISSIONS` sem `costs.view`  
- [x] `costs.view` só em opex (FE + `canAccessModule`)  
- [x] Testes DIAG / Leticia verdes no comportamento desejado  
- [x] Dry-run + mapa de migração explícito  
- [ ] Relatório P19 sem dependentes de mega (ops)
