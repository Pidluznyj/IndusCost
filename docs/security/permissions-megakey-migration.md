# Migração de mega-keys e aliases amplos

**Status:** plano (sem implementação).  
**Regra definitiva:** um alias de compatibilidade **não** pode conceder acesso a um recurso diferente daquele que a chave representa.  
**Base:** diagnóstico `48ef617`.

---

## 1. Definição

**Mega-key:** chave legada cuja presença em `hasPermission` / `legacyAliasKeys` libera **≥2 recursos sem relação canônica** (módulos distintos).

**Alias amplo ilegal (exemplos atuais):**

- `finance.accountsPayable.view` → `financeiro` **e** `financeiro.conciliacao_carteira`
- `costs.view` → RH, Máquinas, Suprimentos, OPEX, Simulações, Simulador, …

**Alias 1:1 legal (alvo):**

- `finance.accountsPayable.view` ↔ **somente** `financeiro.contas_pagar` (+ eixos execute/manage próprios)
- `employees.view` ↔ **somente** `admin.employees` (view)
- `machines.view` ↔ **somente** `operations.machines`

---

## 2. Matriz de mega-keys / chaves amplas

### 2.1 `costs.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Pessoas/RH (`admin.employees`, `EMPLOYEES_VIEW_PERMISSIONS`), Máquinas, Suprimentos, OPEX (`canAccessModule`), Simulações, Simulador (OR), aliases FE em materials/machines/employees/engineering simulator |
| **Frontend** | `permissionsClient.ts` legacyAliasKeys; `modulePermissions.ts` `LEGACY_COSTS_VIEW`; navigationGroups |
| **APIs** | `employeesPermissions`, employee lookups, transformation simulator history, production/material cost tables (parcial), fleet resolve (indireto), vários finance cost-center helpers |
| **Perfis/usuários** | Templates antigos “custos”; bags históricas; possível Leticia se chave residual |
| **Substitutas** | `opex.view` / resource opex; `materials.view`; `machines.view`; `employees.view` / `admin.employees`; `simulations.view`; `products.view` — **cada uma só no seu módulo** |
| **Ordem migração** | 1) Snapshot A 2) Garantir keys canônicas nos usuários intencionais 3) Remover de EMPLOYEES_* e machines aliases 4) Remover de materials/simulations OR 5) Deprecar do catálogo |
| **Risco** | **Crítico** — muitos módulos |
| **Compat temporária** | Feature flag `LEGACY_COSTS_VIEW_CROSS_MODULE=false` default off em homolog; on só emergência |
| **Critério remoção** | Zero hits em telemetria; CI proíbe `costs.view` fora de recurso opex (se mantido) |

### 2.2 `finance.accountsPayable.view` (bleed, não mega clássica mas alias cruzado)

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Contas a Pagar (correto), menu `financeiro` (pai), **Conciliação de Carteira** (incorreto) |
| **Frontend** | `permissionsClient` + seed `legacyAliasKeys` em `financeiro` e `financeiro.conciliacao_carteira` |
| **APIs** | Rotas accounts payable (correto); portfolio reconciliation **não** deveria aceitar AP key |
| **Substitutas** | Manter 1:1 com `financeiro.contas_pagar`; pai `financeiro` sem alias de filho; conciliação só `finance.portfolioReconciliation*.view` |
| **Ordem** | Hotfix P09 cedo (após snapshot) |
| **Risco** | Alto para quem “só tinha AP” e usava conciliação por bug |
| **Remoção bleed** | Teste DIAG invertido verde |

### 2.3 `finance.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Módulo finance amplo (`canAccessModule("finance")`), suppliers OR, vários guards |
| **Substitutas** | Grants por submenu: contas_pagar, contas_receber, fluxo_caixa, conciliacao, relatorio, … |
| **Ordem** | Após Contas a Pagar piloto; decompor users com só `finance.view` |
| **Risco** | Alto |
| **Remoção** | Ninguém depende só dela; CI ban em novos guards |

### 2.4 `crm.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Grupo comercial, CRM, aliases em seed comercial; baseline VIEWER dual-write |
| **Substitutas** | `comercial.crm`, tabs específicas; pedidos = `sales_orders.view` / `comercial.pedidos_venda` |
| **Ordem** | Com deny VIEWER / modo restrição |
| **Risco** | Médio |
| **Nota** | Não é “bug” no VIEWER seed — é baseline amplo; restrição é produto |

### 2.5 `sales_orders.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Pedidos + às vezes grupo comercial (alias) |
| **Substitutas** | 1:1 `comercial.pedidos_venda` |
| **Ordem** | Com alinhamento comercial |
| **Risco** | Médio |

### 2.6 `dashboard.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Dashboard; às vezes reports OR |
| **Substitutas** | `dashboard` resource only; reports com key própria |
| **Ordem** | Baixa prioridade vs bleeds |
| **Risco** | Baixo–médio |

### 2.7 `products.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Engenharia/Produtos; OR simulador; performance ops (alias seed!); AccessProfile Visualizador |
| **Problema extra** | No seed, também alias de `operations.performance` — dual-write acopla produtos↔performance |
| **Substitutas** | `engineering.products` 1:1; performance só `operations.component-performance.*`; simulador key própria |
| **Ordem** | P08 unificar engineering + limpar alias performance |
| **Risco** | Alto |

### 2.8 `materials.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Suprimentos; OR engenharia parent; costs OR |
| **Substitutas** | `suprimentos` 1:1 |
| **Risco** | Médio |

### 2.9 `simulations.view`

| Campo | Valor |
|-------|--------|
| **Abre hoje** | Simulações; OR simulador/engineering |
| **Substitutas** | Keys engineering.simulations / transformation_simulator |
| **Risco** | Médio |

### 2.10 Outras a inventariar no P02/P19

- `reports.view`, `settings.view`, `users.manage` (ampla por natureza admin — manter mas não aliasar em módulos de negócio)
- `inventory.view`, `fleet.view` / `fleet.manage`
- Qualquer `legacyAliasKeys` com **>1 resourceKey** apontando para a **mesma** legacy key

---

## 3. Inventário automático (obrigatório na implementação)

Script futuro deve listar:

```
legacyKey → [resourceKeys...]
legacyKey → [API permission lists...]
legacyKey → [modulePermissions cases...]
```

Falhar CI se `len(resourceKeys) > 1` para a mesma legacy key **sem** allowlist explícita documentada.

---

## 4. Ordem de remoção recomendada

1. **Bleed AP → Conciliação/pai** (alto valor, escopo local).  
2. **`costs.view` → RH** (segurança PII).  
3. **`costs.view` → Máquinas / Suprimentos / OPEX / Simulações**.  
4. **Desacoplar `products.view` de `operations.performance`**.  
5. **Decompor `finance.view`**.  
6. **Apertar `crm.view` / parent comercial**.  
7. **Ban mega-keys no catálogo** (deprecated → delete).

Em cada passo: snapshot → regrant canônico → remover alias → teste persona → deploy.

---

## 5. Compatibilidade temporária

| Fase | Comportamento |
|------|----------------|
| Shadow | Resolvedor ignora mega para **decisão nova**, mas reporta quem perderia acesso |
| Ponte | Alias 1:1 only; mega-keys **não** entram em novos guards |
| Enforce | Mega-keys removidas das listas; bag pode ainda contê-las sem efeito |
| Limpeza | Strip das bags + delete do `PERMISSION_CATALOG` |

**Proibido:** “compatibilidade” que restaure `costs.view`→`employees`.

---

## 6. Impacto no caso Leticia

| Se bag contém | Efeito hoje | Após migração |
|---------------|-------------|----------------|
| só `finance.accountsPayable.view` | Finance+Conciliação | só Contas a Pagar (+ grupo UX sem APIs extras) |
| + `costs.view` | RH, Máquinas, … | sem efeito cross-module; opex só se `opex.view` |
| + baseline comercial dual-write | Comercial | deny/modo restrição |
| bag vazia | Engenharia FE | nada |

---

## 7. Critérios de pronto (mega-keys)

- [ ] Nenhuma legacy key mapeia para >1 resource sem allowlist.  
- [ ] `EMPLOYEES_VIEW_PERMISSIONS` sem `costs.view`.  
- [ ] Seed/FE sem `finance.accountsPayable.view` em conciliação/pai.  
- [ ] Testes DIAG de bleed falham se reintroduzidos (guardrails).  
- [ ] Relatório P19 sem usuários **dependentes** de mega para trabalho diário (ou todos regranted).
