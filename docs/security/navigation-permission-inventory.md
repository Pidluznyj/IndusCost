# PERM-25 — Inventário de navegação × permissionamento

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | PERM-25 |
| **Data** | 2026-07-16 |
| **Escopo** | Inventário read-only a partir do **código local** — sem dados de banco/produção |
| **Objetivo** | Mapear menus, páginas, abas, drawers/modais e ações antes de corrigir permissionamento |
| **Correções** | **Não** implementadas nesta etapa |

## Fontes no código

| Área | Arquivo |
|------|---------|
| Rotas | `src/App.tsx` |
| Sidebar UI | `src/components/layout/Sidebar.tsx` |
| Grupos / ordem / bags de menu | `src/lib/navigationGroups.ts`, `src/lib/modulePermissions.ts` |
| Sidebar → resourceKey | `src/lib/sidebarMenuResources.ts` |
| Gate de view (path/sidebar) | `src/lib/resourceNavigationAccess.ts`, `src/lib/sidebarEffectiveAccess.ts` |
| Abas / seções internas | `src/lib/moduleTabResources.ts`, `src/lib/internalSurfaceAccess.ts` |
| ResourceKeys FE | `src/lib/permissionsClient.ts` |
| Contrato canônico EN | `src/lib/security/permissionContract/resources.ts` |
| Seed PT + retain | `src/lib/permissionResourceSeedData.ts` |
| `requireResource` | `src/lib/security/requireResource.ts`, `src/lib/security/permissionGuards.ts` |
| Auth legado (bag) | `src/lib/appAuthMiddleware.ts` |
| Wiring HTTP | `server.ts`, `src/lib/*Routes.ts` |

Docs relacionados (não substituem este inventário): `permissions-resource-inventory.md`, `permissions-navigation-view.md`, `permissions-contract.md`, `require-resource-migration-backlog.md`.

---

## 1. Arquitetura de proteção (como ler as colunas)

### Frontend

| Mecanismo | Onde | Função |
|-----------|------|--------|
| `RequireAuth` | `src/components/RequireAuth.tsx` | Sessão autenticada |
| `RequirePathViewAccess` | `src/components/RequirePathViewAccess.tsx` | View por path (DTO / resourceKey) — rotas fora do Layout |
| Layout + `evaluatePathViewAccess` | `src/components/layout/Layout.tsx` | URL direta → `AccessDenied` se sem view |
| `buildResourceAwareSidebarNavigation` | sidebar effective access | Filtra itens do menu |
| `PermissionGate` | `src/components/security/PermissionGate.tsx` | Ação por resourceKey + action |
| `ProtectedTab` | `src/components/security/ProtectedTab.tsx` | Aba por view |
| `canAccessModule` / `hasPermission` / bags | `modulePermissions.ts` + módulos | Fallback legado e botões CRUD |
| `canAccessSettingsSection` / CRM helpers | `modulePermissions.ts` | Seções Settings / abas CRM por bag |
| Role hardcode | vários módulos | `role === "SUPER_ADMIN" \| "ADMIN" \| "SELLER" \| …` |

**Não encontrados** como nomes de componente: `ProtectedRoute`, `ResourceGuard`, `Can`.

### Backend

| Mecanismo | Função |
|-----------|--------|
| `requireAppAuth` | Sessão |
| `requireResource(resourceKey, action)` | Guard oficial via `resolveEffectiveAccess` |
| `requirePermission("foo.view")` (bag) | Middleware legado em `appAuthMiddleware` |
| `requireAnyPermission([...])` | OR de bags |
| `requirePermission(resourceKey, action)` em `permissionGuards` | Alias deprecated → preferir `requireResource` |
| Role hardcodes | SUPER_ADMIN/ADMIN (e afins) em trechos pontuais |

### Dualidade de nomes (crítico)

| Camada | Exemplos |
|--------|----------|
| Sidebar / seed PT | `comercial.crm`, `financeiro`, `comissoes`, `suprimentos`, `configuracoes` |
| Contrato / API EN | `commercial.crm`, `finance`, `commercial.commissions`, `engineering.materials`, `admin.settings` |
| Bags legados | `crm.view`, `finance.view`, `materials.view`, `sales_orders.view`, … |

Bridges: `relationalResourceKeys` no contrato + aliases em `permissionsClient` / effective access. Colunas abaixo separam **resourceKey sidebar/FE** e **contrato EN** quando diferem.

### Legenda das colunas de inventário

| Coluna | Significado |
|--------|-------------|
| **Recurso atual** | resourceKey usado na nav/UI ou seed FE (string literal do código) |
| **Contrato EN** | resourceKey canônico do contrato (quando mapeado) |
| **Recurso ausente** | Gap: sem resourceKey fino, só bag, só herança, ou desalinhamento PT/EN |
| **Proteção FE** | Como a UI decide mostrar/bloquear |
| **Proteção BE** | Como a API decide autorizar (quando conhecido no código) |

---

## 2. Grupos do menu lateral

Fonte: `NAVIGATION_GROUP_DEFINITIONS` + `SIDEBAR_GROUP_RESOURCE_KEYS`.

| Grupo | Nome exibido | resourceKey grupo | Renderização |
|-------|--------------|-------------------|--------------|
| `dashboard` | Dashboard | `dashboard` | Item direto (sem accordion) |
| `engenharia` | Engenharia | `engineering` | Accordion |
| `comercial` | Comercial | `comercial` | Accordion |
| `financeiro` | Financeiro | `financeiro` | Accordion |
| `operacoes` | Operações | `operations` | Accordion |
| `administracao` | Administração | `admin` | Accordion |
| `outros` | Outros | — | Fallback (vazio se tudo mapeado) |

Visibilidade do grupo = filhos filtrados (não há grant isolado de “abrir accordion” além da chave documental).

---

## 3. Módulos do menu (sidebar)

Fonte: `SIDEBAR_MODULE_ORDER`, `MODULE_LABELS`, `getModulePath`, `SIDEBAR_MODULE_RESOURCE_KEYS`, `MODULE_MENU_PERMISSION_KEYS`.

Proteção FE comum de shell: `RequireAuth` + Layout `evaluatePathViewAccess` + sidebar resource-aware. Bags em `canAccessModule` ainda usados dentro de muitos módulos e como fallback de projeção.

### 3.1 Dashboard

| Campo | Valor |
|-------|-------|
| Nome | Dashboard |
| Rota | `/dashboard` |
| Componente | `DashboardModule` |
| Módulo pai | grupo Dashboard |
| Abas | `executivo`, `operacao`, `funil` (estado local — **sem** resourceKey de aba) |
| Ações | visualização de indicadores |
| Recurso atual | `dashboard` |
| Contrato EN | `dashboard` |
| Recurso ausente | abas internas sem recurso |
| Proteção FE | sidebar/Layout view `dashboard`; bags `dashboard.view` em UI |
| Proteção BE | backlog: ainda `requirePermission("dashboard.view")` bag (`REQUIRE_RESOURCE_LEGACY_BACKLOG`) |

### 3.2 Engenharia

| Nome | Rota | Componente | Recurso sidebar/FE | Contrato EN | Bags menu (`MODULE_MENU_PERMISSION_KEYS`) | Proteção FE | Proteção BE (resumo) | Recurso ausente / gap |
|------|------|------------|--------------------|-------------|-------------------------------------------|-------------|----------------------|------------------------|
| Produtos | `/products` (+ `/products/indicators`, `material-demand`, `where-used`) | `ProductModule` (+ dashboards) | `engineering.products` | `engineering.products` | `products.view` | Layout view + bags CRUD + abas modal | `requireResource("engineering.products", …)` em rotas produto | — |
| Simulador de Custo de Injeção | `/transformation-simulator` | `TransformationCostSimulatorModule` | `engineering.transformation_simulator` | `engineering.transformation_simulator` | `products.view` OR `simulations.view` | Layout view + OR legado | `requireResource` transformation_simulator view | bag OR largo no menu legado |
| Suprimentos | `/materials/*` | `MaterialsModule` | `suprimentos` | `engineering.materials` (+ relational) | `materials.view` | Layout view PT + seções MI | `requireResource("engineering.materials"…)` + MI keys | dual PT/EN |
| Simulações | `/simulations` (+ indicators) | `SimulationModule` | `engineering.simulations` | `engineering.simulations` | `simulations.view` | Layout + bags | `requireResource` simulations | — |
| Projetos | `/projects`, `/projects/:id`, `/projects/:id/:tab` | `ProjectsModule` | `engineering.projects` | `engineering.projects` | `projects.view` | Layout + bags manage | `requireResource` projects view/manage | abas detalhe só herdam módulo |

### 3.3 Comercial

| Nome | Rota | Componente | Recurso sidebar/FE | Contrato EN | Bags menu | Proteção FE | Proteção BE (resumo) | Gap |
|------|------|------------|--------------------|-------------|-----------|-------------|----------------------|-----|
| CRM Comercial | `/crm-commercial` | `CrmModule` | `comercial.crm` | `commercial.crm` | `crm.view`, `crm.general.view`, `crm.seller.*` | Layout + abas resource + bags CRM | `requireResource` commercial.crm.* + residual `requireAnyPermission` | dual PT/EN; Cliente 360 parcial |
| Clientes | `/customers` (+ indicators, intelligence) | `CustomerModule` / `CustomerIntelligencePage` | `commercial.customers` | `commercial.customers` | `customers.view` | Layout view | `requireResource` customers | UI CRUD fraca vs API |
| Propostas | `/proposals` (+ indicators) | `ProposalModule` | `commercial.proposals` | `commercial.proposals` | `proposals.view` | Layout + bags create/edit/delete/print | `requireResource` proposals | — |
| Pedidos de venda | `/sales-orders` (+ management, result, sold-products, material-demand, `:id`, indicators) | `SalesOrdersModule` + páginas irmãs | `comercial.pedidos_venda` | `commercial.sales_orders` | `sales_orders.view` | Layout view PT | `requireResource` sales_orders (+ detail); residual bags | dual PT/EN |
| Formação de Preço | `/pricing` (+ indicators) | `PricingModule` | `commercial.pricing` | `commercial.pricing` | `pricing.view` | Layout + bags | `requireResource` pricing view/execute/manage | — |
| Comissões | `/commissions/*` | `CommissionsModule` | `comissoes` | `commercial.commissions` | commissions view bags | Layout + abas live | `requireResource` commissions.* | dual PT/EN; abas seed ocultas |

### 3.4 Financeiro

| Nome | Rota | Componente | Recurso sidebar/FE | Contrato EN | Bags menu | Proteção FE | Proteção BE (resumo) | Gap |
|------|------|------------|--------------------|-------------|-----------|-------------|----------------------|-----|
| Financeiro | `/finance` → AR; `/finance/*` seções | `FinanceModule` | `financeiro` | `finance` | `finance.view`, AR/AP, reports, settings… | Layout shell + seções internas | `requireResource` por seção EN | dual PT/EN no shell |
| Fornecedores | `/finance/suppliers` | `FinanceSuppliersPage` | `finance.suppliers` | `finance.suppliers` | suppliers / cost_centers / finance.view | Layout view | `requireResource` suppliers | — |
| Conciliação de Carteira | `/finance/portfolio-reconciliation` | `FinancePortfolioReconciliationPage` | `financeiro.conciliacao_carteira` | `finance.portfolio_reconciliation` | portfolio* bags | Layout + abas | `requireResource` portfolio + order_status / order_to_cash_audit | abas seed ocultas |
| Custos Indiretos | `/opex` | `IndirectCostModule` | `finance.opex` | `finance.opex` | `opex.view`, `costs.view` | Layout + bags | `requireResource` opex | — |
| Tributos | `/taxes` | `TaxModule` | `finance.taxes` | `finance.taxes` | `taxes.view` | Layout + bags | `requireResource` taxes | — |
| Relatórios | `/reports` (+ `cost-to-cash-trace`) | `ReportsModule` / `CostToCashTracePage` | `finance.reports` | `finance.reports` | `reports.view`, `dashboard.view` | Layout + bags | cost-to-cash ainda `requireAnyPermission` amplo | BE bag residual |

### 3.5 Operações

| Nome | Rota | Componente | Recurso sidebar/FE | Contrato EN | Bags menu | Proteção FE | Proteção BE (resumo) | Gap |
|------|------|------------|--------------------|-------------|-----------|-------------|----------------------|-----|
| Estoque / Almoxarifado | `/inventory` (+ items, warehouses, movements, balances, counts) | `InventoryModule` | `operations.inventory` | `operations.inventory` | `inventory.view` | Layout + abas finas | `requireResource` inventory* | overview/balances/reservations/audit só herdam |
| Compras | `/purchases` (+ indicators) | `PurchaseModule` | `operations.purchases` | `operations.purchases` | `purchases.view` | Layout + bags | `requireResource` purchases | — |
| Máquinas | `/machines` | `MachineModule` | `operations.machines` | `operations.machines` | `machines.view` | Layout + bags | `requireResource` machines | — |
| Performance | `/operations-performance` | `OperationsPerformanceModule` | `operations.performance` | `operations.performance` | component-performance + `products.view` | Layout + bags | `requireResource` performance | OR menu legado largo |
| Ordens de Produção | `/production-orders` | `ProductionOrdersModule` | `operations.production_orders` | `operations.production_orders` | `operations.production-orders.view` | Layout | `requireResource` production_orders view | — |
| Manutenção Predial | `/maintenance` | `MaintenanceModule` | `operations.maintenance` | `operations.maintenance` | `maintenance.view` | Layout + bags | `requireResource` maintenance | — |
| Gestão de Frota | `/fleet` (+ `/fleet/field`) | `FleetModule` / `FleetMobileUsageFlow` | `operations.fleet` | `operations.fleet` | `fleet.view` / `fleet.manage` | Layout + tabs + `canFinancial` | `requireResource` fleet (via `fleetRouteGuards`) | abas sem resourceKey fino |

### 3.6 Administração

| Nome | Rota | Componente | Recurso sidebar/FE | Contrato EN | Bags menu | Proteção FE | Proteção BE (resumo) | Gap |
|------|------|------------|--------------------|-------------|-----------|-------------|----------------------|-----|
| Pessoas / RH | `/employees` | `EmployeeModule` | `admin.employees` | `admin.employees` | `employees.view` | Layout + facetas HR | `requireResource` employees / links / user_link | ficha: capabilities HR ≠ PermissionGate por aba |
| Configurações | `/settings` | `SettingsModule` (`BootstrapAdminSettingsRoute`) | `configuracoes` | `admin.settings` | `settings.view`, `users.manage` | Layout + `canAccessSettingsSection` | settings routes + `admin.settings.security` | sidebar key deprecated retain |
| Guia do Sistema | `/guide` | `SystemGuideModule` | `admin.guide` | `admin.guide` | `guide.view`, `dashboard.view` | Layout | (conteúdo estático / pouca API) | — |

---

## 4. Rotas profundas, impressão e públicas

### 4.1 Públicas / sem Layout autenticado (`App.tsx`)

| Rota | Componente | Nota de proteção |
|------|------------|------------------|
| `/` | `PublicLandingRoute` | público |
| `/login` | `PublicLoginRoute` | público |
| `/proposals/:id/print` | `ProposalPrintView` | path público no router — auth pode estar no componente/API |
| `/proposals/:id/internal-management-print` | `ProposalInternalManagementPrintView` | idem |
| `/sales-orders/:id/print` | `SalesOrderPrintView` | idem |
| `/finance/suppliers/:supplierId/service-terminations/:id/print` | `SupplierServiceTerminationPrintView` | idem |
| `/public/fleet/reservation/:token` | `FleetPublicReservationPage` | token público |
| `/public/fleet/vehicle-checklist/:vehicleToken` | `FleetPublicVehicleChecklistPage` | token público |
| `/reservar-carro`, `/r/:sub` | `FleetPublicReservationShortLinkPage` | short-link público |

### 4.2 Autenticadas fora do Layout (`RequireAuth` + `RequirePathViewAccess`)

| Rota | Componente | Recurso de path (módulo) |
|------|------------|--------------------------|
| `/projects/intake-form*` (variantes blank/full/print) | `ProjectIntakeFormPage` | `engineering.projects` |
| `/projects/:projectId/intake-form*` | idem | idem |
| `/projects/:projectId/report` | `ProjectExecutiveReportPage` | idem |
| `/projects/:projectId/client-report` | `ProjectClientReportPage` | idem |

### 4.3 Deep links sob Layout (além do item de menu)

| Área | Rotas | Página pai |
|------|-------|------------|
| Produtos | `/products/indicators`, `/products/material-demand`, `/products/where-used` | Produtos |
| Compras | `/purchases/indicators` | Compras |
| Pricing / Proposals / Simulations / Customers / Sales | `*/indicators` e rotas irmãs listadas em `App.tsx` | módulo comercial/engenharia correspondente |
| Pedidos | `/sales-orders/management`, `result`, `sold-products`, `material-demand`, `:id` | Pedidos de venda |
| Inteligência cliente | `/customers/:id/intelligence`, `/crm/customers/:id/intelligence` | Clientes / CRM |
| Relatórios | `/reports/cost-to-cash-trace` | Relatórios |
| Frota campo | `/fleet/field` | Frota |
| Financeiro seções | ver §5.1 | Financeiro |

---

## 5. Abas e seções internas

### 5.1 Financeiro — seções (`FINANCE_UI_SECTIONS`)

| Nome | Rota | Recurso FE | Contrato EN | Página pai |
|------|------|------------|-------------|------------|
| Fluxo de Caixa | `/finance/cash-flow` | `finance.cash_flow` | `finance.cash_flow` | Financeiro |
| Contas a Receber | `/finance/accounts-receivable` | `financeiro.contas_receber` | `finance.accounts_receivable` | Financeiro |
| Contas a Pagar | `/finance/accounts-payable` | `financeiro.contas_pagar` | `finance.accounts_payable` | Financeiro |
| Faturamento | `/finance/billing` | `finance.billing` | `finance.billing` | Financeiro |
| Pedidos de Venda (fin.) | `/finance/sales-orders` | `finance.sales_orders` | `finance.sales_orders` | Financeiro |
| Centros de Custo | `/finance/cost-centers` | `finance.cost_centers` | `finance.cost_centers` | Financeiro |
| Relatório Presidencial | `/finance/executive-report` | `finance.executive_report` | `finance.executive_report` | Financeiro |

**Sub-abas de Centros de Custo** (herdam `finance.cost_centers`; sem resourceKey próprio): Visão Geral, Centros, Fornecedores, Regras, Sem classificação, Auditoria.

### 5.2 Conciliação de Carteira (`PORTFOLIO_RECONCILIATION_UI_TABS`)

| Nome | Recurso FE | Contrato EN | Visível na UI |
|------|------------|-------------|----------------|
| Conciliação | `financeiro.conciliacao_carteira.tab.conciliacao` | (seed/contrato portfolio) | oculta |
| Inteligência da Carteira | `…tab.inteligencia` | — | oculta |
| Status Pedidos | `…tab.status_pedidos` | `finance.portfolio_reconciliation.order_status` | visível |
| Auditoria Pedido → Caixa | `…tab.auditoria_pedido_caixa` | `finance.portfolio_reconciliation.order_to_cash_audit` | visível |

### 5.3 CRM (`CRM_UI_TABS`)

| Nome | id UI | Recurso FE | Contrato EN |
|------|-------|------------|-------------|
| Gestão Geral | `general` | `comercial.crm.tab.gestao_geral` | `commercial.crm.general` |
| Gestão por Responsável | `seller` | `comercial.crm.tab.gestao_vendedor` | `commercial.crm.seller` |
| Carteira de Clientes | `portfolio` | `comercial.crm.tab.carteira_clientes` | `commercial.crm.portfolio` |

Também no catálogo: `comercial.crm.tab.cliente_360` ↔ `commercial.crm.customer_360` (página Inteligência do Cliente).

### 5.4 Comissões — abas live (`COMMISSIONS_LIVE_UI_TABS`)

| Nome | Path típico | Recurso FE | Contrato EN |
|------|-------------|------------|-------------|
| Fechamento do mês | `/commissions` | `comissoes.tab.fechamento_mes` | `commercial.commissions.monthly_closing` |
| Fechamentos | `/commissions/fechamentos` | `comissoes.tab.fechamentos` | `…closings` |
| Exceções por cliente | `/commissions/exclusoes-cliente` | `comissoes.tab.excecoes_cliente` | `…customer_exclusions` |
| Relatórios | `/commissions/relatorios` | `comissoes.tab.relatorios` | `…reports` |
| Reprocessar | `/commissions/reprocessar` | `comissoes.tab.reprocessar` | `…reprocess` |

Abas seed/legado ainda mapeadas em `COMMISSIONS_CATALOG_TAB_RESOURCE_BY_LEGACY` (dashboard, previstas, confirmadas, liberação, pagamentos, pessoas, regras, auditoria, configurações) — UI atual redireciona/oculta.

### 5.5 Suprimentos / MI (`MATERIALS_UI_SECTIONS`)

| Nome | Path | Recurso FE | Contrato EN |
|------|------|------------|-------------|
| Matérias-primas | `/materials` | `suprimentos.tab.catalogo` | `engineering.materials` (+ relational) |
| Inteligência de Mercado | `/materials/market-intelligence` | `suprimentos.inteligencia_mercado.tab.home` | `engineering.materials.market_intelligence.home` |

Filhos MI: `…tab.materia_prima_360`, `…fornecedores`, `…alertas`, `…configuracoes` ↔ `engineering.materials.market_intelligence.*`.

### 5.6 Produtos — abas do modal (`PRODUCT_UI_TABS`)

| Nome | Recurso contrato | Bag legado |
|------|------------------|------------|
| Info / Histórico | `engineering.products.tab.info` | `products.tab.info` |
| BOM | `engineering.products.tab.bom` | `products.tab.bom` |
| Roteiro | `engineering.products.tab.routing` | `products.tab.routing` |
| Árvore | `engineering.products.tab.tree` | `products.tab.tree` |
| Custo | `engineering.products.tab.cost` | `products.tab.cost` |
| Composição | `engineering.products.tab.composition` | `products.tab.composition` |

### 5.7 Estoque (`INVENTORY_TAB_DEFS` + `INVENTORY_TAB_RESOURCE_KEYS`)

| Nome | Rota deep | Recurso fino | Nota |
|------|-----------|--------------|------|
| Visão Geral | `/inventory` | herda `operations.inventory` | — |
| Itens | `/inventory/items` | `operations.inventory.items` | — |
| Almoxarifados | `/inventory/warehouses` | `operations.inventory.warehouses` | — |
| Saldos | `/inventory/balances` | herda módulo | — |
| Movimentações | `/inventory/movements` | `operations.inventory.movements` | — |
| Conferência Física | `/inventory/counts` | `operations.inventory.counts` | — |
| Reservas | — | herda | `comingSoon` |
| Auditoria | — | herda | `comingSoon` |

### 5.8 Frota (`fleetNavigation.ts`)

Abas nav: Visão Geral, Veículos, Motoristas, Reservas, Solicitações QR, Checklists, Manutenção, Configurações.
Avançadas (`canFinancial`): Relatórios, Custos, Ocorrências.
Todas herdam `operations.fleet` (sem resourceKey por aba).

### 5.9 Configurações — hub (`HUB_SECTIONS`)

| id | Nome | Status | Acesso (código) |
|----|------|--------|-----------------|
| `globals` | Gerais / Parâmetros Globais | operational | `admin.settings.global_params` / bags `settings.global_params.*` |
| `branding` | Identidade Visual | operational | `admin.settings.branding` |
| `operational` | Estrutura Operacional | operational | `admin.settings.operational` |
| `nomusSync` | Logs Nomus | operational | `admin.settings.nomus_sync` / `settings.nomus.*` |
| `priceTables` | Tabelas de Preço | operational | `admin.settings.price_tables` |
| `security` | Usuários e Permissões | operational | `admin.settings.security` / `users.manage` / profiles |
| `integrations` | Integrações | future | legado `settings.view` |
| `system` | Sistema | future | legado `settings.view` |

Sidebar module key permanece `configuracoes` (retain) ↔ contrato `admin.settings`.

### 5.10 Dashboard / Projetos / Pessoas

| Superfície | Abas | Recurso |
|------------|------|---------|
| Dashboard | executivo / operação / funil | **ausente** (só módulo) |
| Projetos detalhe | home / items / costs / docs / hist (via `:tab`) | herda `engineering.projects` |
| Ficha employee | professional, personal, emergency, epi, salary, links | `admin.employees` + facetas `personal_data`, `administrative_data`, `sensitive_data`, `epi`, `links`, `user_link` |

### 5.11 Heranças explícitas (`INTERNAL_SURFACE_INHERITANCE`)

| Superfície | Herda de |
|------------|----------|
| `OrderFullAuditDialog` | `finance.portfolio_reconciliation.order_to_cash_audit` |
| OrderStatus* / portfolio drawers | `finance.portfolio_reconciliation.order_status` |
| CustomerIntelligence tabs | `commercial.crm.customer_360` |
| Project detail tabs | `engineering.projects` |
| Employee ficha tabs | `admin.employees` (+ facetas) |
| Fleet tabs | `operations.fleet` (+ `canFinancial`) |
| Settings hub | `admin.settings` (+ users/profiles) |
| Inventory overview/balances/reservations/audit | `operations.inventory` |

---

## 6. Drawers e modais importantes

Inventário de superfícies de interação relevantes (não exaustivo de todo Dialog do repositório). Herança de permissão quando sem rota própria: ver §5.11.

| Área | Componente (path típico) | Ação típica | Recurso / herança |
|------|--------------------------|-------------|-------------------|
| Portfolio | `OrderFullAuditDialog`, `OrderStatusDrawer`, `OrderStatusPedidosDrawer`, `Portfolio*Drawer` | auditoria / drilldown | order_to_cash_audit / order_status |
| Finance AP/CC | `FinanceApTitleClassificationSheet`, reclassify modals, `FinanceSupplierCadastroDrawer`, termination dialog | classificar / CRUD fornecedor | AP / cost_centers / suppliers |
| Finance shared | `FinanceDataAuditDrawer` | auditoria | seção financeira ativa |
| Sales | `SalesOrderDetailDialog`, `SalesOrder*Drawer`, intelligence/margin drawers | view / ops | `commercial.sales_orders` (+ detail) |
| Inventory | `Inventory*DetailSheet`, `InventoryMovementFormSheet`, count sheet | CRUD / movimentos / counts | inventory* |
| Products | `DataImportDialog`, Nomus BOM modals, reclassification | import / sync | `engineering.products` |
| Materials MI | quote / reliability modals | cotação / approve | materials + MI |
| Commissions | rule/person/exclusion/payment modals + drawers | CRUD / close / pay | commissions.* |
| Projects | `Project*Modal` | CRUD estrutura/custos | `engineering.projects` |
| Fleet | `FleetVehicleDetailSheet`, checkout/checkin | veículo / uso | `operations.fleet` |
| Ops performance | `ComponentPerformanceEditDrawer`, history | update cycle | `operations.performance` |

---

## 7. Ações CRUD e especiais (matriz representativa)

Valores citados são **strings do código** (contrato e/ou bags). Não inventa grants do banco.

| Módulo | Ações na UI/API | Chaves típicas | FE | BE |
|--------|-----------------|----------------|----|----|
| Produtos | create / edit / delete / export / import / Nomus BOM | `engineering.products` + create\|update\|delete; bags `products.*` | bags + PermissionGate parcial | `requireResource` products |
| Materials | CRUD + MI approve/export | `engineering.materials` view\|update; quote approve | bags + MI view | `requireResource` materials/MI |
| Propostas | create/edit/delete/print | bags `proposals.*`; API `commercial.proposals` | bags | `requireResource` proposals |
| Pedidos | view/export/print/management/result | `commercial.sales_orders` (+ detail/invoice); bag `sales_orders.view` | view shell | `requireResource` + residual bags |
| Comissões | close / reprocess / export / exclusions | `commercial.commissions.*` close\|reprocess\|manage\|export | abas + bags | `requireResource` commissions |
| Finance AR/AP | view/export/manage/sync | `finance.accounts_receivable` / `finance.accounts_payable` | seções | `requireResource` |
| Billing | view/export/sync execute | `finance.billing` | seção | `requireResource` |
| Cost centers | manage classification | `finance.cost_centers` manage | seção | `requireResource` |
| Inventory | manage items/warehouses; create movements; approve counts | `operations.inventory.*` | abas | `requireResource` |
| Purchases | create/update/delete requests | `operations.purchases` | bags | `requireResource` |
| Machines | update (POST/PUT/DELETE → update) | `operations.machines` | bags | `requireResource` |
| Fleet | view/manage (+ approve reserva pública) | `operations.fleet` | tabs + canFinancial | `requireResource` fleet |
| Employees | create/update + user_link/links | `admin.employees*` | HR capabilities | `requireResource` |
| Settings | update globals/branding; Nomus sync; users/profiles | `admin.settings.*` | hub sections | settings + security routes |
| Reports / Cost-to-cash | audit view | bags OR | Layout reports | `requireAnyPermission` residual |
| Impressão | propostas / pedidos / rescisão fornecedor / projetos | print bags / view pai | rotas print (ver §4.1) | API conforme rota |

---

## 8. Recursos registrados no código

### 8.1 Contrato canônico (EN) — famílias

Fonte: `permissionContract/resources.ts` (lista completa no arquivo; abaixo as famílias).

- `dashboard`
- `engineering` → products (+ tabs), transformation_simulator, materials (+ market_intelligence), simulations, projects (+ detail)
- `commercial` → crm (+ general/seller/portfolio/customer_360/activities/assign_seller), customers, proposals (+ indicators), sales_orders (+ detail/invoice), pricing, commissions (+ monthly_closing/closings/customer_exclusions/reports/reprocess)
- `finance` → cash_flow, accounts_receivable, accounts_payable, billing, sales_orders, cost_centers, executive_report, suppliers (+ service_termination), portfolio_reconciliation (+ order_status, order_to_cash_audit), opex, taxes, tax_apuration, reports
- `operations` → inventory (+ items/warehouses/movements/counts), purchases, machines, performance, production_orders, maintenance, fleet
- `admin` → employees (+ personal/administrative/sensitive/links/user_link/epi), settings (+ security/nomus_sync/branding/global_params/operational/price_tables), guide

### 8.2 Seed / FE PT (legado + retain)

Fonte: `LEGACY_PERMISSION_RESOURCE_SEEDS` / `ResourceKeys` — exemplos: `financeiro*`, `comercial*`, `comissoes*`, `suprimentos*`, `admin.usuarios`, `admin.permissoes`, retain `configuracoes`.

### 8.3 Constantes de módulo (piloto)

| Constante | Keys |
|-----------|------|
| `FINANCE_MODULE_RESOURCE_KEYS` | `finance`, `finance.cash_flow`, … |
| `FINANCE_AP_RESOURCE_KEY` | `finance.accounts_payable` |
| `COMMERCIAL_RESOURCE_KEYS` | `commercial.*` |
| `ENGINEERING_RESOURCE_KEYS` | `engineering.*` |
| `OPERATIONS_RESOURCE_KEYS` | `operations.*` |
| `EMPLOYEES_RESOURCE_KEYS` | `admin.employees*` |
| `ADMIN_SETTINGS_RESOURCE_KEYS` | `admin.settings*`, `admin.guide` |
| `REQUIRE_RESOURCE_ADMIN_KEYS.security` | `admin.settings.security` |

---

## 9. Usos de `requireResource` (chaves observadas)

Chaves literais/constantes usadas com o guard oficial (amostra consolidada dos `*Routes.ts` / `server.ts`):

| Resource key | Actions típicas |
|--------------|-----------------|
| `engineering.products` | view, create, update, delete |
| `engineering.materials` | view, update |
| `engineering.materials.market_intelligence` (+ `.home`) | view |
| `engineering.simulations` | view, create |
| `engineering.transformation_simulator` | view |
| `engineering.projects` | view, manage |
| `commercial.crm.general\|seller\|portfolio` | view |
| `commercial.crm.activities` | create, update |
| `commercial.customers` | view, create, update |
| `commercial.proposals` | view, create, update, delete |
| `commercial.sales_orders` (+ `.detail`) | view |
| `commercial.pricing` | view, execute, manage |
| `finance.cash_flow` | view |
| `finance.accounts_receivable` | view, export |
| `finance.accounts_payable` | view, export, manage |
| `finance.billing` | view, export, execute |
| `finance.cost_centers` / suppliers / portfolio* / opex / taxes / reports | view / manage / update |
| `operations.machines\|inventory*\|purchases\|performance\|production_orders\|maintenance\|fleet` | view / update / create / manage / approve |
| `admin.employees` (+ links, user_link) | view / create / update / manage |
| `admin.settings.security` | view / manage |
| `admin.settings.price_tables` | view |

Backlog explícito (`REQUIRE_RESOURCE_LEGACY_BACKLOG`): dashboard bag; residual commercial (CRM 360 / ranking / funnel); residual engineering (Nomus / MI attachments).

---

## 10. Verificações legadas por role ou `permissions[]`

Padrões ainda presentes no código:

| Padrão | Onde / uso |
|--------|------------|
| `canAccessModule` + `hasPermission` / `hasAnyPermission` | Shell legado e botões CRUD em módulos |
| `auth.hasPermission("…")` | Maioria dos botões de ação |
| `role === "SUPER_ADMIN" \| "ADMIN" \| "SELLER" \| "COMMERCIAL_MANAGER"` | CRM scope, deletes cost centers, reprocess commissions, bypass |
| `requirePermission("materials.view")` / `"sales_orders.view"` etc. | Middleware bag em várias rotas |
| `requireAnyPermission([...])` | CI, funnel, cost-to-cash, ranking, Nomus, diagnostics |
| `permissions.includes` | testes + helpers fiscais sales |
| `canAccessSettingsSection` | hub Settings |
| `canAccessCrmGeneral/Seller/Portfolio` | abas CRM (bag) em paralelo a resourceKey |

Não há helper nomeado `hasRole()`; checagens são `role ===` diretas.

---

## 11. Gaps consolidados (recurso ausente / desalinhado)

Sem inventar estado do banco — apenas o que o código evidencia:

1. **Dual PT sidebar vs EN contrato** — mesmo módulo com chaves diferentes (`comercial.crm` vs `commercial.crm`, `suprimentos` vs `engineering.materials`, `comissoes` vs `commercial.commissions`, `financeiro` vs `finance`, `configuracoes` vs `admin.settings`). Aliases existem; risco de divergência se alias falhar.
2. **Abas Dashboard** sem resourceKey.
3. **Sub-abas Centros de Custo** sem resourceKey próprio.
4. **Portfolio** — abas `conciliacao` / `inteligencia` seedadas porém ocultas na UI.
5. **Inventory** — overview/balances/reservations/audit só herdam; reservations/audit `comingSoon`.
6. **Fleet / Projects** — abas internas sem resourceKey fino.
7. **Settings** — sidebar `configuracoes` deprecated retain vs `admin.settings`.
8. **APIs ainda bag-only** em superfícies já migradas na UI (dashboard, cost-to-cash OR, residual CRM/engineering) — gap de BE.
9. **Rotas de print** de propostas/pedidos/rescisão registradas **fora** de `RequireAuth` no `App.tsx` — revisar auth no componente/API.
10. **`permissions-navigation-view.md` desatualizado** — afirma que só ~8 módulos têm resourceKey; `sidebarMenuResources.ts` hoje mapeia essencialmente todos.
11. **Employee ficha** — facetas HR / capabilities, nem sempre `PermissionGate` por aba.
12. **Role short-circuits** (`SELLER` força CRM próprio; SUPER_ADMIN bypass) convivem com o resolvedor de recurso — caminho dual.

---

## 12. Checklist de cobertura PERM-25

| Item pedido | Status neste doc |
|-------------|------------------|
| Módulos principais | §2–3 |
| Itens menu lateral / submenus (grupos) | §2–3 |
| Páginas e rotas | §3–4 |
| Abas internas | §5 |
| Drawers / modais importantes | §6 |
| Ações CRUD + export/print/audit/aprovação/config | §7 |
| Recursos registrados | §8 |
| Usos `requireResource` | §9 |
| Checagens antigas role / permissions[] | §10 |
| Colunas nome/rota/componente/pai/abas/ações/recurso/proteção | §3–7 |
| Sem correção implementada | ✅ |
| Sem dados inventados do banco | ✅ |

---

## 13. Próximos passos sugeridos (fora do escopo PERM-25)

1. Unificar chaves PT/EN na matriz de permissões (PERM follow-ups).
2. Migrar residual `requirePermission` bag → `requireResource` (dashboard, cost-to-cash, CRM 360, Nomus).
3. Definir resourceKeys finos para abas Dashboard / Fleet / Projects / cost-center sub-tabs (ou documentar herança como política final).
4. Revisar rotas de impressão públicas no router.
5. Atualizar `permissions-navigation-view.md` para refletir `SIDEBAR_MODULE_RESOURCE_KEYS` completo.
`)