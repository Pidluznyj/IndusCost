# IndusCost — Relatório de auditoria de permissões

Gerado em 2026-06-03T22:40:52.309Z · fase `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.

> Relatório gerado automaticamente por `npm run audit:permissions`. NÃO altera dados — apenas leitura estática do código.

## Resumo executivo

- Permissões no catálogo: **81**
- Permissões observadas (catálogo + código): **81**
- ORFÃS (no catálogo, sem uso): **6**
- FANTASMAS (usadas, fora do catálogo): **0**
- SOMENTE_FE (gate só visual): **9**
- SOMENTE_BE (gate sem UI): **24**
- Rotas mapeadas em server.ts: **185** (89 mutações / 96 leituras)
- Rotas SEM proteção de permissão (apenas auth ou nada): **9**
- Mutações sem requirePermission/Any direto: **5** (algumas usam bootstrap/users.manage — ver detalhes)

## Matriz consolidada de permissões

| Permissão | Catálogo? | Backend | Frontend | Módulo | Tipo | Risco | Status | Observação |
|---|---|---|---|---|---|---|---|---|
| `costs.view` | Sim | — | — | costs | menu | sensitive | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `crm.activities.create` | Sim | server.ts:10423 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.activities.edit` | Sim | server.ts:10561 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.customer_cockpit.view` | Sim | server.ts:10378 (+4) | — | crm-commercial | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.general.view` | Sim | server.ts:10819 (+1) | src/lib/modulePermissions.ts:114 | crm-commercial | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.profile.edit` | Sim | server.ts:13223 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.seller.all` | Sim | server.ts:11757 (+2) | src/lib/modulePermissions.ts:118 (+2) | crm-commercial | action | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.seller.own` | Sim | server.ts:11757 (+1) | src/lib/modulePermissions.ts:118 (+1) | crm-commercial | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.seller.view` | Sim | server.ts:11757 | src/lib/modulePermissions.ts:118 | crm-commercial | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.view` | Sim | server.ts:10740 (+2) | — | crm-commercial | menu | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.commercial360.view` | Sim | server.ts:10232 (+2) | — | customers | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.create` | Sim | server.ts:13270 | — | customers | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.edit` | Sim | server.ts:10081 (+3) | — | customers | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.view` | Sim | server.ts:10069 (+10) | src/lib/modulePermissions.ts:72 | customers | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `dashboard.view` | Sim | server.ts:1635 (+3) | src/lib/modulePermissions.ts:68 (+2) | dashboard | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `employees.edit` | Sim | server.ts:2017 (+3) | src/components/EmployeeModule.tsx:123 | employees | action | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `employees.view` | Sim | server.ts:1885 (+1) | src/lib/modulePermissions.ts:84 | employees | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `fleet.financial.view` | Sim | — | src/components/fleet/FleetFinancialTab.tsx:51 (+2) | fleet | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.maintenance.manage` | Sim | — | src/components/fleet/FleetMaintenancesTab.tsx:45 | fleet | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.manage` | Sim | — | src/components/fleet/FleetDriversTab.tsx:48 (+10) | fleet | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.reservations.approve` | Sim | — | src/components/fleet/FleetReservationsTab.tsx:86 | fleet | action | sensitive | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.reservations.create` | Sim | — | src/components/fleet/FleetMobileUsageFlow.tsx:68 (+1) | fleet | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.settings.manage` | Sim | — | — | fleet | action | sensitive | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `fleet.vehicles.edit` | Sim | — | src/components/fleet/FleetVehiclesTab.tsx:57 | fleet | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `fleet.view` | Sim | src/lib/modulePermissions.ts:103 | src/lib/modulePermissions.ts:103 | fleet | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `guide.view` | Sim | src/lib/modulePermissions.ts:107 | src/lib/modulePermissions.ts:107 | guide | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `machines.edit` | Sim | server.ts:1783 (+2) | — | machines | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `machines.view` | Sim | server.ts:1775 (+1) | src/lib/modulePermissions.ts:86 | machines | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `maintenance.manage` | Sim | server.ts:14040 (+2) | — | maintenance | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `maintenance.view` | Sim | server.ts:13965 (+3) | src/lib/modulePermissions.ts:99 | maintenance | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `materials.edit` | Sim | server.ts:2180 (+9) | — | materials | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `materials.view` | Sim | server.ts:2168 (+2) | src/lib/modulePermissions.ts:88 | materials | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `opex.edit` | Sim | server.ts:5575 (+2) | — | opex | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `opex.view` | Sim | server.ts:5568 (+1) | src/lib/modulePermissions.ts:90 | opex | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.generate_tables` | Sim | server.ts:5665 | src/components/PricingModule.tsx:111 | pricing | action | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.publish_tables` | Sim | server.ts:6241 | src/components/PricingModule.tsx:112 | pricing | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.simulate` | Sim | server.ts:6521 (+5) | src/components/PricingModule.tsx:110 | pricing | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.view` | Sim | server.ts:5611 (+11) | src/lib/modulePermissions.ts:82 (+1) | pricing | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.create` | Sim | server.ts:4948 | src/components/ProductModule.tsx:151 | products | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.delete` | Sim | server.ts:5440 (+1) | src/components/ProductModule.tsx:153 | products | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `products.edit` | Sim | server.ts:2974 (+26) | src/components/ProductModule.tsx:152 | products | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.export.engineering` | Sim | — | src/components/ProductModule.tsx:154 | products | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `products.tab.bom` | Sim | server.ts:3361 (+14) | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.composition` | Sim | server.ts:8476 | — | products | tab | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.cost` | Sim | server.ts:3707 (+13) | — | products | tab | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.info` | Sim | server.ts:4803 | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.routing` | Sim | — | — | products | tab | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `products.tab.tree` | Sim | server.ts:4941 | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.view` | Sim | server.ts:2962 (+22) | src/lib/modulePermissions.ts:78 (+1) | products | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.create` | Sim | server.ts:13717 (+1) | src/lib/modulePermissions.ts:260 | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.delete` | Sim | server.ts:13806 (+1) | src/lib/modulePermissions.ts:268 | proposals | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.edit` | Sim | server.ts:13556 (+4) | src/lib/modulePermissions.ts:260 (+1) | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.indicators.view` | Sim | server.ts:8476 (+1) | src/lib/modulePermissions.ts:276 | proposals | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.material_report.view` | Sim | — | — | proposals | section | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `proposals.print` | Sim | src/lib/modulePermissions.ts:272 | src/lib/modulePermissions.ts:272 | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.view` | Sim | server.ts:6049 (+4) | src/lib/modulePermissions.ts:74 | proposals | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.create` | Sim | server.ts:2704 | src/components/PurchaseModule.tsx:176 | purchases | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.delete` | Sim | — | src/components/PurchaseModule.tsx:178 | purchases | action | critical | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `purchases.edit` | Sim | server.ts:2543 (+2) | src/components/PurchaseModule.tsx:177 | purchases | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.indicators.view` | Sim | — | — | purchases | section | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `purchases.view` | Sim | server.ts:2531 (+3) | src/lib/modulePermissions.ts:80 | purchases | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `reports.view` | Sim | server.ts:9593 (+1) | src/lib/modulePermissions.ts:105 | reports | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `sales_orders.detail.view` | Sim | server.ts:13877 | — | sales-orders | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `sales_orders.invoice.view` | Sim | — | — | sales-orders | section | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `sales_orders.view` | Sim | server.ts:13824 (+2) | src/lib/modulePermissions.ts:76 | sales-orders | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.branding.edit` | Sim | server.ts:7305 | — | settings | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.branding.view` | Sim | server.ts:7293 (+1) | src/lib/modulePermissions.ts:167 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.global_params.edit` | Sim | server.ts:7606 (+1) | — | settings | action | critical | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.global_params.view` | Sim | server.ts:7383 (+3) | src/lib/modulePermissions.ts:169 | settings | section | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.nomus.sync` | Sim | — | src/components/SettingsModule.tsx:324 | settings | action | critical | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `settings.nomus.view` | Sim | server.ts:7418 (+3) | src/lib/modulePermissions.ts:173 | settings | section | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.operational.manage` | Sim | server.ts:1750 (+5) | — | settings | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.operational.view` | Sim | server.ts:1743 (+2) | src/lib/modulePermissions.ts:171 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.price_tables.manage` | Sim | server.ts:5665 (+1) | — | settings | action | critical | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.price_tables.view` | Sim | server.ts:5611 (+3) | src/lib/modulePermissions.ts:175 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.view` | Sim | server.ts:1743 (+11) | src/components/SettingsModule.tsx:323 (+2) | settings | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `simulations.create` | Sim | server.ts:6943 (+4) | — | simulations | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `simulations.view` | Sim | server.ts:6936 (+4) | src/lib/modulePermissions.ts:92 | simulations | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `taxes.edit` | Sim | server.ts:6370 (+2) | — | taxes | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `taxes.view` | Sim | server.ts:6362 (+1) | src/lib/modulePermissions.ts:94 | taxes | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `users.manage` | Sim | server.ts:1192 (+11) | src/components/AdminUsersModule.tsx:79 (+2) | settings | section | critical | OK | Declarada no catálogo e usada nos dois lados. |

## Permissões órfãs

- `costs.view` (Custos — visualizar (legado)) — Permissão legada que libera módulos de custo/operação. Prefira permissões específicas por módulo.
- `fleet.settings.manage` (Frota — Configurações) — Alterar parâmetros do módulo de frota.
- `products.tab.routing` (Engenharia — Aba Processo/Roteiro) — Aba de roteiro de processo.
- `proposals.material_report.view` (Propostas — Relatório Geral de MP) — Relatório consolidado de matéria-prima.
- `purchases.indicators.view` (Compras — Indicadores) — Indicadores do módulo de compras.
- `sales_orders.invoice.view` (Pedidos — Faturamento/NFe) — Informações de faturamento e NFe.

## Permissões SOMENTE_FE (gate só visual)

- `fleet.financial.view` — frontend: src/components/fleet/FleetFinancialTab.tsx:51 (+2)
- `fleet.maintenance.manage` — frontend: src/components/fleet/FleetMaintenancesTab.tsx:45
- `fleet.manage` — frontend: src/components/fleet/FleetDriversTab.tsx:48 (+10)
- `fleet.reservations.approve` — frontend: src/components/fleet/FleetReservationsTab.tsx:86
- `fleet.reservations.create` — frontend: src/components/fleet/FleetMobileUsageFlow.tsx:68 (+1)
- `fleet.vehicles.edit` — frontend: src/components/fleet/FleetVehiclesTab.tsx:57
- `products.export.engineering` — frontend: src/components/ProductModule.tsx:154
- `purchases.delete` — frontend: src/components/PurchaseModule.tsx:178
- `settings.nomus.sync` — frontend: src/components/SettingsModule.tsx:324

## Permissões SOMENTE_BE (gate sem UI)

- `crm.activities.create` — backend: server.ts:10423
- `crm.activities.edit` — backend: server.ts:10561
- `crm.customer_cockpit.view` — backend: server.ts:10378 (+4)
- `crm.profile.edit` — backend: server.ts:13223
- `crm.view` — backend: server.ts:10740 (+2)
- `customers.commercial360.view` — backend: server.ts:10232 (+2)
- `customers.create` — backend: server.ts:13270
- `customers.edit` — backend: server.ts:10081 (+3)
- `machines.edit` — backend: server.ts:1783 (+2)
- `maintenance.manage` — backend: server.ts:14040 (+2)
- `materials.edit` — backend: server.ts:2180 (+9)
- `opex.edit` — backend: server.ts:5575 (+2)
- `products.tab.bom` — backend: server.ts:3361 (+14)
- `products.tab.composition` — backend: server.ts:8476
- `products.tab.cost` — backend: server.ts:3707 (+13)
- `products.tab.info` — backend: server.ts:4803
- `products.tab.tree` — backend: server.ts:4941
- `sales_orders.detail.view` — backend: server.ts:13877
- `settings.branding.edit` — backend: server.ts:7305
- `settings.global_params.edit` — backend: server.ts:7606 (+1)
- `settings.operational.manage` — backend: server.ts:1750 (+5)
- `settings.price_tables.manage` — backend: server.ts:5665 (+1)
- `simulations.create` — backend: server.ts:6943 (+4)
- `taxes.edit` — backend: server.ts:6370 (+2)

## Rotas sem requirePermission/requireAnyPermission

Estas rotas usam apenas `requireAppAuth`, `requireBootstrap*`, `requireUserAdminOrBootstrap` ou nenhum guard. Para auditoria de risco, classifique cada uma e migre as mutations sensíveis para permissão específica.

| Método | Rota | Linha | Guards | Permissões | Observação |
|---|---|---|---|---|---|
| GET | `/api/health` | 1039 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/bootstrap-admin/status` | 1043 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/bootstrap-admin/login` | 1055 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/bootstrap-admin/logout` | 1091 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/auth/login` | 1199 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/auth/logout` | 1250 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/auth/me` | 1265 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/admin/permissions/catalog` | 1283 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| GET | `/api/admin/seller-options` | 1287 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| GET | `/api/admin/users` | 1297 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users` | 1309 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| PATCH | `/api/admin/users/:id` | 1369 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users/:id/reset-password` | 1518 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users/bootstrap-super-admin` | 1549 | requireBootstrapAdmin | — | 🔒 só bootstrap admin (acesso administrativo temporário) |
| GET | `/api/test-db` | 1613 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/settings/nomus-sync/daily-status` | 7514 | requireBootstrapOrAnyPermission | — | — |
| POST | `/api/settings/nomus-sync/daily-run` | 7528 | requireBootstrapOrAnyPermission | — | — |
| GET | `*` | 14332 | (nenhum) | — | 🚨 SEM autenticação |

## Mutations sem requirePermission/Any direto

Mutations (POST/PUT/PATCH/DELETE) que não passam por `requirePermission`/`requireAnyPermission` direto. Confirmar caso a caso — algumas usam `requireBootstrapOrAnyPermission` (vide coluna Guards) e estão OK; outras podem precisar de gate específico.

| Método | Rota | Linha | Guards |
|---|---|---|---|
| POST | `/api/bootstrap-admin/login` | 1055 | (nenhum) |
| POST | `/api/bootstrap-admin/logout` | 1091 | (nenhum) |
| POST | `/api/auth/login` | 1199 | (nenhum) |
| POST | `/api/auth/logout` | 1250 | (nenhum) |
| POST | `/api/settings/nomus-sync/daily-run` | 7528 | requireBootstrapOrAnyPermission |

## Catálogo agrupado por módulo

### Geral

- `dashboard.view` — **Dashboard**: Visualizar painel principal.
- `reports.view` — **Relatórios**: Acessar relatórios e BI.
- `guide.view` — **Guia do Sistema**: Acessar o guia funcional do sistema.

### CRM

- `crm.view` — **CRM Comercial**: Acessar o módulo CRM Comercial.
- `crm.general.view` — **CRM — Gestão Geral**: Aba de gestão comercial geral.
- `crm.seller.view` — **CRM — Gestão por Vendedor**: Aba de gestão por vendedor.
- `crm.seller.all` — **CRM — Ver todos os vendedores** _(sensitive)_: Ver dados de todos os vendedores.
- `crm.seller.own` — **CRM — Ver somente próprio vendedor**: Ver apenas dados do vendedor vinculado.
- `crm.customer_cockpit.view` — **CRM — Cockpit do Cliente**: Carteira e cockpit do cliente no CRM.
- `crm.activities.create` — **CRM — Criar atividade/contato**: Registrar atividades e contatos.
- `crm.activities.edit` — **CRM — Editar/concluir atividade**: Editar ou concluir atividades.
- `crm.profile.edit` — **CRM — Editar perfil comercial do cliente**: Editar perfil de relacionamento comercial.

### Clientes

- `customers.view` — **Clientes**: Consultar clientes.
- `customers.create` — **Clientes — Criar**: Cadastrar novos clientes.
- `customers.edit` — **Clientes — Editar**: Editar cadastro de clientes.
- `customers.commercial360.view` — **Clientes — Visão Comercial 360**: Visão comercial ampliada do cliente.

### Propostas

- `proposals.view` — **Propostas**: Consultar propostas.
- `proposals.create` — **Propostas — Criar**: Criar novas propostas.
- `proposals.edit` — **Propostas — Editar**: Editar propostas existentes.
- `proposals.delete` — **Propostas — Excluir** _(critical)_: Excluir propostas.
- `proposals.print` — **Propostas — Imprimir/gerar cliente**: Imprimir ou gerar versão para o cliente.
- `proposals.indicators.view` — **Propostas — Indicadores**: Indicadores e análises de propostas.
- `proposals.material_report.view` — **Propostas — Relatório Geral de MP**: Relatório consolidado de matéria-prima.

### Pedidos de Venda

- `sales_orders.view` — **Pedidos de venda**: Consultar pedidos de venda.
- `sales_orders.detail.view` — **Pedidos — Detalhe**: Visualizar detalhes do pedido.
- `sales_orders.invoice.view` — **Pedidos — Faturamento/NFe**: Informações de faturamento e NFe.

### Engenharia / Produtos

- `products.view` — **Engenharia / Produtos**: Consultar produtos e engenharia.
- `products.create` — **Engenharia — Criar item**: Criar produtos ou componentes.
- `products.edit` — **Engenharia — Editar item**: Editar produtos ou componentes.
- `products.delete` — **Engenharia — Excluir item** _(critical)_: Excluir itens de engenharia.
- `products.export.engineering` — **Engenharia — Exportar layout**: Exportar planilha de engenharia.
- `products.tab.info` — **Engenharia — Aba Informações**: Aba de identificação do produto.
- `products.tab.bom` — **Engenharia — Aba Estrutura BOM**: Aba de estrutura (BOM).
- `products.tab.routing` — **Engenharia — Aba Processo/Roteiro**: Aba de roteiro de processo.
- `products.tab.tree` — **Engenharia — Aba Estrutura em Árvore**: Aba de estrutura em árvore.
- `products.tab.cost` — **Engenharia — Aba Análise de Custo** _(sensitive)_: Aba de análise de custo.
- `products.tab.composition` — **Engenharia — Aba Composição de Custos** _(sensitive)_: Aba de composição de custos (open book).

### Compras

- `purchases.view` — **Compras**: Consultar solicitações de compra.
- `purchases.create` — **Compras — Criar solicitação**: Criar solicitações de compra.
- `purchases.edit` — **Compras — Editar solicitação**: Editar solicitações de compra.
- `purchases.delete` — **Compras — Excluir/cancelar** _(critical)_: Cancelar ou excluir solicitações.
- `purchases.indicators.view` — **Compras — Indicadores**: Indicadores do módulo de compras.

### Precificação / Impostos

- `pricing.view` — **Formação de Preço**: Acessar formação de preço.
- `pricing.simulate` — **Precificação — Simular preço**: Simular preços unitários ou em lote.
- `pricing.generate_tables` — **Precificação — Gerar tabelas comerciais** _(sensitive)_: Gerar versões DRAFT de tabelas comerciais.
- `pricing.publish_tables` — **Precificação — Publicar tabelas** _(critical)_: Publicar versões de tabelas comerciais.
- `taxes.view` — **Regras fiscais**: Consultar regras fiscais.
- `taxes.edit` — **Regras fiscais — Editar** _(sensitive)_: Editar regras fiscais.

### Custos / Operação

- `employees.view` — **Pessoas / RH**: Consultar colaboradores (módulo administrativo de RH).
- `employees.edit` — **Pessoas / RH — Editar** _(sensitive)_: Editar colaboradores no módulo administrativo de RH.
- `machines.view` — **Máquinas**: Consultar máquinas.
- `machines.edit` — **Máquinas — Editar**: Editar máquinas e centros de trabalho.
- `materials.view` — **Materiais**: Consultar materiais.
- `materials.edit` — **Materiais — Editar**: Editar materiais e suprimentos.
- `opex.view` — **Custos indiretos / OPEX**: Consultar custos indiretos.
- `opex.edit` — **OPEX — Editar** _(sensitive)_: Editar custos indiretos.
- `simulations.view` — **Simulações**: Consultar simulações.
- `simulations.create` — **Simulações — Criar**: Criar cenários de simulação.
- `costs.view` — **Custos — visualizar (legado)** _(sensitive)_: Permissão legada que libera módulos de custo/operação. Prefira permissões específicas por módulo.

### Configurações / Sistema

- `settings.view` — **Configurações**: Acessar configurações do sistema.
- `users.manage` — **Usuários e Permissões** _(critical)_: Cadastrar e administrar usuários.
- `settings.branding.view` — **Configurações — Marca/identidade**: Visualizar identidade visual.
- `settings.branding.edit` — **Configurações — Editar marca/identidade**: Editar logos e identidade.
- `settings.global_params.view` — **Configurações — Parâmetros globais** _(sensitive)_: Visualizar parâmetros globais.
- `settings.global_params.edit` — **Configurações — Editar parâmetros globais** _(critical)_: Editar parâmetros globais de cálculo.
- `settings.nomus.view` — **Configurações — Integração Nomus** _(sensitive)_: Visualizar logs e integração Nomus.
- `settings.nomus.sync` — **Configurações — Executar sincronização Nomus** _(critical)_: Disparar sincronização com Nomus.
- `settings.price_tables.view` — **Configurações — Tabelas de preço**: Visualizar tabelas de preço comerciais.
- `settings.price_tables.manage` — **Configurações — Gerenciar tabelas de preço** _(critical)_: Gerenciar versões e itens de tabelas.
- `settings.operational.view` — **Configurações — Operacional**: Visualizar estrutura operacional (cargos, encargos).
- `settings.operational.manage` — **Configurações — Gerenciar operacional** _(sensitive)_: Editar cargos, encargos e benefícios.

### Manutenção

- `maintenance.view` — **Manutenção**: Acessar manutenção predial.
- `maintenance.manage` — **Manutenção — Gerenciar**: Gerenciar registros de manutenção.

### Gestão de Frota

- `fleet.view` — **Gestão de Frota**: Acessar o módulo de gestão de frota.
- `fleet.manage` — **Frota — Gerenciar**: Operações gerais de frota (motoristas, cadastros).
- `fleet.vehicles.edit` — **Frota — Editar veículos**: Cadastrar e editar veículos.
- `fleet.reservations.create` — **Frota — Criar reservas**: Criar reservas e registrar retirada/devolução.
- `fleet.reservations.approve` — **Frota — Aprovar reservas** _(sensitive)_: Aprovar ou rejeitar reservas.
- `fleet.maintenance.manage` — **Frota — Manutenções**: Abrir e gerenciar manutenções de veículos.
- `fleet.financial.view` — **Frota — Custos**: Visualizar custos da frota.
- `fleet.settings.manage` — **Frota — Configurações** _(sensitive)_: Alterar parâmetros do módulo de frota.
