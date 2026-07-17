# Comercial + Financeiro — árvore oficial (PERM-41)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Navegação + abas + CRUD Fornecedores + APIs alinhados ao contrato |
| **Inventário** | `docs/security/navigation-permission-inventory.md` |
| **Contrato** | `src/lib/security/permissionContract/resources.ts` |

## Objetivo validado

1. **Comercial totalmente negado** — menu Comercial oculto; rotas e APIs `commercial.*` bloqueadas.
2. **Financeiro parcial** — menu Financeiro + página; só abas liberadas (AP e/ou Centros de Custo); Fornecedores independente; CRUD de Fornecedores configurável (`view` ≠ `manage`).

Page access ≠ escopo de dados. Regras oficiais de Contas a Pagar por **data de vencimento** (`dueDate`) preservadas.

## Matriz (persona Financeiro parcial)

| Superfície | resourceKey | Resultado |
|------------|-------------|-----------|
| Comercial (grupo) | `commercial.*` | negado — fora do menu / path deny / API 403 |
| Financeiro (página) | `finance` / filhos AP+CC | menu + shell |
| Contas a Pagar (aba) | `finance.accounts_payable` | liberável |
| Centros de Custo (aba) | `finance.cost_centers` | liberável |
| Fluxo / AR / Faturamento / PV fin. / Rel. Presidencial | chaves próprias | negáveis |
| Fornecedores (menu) | `finance.suppliers` | independente de CC |
| Fornecedores CRUD | `finance.suppliers` manage/configure | configurável |
| Portfolio / Opex / Taxes / Reports | chaves próprias | negados nesta persona |

## Isolamento Fornecedores ↔ Centros de Custo

- `canViewFinanceSuppliers` **não** herda `finance.cost_centers.view` nem `finance.view`.
- Menu Fornecedores **não** chama `/api/finance/cost-centers/dashboard` nem `supplier-cost-center-rules`.
- Cadastro/lista via APIs `finance.suppliers`.

## Ações CRUD (catálogo)

| Superfície | resourceKey | Actions |
|------------|-------------|---------|
| Fornecedores | `finance.suppliers` | view, manage, configure |
| Contas a Pagar | `finance.accounts_payable` | view, export, execute, manage |
| Centros de Custo | `finance.cost_centers` | view, manage |

FE: helpers DTO-first (`canPerformAction`) em `financeCostCentersPermissions` / `financeAccountsPayablePermissions`.  
BE: `requireResource` nas rotas de suppliers / AP / CC.

## Regras de negócio AP

Não alteradas — eixo oficial `NomusAccountsPayable.dueDate` (`FINANCE_AP_DUE_DATE_AXIS_NOTE`).

## Testes

```bash
npx tsx --test src/lib/commercialFinance.perm41.test.ts
npm run test:resource-navigation
npm test
npm run build
```
