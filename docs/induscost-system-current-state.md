# IndusCost — Estado atual do sistema

> **Atualizado:** 2026-06-17  
> **Branch:** `main`  
> **Commit HEAD:** `26c54ef662c7c7606c2fd4ee29bc44bf711b6de7` (`feat(finance): padronizar UX visual e operacional das abas do modulo Financeiro.`)  
> **Commit anterior documentado:** `7c57130` (auditoria INDUSCOST-SYSTEM-AUDIT-AND-ACTION-PLAN-A)

Fotografia do repositório **sem alteração funcional**. Cada afirmação abaixo deriva de inspeção do código em `26c54ef`.

Legenda de status: **Pronto** · **Parcial** · **Pendente** · **Quebrado** (nenhuma aba financeira marcada como quebrada neste commit).

---

## 1. Visão geral

O **IndusCost / My Industry** é aplicação web fullstack para cadastros, custos, formação de preço, propostas, pedidos, CRM, **módulo Financeiro BI**, **Projetos**, **Frota** e integração de engenharia com o ERP **Nomus**.

Linha de produto: fabricação de componentes plásticos (BOM, roteiro, máquina, cavidade, opcionais Nomus). Em produção no servidor `/opt/induscost`, PostgreSQL `teste_bi`.

Desde `7c57130`, os maiores incrementos foram:

| Área | Evolução |
|------|----------|
| Financeiro | 6 abas BI com AR/AP/NF-e/Fluxo/Pedidos/Relatório Presidencial |
| CRM Comercial | Escopo por vendedor, carteira dedicada, inteligência do cliente |
| Pedidos de Venda | Gestão operacional + Status Logístico BI (Power BI) |
| Projetos | Ficha rápida, BOM isolada, snapshots de produto |
| Nomus Engenharia | Fila “Prontos para aplicar”, auto-apply pós-sync, fingerprint de governança |
| Frota | Módulo completo com reservas públicas e checklist |
| Dados financeiros Nomus | `NomusAccountsReceivable`, `NomusAccountsPayable`, `NomusNfe` |

---

## 2. Stack confirmada

| Camada | Tecnologia | Evidência atual |
|--------|------------|-----------------|
| Frontend | React 19 + Vite 6 + TypeScript 5.8 | `package.json` |
| Backend | Node + Express 4.21 | `server.ts` (~12 359 linhas) |
| ORM | Prisma 5.22 | `prisma/schema.prisma` — **95 models + 55 enums** |
| Banco | PostgreSQL (`Decimal(20,6)`) | `schema.prisma` |
| Auth | Sessões opacas + RBAC granular | `src/lib/appAuth*.ts`, `permissionCatalog.ts` |
| Build | `tsc --noEmit` + `vite build` | `npm run lint`, `npm run build` ✅ |
| Testes | `tsx --test` | **~289** arquivos `*.test.ts` em `src/lib/` |
| Scripts CLI | `tsx scripts/*.ts` | **64** scripts |
| Endpoints HTTP | Express monolítico | **~197** rotas `app.(get\|post\|…)` em `server.ts` + registradores em `src/lib/*Routes.ts` |

---

## 3. Estrutura do repositório (atualizada)

```
IndusCost/
├── prisma/schema.prisma       # 95 models + 55 enums
├── server.ts                 # monolito ~12.4k linhas; registra rotas modulares
├── src/
│   ├── App.tsx               # roteamento (finance, crm, projects, fleet, …)
│   ├── components/           # ~371 arquivos (finance/, crm/, projects/, fleet/, product/, …)
│   ├── lib/                  # ~300+ módulos puros + server-side + *Routes.ts
│   ├── contexts/             # AuthContext
│   └── tours/
├── scripts/                  # 64 scripts (Nomus sync, smokes, debug, fleet, …)
└── docs/                     # esta documentação + guias operacionais
```

Padrão arquitetural recente: rotas HTTP extraídas para `register*Routes()` em `src/lib/`, mas **`server.ts` permanece monolítico** para cadastros, pricing, Nomus legado e CRM inline.

---

## 4. Módulo Financeiro

### 4.1 Abas e rotas frontend

Registradas em `src/lib/financeNavigation.ts`, renderizadas por `src/components/FinanceModule.tsx`:

| Aba | Rota | Página | Status |
|-----|------|--------|--------|
| Fluxo de Caixa | `/finance/cash-flow` | `FinanceCashFlowPage` | **Pronto** |
| Contas a Receber | `/finance/accounts-receivable` | `FinanceAccountsReceivablePage` (+ sub-aba Atrasados) | **Pronto** |
| Contas a Pagar | `/finance/accounts-payable` | `FinanceAccountsPayablePage` | **Pronto** |
| Faturamento | `/finance/billing` | `FinanceBillingPage` | **Pronto** |
| Pedidos de Venda | `/finance/sales-orders` | `FinanceSalesOrdersPage` | **Pronto** |
| Relatório Presidencial | `/finance/executive-report` | `FinanceExecutiveReportPage` | **Pronto** |

UX padronizada (`financeModuleUiStandards.ts`, `FinanceModuleStates.tsx`): breadcrumb `FINANCEIRO · ABA`, painel **Filtros**, botões **Atualizar** / **Exportar CSV** / **Exportar PDF**, drawer **Dados e auditoria**.

### 4.2 Endpoints `/api/finance/*`

| Endpoint | Lib principal | Fonte Prisma |
|----------|---------------|--------------|
| `GET /api/finance/cash-flow/dashboard` | `financeCashFlowDashboard.ts` | `NomusAccountsReceivable` + `NomusAccountsPayable` |
| `GET /api/finance/cash-flow/audit` | `financeCashFlowDataset.ts` | idem |
| `GET /api/finance/cash-flow/export` | `financeCashFlowExport.ts` | idem |
| `GET /api/finance/accounts-receivable/dashboard` | `financeAccountsReceivableDashboard.ts` | `NomusAccountsReceivable` via `loadFinanceArManagementRowsFromPrisma` |
| `GET /api/finance/accounts-receivable/titles` | `financeAccountsReceivableTitles.ts` | idem |
| `GET /api/finance/accounts-receivable/export` | `financeAccountsReceivableExport.ts` | idem |
| `GET /api/finance/accounts-receivable/overdue` | `financeAccountsReceivableOverdue.ts` | idem |
| `GET /api/finance/accounts-receivable/overdue/export.xlsx` | `financeAccountsReceivableOverdueExport.ts` | idem |
| `GET /api/finance/accounts-payable/dashboard` | `financeAccountsPayableDashboard.ts` | `NomusAccountsPayable` |
| `GET /api/finance/accounts-payable/titles` | `financeAccountsPayableTitles.ts` | idem |
| `GET /api/finance/accounts-payable/export` | `financeAccountsPayableExport.ts` | idem |
| `GET /api/finance/billing/dashboard` | `financeBillingDashboard.ts` | `NomusNfe` (padrão) ou `SalesOrder` (`billingSource=sales_order`) |
| `GET /api/finance/billing/nfes` | `financeBillingNfeList.ts` | `NomusNfe` |
| `GET /api/finance/billing/comparison` | `financeBillingNfeComparison.ts` | NF-e vs pedidos |
| `GET /api/finance/billing/export` | `financeBillingNfeExport.ts` | NF-e |
| `GET /api/finance/billing/audit` (+ export) | `financeBillingAudit*.ts` | dataset de conferência |
| `GET/POST /api/finance/billing/sync-status` / `sync` | `nomusNfesSyncRunner.ts` | sync Nomus NF-e |
| `GET /api/finance/sales-orders/dashboard` | `financeSalesOrdersDashboard.ts` | **`SalesOrder` + `SalesOrderItem`** (não Proposal) |
| `GET /api/finance/sales-orders/export` | `financeSalesOrdersExport.ts` | idem |
| `GET /api/finance/executive-report` | `financeExecutiveReport.ts` | consolida AR, AP, Fluxo, Pedidos, Faturamento |

Registro: `server.ts` chama `registerFinance*Routes()` (linhas ~13194–13223).

### 4.3 Fontes oficiais e regras de negócio

| Domínio | Fonte oficial | Regras notáveis |
|---------|---------------|-----------------|
| AR | `NomusAccountsReceivable` | Freshness (`syncedAt` − 1h); dedup Com NF; **vencidos sem NF excluídos** da visão gerencial; horizonte de carteira aberta **ignora filtro de período** |
| AP | `NomusAccountsPayable` | Exclui intercompany e pedido de compra (`type=2`); data operacional quando `scheduleDate > dueDate` |
| Fluxo de Caixa | AR + AP saneados | Modos previsto/realizado/combinado; YTD ignora filtro mensal; gráfico anual sempre Jan–Dez no Relatório Presidencial |
| Faturamento | **`NomusNfe`** (padrão `billingSource=nfe`) | Comparativo anual; sync dedicado `sync:nomus:nfes:*` |
| Pedidos (financeiro) | **`SalesOrder` / `SalesOrderItem`** | Status logístico BI; manufacturing Nomus 1–6; **meta comercial não configurada** (`monthTargetConfigured: false`) |

### 4.4 Testes Financeiro

**~103** arquivos `finance*.test.ts` em `src/lib/`. Suites estruturais:

- `financeModuleTabsValidation.test.ts` (27) — endpoints, rotas, payload vazio
- `financeModuleUiStandards.test.ts` (28) — UX padronizada
- `financeCashFlowDashboard.test.ts`, `financeCashFlowExecutiveYtd.test.ts`
- `financeAccountsReceivableDashboard.test.ts`, `financeAccountsReceivableOverdue.test.ts`, `financeAccountsReceivableFiscalBacking.test.ts`
- `financeAccountsPayableDashboard.test.ts`
- `financeBillingDashboard.test.ts`, `financeBillingNfeDashboard.test.ts`
- `financeSalesOrdersDashboard.test.ts`, `financeSalesOrdersExtendedMetrics.test.ts`, `financeSalesOrdersPage.test.ts`
- `financeExecutiveReport.test.ts`, `financeExecutiveReportPrint.test.ts`, `financeExecutiveReportConsistency.test.ts`

**Lint e build passam** no commit base.

### 4.5 Problemas conhecidos / pendências Financeiro

| Item | Severidade | Status |
|------|------------|--------|
| Aba Pedidos de Venda quebrada | — | **Não confirmado** — testes e build OK |
| Meta comercial Pedidos de Venda | P2 | **Pendente** — sem fonte oficial de metas; UI mostra “não configurada” |
| Classes CSS de filtros heterogêneas em AR/AP/Billing | P2 | Cosmético |
| Bundle JS > 500 kB | P2 | Pré-existente |
| `server.ts` monolítico | P1 | Refactor futuro |

---

## 5. CRM Comercial

### 5.1 Abas (`CrmCommercialManagementTabs.tsx`)

| Aba UI | ID | Endpoint principal | Permissão |
|--------|-----|-------------------|-----------|
| Gestão Geral | `general` | `GET /api/crm/management-dashboard` | `crm.general.view` |
| Gestão por Vendedor / Meu Dashboard | `seller` | `GET /api/crm/seller-dashboard` | `crm.seller.all` ou `crm.seller.own` |
| Carteira de Clientes | `portfolio` | `GET /api/crm/customers` | `crm.view` + escopo |

**Inteligência do Cliente:** rota dedicada + `GET /api/crm/customers/:id/commercial-intelligence` (componentes em `src/components/crm/customer-intelligence/`). Integrada ao `CrmModule.tsx`.

### 5.2 Escopo por vendedor (backend)

Fonte única: `src/lib/crmCommercialAccessScope.ts`.

- Base comercial: **`SalesOrder`** (não Proposal) — documentado no próprio arquivo.
- `crm.seller.own`: escopo `own`, `sellerLocked: true`; filtro SQL via `crmSellerMatchSql.ts` + consolidação `crmSellerIdentityConsolidation.ts`.
- Teste `crmCommercialAccessScope.test.ts`: **“vendedor com crm.seller.own ignora query de outro vendedor”** — confirma bloqueio no backend.
- Risco residual: duplicidade de nomes de vendedores no Nomus — mitigado por `sellerIdentityKey` normalizado; dropdown consolidado (`43493f7`).

### 5.3 Endpoints CRM relacionados

```
GET  /api/crm/dashboard/basic
GET  /api/crm/management-dashboard
GET  /api/crm/seller-dashboard
GET  /api/crm/customers
GET  /api/crm/customers/:id/profile
PUT  /api/crm/customers/:id/profile
GET  /api/crm/customers/:id/commercial-intelligence
GET  /api/admin/seller-options
```

Comercial auxiliar: `GET /api/customers/:id/commercial-360`, atividades comerciais, ranking de produtos (`salesProductRankingRoutes.ts`).

### 5.4 Status CRM

| Bloco | Status |
|-------|--------|
| Gestão Geral | **Pronto** |
| Gestão por Vendedor / Meu Dashboard | **Pronto** (escopo backend validado por testes) |
| Carteira de Clientes | **Pronto** |
| Inteligência do Cliente | **Pronto** (Fase 1H-B) |
| Smoke E2E CRM | **Pendente** |

---

## 6. Pedidos de Venda (operacional + financeiro)

Dois contextos distintos no código:

### 6.1 Gestão de Pedidos (`/sales-orders` módulo operacional)

| Item | Detalhe |
|------|---------|
| Endpoint | `GET /api/sales-orders/management` (`salesOrderIntelligenceRoutes.ts`) |
| UI | `SalesOrdersModule` / gestão com cards Status Logístico BI |
| Fonte | `SalesOrder` + `SalesOrderItem` + `nomusRawResponse` |
| Drawer | `GET /api/sales-orders/:id/intelligence` |
| NF processada | Extraída de `nomusRawResponse` → `nfes.dataProcessamento` (`salesOrderNomusRaw.ts`) |
| Testes | `salesOrderManagementDashboard.test.ts`, `salesOrderManagementPage.test.ts`, `salesOrderLogisticStatus.test.ts` (12 casos BI) |

### 6.2 Status Logístico BI vs status gerencial

| | Status Logístico BI | Status gerencial (Nomus item) |
|--|---------------------|-------------------------------|
| Lib | `salesOrderLogisticStatus.ts` | Códigos manufacturing 1–6 em `salesOrderNomusRaw.ts` |
| Fórmula | Réplica DAX Power BI (NF × prazo × status 1/2/3) | Pendências de fabricação por item |
| Uso | Cards clicáveis na Gestão; filtro `logisticStatus` no dashboard financeiro | Gráfico “status fabricação” no financeiro |
| Labels | Entregue no Prazo, Entregue com Atraso, Atrasado (Pendente), No Prazo (Pendente), Finalizado/Cancelado, Revisar dados | Códigos Nomus 1–6 mapeados |

### 6.3 Dashboard financeiro Pedidos de Venda

**Pronto** — KPIs, gráficos (carteira, comparativo anual, top vendedores, críticos), export CSV, auditoria. Não usa Proposal.

---

## 7. Módulo Projetos

### 7.1 Models Prisma

- `Project`, `ProjectVersion`, `ProjectPricingConfig`, `ProjectPricingItem`
- `ProjectSimulatedProduct`, `ProjectSimulatedItem`
- `ProjectStructureLine` (BOM hierárquica isolada — **não existe `ProjectLaborLine`**; mão de obra entra via `lineType` / itens simulados)
- `ProjectMold`, `ProjectCostAmortization`, `ProjectCostAmortizationAllocation`

### 7.2 Fluxos principais

| Fluxo | Endpoint / lib | Regra |
|-------|----------------|-------|
| CRUD projeto | `projectsRoutes.ts` (~30 rotas `/api/projects/*`) | Permissões `projects.view` / `projects.manage` |
| Import snapshot produto oficial | `POST …/import-product-snapshot` | `projectsProductSnapshot.ts` — **não grava no cadastro oficial** |
| Import engineering snapshot | `GET …/engineering-snapshot` | `projectsProductEngineeringSnapshot.ts` |
| Ficha rápida / intake | `ProjectIntakeActions.tsx`, `projectsGuidedFlow` | Impressão A4; planilha modelo |
| BOM do projeto | `ProjectStructureLine` hierárquica | Isolada do `ProductBOM` oficial |
| Bloqueio criação in-project | `PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION = true` | Produto novo só via Simulação → referência ao projeto |

### 7.3 Status

**Pronto** para fluxo principal; testes em `projectsService.test.ts`, `projectsGuidedFlow.test.ts`, `projectsProductEngineeringSnapshot.test.ts`, entre outros.

---

## 8. Nomus / BOM / Engenharia (atualizado)

### 8.1 Governança e fingerprint

- `NomusOptionalPricingGroup` / `NomusOptionalPricingChoice` — seleção de opcionais
- `NomusBomReviewDecision` + `nomusStructureFingerprint` nos models de grupo/decisão
- `nomusBomStructureFingerprint.ts` — fingerprint de linhas Nomus
- `nomusBomReviewDecision.ts` — decisão invalidada se fingerprint mudar **e** linha local divergir

### 8.2 Apply BOM

| Canal | Endpoint / script | Confirmação |
|-------|-------------------|-------------|
| Apply controlado (produto) | `POST /api/nomus/effective-pricing-bom/apply` | `APLICAR BOM NOMUS <CÓDIGO>` |
| Fila Prontos para aplicar (UI) | `GET /api/nomus/auto-apply-bom-dashboard` | — |
| Apply individual | `POST /api/nomus/bom-auto-apply/products/:parentCode/apply` | `products.edit` |
| Apply lote | `POST /api/nomus/bom-auto-apply/products/apply-batch` | idem |
| Readiness | `GET /api/nomus/bom-auto-apply/products/apply-readiness` | — |
| Auto-apply pós-sync | `npm run sync:nomus:bom-auto-apply` / passo no orchestrator | Avalia **todo o stage** (`NomusBomComponentStage`), não só fila UI |
| Classificação | `nomusBomApplyStatus.ts` → `readyToApply: true` | Fila manual na UI |

**Regra desejada vs código atual:** a rotina `nomusSyncOrchestrator.ts` executa `runNomusBomAutoApplyAfterSync` após sync de `bom-components` em modo `--apply`, aplicando candidatos do **stage Nomus** (não consome explicitamente a fila UI, mas pode sobrepor produtos `ready_to_apply`). **Pendente (P1):** validar política operacional de separação total entre auto-sync e fila manual.

### 8.3 Scripts de debug

- `npm run debug:nomus-ready-to-apply` → `scripts/debug-nomus-ready-to-apply.ts`
- Smokes: `nomusAutoSyncBomApplySmokeTestV1.ts`, `nomusBomReadyToApply.test.ts`, `nomusAutoApplyBomDashboard.test.ts`

---

## 9. Outros módulos (resumo)

| Módulo | Status | Notas |
|--------|--------|-------|
| Produtos / Engenharia Nomus | **Pronto** | Cockpit, Carga Mestre, Igualar Bases, Apply controlado |
| Pricing / Propostas | **Funcional** | `apply-batch` sem confirmação textual (risco P1 herdado) |
| Frota | **Pronto** | `registerFleetManagementRoutes`, reservas públicas, checklist QR |
| Perfis de acesso | **Pronto** | `AccessProfilesModule`, `accessProfiles.test.ts` |
| Manutenção predial | **Funcional** | Sem mudanças estruturais |
| Sync Nomus financeiro | **Pronto** | `sync:nomus:accounts-receivable:*`, `accounts-payable:*`, `nfes:*` |

---

## 10. Cobertura de testes (panorama)

| Domínio | Arquivos test | Observação |
|---------|---------------|------------|
| Financeiro | ~103 | Cobertura forte em libs puras + validação estrutural UI |
| CRM / vendedor | `crmCommercialAccessScope.test.ts`, `crmSellerDashboard.test.ts`, `crmManagementDashboard.test.ts` | Escopo por vendedor testado |
| Pedidos / logístico BI | 4+ suites | 12 cenários fórmula Power BI |
| Projetos | 20+ suites | Snapshot, BOM, pricing, guided flow |
| Nomus BOM apply | `nomusBomReadyToApply.test.ts`, `nomusBomApplyStatus.test.ts`, smokes | |
| Core (custos, pricing) | ~22 suites legadas | Mantidas |

**Ausente:** smoke E2E de `PricingModule`, `ProposalModule`, `CrmModule` no browser.

---

## 11. Estado atual por bloco

| Bloco | Status | Observações |
|-------|--------|-------------|
| Login + sessão | **Pronto** | |
| Financeiro (6 abas) | **Pronto** | UX padronizada em `26c54ef` |
| CRM Comercial | **Pronto** | Escopo vendedor no backend |
| Gestão de Pedidos + BI logístico | **Pronto** | Cards alinhados Power BI |
| Dashboard financeiro Pedidos | **Pronto** | SalesOrder; meta não configurada |
| Projetos | **Pronto** | BOM isolada; sem gravação no cadastro oficial |
| Nomus Engenharia + fila apply | **Pronto** | Auto-sync e fila UI coexistem — ver pendência P1 |
| Frota | **Pronto** | |
| `server.ts` monolítico | **Parcial** | ~12.4k linhas |
| Backups `*_backup_*_20260413` no schema | **Atenção** | 9 models históricos persistidos |

---

## 12. Riscos e pendências (P0 / P1 / P2)

### P0 — nenhum confirmado no código para abas financeiras

Nenhuma aba do Financeiro está marcada como quebrada; testes estruturais e build passam em `26c54ef`.

### P1

| Risco | Detalhe |
|-------|---------|
| `server.ts` monolítico | ~12.4k linhas, ~197 rotas — manutenção e revisão difíceis |
| `POST /api/pricing/apply-batch` | Mutation em lote sem confirmação textual (herdado) |
| Auto-apply BOM pós-sync vs fila UI | Orchestrator aplica do stage; política de não consumir fila manual **não garantida por código** |
| Documentação anterior (`7c57130`) | Substituída por este documento |

### P2

| Risco | Detalhe |
|-------|---------|
| Meta comercial Pedidos de Venda | Sem fonte configurável |
| Bundle > 500 kB | Sem code-splitting por módulo |
| Smokes E2E CRM/Pricing/Proposals | Ausentes |
| Heterogeneidade visual filtros financeiros | AR/AP/Billing |
| Duplicidade nominal vendedores Nomus | Mitigado por `sellerIdentityKey`; monitorar em produção |

---

## 13. O que ainda não está coberto

- Smoke real browser de módulos comerciais e pricing.
- Testes de integração de modais React.
- Lazy-loading de módulos no frontend.
- Refatoração em camadas do `server.ts`.
- Migration Prisma para arquivar models `*_backup_*`.
