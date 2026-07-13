# Inventário técnico atual — CRM Comercial vs Pedidos de Venda

**Projeto:** IndusCost / My Industry  
**Escopo:** somente inventário (sem correção de regra neste documento)  
**Data:** 2026-07-13  
**Rota UI CRM:** `/crm-commercial`  
**Script auxiliar (read-only):** `tmp-audits/inspect-crm-commercial-current-inventory.ts`

---

## 1. Resumo executivo

O **CRM Comercial** é orquestrado por um único shell (`CrmModule`) com **3 abas** (`Gestão Geral`, `Gestão por Vendedor`, `Carteira de Clientes`). Não há React Query: o frontend chama APIs via `fetchJsonOk`.

Há **dois conceitos de “vendedor”** no código, e o inventário confirma que ainda coexistem:

| Conceito | Fonte oficial | Uso esperado |
|----------|---------------|--------------|
| **Responsável Comercial do Cliente** | `CrmCustomerCommercialOwner` (manual) + inferência Nomus pontual | Carteira, relacionamento, follow-up, eixo CRM |
| **Vendedor do Pedido (comissionável)** | `SalesOrder.externalSellerId` + `SalesOrder.nomusSellerName` (sync Nomus) | Pedidos de Venda, comissões |

**Propostas não são fonte** dos KPIs principais das 3 abas. Ainda há resíduos (`proposalId`, bloco deprecated em inteligência, labels legados).

**Paridade com Pedidos de Venda (indicadores de pedido):**

- **Parcialmente alinhada** na aba **Gestão por Vendedor**: KPIs principais já passam por `resolveOfficialScopedOrderMetrics` (motor oficial).
- **Não alinhada** na **Gestão Geral** (SQL próprio / status de compra mais estreito).
- **Carteira** lista clientes e enriquece com pedidos; não é o mesmo agregador da Gestão de Pedidos.
- Em vários pontos o campo legado `SalesOrder.responsible` ainda aparece no enrich/display, enquanto o sync Nomus preenche `nomusSellerName` e zera `responsible`.

---

## 2. Mapa da tela CRM Comercial

### 2.1 Shell

| Item | Valor |
|------|--------|
| Rota | `/crm-commercial` (`src/App.tsx`) |
| Componente principal | `src/components/CrmModule.tsx` |
| Tabs UI | `src/components/CrmCommercialManagementTabs.tsx` |
| Tab IDs | `general` \| `seller` \| `portfolio` (`src/lib/moduleTabResources.ts` → `CRM_UI_TABS`) |
| Resource keys | `comercial.crm.tab.gestao_geral`, `...gestao_vendedor`, `...carteira_clientes` |
| Guard UI | `ProtectedTab` + `modulePermissions.ts` (`canAccessCrmGeneral` / `Seller` / `Portfolio`, `canFilterAllCrmSellers`, `isCrmOwnSellerOnly`) |
| Hooks | **Nenhum** hook de data-fetch dedicado; `useState` / `useCallback` / `useEffect` + `fetchJsonOk` (`src/lib/http.ts`) |
| Client HTTP dedicado | **Não** (chamadas inline no `CrmModule`) |

### 2.2 Endpoints consumidos pelo shell

| Finalidade | Método | Endpoint |
|------------|--------|----------|
| Gestão Geral | GET | `/api/crm/management-dashboard` |
| Gestão por Vendedor | GET | `/api/crm/seller-dashboard` |
| Carteira (lista) | GET | `/api/crm/customers` |
| Perfil CRM | GET/PUT | `/api/crm/customers/:id/profile` |
| Inteligência comercial | GET | `/api/crm/customers/:id/commercial-intelligence` |
| Atividades / follow-up | GET/POST | `/api/customers/:id/commercial-activities` |

**Existente no server, não usado pelo `CrmModule` atual:** `GET /api/crm/dashboard/basic`.

### 2.3 Responsável comercial (fora do shell CRM, mas fonte da carteira)

| Item | Valor |
|------|--------|
| Modelo | `CrmCustomerCommercialOwner` (`prisma/schema.prisma`) |
| Service | `src/lib/crmCustomerCommercialOwner.ts` |
| Routes | `src/lib/crmCustomerCommercialOwnerRoutes.ts` |
| APIs | `GET/PATCH /api/crm/customers/:id/commercial-owner`, `GET /api/crm/commercial-sellers/active` |
| UI de edição | `src/components/customers/CustomerCommercialOwnerTab.tsx` (Cadastro de Clientes, **não** aba do CRM) |
| Campos | `customerId`, `sellerExternalId`, `sellerResponsibleName`, `sellerCanonicalName`, `sellerIdentityKey`, `sellerAliasExternalIds`, `assignmentSource`, `isActive`, audit `createdBy*` / `updatedBy*` |

Resolução efetiva: **manual ativo** > **inferido Nomus** (`COALESCE(nomusSellerName, responsible)` + `externalSellerId`) > `NONE`.

---

## 3. Mapa das 3 abas

### 3.1 Tabela-síntese por aba

| Aba | Arquivo frontend | Hook/client | Endpoint | Service backend | Tabelas consultadas | Fonte de pedidos | Fonte de clientes | Fonte de responsável comercial | Fonte de vendedor do pedido | Campo de data | Campo de status | Possíveis inconsistências |
|-----|------------------|---------------|----------|-----------------|---------------------|------------------|-------------------|--------------------------------|-----------------------------|---------------|-----------------|---------------------------|
| **Gestão Geral** | `CrmManagementDashboardSection.tsx`, `CrmManagementLists.tsx`, `crmManagementUi.ts` | `fetchJsonOk` no `CrmModule` | `GET /api/crm/management-dashboard` | `crmManagementDashboardService.ts` (+ `crmManagementDashboard.ts`, `crmOrderPortfolioSql.ts`) | `Customer`, `CommercialActivity`, `SalesOrder`, `CrmCustomerProfile` | `SalesOrder` (SQL próprio) | Todos os `Customer` (global) | **Não filtra** por responsável comercial | Display em listas: `so.responsible` (legado) | Contato: `CommercialActivity.contactDate`/`createdAt`; compra: `SalesOrder.issueDate` | Compra “válida”: só `READY_TO_SEND`/`SENT_TO_NOMUS`; carteira: válido sem NF `dataProcessamento` em `nomusRawResponse.nfes` | Sem filtro de carteira/responsável; status de compra **mais estreito** que motor oficial; “byResponsible” de atividades = `assignedTo`/`createdByName` ≠ responsável comercial; labels `PROPOSAL_*` legados na UI |
| **Gestão por Vendedor** | `CrmSellerDashboardSection.tsx`, `CrmSellerDashboardLists.tsx`, `crmSellerDashboardUi.ts` | `fetchJsonOk` + período local (`resolveSellerPeriodRange`) | `GET /api/crm/seller-dashboard` | `crmSellerDashboardService.ts` (+ `crmSellerMatchSql.ts`, `crmSellerIdentityConsolidation.ts`, `crmCommercialAccessScope.ts`) | `SalesOrder`, `SalesOrderItem`, `Customer`, `CrmCustomerCommercialOwner` (+ NFe via motor/`nomusRawResponse`) | `SalesOrder` + KPIs via `resolveOfficialScopedOrderMetrics` | Clientes do escopo (owner manual ∪ match vendedor pedido) | `CrmCustomerCommercialOwner` (manual) no `OR` do escopo | Match: `COALESCE(nomusSellerName, responsible)` + `externalSellerId` | Pedidos/valor/produto: `issueDate`; faturado no período: `nfe.dataProcessamento` | Válidos: `status NOT IN (CANCELLED, ERROR)`; cancelados: `CANCELLED` | Escopo CRM mistura owner + vendedor do pedido; lists/`bySeller`/top product ainda SQL raw (podem divergir do motor); sync zera `responsible` — opções/display dependem de `nomusSellerName` |
| **Carteira de Clientes** | `crm/CrmCustomerPortfolioSection.tsx`, `crm/CrmCustomerAccountCockpit.tsx`, `crmCustomerPortfolioUi.ts` | `fetchJsonOk` no `CrmModule` | `GET /api/crm/customers` (+ profile / commercial-intelligence / activities) | `crmCustomersList.ts`, `crmCommercialIntelligence.ts`, activities em rotas de customer | `Customer`, `SalesOrder`, `CommercialActivity`, `CrmCustomerCommercialOwner`, `CrmCustomerProfile`, (intel: `Proposal` auxiliar) | Enrich / intel: `SalesOrder` | Escopo union: pedidos do vendedor + owner manual | Owner manual priorizado em `primarySeller*`; inferido só na API commercial-owner | Enrich SQL lista ainda lê `so.responsible` (não `nomusSellerName`) | Filtros de contato/FU: atividades; compra: existência de pedido | Pedidos válidos no enrich; open portfolio = sem NF processada | Enrich de “vendedor primário” legado; intel own-scope sem passar `nomusSellerName` em `salesOrderMatchesCrmSellerScope`; Proposal residual em intel |

### 3.2 Campos por domínio (checklist pedido)

| # | Domínio | Onde aparece no CRM | Campos / regras atuais |
|---|---------|---------------------|------------------------|
| 9 | Cliente | Lista carteira, joins | `Customer.id`, `companyName`, `tradeName`, `taxId`, `email`, `phone`, `city`, `state`, `address` (+ busca `stateTaxId`) |
| 10 | Responsável comercial | Owner + escopo carteira/seller | `CrmCustomerCommercialOwner.sellerIdentityKey`, `sellerExternalId`, `sellerCanonicalName`, `sellerResponsibleName`, `sellerAliasExternalIds`, `isActive` |
| 11 | Vendedor do pedido | Match SQL / options / sync | `SalesOrder.externalSellerId`, `nomusSellerName`, legado `responsible` |
| 12 | Período | Seller dashboard UI + API | Query `dateFrom`/`dateTo` (YYYY-MM-DD); filtro em `SalesOrder.issueDate` (e NF `dataProcessamento` para faturado no período) |
| 13 | Status do pedido | Dashboards / enrich | Enum `SalesOrderStatus`; CRM seller exclui `CANCELLED`/`ERROR` dos válidos; Gestão Geral “compra válida” só `READY_TO_SEND`/`SENT_TO_NOMUS` |
| 14 | Valor do pedido | KPIs / lists | `SalesOrder.totalNetValue` (header) |
| 15 | Faturamento | Seller + gestão geral carteira | Preferencial: motor/`SalesOrderNfeLink`; CRM SQL lists ainda usam `nomusRawResponse.nfes[].dataProcessamento` |
| 16 | Produto líder | Seller dashboard | `SalesOrderItem` `GROUP BY productId` `ORDER BY SUM(totalNetValue) DESC LIMIT 1` |
| 17 | Carteira aberta | Gestão Geral + Seller + enrich | Pedido válido **sem** NF processada (`crmOrderPortfolioSql` / predicados CRM / motor `!hasInvoice`) |
| 18 | Follow-up | Gestão Geral + Carteira/cockpit | `CommercialActivity.nextActionAt`, `contactDate`, `status`, `assignedTo`, `createdByName` |
| 19 | Propostas indevidas? | KPIs principais | **Não** como fonte de pedido/carteira/valor. Resíduos: intel `_deprecated`, `proposalId` em atividade, KPI “sem proposta vinculada”, labels UI legados |
| 20 | Uso indevido de responsável/proposta/criador? | Vários | `CommercialActivity.assignedTo`/`createdByName` tratados como “responsável” em breakdowns; `SalesOrder.responsible` legado em enrich; **não** há uso de “usuário que criou pedido” como eixo de carteira |

### 3.3 Detalhe — Gestão Geral

- **KPIs:** risco (alto), carteira aberta (qtd/valor), pedidos sem follow-up, sem contato 30d, sem compra válida, FU atrasados / próximos 7d.
- **Escopo:** global (sem filtro de vendedor/responsável comercial).
- **Permissão:** resource tab gestão geral / `crm.general.view`.

### 3.4 Detalhe — Gestão por Vendedor

- **KPIs UI:** pedidos emitidos, valor, carteira aberta/valor, faturados/valor, cancelados, ticket médio, clientes com pedido, produto líder (+ “sem proposta vinculada” como qualidade).
- **Escopo atual (`buildCrmSellerPortfolioOrderScopeSql`):**  
  `(customerId IN owners manuais do vendedor) OR (match vendedor do pedido Nomus)`.
- **KPIs oficiais:** `resolveOfficialScopedOrderMetrics` **sem** refiltro `responsible` em `managementFilters`.
- **Permissão:** `crm.seller.all` (filtra qualquer) ou `crm.seller.own` (força vínculo do `AppUser`).

### 3.5 Detalhe — Carteira de Clientes

- **Lista:** `fetchCrmCustomersList` + `resolveCrmCustomerListScopeWhere` (union IDs).
- **Cockpit:** perfil, timeline de atividades, inteligência comercial.
- **Edição de responsável comercial:** Cadastro de Clientes (`CustomerCommercialOwnerTab`), não nesta aba.

---

## 4. Mapa da tela Pedidos de Venda

### 4.1 Superfície UI relevante

| Rota | Componente | Papel |
|------|------------|--------|
| `/sales-orders` | `SalesOrdersModule.tsx` | Lista clássica |
| `/sales-orders/management` | `SalesOrderManagementPage.tsx` | **Referência oficial de KPIs** (carteira / faturado / vendido) |
| `/sales-orders/indicators` | `SalesOrdersIndicatorsDashboard.tsx` | Margem / indicadores (API própria) |

### 4.2 Endpoints / services

| Item | Valor |
|------|--------|
| Lista | `GET /api/sales-orders` (`server.ts`) |
| Gestão | `GET /api/sales-orders/management` (`salesOrderIntelligenceRoutes.ts` → `loadSalesOrderManagementPage`) |
| Motor | `salesOrderRulesEngine.ts` + `salesOrderRulesAdapter.ts` |
| Métricas gestão | `salesOrderManagementMetrics.ts` / `.server.ts` |
| Vendedor oficial | `salesOrderListQuery.server.ts` + `salesOrderNomusSellerDisplay.ts` (`sellerKey` → `externalSellerId` / identidade Nomus) |
| NFe | `SalesOrderNfeLink` + `salesOrderLinkedNfe.ts` |

### 4.3 Tabelas

`SalesOrder`, `SalesOrderItem`, `SalesOrderNfeLink` (+ `Customer` em joins).

### 4.4 Regras oficiais (resumo)

| Regra | Definição |
|-------|-----------|
| **Data (vendido)** | `SalesOrder.issueDate` |
| **Valor vendido** | `SalesOrder.totalNetValue` (header) |
| **Vendedor** | `externalSellerId` + `nomusSellerName` (filtro `sellerKey`); **não** `responsible` legado como critério oficial |
| **Status** | Enum `SalesOrderStatus`; cancelado = `CANCELLED` |
| **Carteira aberta** | Pedido no universo management com `hasInvoice === false` (NF vinculada/processada) |
| **Faturado** | `hasInvoice === true`; valor fiscal via contexto NFe; amount comercial de pedidos faturados = Σ `totalNetValue` |
| **Sem faixa min/max de valor** | Na lista/gestão padrão (existe em outros funis) |

`metricsSource` / engine: `OFFICIAL_SO_RULES_SOURCE` / `SALES_ORDER_RULES_ENGINE_VERSION`.

---

## 5. Comparativo inicial CRM vs Pedidos de Venda

| Tema | Pedidos de Venda (oficial) | CRM Comercial | Mesma origem? |
|------|----------------------------|---------------|---------------|
| Entidade de pedido | `SalesOrder` | `SalesOrder` | **Sim** (entidade) |
| Agregador de KPIs | `resolveOfficialScopedOrderMetrics` / management bundle | Seller: **sim** (parcial); Gestão Geral: **SQL próprio** | **Parcial** |
| Eixo “vendedor” | Vendedor Nomus do pedido | Carteira = responsável comercial ∪ vendedor pedido | **Diferente por desenho** (ok se explícito) |
| Campo nome vendedor pedido | `nomusSellerName` | Match seller: COALESCE; enrich carteira: ainda `responsible` | **Inconsistente em pontos** |
| Data vendido | `issueDate` | `issueDate` (seller) | **Sim** |
| Valor | `totalNetValue` | `totalNetValue` | **Sim** |
| Status válido | Motor / filtros management | Seller: exclui CANCELLED/ERROR; Geral: só READY/SENT | **Divergente (Geral)** |
| Carteira aberta | `!hasInvoice` (NFe link / motor) | SQL `nomusRawResponse.nfes` **e** motor no seller summary | **Risco de divergência NFe JSON vs link** |
| Proposta | Não é fonte | Não é fonte de KPI; resíduos | **OK / residual** |
| Comissão | Vendedor pedido | Não deve usar responsável comercial | Seller CRM não grava comissão; risco é só confusão de eixo |

**Conclusão da comparação:** o CRM **já usa a mesma entidade** `SalesOrder` e, na Gestão por Vendedor, **já reutiliza o motor oficial** para KPIs principais. Ainda **não há paridade total** com a tela Pedidos (Gestão Geral SQL própria; lists SQL; enrich legado; status de compra diferente; NFe dual-path).

---

## 6. Gaps encontrados

1. **Gestão Geral** não usa `resolveOfficialScopedOrderMetrics` / management bundle.
2. **Status de “compra válida”** na Gestão Geral (`READY_TO_SEND`/`SENT_TO_NOMUS`) ≠ universo típico do motor (exclui só cancelados/erro, etc.).
3. **Detecção de NF** no CRM SQL lists ainda via `nomusRawResponse`; Pedidos Gestão preferem `SalesOrderNfeLink` / `hasInvoice`.
4. **Enrich da carteira** (`primarySellerResponsible` via pedido) lê só `so.responsible`, não `nomusSellerName`.
5. **commercial-intelligence** em escopo `own` chama `salesOrderMatchesCrmSellerScope` sem `nomusSellerName`.
6. **Gestão Geral** sem eixo de responsável comercial (visão 100% global).
7. **UI de assign** do responsável comercial fora do CRM (só Cadastro de Clientes).
8. **KPI “pedidos sem proposta”** e labels `PROPOSAL_*` geram ruído semântico (não são fonte, mas confundem).
9. **Breakdown “por responsável”** em atividades ≠ Responsável Comercial do Cliente.
10. **Seller dashboard** ainda calcula lists/top product/`bySeller` em SQL paralelo ao motor oficial.

---

## 7. Riscos de mistura de conceitos

| Conceito | Onde aparece | Risco |
|----------|--------------|-------|
| **Responsável Comercial do Cliente** | `CrmCustomerCommercialOwner`, escopo carteira/seller (`OR` manual) | Correto para CRM; não deve alimentar comissão |
| **Vendedor do Pedido** | `externalSellerId` / `nomusSellerName`; match SQL; Pedidos/Comissões | Correto para comissão; no CRM entra no `OR` do escopo — precisa linguagem clara na UI |
| **`SalesOrder.responsible` (legado)** | Enrich carteira, algumas lists, sync seta `null` | Display/match zerado ou divergente pós-sync |
| **Responsável CRM / atividade** | `CommercialActivity.assignedTo`, `createdByName` | Confundido com dono da carteira na Gestão Geral |
| **Usuário que criou pedido** | Não é eixo de carteira | Baixo; não inventariado como filtro CRM |
| **Propostas** | Intel deprecated, `proposalId`, labels | Baixo em KPI; médio em UX/comunicação |

---

## 8. Arquivos para analisar/corrigir nos próximos prompts

### Frontend CRM
- `src/components/CrmModule.tsx`
- `src/components/CrmCommercialManagementTabs.tsx`
- `src/components/CrmManagementDashboardSection.tsx`
- `src/components/CrmManagementLists.tsx`
- `src/components/crmManagementUi.ts`
- `src/components/CrmSellerDashboardSection.tsx`
- `src/components/CrmSellerDashboardLists.tsx`
- `src/components/crmSellerDashboardUi.ts`
- `src/components/crmSellerDashboardTypes.ts`
- `src/components/crm/CrmCustomerPortfolioSection.tsx`
- `src/components/crm/CrmCustomerAccountCockpit.tsx`
- `src/components/customers/CustomerCommercialOwnerTab.tsx`

### Backend CRM / escopo
- `src/lib/crmManagementDashboardService.ts`
- `src/lib/crmManagementDashboard.ts`
- `src/lib/crmOrderPortfolioSql.ts`
- `src/lib/crmSellerDashboardService.ts`
- `src/lib/crmSellerMatchSql.ts`
- `src/lib/crmSellerIdentityConsolidation.ts`
- `src/lib/crmCustomersList.ts`
- `src/lib/crmCustomerSellerScope.ts`
- `src/lib/crmCommercialAccessScope.ts`
- `src/lib/crmCommercialIntelligence.ts`
- `src/lib/crmCustomerCommercialOwner.ts`
- `src/lib/crmCustomerCommercialOwnerRoutes.ts`
- `src/lib/crmCommercialOrderRules.ts`
- `src/lib/modulePermissions.ts`
- `src/lib/moduleTabResources.ts`
- `server.ts` (bloco `/api/crm/*`)

### Pedidos (referência / reuso — **não alterar comissões/financeiro**)
- `src/lib/salesOrderRulesAdapter.ts` (`resolveOfficialScopedOrderMetrics`)
- `src/lib/salesOrderRulesEngine.ts`
- `src/lib/salesOrderManagementMetrics.ts` / `.server.ts`
- `src/lib/salesOrderListQuery.server.ts`
- `src/lib/salesOrderNomusSellerDisplay.ts`
- `src/lib/salesOrderLinkedNfe.ts`
- `src/components/sales/SalesOrderManagementPage.tsx`

### Testes já existentes úteis
- `src/lib/crmSellerMatchSql.test.ts`
- `src/lib/crmSellerDashboard.test.ts`
- `src/lib/crmCustomersList.test.ts`
- `src/lib/crmCustomerCommercialOwner.test.ts`
- `src/lib/crmManagementDashboard.test.ts`
- `src/lib/crmCommercialAccessScope.test.ts`

### Docs relacionados
- `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`
- Este arquivo: `docs/commercial/crm-commercial-current-inventory.md`

---

## 9. Notas de inventário (limites)

- Inventário baseado em leitura estática do código (e script read-only de existência de símbolos).
- Não executa consultas ao banco de produção.
- Reflete o estado **após** o ajuste recente de escopo do seller-dashboard (`buildCrmSellerPortfolioOrderScopeSql` + `nomusSellerName`); gaps acima ainda válidos para próximos prompts.
