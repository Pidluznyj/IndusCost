# Prompt 00 — Discovery técnico: Central de Tesouraria

**Projeto:** IndusCost  
**Data da auditoria:** 2026-07-27  
**Branch auditada:** `main` (working tree local; ver seção 16 sobre alterações não relacionadas)  
**Escopo:** somente leitura / documentação — **nenhuma funcionalidade de Tesouraria foi implementada**

---

## 1. Resumo executivo

O IndusCost já possui um módulo **Financeiro** maduro (Fluxo de Caixa, Contas a Receber, Contas a Pagar, Faturamento, Centros de Custo, Conciliação de Carteira, DRE, Relatório Presidencial), alimentado por **sync Nomus** de títulos AR/AP e NF-e.

**Não existe** hoje um domínio de **Central de Tesouraria** (contas financeiras locais, saldos manuais, OFX, conciliação bancária, fechamento diário, transferências internas, promessas de pagamento, ações de cobrança, etc.).

O Fluxo de Caixa atual é uma projeção/realização sobre títulos Nomus AR+AP. O blueprint oficial declara explicitamente:

> **Não há saldo bancário real.** `hasInitialBankBalance: false` — saldo acumulado é fluxo projetado acumulado, não extrato bancário.  
> Fonte: `docs/finance/FINANCE_CASH_FLOW_BLUEPRINT.md`

A Central de Tesouraria deve ser um **novo domínio** que:

1. Reutiliza Nomus como fonte oficial de títulos AR/AP (sem segunda base completa).
2. Armazena localmente apenas complementos operacionais/gerenciais (saldos, agendas, OFX, fechamentos, conciliações, auditoria).
3. Não altera silenciosamente divergências nem soma pedido + NF + CR + previsão como receitas distintas.

---

## 2. Stack e estrutura do repositório

| Aspecto | Valor real |
|---------|------------|
| Frontend | React 19 (`react@19.2.4`), Vite 6, TypeScript, Tailwind 4, Recharts 3 |
| Backend | Node.js + Express 4 + TypeScript (`tsx`), **monólito** no root `server.ts` |
| ORM | Prisma 5.22 (`@prisma/client` + `prisma`) |
| Banco | PostgreSQL (`provider = "postgresql"`) |
| Package manager | **npm** (`package-lock.json` lockfileVersion 3) |
| Entrada dev | `npm run dev` → `tsx server.ts` |
| Build | `npm run build` → `vite build` |
| Lint tipado | `npm run lint` → `tsc --noEmit` |
| Porta produção (contexto) | 3000 em `/opt/induscost` — **fora do escopo do Cursor** |

### Layout relevante

```
IndusCost/
  server.ts                 # Express + Vite SPA; registra routers
  package.json              # scripts npm
  prisma/
    schema.prisma           # 183 models, 136 enums
    migrations/             # 128 pastas de migration
  scripts/                  # sync Nomus, audits, crons shell, checks
  src/
    App.tsx / main.tsx      # SPA
    components/             # UI (FinanceModule, Overlay, etc.)
    lib/                    # backend + shared (Routes, services, engines)
    hooks/ / contexts/
  docs/finance/             # blueprints financeiros existentes
  docs/treasury/            # este discovery (novo)
```

**Não há** diretórios `server/` ou `src/server/`. Backend e frontend compartilham `src/lib`, com guardrails de import (ver seção 14).

---

## 3. Package manager e scripts baseline

| Script | Função |
|--------|--------|
| `dev` | Sobe Express+Vite |
| `build` / `build:safe` | Build Vite (+ checks de import/bundle) |
| `lint` | `tsc --noEmit` |
| `check:frontend-server-imports` | Grafo FE → bloqueia Prisma/server/Node |
| `check:server-imports` | Validação de imports server |
| `check:browser-bundle` | Bundle browser sem Prisma |
| `test:unit` | `node scripts/run-unit-tests.mjs` |
| `test:finance:cash-flow` | Suíte fluxo de caixa |
| `test:finance:accounts-receivable` | Suíte CR |
| `test:finance:accounts-payable` | Suíte CP |
| `sync:nomus:accounts-receivable:apply` | Sync CR Nomus |
| `sync:nomus:accounts-payable:apply` | Sync CP Nomus |
| `backup:pre-deploy` | `bash scripts/backupDatabaseBeforeDeploy.sh` |

Runner de testes: **Node.js built-in test** via `tsx --test` (não há Vitest/Jest/Playwright no `package.json`).

---

## 4. `server.ts` e registro de routers

**Arquivo:** `server.ts`

### Middleware (ordem observada)

1. `express.json` / `urlencoded` (limit 10mb)
2. Opcional `createDevPerfBaselineMiddleware` se `INDUSCOST_PERF_BASELINE=1`
3. `Cache-Control: no-store` em `/api`
4. Rotas inline + `register*Routes(app, { requireAppAuth, requireResource, … })`
5. 404 JSON para `/api` desconhecido
6. Error handler Express (`console.error`)
7. Vite (dev) ou `express.static(dist)` + SPA fallback (prod)

### Health

| Método | Path | Auth |
|--------|------|------|
| GET | `/api/health` | nenhuma — `{ status: "ok", timestamp }` |
| GET | `/api/app-version` | nenhuma |
| GET | `/api/test-db` | `requireAppAuth` |
| GET | `/api/integrations/nomus/health` | `admin.settings.nomus_sync` view |

### Routers financeiros já registrados (trecho ~15402–15630)

Arquivos reais em `src/lib/*Routes.ts`:

| Registrar | Arquivo |
|-----------|---------|
| `registerFinanceAccountsReceivableRoutes` | `financeAccountsReceivableRoutes.ts` |
| `registerFinanceAccountsPayableRoutes` | `financeAccountsPayableRoutes.ts` |
| `registerFinanceCashFlowRoutes` | `financeCashFlowRoutes.ts` |
| `registerFinanceBillingRoutes` | `financeBillingRoutes.ts` |
| `registerFinanceSalesOrdersRoutes` | `financeSalesOrdersRoutes.ts` |
| `registerFinanceCostCentersRoutes` (+ detail/rules/allocation) | vários `financeCostCenter*.ts` |
| `registerFinancePortfolioReconciliationRoutes` | `financePortfolioReconciliationRoutes.ts` |
| `registerFinanceExecutiveReportRoutes` | `financeExecutiveReportRoutes.ts` |
| `registerFinanceDreRoutes` | `financeDreRoutes.ts` |
| `registerFinanceSuppliersRoutes` | `financeSuppliersRoutes.ts` |
| `registerFiscalSettlementRoutes` | `finance/fiscalSettlementRoutes.ts` |
| `registerSettingsNomusSyncRoutes` | `settingsNomusSyncRoutes.ts` |
| `registerNomusAccountsReceivableRoutes` | `nomusAccountsReceivableRoutes.ts` |
| `registerNomusAccountsPayableRoutes` | `nomusAccountsPayableRoutes.ts` |

**Padrão a seguir para Tesouraria:** criar `src/lib/treasury/*` (domain/services/repositories/controllers/schemas) + `registerTreasuryRoutes` em arquivo dedicado — **não** concentrar no `server.ts`.

---

## 5. Schema Prisma — estado financeiro atual

- **183 models**, **136 enums**, **128 migrations**
- Lock: `prisma/migrations/migration_lock.toml` (`postgresql`)
- Última migration observada: `20260804120000_perf08_sales_finance_read_indexes`
- **Nenhum** model `BankAccount`, `Treasury*`, `CashLedger`, `Ofx*`, `DailyClosing`, `BankTransfer`, `PaymentPromise`, `CollectionAction`
- **Nenhum** `Float` / `@db.Real` / `@db.Double` no schema — valores monetários usam `Decimal` + `@db.Decimal(p,s)`
- **Nenhum** model `FeatureFlag`

### 5.1 Contas a Receber — `NomusAccountsReceivable`

Stage local de sync Nomus (comentário no schema: read-only sync).

Campos monetários (`Decimal(20,2)`):

- `amountReceivable`, `amountScheduled`, `amountReceived`, `balanceReceivable`

Datas: `dueDate`, `competenceDate`, `scheduleDate`, `settlementDate`, `createdAtNomus`, `modifiedAtNomus`, `syncedAt`

Identidade/origem:

- `externalId` (Int unique — ID Nomus)
- `personId` / `personName` / `personCnpj` (denormalizados Nomus; **sem FK** para `Customer`)
- `bankAccountId` / `bankAccountName` (denormalizados Nomus; **sem model Conta**)
- `sourceInvoiceId` / `sourceInvoiceNumber`
- `rawPayload` Json + `payloadHash` (idempotência)
- lifecycle: `sourcePresenceStatus`, `presentInLastPayload`, `missingSince`, `sourceRemovedAt`, `lastSyncRunId` → `NomusSourceSyncRun`

Baixa/recebimento: **colunas** `settlementDate` + `amountReceived` + `balanceReceivable` — **não** há entidade `Baixa`/`Settlement`.

### 5.2 Contas a Pagar — `NomusAccountsPayable`

Espelho de AR com:

- `amountPayable`, `amountScheduled`, `amountPaid`, `balancePayable` (`Decimal(20,2)`)
- `paymentDate` além de `settlementDate`
- `documentNumber`, `suspendPayment`
- mesma ausência de FK para fornecedor canônico / NFe

### 5.3 Sync / integração

| Model | Papel |
|-------|-------|
| `IntegrationRun` | Runs genéricos (`sourceSystem` default `"NOMUS"`) |
| `NomusSourceSyncRun` | Presence sync tipado (`SALES_ORDER` \| `ACCOUNTS_RECEIVABLE` \| `ACCOUNTS_PAYABLE`) |

Scripts shell: `scripts/runNomusAccountsReceivableSync.sh`, `runNomusAccountsPayableSync.sh`, `runNomusDailySync.sh`, etc.  
API de controle: `src/lib/settingsNomusSyncRoutes.ts` (`/api/settings/nomus-sync/*`).

### 5.4 Clientes, fornecedores, pedidos, notas

| Conceito | Model / link real |
|----------|-------------------|
| Cliente canônico | `Customer` (`taxId` unique, `personId` opcional) |
| Pedido | `SalesOrder` → `customerId` FK; `externalSalesOrderId`; totais `Decimal(20,6)` |
| Itens | `SalesOrderItem` |
| Link Pedido↔NF | `SalesOrderNfeLink` (`nfeExternalId`, `nomusNfeId` string **sem** `@relation` Prisma) |
| NF-e | `NomusNfe` (`externalId`, `xmlVNF`, `valorLiquido`, `billingClassification`, …) |
| Fornecedor gerencial | `FinancialSupplier` + `FinancialSupplierAlias` (não substitui `personName` Nomus) |
| Alocação CC×AP | `AccountsPayableCostCenterAllocation.accountsPayableId` = `NomusAccountsPayable.externalId` (**lógico**, sem FK Prisma) |

### 5.5 Camadas paralelas (não são Tesouraria)

| Model | Observação |
|-------|------------|
| `PortfolioReconciliationRun` / `Fact` | Auditoria/previsão pedido×NF×CR — comentários: **não** alterar Fluxo de Caixa oficial |
| `OrderToCashAuditRun` / `Fact` | Auditoria pedido→caixa derivada |
| `CommissionReceiptLedgerLine` | Snapshot de baixa para comissões (`nomusReceivableId`) |
| `FiscalPaymentGuide` / `FiscalSettlementAuditLog` | Guias fiscais; `accountsPayableExternalId` lógico |

### 5.6 Separação conceitual já documentada

Reutilizar regras de `docs/finance/order-nfe-cr-financial-separation.md`:

- Saldo financeiro **nunca** = pedido − NF
- Não somar previsão e realização do mesmo título
- CR oficial: `NomusAccountsReceivable` via `sourceInvoiceId`

---

## 6. Autenticação e middleware

| Item | Valor real |
|------|------------|
| Cookie de sessão | `induscost_session` |
| Store | `AppSession` (PostgreSQL) — `tokenHash` SHA-256, `expiresAt`, `revokedAt`, `permissionsVersionAtIssue` |
| TTL | 12h (`APP_SESSION_TTL_MS`) |
| Password | scrypt (`hashPassword` / `verifyPassword`) em `src/lib/auth/appAuth.server.ts` |
| Shared browser-safe | `src/lib/auth/appAuth.shared.ts` |
| Guards | `createAuthGuards` em `src/lib/appAuthMiddleware.ts` → `requireAppAuth`, `requirePermission`, `requireAnyPermission`, `requireAllPermissions` |
| Rotas auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/permissions-version`, `POST /api/auth/sync-session-permissions` |
| Bootstrap admin | cookie `induscost_bootstrap_admin` + env `BOOTSTRAP_ADMIN_*` |

**Regra:** backend é autoridade; FE só esconde UI.

---

## 7. Sistema de permissões

### Duas camadas coexistentes

1. **Bag keys** — `src/lib/permissionCatalog.ts` (ex.: `finance.cashFlow.view`, `finance.accountsReceivable.export`)
2. **Contract resources** — `requireResource(resourceKey, action)` em `src/lib/security/requireResource.ts`  
   Catálogo: `src/lib/security/permissionContract/resources.ts`

### Resource keys financeiros reais (`FINANCE_MODULE_RESOURCE_KEYS`)

Arquivo: `src/lib/financeModulesAccess.ts`

| Constante | Resource key |
|-----------|--------------|
| `home` | `finance` |
| `cashFlow` | `finance.cash_flow` |
| `accountsReceivable` | `finance.accounts_receivable` |
| AP (isolado) | `finance.accounts_payable` (`financeAccountsPayableAccess.ts`) |
| `billing` | `finance.billing` |
| `salesOrders` | `finance.sales_orders` |
| `costCenters` | `finance.cost_centers` |
| `executiveReport` | `finance.executive_report` |
| `dre` | `finance.dre` |
| `profitCash` | `finance.profit_cash` *(chave já presente no contrato/nav WIP local — ver §16)* |
| `suppliers` | `finance.suppliers` |
| `portfolio` | `finance.portfolio_reconciliation` |
| `taxes` / `taxApuration` | `finance.taxes` / `finance.tax_apuration` |
| `reports` | `finance.reports` |

Actions usadas: `view`, `export`, `manage`, `execute`, `update`, `create`.

### Models de permissão

`AccessProfile`, `AppUser`, `PermissionResource`, `RolePermission` (`canView`/`canExecute`/`canManage`), `UserPermissionOverride`, `PermissionAuditLog`.

### FE

- `src/hooks/usePermissions.ts`
- `src/hooks/useAuthorizedTabs.ts`
- `src/lib/permissionsClient.ts` (`ResourceKeys`)
- `src/lib/resourceNavigationAccess.ts`
- Guard de rota: `RequirePathViewAccess.tsx`

**Para Tesouraria:** criar resource keys novas no contrato (ex. `finance.treasury` + actions), seed via `permissions:seed:contract:*`, e **nunca** abrir Tesouraria só com bag `finance.view`.

---

## 8. Auditoria existente

Não há middleware global de audit. Padrão = tabelas/domain writers:

| Model / writer | Domínio |
|----------------|---------|
| `PermissionAuditLog` | ACL |
| `CommercialAuditLog` / `writeCommercialAuditLog` | Comercial |
| `FinancialCostCenterAuditLog` | Centros de custo |
| `FiscalSettlementAuditLog` | Fiscal |
| `InventoryAuditLog`, `FleetAuditLog`, `MaterialMarketAuditEvent` | Outros módulos |
| `OrderToCashAuditRun`/`Fact` | Auditoria O2C |
| `CommissionAuditIssue` | Comissões |

**Tesouraria** deve seguir o padrão de audit log versionado por domínio (novo model `TreasuryAuditLog` ou equivalente — **nome a definir na etapa de schema**, não inventado como existente).

---

## 9. Decimal e dinheiro

| Achado | Detalhe |
|--------|---------|
| Schema | AR/AP/NFe/comissões/fiscal: majoritariamente `Decimal(20,2)`; pedidos/O2C: frequentemente `Decimal(20,6)` |
| Conversão atual | Muitos engines fazem `Decimal → number` (`decimalToNumber`, `decimalFieldToNumber`, `roundMoney`) — **risco** para Tesouraria |
| Utilitário comissões | `src/lib/commissions/commission-money.ts` + `commission-money.shared.ts` |
| Tolerância schedule | `EFFECTIVE_SCHEDULE_MONEY_TOLERANCE = new Prisma.Decimal("0.01")` em `finance/salesOrderEffectiveFinancialSchedule.ts` |

**Requisito da Tesouraria (já nas regras do programa):**

- Manter `Decimal` no domínio/serviço
- DTOs monetários como **strings decimais**
- Não usar ponto flutuante nativo em cálculos críticos

---

## 10. Datas e fuso

| Padrão | Arquivo / uso |
|--------|----------------|
| Datas civis financeiras (vencimento/competência) | `src/lib/financeCivilDate.ts` — `toCivilDateKey`, `formatCivilDate`, `addCivilDays` (UTC midnight / sem shift de fuso) |
| TZ explícito `America/Sao_Paulo` | Brent/PTAX jobs, parsers OP Nomus, DRE cash bridge (`FINANCE_DRE_CASH_BRIDGE_TIMEZONE`) |
| Schema AR/AP | `DateTime?` sem `@db.Timestamptz` nas datas de título |

**Recomendação:** Tesouraria deve padronizar dias financeiros com `financeCivilDate` + documentar instantes (`America/Sao_Paulo`) para fechamento/OFX/auditoria.

---

## 11. Frontend — UI reutilizável

### Shell financeiro

- `src/components/FinanceModule.tsx` — tabs `/finance/*`
- Seções: `FINANCE_UI_SECTIONS` / `src/lib/financeNavigation.ts` / `internalSurfaceAccess.ts`
- Páginas: `FinanceCashFlowPage`, `FinanceAccountsReceivablePage`, `FinanceAccountsPayablePage`, `FinanceBillingPage`, `FinanceCostCentersPage`, `FinanceExecutiveReportPage`, `FinanceManagerialDrePage`, `FinancePortfolioReconciliationPage`, `FinanceSuppliersPage`

### Primitivos a reutilizar

| Tipo | Path |
|------|------|
| Overlay (modal/drawer canônico) | `src/components/ui/overlay/Overlay.tsx` (+ Header/Body/Footer/Table/KpiCard) |
| KPI cards | `MetricCard`, `SummaryKpiCard`, `FinanceBiKpiCard`, `FinanceKpiCard` |
| Shell BI | `src/components/finance/bi/FinanceBiDashboardShell.tsx`, `FinanceBiFilterPanel`, `FinanceBiChartExpandModal` |
| Filtros | `EntityAutocompleteFilter`, `MoneyRangeFilter` |
| Charts | feature-local + Recharts (ex. `FinanceCashFlowCharts.tsx`) — sem kit chart global |

**Não existe** UI de Tesouraria/OFX/fechamento diário. Menção textual em `src/lib/systemGuide/sectionsExtended.ts` apenas.

---

## 12. Rotas financeiras existentes (amostra reutilizável)

### Fluxo de Caixa — `financeCashFlowRoutes.ts`

- `GET /api/finance/cash-flow/dashboard`
- `GET /api/finance/cash-flow/export`
- `GET /api/finance/cash-flow/audit`
- `GET /api/finance/cash-flow/annual-comparison`
- `GET /api/finance/cash-flow/daily-radar` (+ cost-centers, export-data, export.xlsx)

Permissão: `finance.cash_flow` / `view` (export do cash-flow também usa `view` — documentado como deprecado).

### Contas a Receber — `financeAccountsReceivableRoutes.ts`

- `GET /api/finance/accounts-receivable/dashboard`
- `GET /api/finance/accounts-receivable/titles`
- `GET /api/finance/accounts-receivable/export`
- `GET …/titles/export.xlsx`, `…/horizon/export-data`, `…/horizon/export.xlsx`
- Due-radar / overdue em `financeDueRadarRoutes.ts`, `financeAccountsReceivableOverdueRoutes.ts`

### Contas a Pagar — `financeAccountsPayableRoutes.ts`

- `GET /api/finance/accounts-payable/dashboard|titles|export`
- `GET /api/finance/accounts-payable/titles/:id/classification`

### Export pattern a copiar

1. Builder em `src/lib/*Export*.ts`
2. Rota `GET …/export` (CSV) ou `…/export.xlsx` (XLSX)
3. Botão FE faz `fetch` → blob → download  
Dependência: `xlsx` no `package.json`.

---

## 13. Jobs, crons, logs, feature flags, health

### Jobs in-process

| Job | Arquivo | TZ |
|-----|---------|-----|
| Brent | `brentCommodityJob.ts` | `America/Sao_Paulo` |
| PTAX | `ptaxSnapshotJob.ts` | `America/Sao_Paulo` |

Kill-switch exemplo: `BRENT_COMMODITY_SCHEDULER_ENABLED`.

### Crons externos (shell)

`scripts/runNomusDailySync.sh`, `runNomusAccountsReceivableSync.sh`, `runNomusAccountsPayableSync.sh`, `runNomusNfesSync.sh`, …

### Logs

- Sem pino/winston — `console.*`
- Prisma: warn/error; `PRISMA_QUERY_LOG=1` para queries
- Nomus sync logs em filesystem (`NOMUS_SYNC_LOG_DIR`, default `/tmp/induscost-nomus-sync`)

### Feature flags

Não há serviço central. Padrão observado: env + fail-closed, ex.:

- `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` → `src/lib/sales/salesOrderFlowFeatureFlags.ts`
- `REQUIRE_RESOURCE_LEGACY_COMPAT`, `EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT`
- `INDUSCOST_PERF_BASELINE`

**Tesouraria** deve introduzir flag explícita (env + resource) no padrão fail-closed.

---

## 14. Risco Prisma no frontend

| Check | Resultado (2026-07-27) |
|-------|------------------------|
| Imports `@prisma/client` em `src/components` | **0** matches |
| `npm run check:frontend-server-imports` | **OK** — 743 arquivos FE; nenhum caminho até Prisma/server/Node |
| `npm run check:server-imports` | **OK** |
| `npm run test:server-startup` | **2 pass / 0 fail** |

Risco residual: módulos `src/lib/*.ts` (sem `.server`) ainda importam Prisma (ex. dashboards financeiros). Guardrail oficial: `check:frontend-server-imports` + `build:safe`.

**Para Tesouraria:** separar `*.server.ts` / `*.shared.ts` e nunca importar Prisma no FE.

---

## 15. Lacunas vs. escopo da Central de Tesouraria

| Capacidade desejada | Estado atual |
|---------------------|--------------|
| Contas financeiras locais | Ausente (só `bankAccountId/Name` denormalizados Nomus) |
| Saldos manuais / históricos | Ausente (`hasInitialBankBalance: false`) |
| Saldo observado / calculado / conciliado | Ausente |
| Contas a receber/pagar (títulos) | Presente via Nomus stage + dashboards |
| Previsto vs realizado | Parcial no Fluxo de Caixa (`projected`/`realized`/`combined`) |
| Datas esperadas / promessas | Ausente (há `scheduleDate` Nomus; não substituir `dueDate`) |
| Ações de cobrança / contestações | Ausente |
| Programação de pagamentos | Parcial (Due Radar / Daily Radar / classificação CC) |
| Projeções contratual/provável/confirmada | Parcial (cenários cash-flow + portfolio forecast) |
| Agenda financeira | Parcial (calendário cash-flow / due radar) |
| Transferências internas | Ausente |
| Lançamentos manuais / exceções / alertas | Ausente (alertas CFO do cash-flow são derivados) |
| Fechamento diário / reabertura | Ausente |
| Importação OFX / conciliação bancária | Ausente |
| Relatórios / exportações tesouraria | Ausente (exports de AR/AP/cash-flow existem) |
| Auditoria / permissões / flags / testes / docs | Infra genérica existe; domínio Tesouraria não |

---

## 16. Working tree no momento da auditoria (não relacionado)

Alterações locais **não** fazem parte deste Prompt 00 e **não foram commitadas aqui**:

- Modificados: `Sidebar.tsx`, `financeModulesAccess.ts`, `financeNavigation.ts`, `modulePermissions.ts`, `navigationGroups.ts`, `permissionsClient.ts`, `permissionContract/resources.ts`, `sidebar*` (vários), `appHeaderBreadcrumbNesting.ts`
- Untracked: `financeProfitCashAnalysis*.ts`

Provável WIP de análise Lucro×Caixa (`finance.profit_cash`). A Tesouraria **não deve sobrescrever** esses arquivos sem coordenação.

---

## 17. Artefatos e serviços a reutilizar (checklist)

### Backend / domínio

- `src/lib/prisma.ts` — client singleton
- `src/lib/appAuthMiddleware.ts` + `src/lib/security/requireResource.ts`
- `src/lib/financeModulesAccess.ts` / `financeAccountsPayableAccess.ts`
- `src/lib/financeCivilDate.ts`
- Engines de leitura AR/AP/CashFlow (somente leitura de títulos; **não** mutar stage Nomus)
- Sync idempotente: `payloadHash` + `NomusSourceSyncRun` / `IntegrationRun`
- Padrão `register*Routes(app, auth)`

### Frontend

- `FinanceModule` + Overlay + `FinanceBiDashboardShell`
- `usePermissions` / `useAuthorizedTabs`
- Export buttons pattern (Daily Radar / Horizon)

### Docs de negócio já existentes

- `docs/finance/FINANCE_CASH_FLOW_BLUEPRINT.md`
- `docs/finance/FINANCE_CASH_FLOW_DATA_DICTIONARY.md`
- `docs/finance/order-nfe-cr-financial-separation.md`
- `docs/nomus/nomus-accounts-receivable-source-reconciliation.md`
- Docs de permissões em `docs/security/`

### Scripts de validação segura

- `npm run check:frontend-server-imports`
- `npm run check:server-imports`
- `npm run test:server-startup`
- `npm run lint` (quando etapa exigir)

---

## 18. Riscos para as próximas etapas

1. **Soma indevida de conceitos** (pedido + NF + CR + previsão) — mitigar com regras de `order-nfe-cr-financial-separation.md`.
2. **Converter Decimal→number** nos engines atuais — Tesouraria precisa de caminho string/Decimal estrito.
3. **`server.ts` já é grande** — novo módulo deve nascer modularizado.
4. **Referências lógicas sem FK** (AR↔Customer, AP↔Supplier) — conciliação tesouraria não pode assumir integridade referencial Prisma.
5. **WIP Lucro×Caixa** no working tree — evitar conflito de nav/permissões.
6. **Produção fora do Cursor** — migrations apenas via `prisma migrate` versionado; usuário aplica `migrate deploy` no servidor.
7. **Cash-flow atual pode ser confundido com caixa bancário** — UI/docs da Tesouraria devem distinguir saldo observado/conciliado do fluxo projetado.

---

## 19. Validação baseline executada (Prompt 00)

| Validação | Comando | Resultado |
|-----------|---------|-----------|
| Frontend→server imports | `npm run check:frontend-server-imports` | OK (743 arquivos) |
| Server imports | `npm run check:server-imports` | OK |
| Startup prisma scope | `npm run test:server-startup` | 2 pass / 0 fail |
| Prisma Float money | grep schema | 0 matches |
| Prisma em components | grep `src/components` | 0 matches |
| Contagem migrations | filesystem | 128 |

Nenhuma migration criada. Nenhuma alteração de código de produto.
