# Matriz alvo de permissões (contrato canônico)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Fonte** | `src/lib/security/permissionContract` |
| **Status** | Contrato tipado — **não** conectado ao runtime de auth |
| **Pré-req** | Prompt 01 (`permissions-current-state.md`) |

Regenerar: `npx tsx -e "import { formatPermissionTargetMatrixMarkdown } from './src/lib/security/permissionContract/index.ts'; console.log(formatPermissionTargetMatrixMarkdown())"`

| Recurso | Label | Ver | Criar | Editar | Excluir | Exportar | Executar | Gerenciar | Ações específicas |
|---------|-------|-----|-------|--------|---------|----------|----------|-----------|-------------------|
| `admin` | Administração | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `admin.employees` | Pessoas / RH | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `admin.guide` | Guia do Sistema | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `admin.settings` | Configurações | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `admin.settings.branding` | Configurações — Identidade Visual | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `admin.settings.global_params` | Configurações — Parâmetros Globais | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `admin.settings.nomus_sync` | Configurações — Sync Nomus | ✓ | n/a | n/a | n/a | n/a | ✓ | n/a | — |
| `admin.settings.operational` | Configurações — Estrutura Operacional | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `admin.settings.price_tables` | Configurações — Tabelas de Preço | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `admin.settings.security` | Configurações — Usuários e Permissões | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `commercial` | Comercial | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.commissions` | Comissões | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.commissions.closings` | Comissões — Fechamentos | ✓ | n/a | n/a | n/a | ✓ | n/a | n/a | — |
| `commercial.commissions.customer_exclusions` | Comissões — Exceções por cliente | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `commercial.commissions.monthly_closing` | Comissões — Fechamento do mês | ✓ | n/a | n/a | n/a | ✓ | n/a | ✓ | close |
| `commercial.commissions.reports` | Comissões — Relatórios | ✓ | n/a | n/a | n/a | ✓ | n/a | n/a | — |
| `commercial.commissions.reprocess` | Comissões — Reprocessar | ✓ | n/a | n/a | n/a | n/a | ✓ | n/a | reprocess |
| `commercial.crm` | CRM Comercial | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.crm.activities` | CRM — Atividades | n/a | ✓ | ✓ | n/a | n/a | n/a | n/a | — |
| `commercial.crm.assign_seller` | CRM — Atribuir vendedor | n/a | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `commercial.crm.customer_360` | CRM — Cliente 360 | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.crm.general` | CRM — Gestão Geral | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.crm.portfolio` | CRM — Carteira de Clientes | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.crm.seller` | CRM — Gestão por Responsável | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.customers` | Clientes | ✓ | ✓ | ✓ | n/a | n/a | n/a | n/a | — |
| `commercial.pricing` | Formação de Preço | ✓ | n/a | n/a | n/a | n/a | ✓ | ✓ | — |
| `commercial.proposals` | Propostas | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | n/a | — |
| `commercial.proposals.indicators` | Propostas — Indicadores | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.sales_orders` | Pedidos de venda | ✓ | n/a | n/a | n/a | ✓ | n/a | n/a | — |
| `commercial.sales_orders.detail` | Pedido — detalhe | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `commercial.sales_orders.invoice` | Pedido — NF vinculada | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `dashboard` | Dashboard | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering` | Engenharia | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.materials` | Suprimentos | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `engineering.materials.market_intelligence` | Inteligência de Mercado | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.materials.market_intelligence.home` | IM — Home | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.materials.market_intelligence.material_360` | IM — Matéria-prima 360 | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.materials.market_intelligence.quotes` | IM — Cotações / fornecedores | ✓ | n/a | ✓ | n/a | n/a | ✓ | n/a | approve |
| `engineering.products` | Produtos | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | n/a | — |
| `engineering.products.tab.bom` | Produto — BOM | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.products.tab.composition` | Produto — Composição | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.products.tab.cost` | Produto — Custo | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.products.tab.info` | Produto — Info | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.products.tab.routing` | Produto — Roteiro | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.products.tab.tree` | Produto — Árvore | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.projects` | Projetos | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `engineering.projects.detail` | Projeto — detalhe | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `engineering.simulations` | Simulações | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | — |
| `engineering.transformation_simulator` | Simulador de Custo de Injeção | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance` | Financeiro | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.accounts_payable` | Contas a Pagar | ✓ | n/a | n/a | n/a | ✓ | ✓ | ✓ | — |
| `finance.accounts_receivable` | Contas a Receber | ✓ | n/a | n/a | n/a | ✓ | ✓ | n/a | — |
| `finance.billing` | Faturamento | ✓ | n/a | n/a | n/a | ✓ | ✓ | n/a | — |
| `finance.cash_flow` | Fluxo de Caixa | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.cost_centers` | Centros de Custo | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `finance.executive_report` | Relatório Presidencial | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.opex` | Custos Indiretos | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `finance.portfolio_reconciliation` | Conciliação de Carteira | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.portfolio_reconciliation.order_status` | Conciliação — Status Pedidos | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.portfolio_reconciliation.order_to_cash_audit` | Conciliação — Auditoria Pedido → Caixa | ✓ | n/a | n/a | n/a | n/a | ✓ | n/a | — |
| `finance.reports` | Relatórios | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.sales_orders` | Financeiro — Pedidos de Venda | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `finance.suppliers` | Fornecedores | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `finance.suppliers.service_termination` | Fornecedores — Rescisão de serviço | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | — |
| `finance.taxes` | Tributos | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `operations` | Operações | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | — |
| `operations.fleet` | Gestão de Frota | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `operations.inventory` | Estoque / Almoxarifado | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `operations.inventory.counts` | Estoque — Conferência Física | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | approve |
| `operations.inventory.items` | Estoque — Itens | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `operations.inventory.movements` | Estoque — Movimentações | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | — |
| `operations.inventory.warehouses` | Estoque — Almoxarifados | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `operations.machines` | Máquinas | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `operations.maintenance` | Manutenção Predial | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ | — |
| `operations.performance` | Performance | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | — |
| `operations.purchases` | Compras | ✓ | ✓ | ✓ | ✓ | n/a | n/a | n/a | — |

Legenda: `✓` = ação aplicável no contrato (há capacidade/legado real); `n/a` = não aplicável.
Ações específicas fora das colunas: approve, close, reopen, reprocess.
