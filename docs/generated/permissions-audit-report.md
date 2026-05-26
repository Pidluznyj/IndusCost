# IndusCost — Relatório de auditoria de permissões

Gerado em 2026-05-26T14:23:44.395Z · fase `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.

> Relatório gerado automaticamente por `npm run audit:permissions`. NÃO altera dados — apenas leitura estática do código.

## Resumo executivo

- Permissões no catálogo: **73**
- Permissões observadas (catálogo + código): **73**
- ORFÃS (no catálogo, sem uso): **5**
- FANTASMAS (usadas, fora do catálogo): **0**
- SOMENTE_FE (gate só visual): **2**
- SOMENTE_BE (gate sem UI): **26**
- Rotas mapeadas em server.ts: **179** (87 mutações / 92 leituras)
- Rotas SEM proteção de permissão (apenas auth ou nada): **9**
- Mutações sem requirePermission/Any direto: **4** (algumas usam bootstrap/users.manage — ver detalhes)

## Matriz consolidada de permissões

| Permissão | Catálogo? | Backend | Frontend | Módulo | Tipo | Risco | Status | Observação |
|---|---|---|---|---|---|---|---|---|
| `costs.view` | Sim | — | — | costs | menu | sensitive | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `crm.activities.create` | Sim | server.ts:9864 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.activities.edit` | Sim | server.ts:10002 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.customer_cockpit.view` | Sim | server.ts:9819 (+4) | — | crm-commercial | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.general.view` | Sim | server.ts:10260 (+1) | src/lib/modulePermissions.ts:110 | crm-commercial | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.profile.edit` | Sim | server.ts:12664 | — | crm-commercial | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `crm.seller.all` | Sim | server.ts:11198 (+2) | src/lib/modulePermissions.ts:114 (+2) | crm-commercial | action | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.seller.own` | Sim | server.ts:11198 (+1) | src/lib/modulePermissions.ts:114 (+1) | crm-commercial | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.seller.view` | Sim | server.ts:11198 | src/lib/modulePermissions.ts:114 | crm-commercial | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `crm.view` | Sim | server.ts:10181 (+2) | — | crm-commercial | menu | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.commercial360.view` | Sim | server.ts:9673 (+2) | — | customers | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.create` | Sim | server.ts:12711 | — | customers | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.edit` | Sim | server.ts:9522 (+3) | — | customers | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `customers.view` | Sim | server.ts:9510 (+10) | src/lib/modulePermissions.ts:70 | customers | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `dashboard.view` | Sim | server.ts:1607 (+3) | src/lib/modulePermissions.ts:66 (+2) | dashboard | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `employees.edit` | Sim | server.ts:1942 (+3) | — | employees | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `employees.view` | Sim | server.ts:1857 (+1) | src/lib/modulePermissions.ts:82 | employees | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `guide.view` | Sim | src/lib/modulePermissions.ts:103 | src/lib/modulePermissions.ts:103 | guide | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `machines.edit` | Sim | server.ts:1755 (+2) | — | machines | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `machines.view` | Sim | server.ts:1747 (+1) | src/lib/modulePermissions.ts:84 | machines | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `maintenance.manage` | Sim | server.ts:13481 (+2) | — | maintenance | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `maintenance.view` | Sim | server.ts:13406 (+3) | src/lib/modulePermissions.ts:97 | maintenance | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `materials.edit` | Sim | server.ts:2099 (+8) | — | materials | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `materials.view` | Sim | server.ts:2087 (+2) | src/lib/modulePermissions.ts:86 | materials | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `opex.edit` | Sim | server.ts:5318 (+2) | — | opex | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `opex.view` | Sim | server.ts:5311 (+1) | src/lib/modulePermissions.ts:88 | opex | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.generate_tables` | Sim | server.ts:5408 | src/components/PricingModule.tsx:111 | pricing | action | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.publish_tables` | Sim | server.ts:5984 | src/components/PricingModule.tsx:112 | pricing | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.simulate` | Sim | server.ts:6264 (+5) | src/components/PricingModule.tsx:110 | pricing | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `pricing.view` | Sim | server.ts:5354 (+11) | src/lib/modulePermissions.ts:80 (+1) | pricing | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.create` | Sim | server.ts:4691 | src/components/ProductModule.tsx:151 | products | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.delete` | Sim | server.ts:5183 (+1) | src/components/ProductModule.tsx:153 | products | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `products.edit` | Sim | server.ts:2893 (+25) | src/components/ProductModule.tsx:152 | products | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `products.export.engineering` | Sim | — | src/components/ProductModule.tsx:154 | products | action | normal | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `products.tab.bom` | Sim | server.ts:3280 (+14) | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.composition` | Sim | server.ts:8180 | — | products | tab | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.cost` | Sim | server.ts:3581 (+13) | — | products | tab | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.info` | Sim | server.ts:4546 | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.tab.routing` | Sim | — | — | products | tab | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `products.tab.tree` | Sim | server.ts:4684 | — | products | tab | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `products.view` | Sim | server.ts:2881 (+26) | src/lib/modulePermissions.ts:76 (+1) | products | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.create` | Sim | server.ts:13158 (+1) | src/lib/modulePermissions.ts:255 | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.delete` | Sim | server.ts:13247 (+1) | src/lib/modulePermissions.ts:263 | proposals | action | critical | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.edit` | Sim | server.ts:12997 (+4) | src/lib/modulePermissions.ts:255 (+1) | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.indicators.view` | Sim | server.ts:8180 (+1) | src/lib/modulePermissions.ts:271 | proposals | tab | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.material_report.view` | Sim | server.ts:8862 (+4) | — | proposals | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `proposals.print` | Sim | src/lib/modulePermissions.ts:267 | src/lib/modulePermissions.ts:267 | proposals | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `proposals.view` | Sim | server.ts:5792 (+4) | src/lib/modulePermissions.ts:72 | proposals | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.create` | Sim | server.ts:2623 | src/components/PurchaseModule.tsx:176 | purchases | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.delete` | Sim | — | src/components/PurchaseModule.tsx:178 | purchases | action | critical | SOMENTE_FE | Aparece só no frontend. Backend não impõe — é apenas guia de UI. |
| `purchases.edit` | Sim | server.ts:2462 (+2) | src/components/PurchaseModule.tsx:177 | purchases | action | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `purchases.indicators.view` | Sim | — | — | purchases | section | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `purchases.view` | Sim | server.ts:2450 (+3) | src/lib/modulePermissions.ts:78 | purchases | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `reports.view` | Sim | server.ts:9004 (+1) | src/lib/modulePermissions.ts:101 | reports | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `sales_orders.detail.view` | Sim | server.ts:13318 | — | sales-orders | section | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `sales_orders.invoice.view` | Sim | — | — | sales-orders | section | normal | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `sales_orders.view` | Sim | server.ts:13265 (+2) | src/lib/modulePermissions.ts:74 | sales-orders | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.branding.edit` | Sim | server.ts:7048 | — | settings | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.branding.view` | Sim | server.ts:7036 (+1) | src/lib/modulePermissions.ts:163 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.global_params.edit` | Sim | server.ts:7310 (+1) | — | settings | action | critical | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.global_params.view` | Sim | server.ts:7126 (+3) | src/lib/modulePermissions.ts:165 | settings | section | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.nomus.sync` | Sim | — | — | settings | action | critical | ORFÃ | Declarada no catálogo, mas não é referenciada em nenhum lugar. |
| `settings.nomus.view` | Sim | server.ts:7161 (+3) | src/lib/modulePermissions.ts:169 | settings | section | sensitive | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.operational.manage` | Sim | server.ts:1722 (+5) | — | settings | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.operational.view` | Sim | server.ts:1715 (+2) | src/lib/modulePermissions.ts:167 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.price_tables.manage` | Sim | server.ts:5408 (+1) | — | settings | action | critical | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `settings.price_tables.view` | Sim | server.ts:5354 (+3) | src/lib/modulePermissions.ts:171 | settings | section | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `settings.view` | Sim | server.ts:1715 (+11) | src/components/SettingsModule.tsx:322 (+2) | settings | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `simulations.create` | Sim | server.ts:6686 (+4) | — | simulations | action | normal | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `simulations.view` | Sim | server.ts:6679 (+4) | src/lib/modulePermissions.ts:90 | simulations | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `taxes.edit` | Sim | server.ts:6113 (+2) | — | taxes | action | sensitive | SOMENTE_BE | Aparece só no backend. UI não está ensinando o usuário sobre o gate. |
| `taxes.view` | Sim | server.ts:6105 (+1) | src/lib/modulePermissions.ts:92 | taxes | menu | normal | OK | Declarada no catálogo e usada nos dois lados. |
| `users.manage` | Sim | server.ts:1164 (+11) | src/components/AdminUsersModule.tsx:79 (+2) | settings | section | critical | OK | Declarada no catálogo e usada nos dois lados. |

## Permissões órfãs

- `costs.view` (Custos — visualizar (legado)) — Permissão legada que libera módulos de custo/operação. Prefira permissões específicas por módulo.
- `products.tab.routing` (Engenharia — Aba Processo/Roteiro) — Aba de roteiro de processo.
- `purchases.indicators.view` (Compras — Indicadores) — Indicadores do módulo de compras.
- `sales_orders.invoice.view` (Pedidos — Faturamento/NFe) — Informações de faturamento e NFe.
- `settings.nomus.sync` (Configurações — Executar sincronização Nomus) — Disparar sincronização com Nomus.

## Permissões SOMENTE_FE (gate só visual)

- `products.export.engineering` — frontend: src/components/ProductModule.tsx:154
- `purchases.delete` — frontend: src/components/PurchaseModule.tsx:178

## Permissões SOMENTE_BE (gate sem UI)

- `crm.activities.create` — backend: server.ts:9864
- `crm.activities.edit` — backend: server.ts:10002
- `crm.customer_cockpit.view` — backend: server.ts:9819 (+4)
- `crm.profile.edit` — backend: server.ts:12664
- `crm.view` — backend: server.ts:10181 (+2)
- `customers.commercial360.view` — backend: server.ts:9673 (+2)
- `customers.create` — backend: server.ts:12711
- `customers.edit` — backend: server.ts:9522 (+3)
- `employees.edit` — backend: server.ts:1942 (+3)
- `machines.edit` — backend: server.ts:1755 (+2)
- `maintenance.manage` — backend: server.ts:13481 (+2)
- `materials.edit` — backend: server.ts:2099 (+8)
- `opex.edit` — backend: server.ts:5318 (+2)
- `products.tab.bom` — backend: server.ts:3280 (+14)
- `products.tab.composition` — backend: server.ts:8180
- `products.tab.cost` — backend: server.ts:3581 (+13)
- `products.tab.info` — backend: server.ts:4546
- `products.tab.tree` — backend: server.ts:4684
- `proposals.material_report.view` — backend: server.ts:8862 (+4)
- `sales_orders.detail.view` — backend: server.ts:13318
- `settings.branding.edit` — backend: server.ts:7048
- `settings.global_params.edit` — backend: server.ts:7310 (+1)
- `settings.operational.manage` — backend: server.ts:1722 (+5)
- `settings.price_tables.manage` — backend: server.ts:5408 (+1)
- `simulations.create` — backend: server.ts:6686 (+4)
- `taxes.edit` — backend: server.ts:6113 (+2)

## Rotas sem requirePermission/requireAnyPermission

Estas rotas usam apenas `requireAppAuth`, `requireBootstrap*`, `requireUserAdminOrBootstrap` ou nenhum guard. Para auditoria de risco, classifique cada uma e migre as mutations sensíveis para permissão específica.

| Método | Rota | Linha | Guards | Permissões | Observação |
|---|---|---|---|---|---|
| GET | `/api/health` | 1011 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/bootstrap-admin/status` | 1015 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/bootstrap-admin/login` | 1027 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/bootstrap-admin/logout` | 1063 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/auth/login` | 1171 | (nenhum) | — | 🚨 SEM autenticação |
| POST | `/api/auth/logout` | 1222 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/auth/me` | 1237 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `/api/admin/permissions/catalog` | 1255 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| GET | `/api/admin/seller-options` | 1259 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| GET | `/api/admin/users` | 1269 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users` | 1281 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| PATCH | `/api/admin/users/:id` | 1341 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users/:id/reset-password` | 1490 | requireUserAdminOrBootstrap | — | 🔒 admin de usuários (users.manage ou bootstrap) |
| POST | `/api/admin/users/bootstrap-super-admin` | 1521 | requireBootstrapAdmin | — | 🔒 só bootstrap admin (acesso administrativo temporário) |
| GET | `/api/test-db` | 1585 | (nenhum) | — | 🚨 SEM autenticação |
| GET | `*` | 13765 | (nenhum) | — | 🚨 SEM autenticação |

## Mutations sem requirePermission/Any direto

Mutations (POST/PUT/PATCH/DELETE) que não passam por `requirePermission`/`requireAnyPermission` direto. Confirmar caso a caso — algumas usam `requireBootstrapOrAnyPermission` (vide coluna Guards) e estão OK; outras podem precisar de gate específico.

| Método | Rota | Linha | Guards |
|---|---|---|---|
| POST | `/api/bootstrap-admin/login` | 1027 | (nenhum) |
| POST | `/api/bootstrap-admin/logout` | 1063 | (nenhum) |
| POST | `/api/auth/login` | 1171 | (nenhum) |
| POST | `/api/auth/logout` | 1222 | (nenhum) |

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

- `employees.view` — **Colaboradores**: Consultar colaboradores.
- `employees.edit` — **Colaboradores — Editar** _(sensitive)_: Editar colaboradores e custos de mão de obra.
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
