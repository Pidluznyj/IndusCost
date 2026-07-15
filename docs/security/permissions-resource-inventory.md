# Inventário de recursos de navegação × permissões

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Escopo** | Inventário read-only (código) — **sem** implementação da nova matriz |
| **Fontes** | `navigationGroups.ts`, `modulePermissions.ts`, `*Navigation.ts`, `PERMISSION_CATALOG`, `PERMISSION_RESOURCE_SEEDS`, `permissionsClient.ts`, componentes de módulo |

Legenda **nível de risco (superfície):** impacto se a permissão for errada ou ausente (não confundir com gap de segurança de endpoint — ver `permissions-endpoint-audit.md`).

Legenda **gap:**

| Código | Significado |
|--------|-------------|
| OK | Gate de nav/ação coerente com catálogo |
| PARTIAL | Há gate, mas OR largo / só legado / sem resource |
| MISSING_UI | Chave no catálogo/seed sem gate de UI |
| MISSING_TAB | Aba sem permissão dedicada |
| WEAK_ACTION | Ação (botão) sem chave dedicada no client |
| DUAL | Catalog resource + legado podem divergir |
| HIDDEN | Seed/catalog existe, UI não expõe a aba |

Colunas: grupo · módulo · submenu/aba · rota · componente · botão/ação · endpoint (se conhecido) · método · permissão atual · guard atual · risco · gap.

---

## Dashboard

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Dashboard | Dashboard | — | `/` ou path dashboard | Dashboard module / Layout | Ver | `/api/dashboard` | GET | `dashboard.view` / resource `dashboard` | L `requirePermission` + sidebar resource | médio | DUAL |

---

## Engenharia

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Engenharia | Produtos | — | `/products` | `ProductModule` | Ver módulo | `/api/products*` | * | `products.view` | L | alto | PARTIAL (sem resource sidebar) |
| Engenharia | Produtos | modal Info | — | Product form | Ver aba | — | — | `products.tab.info` | UI filter | médio | OK |
| Engenharia | Produtos | modal BOM | — | Product form | Ver aba | BOM APIs | * | `products.tab.bom` | UI + L APIs | alto | OK |
| Engenharia | Produtos | modal Roteiro | — | Product form | Ver aba | — | — | `products.tab.routing` | UI | médio | OK |
| Engenharia | Produtos | modal Árvore | — | Product form | Ver aba | — | — | `products.tab.tree` | UI | médio | OK |
| Engenharia | Produtos | modal Custo | — | Product form | Ver aba | cost-analysis | GET | `products.tab.cost` (+ ORs) | L any | alto | OK |
| Engenharia | Produtos | modal Composição | — | Product form | Ver aba | — | — | `products.tab.composition` | UI | médio | OK |
| Engenharia | Produtos | — | — | ProductModule | Criar | POST `/api/products` | POST | `products.create` | L | alto | OK |
| Engenharia | Produtos | — | — | ProductModule | Editar | PUT/PATCH products | * | `products.edit` | L | alto | OK |
| Engenharia | Produtos | — | — | ProductModule | Excluir/bulk | DELETE / bulk-delete | * | `products.delete` | L | crítico | OK |
| Engenharia | Produtos | — | — | ProductModule | Export engenharia | export | * | `products.export.engineering` | UI + API | médio | OK |
| Engenharia | Simulador Injeção | — | transformation-simulator | Transformation simulator | Ver | — | — | `products.view` \| `simulations.view` \| `costs.view` | `canAccessModule` | médio | PARTIAL |
| Engenharia | Suprimentos | Catálogo MP | `/materials` | MaterialsModule | Ver | `/api/materials*` | * | `materials.view` (+ `costs.view`) / resource `suprimentos` + tab catalogo | L+R | alto | DUAL |
| Engenharia | Suprimentos | — | — | MaterialsModule | Editar | materials mutate | * | `materials.edit` | L | alto | OK |
| Engenharia | Suprimentos | MI Home | `/materials/market-intelligence` | MI page | Ver | MI APIs | GET | resource `…tab.home` / `materials.view` | R+L | alto | PARTIAL |
| Engenharia | Suprimentos | MI 360 | `/materials/market-intelligence/:id` | Detail 360 | Ver | MI detail | GET | resource `…tab.materia_prima_360` | UI canView | alto | PARTIAL |
| Engenharia | Suprimentos | MI Fornecedores | (seed) | — | — | quotes APIs | * | seed `…tab.fornecedores` | L materials.* | médio | HIDDEN / MISSING_UI nav |
| Engenharia | Suprimentos | MI Alertas | (seed) | config panels | — | alerts APIs | * | resource tab.alertas (parcial) | R view em partes | médio | HIDDEN nav |
| Engenharia | Suprimentos | MI Config | (seed) | Global config | Editar alertas | alert-config | * | `materials.edit` / seed config | L | alto | MISSING_UI resource gate |
| Engenharia | Suprimentos | Cotação | — | MI | Aprovar | approve routes | POST | `materials.market_quote.approve` | L | alto | OK |
| Engenharia | Simulações | — | `/simulations` | Simulations | Ver/Criar | simulations APIs | * | `simulations.view` / `.create` (+ `costs.view` module) | L | médio | PARTIAL |
| Engenharia | Projetos | Início/Itens/Custos/Docs/Hist | `/projects`, `/projects/:id/*` | ProjectsModule | Ver/Gerir | `/api/projects*` | * | `projects.view` / `.manage` | L + DELETE SUPER_ADMIN inline | alto | PARTIAL |
| Engenharia | Projetos | Intake/reports | paths fora do mapa | Project intake | — | — | — | Layout moduleId null → sem AccessDenied módulo | — | médio | WEAK_ACTION / PARTIAL |

---

## Comercial

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Comercial | CRM | — | `/crm` | CrmModule | Ver | `/api/crm/*` | * | `crm.view` / resource `comercial.crm` | L+R | alto | DUAL |
| Comercial | CRM | Gestão Geral | tab | CrmCommercialManagementTabs | Ver | CRM general | GET | `comercial.crm.tab.gestao_geral` + fallback legado | R+L | alto | OK |
| Comercial | CRM | Gestão Vendedor | tab | idem | Ver | seller dash | GET | `…gestao_vendedor` + `crm.seller.*` | R+L | alto | OK |
| Comercial | CRM | Carteira | tab | idem | Ver | portfolio | GET | `…carteira_clientes` | R+L | alto | OK |
| Comercial | CRM | Cliente 360 | sob carteira | Customer intelligence | Ver | customer intel | * | `…cliente_360` / `crm.customer_cockpit.view` | R+L | alto | PARTIAL |
| Comercial | CRM | Contato/Atividade | modal | CRM modals | Criar/editar | activities | * | Catálogo `crm.activities.*` — **UI do modal pouco checado** | service/API variável | alto | WEAK_ACTION |
| Comercial | CRM | Owner comercial | — | — | Assign seller | PATCH commercial-owner | PATCH | `crm.customers.assign_seller` **inline service** | I (sem MW perm) | alto | PARTIAL |
| Comercial | Clientes | — | `/customers` | CustomerModule | Ver | `/api/customers*` | * | `customers.view` | Layout only no module | médio | WEAK_ACTION (sem create/edit UI gate) |
| Comercial | Clientes | — | — | — | Criar/Editar | customers CRUD | * | `customers.create` / `.edit` | L API | alto | PARTIAL UI |
| Comercial | Propostas | — | `/proposals` | Proposals | CRUD | `/api/proposals*` | * | `proposals.view|create|edit|delete` | L | alto | OK (legado) |
| Comercial | Pedidos de venda | — | `/sales-orders` | SalesOrdersModule | Ver | `/api/sales-orders*` | GET | `sales_orders.view` / resource `comercial.pedidos_venda` | L+R | alto | DUAL |
| Comercial | Pedidos | detalhe | `/sales-orders/:id` | detail | Ver | detail APIs | GET | `sales_orders.detail.view` | L | médio | PARTIAL |
| Comercial | Pedidos | NF | — | — | Ver | invoice | GET | `sales_orders.invoice.view` | L | médio | PARTIAL |
| Comercial | Pedidos | Export XLSX/PDF/margem | botões | list/management | Export | report/export | * | **Sem hasPermission no client** | backend variável | médio | WEAK_ACTION |
| Comercial | Formação de Preço | — | `/pricing` | Pricing module | Ver/simular | `/api/pricing*` | * | `pricing.view` / `.simulate` / publish keys | L | crítico* | PARTIAL (*delete ver endpoint audit) |
| Comercial | Comissões | — | `/commissions` | Commissions shell | Ver | `/api/commissions*` | * | `commissions.view` ORs / resource `comissoes` | L+R | alto | DUAL |
| Comercial | Comissões | Fechamento do mês | `/commissions/...` | monthly closing | Ver/Gerir | receipt-closing | * | tab `fechamento_mes` + `commissions.payments.manage` | R+L | crítico | OK |
| Comercial | Comissões | Fechamentos | `/commissions/fechamentos` | ClosingsPage | Ver | closings APIs | GET | `comissoes.tab.fechamentos` | R+L | alto | OK |
| Comercial | Comissões | Exceções cliente | — | exclusions | Gerir | exceptions | * | `commissions.rules.manage` | L | alto | OK |
| Comercial | Comissões | Relatórios | — | reports | Ver/Export | reports | * | tab relatorios / view ORs | R+L | médio | PARTIAL export key |
| Comercial | Comissões | Reprocessar | — | reprocess | Executar | recalculate/reprocess | POST | rules\|payments manage | L | crítico | OK |
| Comercial | Comissões | Abas legadas (dashboard, previstas, …) | redirects | — | — | tab GETs | GET | `comissoes.tab.*` seeded | R+L | baixo | HIDDEN |

\* DELETE pricing: ver endpoint audit (gate `pricing.view` apenas).

---

## Financeiro

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Financeiro | Financeiro | — | `/finance` | FinanceModule | Ver | vários | * | `finance.view` ORs / resource `financeiro` | L+R | alto | DUAL + OR largo |
| Financeiro | Financeiro | Fluxo de Caixa | `/finance/cash-flow` | CashFlow | Ver | cash-flow APIs | GET | AR/AP/finance/reports/**settings.view** OR | L any | alto | PARTIAL |
| Financeiro | Financeiro | Contas a Receber | `/finance/accounts-receivable` | AR | Ver/Export/Sync | AR APIs | * | AR.view/export; sync `settings.nomus.sync` UI | L | crítico sync | PARTIAL |
| Financeiro | Financeiro | Contas a Pagar | `/finance/accounts-payable` | AP | Ver/Export/Classificar | AP APIs | * | AP.view/export; `finance.ap_allocations.manage` | L | alto | PARTIAL |
| Financeiro | Financeiro | Faturamento | `/finance/billing` | Billing | Ver/Sync | billing | * | sales_orders + finance ORs; sync OR settings.view | L | crítico | PARTIAL |
| Financeiro | Financeiro | Pedidos (fin) | `/finance/sales-orders` | Finance SO | Ver | finance SO | GET | helper view | L | médio | PARTIAL |
| Financeiro | Financeiro | Centros de Custo | `/finance/cost-centers` | CC | Ver/Gerir | cost-centers | * | `finance.cost_centers.*` | L | alto | PARTIAL |
| Financeiro | Financeiro | Relatório Presidencial | executive | Exec report | Ver | executive-report | GET | `finance.executiveReport` / reports OR (+ seed `financeiro.relatorio_presidencial`) | L | médio | PARTIAL |
| Financeiro | Fornecedores | — | `/finance/suppliers` | Suppliers | Ver/Gerir/Delete | suppliers | * | `finance.suppliers.*`; DELETE SUPER_ADMIN | L+I | crítico delete | PARTIAL |
| Financeiro | Fornecedores | Rescisão serviço | — | termination | CRUD/export | termination | * | `finance.suppliers.service_termination.*` (+ aliases) | L | alto | OK (dup alias) |
| Financeiro | Conciliação | — | `/finance/portfolio-reconciliation` | Portfolio page | Ver | portfolio routes | * | resource `financeiro.conciliacao_carteira` | R | alto | OK |
| Financeiro | Conciliação | Status Pedidos | tab UI | ProtectedTab | Ver | — | GET | `…tab.status_pedidos` | R + PermissionGate | alto | OK |
| Financeiro | Conciliação | Auditoria Pedido→Caixa | tab UI | ProtectedTab | Ver/Execute rebuild | order-to-cash | * | `…tab.auditoria_pedido_caixa` | R | alto | OK |
| Financeiro | Conciliação | Conciliação / Inteligência | seed | ocultas na whitelist | — | — | — | tab resources seeded | R | baixo | HIDDEN |
| Financeiro | Custos Indiretos | — | `/opex` | Opex | Ver/Editar | indirect-costs | * | `opex.view` / `.edit` + bootstrap | L+B | alto | PARTIAL |
| Financeiro | Tributos | — | `/taxes` | Taxes | Ver/Editar | tax-rules | * | `taxes.view` / `.edit` | L | alto | PARTIAL |
| Financeiro | Relatórios | — | `/reports` | Reports | Ver | `/api/reports/data` | GET | `reports.view` \| `dashboard.view` module | L | médio | PARTIAL |

---

## Operações

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Operações | Estoque | — | `/inventory` | InventoryModule | Ver | `/api/inventory*` | * | `inventory.view` | L | alto | PARTIAL (sem resource) |
| Operações | Estoque | Visão/Itens/Almox/Saldos/Mov/Counts/… | tabs | inventoryNavigation | Navegar abas | — | — | **módulo inteiro** `inventory.view` | UI filter | médio | MISSING_TAB |
| Operações | Estoque | Itens/Almox | — | sheets | Gerir | items/warehouses | * | `inventory.item|warehouse.manage` (+ manage) | L | alto | OK |
| Operações | Estoque | Movimentações | — | — | Criar/ajuste/transf | movements | POST | `inventory.movement(s).create` etc. | L | alto | OK (dup keys) |
| Operações | Estoque | Conferência | — | counts | Manage/Approve | counts | * | `inventory.count.manage` / `.approve` | L | alto | OK |
| Operações | Estoque | Auditoria | tab comingSoon | — | Ver | audit | GET | `inventory.audit.view` | L | baixo | PARTIAL |
| Operações | Compras | — | `/purchases` | Purchases | CRUD UI | purchase-requests | * | `purchases.view|create|edit` | L | alto | PARTIAL (`purchases.delete` FE-only?) |
| Operações | Máquinas | — | `/machines` | Machines | Ver/Editar | machines | * | `machines.view` / `.edit` (+ costs.view module) | L | médio | PARTIAL |
| Operações | Performance | — | operations-performance | Ops performance | Ver/Editar | — | * | `operations.component-performance.view|edit` | L | médio | PARTIAL |
| Operações | Manutenção Predial | — | `/maintenance` | Maintenance | Ver/Gerir | maintenance-requests | * | `maintenance.view` / `.manage` | L | médio | PARTIAL |
| Operações | Frota | — | `/fleet` | FleetModule | Ver | `/api/fleet*` | * | `fleet.view` \| manage + fleet guards | F | alto | PARTIAL (sem resource sidebar) |
| Operações | Frota | Visão/Veículos/Motoristas/Reservas/QR/Checklists/Manut/Config | tabs | fleetNavigation | Ver avançado | — | — | `canView` / `canFinancial` fleet | F | médio | MISSING_TAB resource |
| Operações | Frota | Admin cleanup | — | admin | Cleanup | fleet/admin/reservations-cleanup | * | SUPER_ADMIN inline | I | crítico | PARTIAL MW |

---

## Administração

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| Administração | Pessoas/RH | — | `/employees` | Employees | Ver/Editar | employees | * | `employees.view` / `.edit` (+ costs.view) | L | médio | PARTIAL |
| Administração | Pessoas/RH | Ficha tabs | modal/side | EmployeeFichaTabNav | Seções ficha | — | — | **sem** permissão por aba de ficha | UI always | baixo | MISSING_TAB |
| Administração | Configurações | Hub | `/settings` | SettingsModule | Ver seções | vários | * | `settings.view` \| `users.manage` / FE resource `configuracoes` | L + canView `configuracoes` | alto | DUAL (`configuracoes`≠`admin`) |
| Administração | Configurações | Segurança | hub | AdminUsers + Profiles | Users/ACL | admin users / access-profiles | * | `users.manage` / `accessProfiles.*` / resource admin.* | L+R | crítico | OK+PARTIAL (Users tab listing) |
| Administração | Configurações | Branding/Globals/Ops/Nomus/PriceTables | hub | Settings sections | Ver/Editar/Sync | settings APIs | * | `settings.*` + sync | L+B | crítico sync | PARTIAL |
| Administração | Configurações | Integrações/Sistema | hub | placeholders | — | — | — | `settings.view` | UI | baixo | OK |
| Administração | Guia | — | `/guide` | Guide | Ver | — | — | `guide.view` \| `dashboard.view` | Layout | baixo | PARTIAL |

---

## Controles transversais (não-sidebar)

| Grupo | Módulo | Sub/aba | Rota | Componente | Ação | Endpoint | Método | Permissão | Guard | Risco | Gap |
|-------|--------|---------|------|------------|------|----------|--------|-----------|-------|-------|-----|
| — | Auth público | Login/logout/me | `/api/auth/*` | AuthContext | Sessão | auth | * | público / sessão | — | — | OK |
| — | Bootstrap | cookie ops | bootstrap | — | Ops | — | — | bootstrap cookie | B | crítico canal | documentado |
| — | Frota pública | QR/reserva | `/api/public/fleet/*` | public | — | public | * | token/público | — | médio | OK esperado |
| — | Diagnostic | Test DB | `/api/test-db` | — | Contagens Prisma | test-db | GET | **nenhuma** | **none** | crítico | ver endpoint audit |
| — | Prints | Proposta/SO/termination | rotas print | print docs | Ver | — | — | auth variável / público parcial | — | médio | PARTIAL |

---

## Cobertura sidebar × resource seed

| AppModuleId | No SIDEBAR_MODULE_ORDER | ResourceKey sidebar | No PERMISSION_RESOURCE_SEEDS |
|-------------|-------------------------|---------------------|------------------------------|
| dashboard | sim | `dashboard` | sim |
| products | sim | — | não |
| transformation-simulator | sim | — | não |
| materials | sim | `suprimentos` | sim |
| simulations | sim | — | não |
| projects | sim | — | não |
| crm-commercial | sim | `comercial.crm` | sim |
| customers | sim | — | não |
| proposals | sim | — | não |
| sales-orders | sim | `comercial.pedidos_venda` | sim |
| pricing | sim | — | não |
| commissions | sim | `comissoes` | sim |
| finance | sim | `financeiro` | sim |
| suppliers | sim | — | não (só suppliers via finance keys) |
| portfolio-reconciliation | sim | `financeiro.conciliacao_carteira` | sim |
| opex | sim | — | não |
| taxes | sim | — | não |
| reports | sim | — | não |
| inventory | sim | — | não |
| purchases | sim | — | não |
| machines | sim | — | não |
| operations-performance | sim | — | não |
| maintenance | sim | — | não |
| fleet | sim | — | não |
| employees | sim | — | não |
| settings | sim | **`configuracoes` (FE)** | seed usa **`admin`** |
| guide | sim | — | não |

Grupos accordion com resourceKey: `dashboard`, `financeiro`, `comercial`, `administracao`. Sem: `engenharia`, `operacoes`.

---

## Síntese de gaps do inventário

| Severidade | Gaps tipados neste inventário |
|------------|-------------------------------|
| Crítico | Sync/billing (OR `settings.view`) — detalhar endpoint; test-db; pricing delete |
| Alto | DUAL nav; WEAK_ACTION CRM/SO/Customers; MISSING_TAB estoque; assign seller inline |
| Médio | OR finance leitura; Layout null-module; exports sem chave; FE `configuracoes`≠`admin` |
| Baixo | HIDDEN tabs; ficha RH sem ACL; docs/scripts stale |

Este inventário é a base para a futura matriz C/R/U/D **sem** alterar funcionalidade nesta etapa.
