# Matriz oficial de personas — permissionamento

Fonte executável: `src/lib/security/permissionPersonaMatrix.test.ts`  
Comparador: `npm run permissions:compare:legacy-vs-resource`

| Persona | Role | Bag / notas | Deve ver | Não deve ver |
|---------|------|-------------|----------|--------------|
| SUPER_ADMIN | SUPER_ADMIN | bypass | todos os módulos | — |
| ADMIN | ADMIN | ROLE_MATRIX amplo | dashboard, financeiro, CRM, pedidos, settings, RH, estoque | (manage ACL fino sob regra separada) |
| Gestor comercial | COMMERCIAL_MANAGER | matrix comercial | CRM, pedidos, clientes, propostas | financeiro, settings, RH |
| Vendedor | SELLER | crm + pedidos + dashboard | CRM, pedidos, clientes | financeiro, settings, RH, estoque |
| Financeiro SO | VIEWER | `finance.view` + conciliação + suppliers | financeiro, conciliação, fornecedores | settings, RH, CRM |
| Financeiro operacional | VIEWER | finance + AP/AR (+ billing sync na bag) | financeiro, suppliers | settings, RH |
| Engenharia | VIEWER | products/simulations/projects/pricing | engenharia + pricing | financeiro, settings, RH |
| RH | VIEWER | employees + guide | pessoas, guia | financeiro, settings, CRM |
| Viewer | VIEWER | matrix default | dashboard, pedidos, clientes, propostas, produtos | CRM gestao, financeiro, settings |
| Usuário com deny | VIEWER | só dashboard + pedidos | dashboard, pedidos | financeiro, CRM, settings |
| Legado sem grants estruturados | VIEWER | opex/taxes/reports/materials | esses módulos (fallback legado onde sem resourceKey) | settings |
| **Analista de Compras** (PERM-43) | VIEWER | fixture `analistaComprasPersona.ts` (sem perfil prod obrigatório) | Dashboard, Suprimentos/MI, AP+CC+Fornecedores, Estoque/Compras/Manutenção/Frota | Comercial, Produtos/Simulações/Projetos, demais finance/ops |

## Casos transversais cobertos nos testes

| Caso | Expectativa |
|------|-------------|
| Login / bag carregada | `effectivePermissions` alimenta aliases |
| Sidebar | `canViewModule` / `buildResourceAwareSidebarNavigation` |
| URL direta | `canAccessPath` / `evaluatePathViewAccess` |
| Aba | `filterTabsByView` / testes moduleTab |
| Botão / mutação | guards FE + `requirePermission` BE |
| Exportação | chaves `*.export` / execute |
| Deny / parent negado | sem alias do pai → path negado |
| Dual-write | `test:permission-dual-write` + report dry-run |
| Último SUPER_ADMIN | `warnings.isLastSuperAdmin` na API admin |
| Auditoria | `PermissionAuditLog` / testes audit admin |
