# IndusCost — Estado atual do sistema

> Auditoria gerada na fase **INDUSCOST-SYSTEM-AUDIT-AND-ACTION-PLAN-A**.
>
> Esta é uma fotografia do que existe **hoje** no repositório
> (`Pidluznyj/IndusCost`, branch `main`, último commit `7c57130`). Não
> introduz mudanças funcionais. Cada afirmação é derivada de inspeção de
> código real.

## 1. Visão geral

O **IndusCost** é uma aplicação web fullstack para gestão de cadastros,
custos, formação de preço, propostas, pedidos, CRM e — mais recentemente —
integração de engenharia com o ERP **Nomus**.

A linha de produto suportada é fabricação de **componentes plásticos**
(referências como `611.48AA`, `304.02AA`, `610.73BA`, `317.02AA`,
`110.03--`), com BOM, roteiro, máquina, cavidade, eficiência e
opcionais/alternativos.

Não é um protótipo: é um sistema em uso no servidor `/opt/induscost`,
banco PostgreSQL real `teste_bi`.

## 2. Stack confirmada

| Camada | Tecnologia | Evidência |
|---|---|---|
| Frontend | React 19 + Vite 6 + TypeScript 5.8 | `package.json` deps |
| Backend | Node + Express 4.21 | `server.ts` (1 arquivo, ~13 500 linhas) |
| ORM | Prisma 5.22 | `prisma/schema.prisma` |
| Banco | PostgreSQL (`@db.Decimal(20,6)` extensivamente) | `schema.prisma` |
| Auth | Sessões opacas + RBAC granular | `src/lib/appAuth*.ts`, `src/lib/modulePermissions.ts` |
| Build | `tsc --noEmit` + `vite build` | `package.json` scripts |
| Test runner | `tsx --test` para suites de lib | `npm test` |
| Smoke runners | `tsx scripts/*.ts` | 42 scripts em `scripts/` |
| Tabela Excel | XLSX | importadores de Material/Product/Customer |

## 3. Estrutura do repositório

```
IndusCost/
├── prisma/
│   └── schema.prisma          # 51 models + 22 enums
├── server.ts                  # backend monolítico, ~13 500 linhas, 176 endpoints
├── src/
│   ├── App.tsx                # roteamento principal
│   ├── main.tsx               # bootstrap
│   ├── components/            # 40 módulos top-level + 10 subpastas
│   │   ├── product/           # 29 componentes (BOM, Nomus, History)
│   │   ├── pricing/           # 11 componentes
│   │   ├── proposal/          # painéis comerciais
│   │   ├── customers/         # CRM
│   │   ├── dashboard/         # indicadores
│   │   ├── admin/             # usuários + permissões
│   │   ├── shared/, layout/, tour/, contextual/
│   ├── lib/                   # 101 arquivos: shared puros, server-side, clients REST
│   ├── contexts/              # AuthContext
│   ├── hooks/                 # custom hooks
│   ├── types/                 # tipos compartilhados
│   └── tours/                 # passos de onboarding
├── scripts/                   # 42 scripts CLI
│   ├── nomus*Sync*.ts         # ingestão Nomus
│   ├── nomus*Smoke*.ts        # smokes read-only
│   ├── nomusMasterData*.ts    # Carga Mestre + Igualar Bases + Backfill
│   ├── nomusBom*.ts           # Apply BOM
│   └── checkFrontendServerImports.ts (guardrail)
└── docs/                      # esta documentação + guia operacional Nomus
```

## 4. Módulos e fluxos principais

### 4.1 Produtos e Engenharia

- `ProductModule.tsx` é o módulo central da Engenharia: lista, edição em
  modal com 7 abas (Informações, Estrutura BOM, Processo/Roteiro, Estrutura
  em Árvore, Análise de Custo, Composição de Custos, **Histórico**).
- Tabs de produto controladas por permissões (`src/lib/modulePermissions.ts`).
- BOM e roteiro são tabelas independentes (`ProductBOM`, `ProductRouting`)
  ligadas a `Product` (`type: PRODUCT | COMPONENT`).
- Cada produto tem um `costingMode: OWN_PROCESS | BOM_ONLY |
  FINISHING_SERVICE` que define se HH/HM próprio entra no cálculo.
- Análise de custo recursiva (filhos via `childProductId`); resultado
  exposto em `GET /api/products/:id/cost-analysis`.

### 4.2 Materiais

- `MaterialModule.tsx` mantém o cadastro mestre de matéria-prima e insumos.
- Campos `currentCost/averageCost/standardCost/freight/standardLoss/
  conversionFactor` em `Decimal(20,6)`.
- Histórico de preço em `MaterialPriceHistory`.

### 4.3 Nomus — integração de engenharia

A camada Nomus é a maior em volume de código recente. Compreende:

| Sub-fluxo | Lib server-side | UI |
|---|---|---|
| Ingestão (sync) | `scripts/nomus*Sync*.ts`, `nomusBomComparisonLoad.ts` | logs em Configurações |
| Comparação Nomus × IndusCost | `nomusBomComparison.ts`, `nomusBomComparisonLoad.ts` | `NomusBomComparisonPanel.tsx` |
| Classificação | `nomusBomClassification.ts` | indireta |
| BOM efetiva (com opcionais) | `nomusEffectivePricingBom.ts` | `NomusEffectivePricingBomPanel.tsx` |
| Impacto de custo | `nomusEffectiveBomCostImpact.ts` | `NomusEffectiveBomCostImpactPanel.tsx` |
| Plano de aplicação | `nomusBomApplyPlan.ts`, `nomusBomApplyPlanLoad.ts` | `NomusBomApplyPlanPanel.tsx` |
| **Aplicar BOM controlado** | `nomusBomControlledApply.ts` | `NomusBomControlledApplySection.tsx` |
| Carga Mestre Nomus | `nomusMasterDataImport.ts` | `NomusMasterDataImportPanel.tsx` |
| **Igualar bases** | `nomusMasterDataEqualize.ts` | `NomusMasterDataImportPanel.tsx` (mesmo painel) |
| Plano de Ação por produto | `nomusEngineeringEqualizationActionPlan.ts` | `NomusEngineeringOperationsCockpitPanel.tsx` (dropdown) |
| Central / Cockpit | `nomusEngineeringOperationsCockpit.ts` | `NomusEngineeringOperationsCockpitPanel.tsx` |
| Status da Engenharia (consolidado) | reusa endpoints existentes | `NomusEngineeringStatusBoard.tsx` |
| Checklist por produto | reusa action plan | `ProductReleaseChecklist.tsx` |
| Histórico do produto | `productChangeHistory.ts` | `ProductHistoryTab.tsx` |

Ponto-chave: **toda mutation Nomus exige confirmação textual exata**
(`IMPORTAR CADASTRO MESTRE NOMUS`, `IGUALAR BASES NOMUS`,
`APLICAR BOM NOMUS <CÓDIGO>`, `BACKFILL HISTORICO NOMUS`) e cria
`EngineeringSyncRun` antes de gravar `EngineeringChangeLog`. A FK foi
provada em hotfix anterior (`652971e`) e protegida por smoke.

### 4.4 Custos

- Motor em `server.ts` (`GET /api/products/:id/cost-analysis`).
- Composição: material (incluindo perda, frete, conversão) + transformação
  (HH+HM por minuto produtivo a partir de cycle/cavities/efficiency/setup) +
  custos indiretos (`IndirectCost`) + impostos opcionais (`TaxRule`).
- `ProductCostingMode` modula HH/HM próprio.
- `pricingOpenBook.ts` + `OpenBookCompositionTab.tsx` apresentam composição
  detalhada por linha.
- Simulação independente em `Simulation` (parâmetros incrementais sobre
  cálculo) e `NewProductSimulation` (sandbox + snapshot completo).

### 4.5 Formação de preço

- `PricingModule.tsx` + `pricingFormationIndicatorsStats.ts` lidam com a
  matriz produto×TaxRule.
- `PriceTable` + `PriceTableVersion` + `PriceTableItem` versionam preços
  publicados.
- Endpoint `POST /api/pricing/apply-batch` aplica margens em lote
  (**única mutation batch sem confirmação textual** — ver auditoria de riscos).

### 4.6 Comercial / CRM

- `ProposalModule.tsx`, `CrmModule.tsx`, `CrmManagement*`, `CrmSeller*`.
- Pipeline com `ProposalStatus` (`DRAFT → ANALYSIS → SENT → APPROVED →
  REJECTED/EXPIRED/CANCELED`).
- `ProposalItem` carrega `pricingSnapshotJson` para reproduzibilidade.
- Geração de Pedido de Venda a partir de Proposta:
  `POST /api/proposals/:id/generate-sales-order`.
- CRM com `CommercialActivity` (visitas/calls/emails), `CrmCustomerProfile`,
  `CommercialAuditLog`, dashboards de gestão e vendedor.

### 4.7 Configurações / Admin

- `AdminUsersModule.tsx`, RBAC granular via `permissionCatalog.ts`.
- `SettingsModule.tsx` para parâmetros globais, branding, integrações,
  tabelas de preço, regras fiscais.
- Bootstrap admin separado das contas regulares (`requireBootstrap*`).
- `ProductionHourCostSimulation` para custo da hora produtiva global.

### 4.8 Manutenção predial

- `MaintenanceRequest` + `MaintenanceRequestStatusHistory` com fluxo de
  ordens de serviço, prioridades e categorias.

### 4.9 Compras

- `PurchaseRequest` + `PurchaseRequestItem` ligados a `Material` ou linhas
  livres, com prioridades.
- Endpoints `/api/purchase-requests*`.

## 5. Cobertura de testes

- **Suite Vitest/tsx --test** (`npm test`) — 22 arquivos de teste:
  cost rollup, costAnalysisPartial, openBook explosion, pricing
  formation, simulation formula, sandbox, snapshot, indicadores, filtros
  operacionais/pricing, customer indicators, BomCostDetailRow, indicadores
  contextuais. Cobertura forte em libs puras.
- **Smokes Nomus read-only**: `master-data-import`,
  `master-data-equalize`, `engineering-action-plan`,
  `engineering-release-check`, `bom-apply-after-master-data`,
  `engineering-release-ready`. Todos: snapshot antes/depois +
  validação de FK órfã + check de bloqueio com confirmação errada.
- **Não há smoke real** para os fluxos `PricingModule`, `ProposalModule`,
  `CrmModule`, `MaintenanceModule`, `ProductRouting` ou `Simulation*` —
  ver `induscost-action-plan-roadmap.md`.

## 6. Estado atual por bloco

| Bloco | Status | Observações |
|---|---|---|
| Login + sessão | **Pronto** | Hotfix anterior eliminou tela branca por import Prisma indevido. |
| Produtos (CRUD básico) | **Pronto** | Import Excel + abas técnicas + permissões. |
| Materiais (CRUD básico) | **Pronto** | Inclui import Excel + histórico de preço. |
| Engenharia Nomus (ingestão) | **Pronto** | Scripts `nomusBomComponentsSyncV1`, etc. |
| Engenharia Nomus (Central/Cockpit) | **Pronto** | Paginação + filtros + abrir produto. |
| Engenharia Nomus (Plano de ação) | **Pronto** | Action plan + steps + readiness. |
| Engenharia Nomus (Carga Mestre) | **Pronto** | Aplicado em produção (54 itens criados; 110.03-- como Material). |
| Engenharia Nomus (Igualar Bases) | **Pronto após hotfix** | Hotfix `652971e` corrigiu FK; smoke + endurecimento aplicados. |
| Engenharia Nomus (Aplicar BOM) | **Pronto após hotfix** | Confirmação `APLICAR BOM NOMUS <CÓDIGO>` + ponte para EngineeringChangeLog. |
| Histórico do produto (UI) | **Pronto** | Aba Histórico + timeline humanizada. |
| Central de Engenharia (resumo) | **Pronto** | Cards consolidados + últimos runs + checklist por produto. |
| Custos (motor) | **Funcional** | Há divergência conhecida entre grid e modal em alguns casos (cost rollup) — ver auditoria. |
| Pricing | **Funcional** | `apply-batch` sem confirmação textual — risco P1. |
| Propostas | **Funcional** | Geração de pedido OK; impactos de custo controlados pelo `pricingSnapshotJson`. |
| Pedidos | **Funcional** | Status básico. |
| CRM | **Funcional** | Dashboards extensos; alguns scripts pesados. |
| Manutenção predial | **Funcional** | Em uso interno. |
| Backups históricos no schema | **Atenção** | 9 models `*_backup_*_20260413` ficaram persistidos no schema (ver auditoria). |

## 7. O que ainda **não** está coberto

- Smoke real de `PricingModule`, `ProposalModule`, `CrmModule`,
  `MaintenanceModule`, `ProductRouting`, `Simulation*`.
- Frontend não tem testes de integração de modal de produto.
- `server.ts` continua monolítico (~13 500 linhas) — refactor em camadas
  reserved para fase futura.
- Lazy-loading de módulos no React (bundle atualmente acima de 500 kB
  gzipado).
- Indicadores agregados de aplicação de BOM ao longo do tempo (próxima
  fase recomendada).
