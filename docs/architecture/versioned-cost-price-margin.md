# Arquitetura: custo versionado, preço e margem

> **Referência operacional** — fluxo implementado e validado.  
> **Atualizado:** 2026-07-02  
> **Escopo:** matéria-prima, custo de produção, preço de venda, margem comercial.

---

## 1. Arquitetura implementada

### Camadas congeladas

| Camada | Entidades | Geração oficial | Consumo (margem/preço) |
|--------|-----------|-----------------|------------------------|
| Matéria-prima | `MaterialCostTableVersion`, `MaterialCostTableItem` | Snapshot de `Material` ACTIVE com custo > 0 | DRAFT de produção (catálogo MP congelado) |
| Custo produção | `ProductionCostTableVersion`, `ProductionCostTableItem` | `getProductCostAnalysis` + MP publicada; PRODUCT + COMPONENT | Margem na `issueDate`; DRAFT de preço |
| Preço comercial | `PriceTableVersion`, `PriceTableItem` | `ProductionCostTableItem` publicado (não motor vivo) | Referência comercial na margem |
| Margem | motor + service | — | Custo publicado + preço vendido real + preço tabela (KPI) |

### Fluxo oficial (ordem obrigatória)

```
Material ACTIVE (cadastro)
        ↓ generate + publish
MaterialCostTableVersion PUBLISHED  ← matéria-prima publicada (landedCostSnapshot)
        ↓ generate DRAFT + publish
ProductionCostTableVersion PUBLISHED  ← produtos e componentes (unitProductionCost)
        ↓ generate DRAFT + publish
PriceTableVersion PUBLISHED  ← salePrice congelado (produtos e componentes)
        ↓
SalesOrder.issueDate
        ↓
Margem realizada (custo publicado) + referência preço oficial (se proposta/tabela)
```

### Motor único

- `getProductCostAnalysis` — usado **apenas na geração de DRAFT** de produção (com catálogo MP congelado).
- **Margem e preço comercial não chamam o motor vivo** — leem snapshots publicados.
- Simulações, open book e engenharia podem usar motor vivo (fora do fluxo oficial de margem).

### Terminologia padronizada

| Termo | Significado |
|-------|-------------|
| **Matéria-prima publicada** | `MaterialCostTableItem.landedCostSnapshot` em versão PUBLISHED/SUPERSEDED |
| **Custo publicado** | `ProductionCostTableItem.unitProductionCost` vigente na data |
| **Preço oficial** | `PriceTableItem.salePrice` vigente na data (referência comercial) |
| **Preço vendido** | Receita líquida unitária real do pedido |
| **Custo vivo** | `Material.currentCost` ou motor sem snapshot — **não entra na margem oficial** |
| **SEM_CUSTO** | Pendência explícita — nunca substituída por zero |

### Limitações conhecidas (aceitas)

- **HH/HM globais** (`IndirectCost`) permanecem vivos na geração de DRAFT de produção.
- **BOM Nomus** viva — altera novos DRAFTs, não publicações antigas.
- **Performance operacional** (ciclo/cavidades em `Product`) viva — altera novos DRAFTs via `getProductCostAnalysis`, não publicações antigas.
- Pedidos Nomus sem proposta → margem realizada OK, referência `SEM_PRECO_TABELA`.

### Performance operacional × custo publicado

| Conceito | Onde vive | Impacto comercial |
|----------|-----------|-------------------|
| **Dado vivo operacional** | `Product.cycleTimeSeconds`, `Product.cavities` (Operações > Performance) | Nenhum até nova geração de DRAFT |
| **Snapshot congelado** | `ProductionCostTableItem.calculationSnapshot.processPerformance` | Custo/preço/margem histórica |
| **Motor único** | `getProductCostAnalysis` → `buildStandardOperationItems` | Lê campos vivos na geração de DRAFT |

Fluxo:

```
Operações > Performance altera Product (ciclo/cavidades)
        ↓ (não recalcula publicado)
ProductionCostTableItem PUBLISHED permanece congelado
        ↓ generate novo DRAFT + publish
Novo snapshot inclui ciclo/cavidades usados + warnings se ausentes
        ↓
Margem de pedidos antigos continua no custo publicado anterior
```

Auditoria read-only:

```bash
npm run audit:component-performance-cost-impact -- --before-cycle=64 --after-cycle=90
npm run audit:component-performance-cost-impact -- --sku=309.86AA --json
```

Testes: `npm run test:component-performance-cost-draft`

Auditoria operacional de cobertura (read-only):

```bash
npm run audit:component-performance-coverage -- --year=2026 --month=7
npm run audit:component-performance-coverage -- --top=20 --sold-only --missing-only --json
```

Testes: `npm run test:component-performance-coverage`

Documentação da frente: `docs/operations/component-performance-flow.md`

---

## 2. Fases concluídas

| Fase | Status |
|------|--------|
| 0 — Baseline + testes | ✅ |
| 1 — Auditoria/cobertura | ✅ script + API + UI |
| 2 — Componentes no custo | ✅ |
| 3 — MP versionada | ✅ |
| 4 — Produção ↔ MP | ✅ FK + catálogo congelado |
| 5 — Preço desacoplado | ✅ produção publicada + COMPONENT |
| 6 — Margem enriquecida | ✅ preço oficial como referência |
| 7 — E2E + auditoria contínua | ✅ |

**Fora de escopo:** alterar sync BOM Nomus, recalcular passado automaticamente, segundo motor de custo.

---

## 4. Regras invioláveis

Estas regras são **travas de segurança** — qualquer PR da sequência deve respeitá-las.

| ID | Regra |
|----|-------|
| **R1** | **BOM viva não altera custo publicado** — `ProductionCostTableItem` de versão PUBLISHED/SUPERSEDED é imutável; mudança de BOM só impacta nova geração de DRAFT. |
| **R2** | **MP viva não altera custo publicado** — MP congelada na geração de DRAFT; snapshots PUBLISHED imutáveis. |
| **R3** | **Preço publicado não muda automaticamente** — `PriceTableItem.salePrice` só muda com nova versão publicada. |
| **R4** | **Pedido usa custo publicado** — margem/comissão resolvem `ProductionCostTable` vigente em `SalesOrder.issueDate` (`VERSIONED_PRODUCTION_COST`). |
| **R5** | **SalesOrderItem.unitCost não é custo industrial** — espelho comercial/Nomus; nunca fonte de margem oficial. |
| **R6** | **Componente vendido precisa de custo oficial** — mesmo fluxo `Product` + `ProductionCostTableItem`. |
| **R7** | **Custo faltante = pendência** — `SEM_CUSTO` / `MISSING_COST`; nunca inserir linha com custo zero silencioso na tabela publicada. |
| **R8** | **Um motor** — `getProductCostAnalysis`; extensões via parâmetros (ex.: catálogo MP), não fork. |
| **R9** | **Correção = nova revisão** — não editar PUBLISHED; incrementar `revision` / `versionNumber`. |
| **R10** | **BOM Nomus intacta** — sync/aplicação de BOM não deve ser alterado por esta sequência. |

---

## 5. Referências de código

| Área | Arquivos principais |
|------|---------------------|
| Motor | `src/lib/productCostAnalysisEngine.server.ts` |
| Custo oficial | `src/lib/productOfficialFinalCost.ts`, `src/lib/productionCostPublication.server.ts` |
| Versionamento produção | `src/lib/productionCostVersioning.ts`, `src/lib/productionCostTables.server.ts` |
| Preço | `server.ts` (rotas price-table), `PricingModule.tsx`, `SettingsModule.tsx` |
| Margem + referência comercial | `src/lib/salesOrderMarginService.server.ts`, `src/lib/salesOrderMarginOfficialPrice.ts` |
| Auditoria integrada | `src/lib/costPriceMarginIntegratedAudit.server.ts`, `scripts/audit-cost-price-margin-integration.ts` |
| MP versionada | `src/lib/materialCostPublication.server.ts`, `src/lib/materialCostTables.server.ts` |
| Preço ← produção | `src/lib/priceTablePublication.server.ts`, `src/lib/priceTableProductionCostResolver.ts` |
| Elegibilidade | `src/lib/productEngineeringCostSnapshot.ts` (`PRODUCT` + `COMPONENT`) |
| Testes baseline | `src/lib/versionedCostArchitectureBaseline.test.ts` |

---

## 6. Validação contínua

Scripts/npm recomendados antes de cada fase:

```bash
npm run test:versioned-cost-baseline
npm run test:material-cost-tables
npm run test:production-cost-tables
npm run test:price-table-publication
npm run test:sales-orders-margins
npm run test:cost-price-margin-audit
npm run test:cost-price-margin-flow
npm run build
npm run check:frontend-server-imports
```

Auditoria read-only em produção (quando aplicável):

```bash
npx tsx scripts/audit-production-cost-versioning.ts
npx tsx scripts/audit-sales-order-effective-cost.ts
npx tsx scripts/bootstrap-production-cost-table-from-engineering.ts --preview
npm run audit:cost-price-margin-integration -- --year=2026 --month=7
```

---

## 8. Auditoria integrada (MP → produção → preço → margem)

Ferramenta read-only que consolida cobertura e pendências sem alterar cálculos, versões publicadas ou sync Nomus.

### Como rodar

**Script CLI** (requer `DATABASE_URL`):

```bash
# Mês corrente / período
npm run audit:cost-price-margin-integration -- --year=2026 --month=7

# Filtros opcionais
npm run audit:cost-price-margin-integration -- --year=2026 --month=7 --seller=João --customer=ACME --sku=80001 --top=20

# Somente JSON (CI / integração)
npm run audit:cost-price-margin-integration -- --year=2026 --json
```

**API** (autenticada):

```
GET /api/cost-price-margin/audit?year=2026&month=7&top=10
GET /api/cost-price-margin/audit?from=2026-07-01&to=2026-07-31
```

**UI:** módulo Precificação → seção **Auditoria de Custo, Preço e Margem**.

### O que é medido

| Bloco | Fonte | Regra |
|-------|-------|-------|
| Cobertura MP | `getEffectiveMaterialCost` | Material ACTIVE com landed cost publicado > 0 na data de referência (fim do período) |
| Custo produto/componente | `getEffectiveProductProductionCosts` | Product ACTIVE com `unitProductionCost` publicado > 0 |
| Preço oficial | `PriceTableVersion` PUBLISHED + `PriceTableItem` | Pelo menos uma tabela ACTIVE com `salePrice` > 0 |
| Margem vendida | Motor `calculateSalesOrderMarginsForOrders` | Custo = produção publicada na `issueDate`; nunca `SalesOrderItem.unitCost` |

### Pendências detectadas

| Código | Significado | Gravidade |
|--------|-------------|-----------|
| `MATERIAL_SEM_CUSTO_PUBLICADO` | Material ACTIVE sem MP publicada vigente | Alta — bloqueia nova produção |
| `PRODUTO_SEM_CUSTO_PUBLICADO` | Produto ACTIVE sem custo de produção publicado | Alta |
| `COMPONENTE_SEM_CUSTO_PUBLICADO` | Componente ACTIVE sem custo publicado | Alta — impacta venda direta |
| `PRODUTO_SEM_PRECO_OFICIAL` | Produto sem item em tabela comercial publicada | Média |
| `COMPONENTE_SEM_PRECO_OFICIAL` | Componente sem preço oficial | Média |
| `ITEM_VENDIDO_SEM_CUSTO` | Item vendido no período com margem `SEM_CUSTO` | Crítica |
| `ITEM_VENDIDO_SEM_PRECO_TABELA` | Pedido sem proposta/tabela vinculada | Informativa (margem realizada OK) |
| `ITEM_VENDIDO_PRECO_INDISPONIVEL` | Tabela vinculada, mas sem `PriceTableItem` vigente | Média |
| `MARGEM_OUTROS_PROBLEMAS` | `SEM_PRODUTO`, receita inválida, etc. | Variável |

Custo zero **nunca** conta como OK — alinhado às regras R7 e resolvers (`unitProductionCost` / `landedCostSnapshot` > 0).

### Ordem recomendada de correção

1. **MP publicada** — gerar/publicar `MaterialCostTableVersion` para materiais ACTIVE pendentes.
2. **Custo de produção** — DRAFT a partir de MP congelada → publicar `ProductionCostTableVersion` (produtos e componentes vendidos).
3. **Preço comercial** — DRAFT a partir de produção publicada → publicar `PriceTableVersion`.
4. **Pedidos SEM_CUSTO** — priorizar SKUs do top vendidos; publicar custo retroativo **não recalcula passado** automaticamente — nova revisão vigente na `issueDate` do pedido.
5. **SEM_PRECO_TABELA** — vincular proposta/pedido à tabela comercial ou aceitar como referência ausente (margem realizada permanece).

### Validação

```bash
npm run test:cost-price-margin-audit
npm run test:cost-price-margin-flow
npm run test:sales-orders-margins
npm run build
```

### Fluxo ponta a ponta validado (E2E service)

Testes em `src/lib/costPriceMarginFlow.server.test.ts` (`npm run test:cost-price-margin-flow`):

| Cenário | O que valida |
|---------|----------------|
| **A — Produto** | MP publicada → DRAFT/publish produção → DRAFT/publish preço → margem OK com `VERSIONED_PRODUCTION_COST` e referência comercial |
| **B — Componente** | Componente ACTIVE no DRAFT de produção e preço; margem e preço oficial |
| **C — Mudança MP viva** | `Material.currentCost` alterado não muda snapshot publicado, custo produção ou preço congelado; nova publicação gera nova realidade |
| **D — Mudança BOM** | Motor retorna custo maior no novo DRAFT; pedido na vigência antiga mantém custo publicado |
| **E — Pendências** | Item sem custo → `SEM_CUSTO` (nunca zero); componente sem custo na geração de preço → `SEM_CUSTO_PRODUCAO_OFICIAL` |
| **Legado produção** | `ProductionCostTableVersion` sem `materialCostTableVersionId` ainda resolve margem |
| **Legado preço** | `PriceTableVersion` sem `productionCostTableVersionId` ainda legível por data |

Sequência oficial (não alterar ordem):

```
Material ACTIVE → MaterialCostTableVersion PUBLISHED
  → ProductionCostTableVersion DRAFT (MP congelada) → PUBLISHED
  → PriceTableVersion DRAFT (custo produção publicado) → PUBLISHED
  → SalesOrder.issueDate → margem realizada + referência preço tabela
```

---

## 9. Operação recomendada

### a) Matéria-prima publicada

**Onde:** Precificação → Custo oficial de matéria-prima (versionado)  
**Ação:** Gerar DRAFT → revisar → Publicar  
**Fonte:** materiais ACTIVE com `currentCost + freight` > 0 no cadastro  
**Pendência:** material sem custo válido é **ignorado** (não entra com zero)

### b) Custo de produção

**Onde:** Precificação → Custo oficial de produção (versionado)  
**Pré-requisito:** MP publicada vigente na data escolhida  
**Ação:** Gerar DRAFT (produtos **e** componentes) → Publicar  
**Fonte:** motor + catálogo MP congelado (não `Material.currentCost` vivo)  
**Pendência:** produto/componente sem engenharia ou motor FAIL → skip com erro explícito

### c) Preço comercial

**Onde:** Precificação → Geração comercial / Configurações → Tabelas de preço  
**Pré-requisito:** custo de produção publicado vigente  
**Ação:** Gerar DRAFT → Publicar com vigência  
**Fonte:** `ProductionCostTableItem` publicado (produtos e componentes)  
**Pendência:** `SEM_CUSTO_PRODUCAO_OFICIAL` — item não entra na tabela

### d) Auditoria de margem

**Onde:** Precificação → Auditoria de Custo, Preço e Margem  
**Script:** `npm run audit:cost-price-margin-integration -- --year=YYYY --month=M`  
**Ordem de correção:** MP → produção → preço → pedidos SEM_CUSTO

### BOM atualizada

- Custo/preço **já publicados** não mudam.
- Gere **nova revisão** DRAFT de produção (reflete BOM viva + MP publicada vigente).
- Publique nova versão; margem de pedidos futuros usa nova vigência por `issueDate`.

### Material sem custo

- Corrija cadastro `Material` (currentCost/freight).
- Gere nova revisão MP → produção → preço.

### Componente sem engenharia

- Complete BOM/roteiro no cadastro de produto.
- Regenerar DRAFT de produção incluindo escopo PRODUCT_AND_COMPONENT.
- Se vendido sem custo: margem fica **SEM_CUSTO** até publicação.

---

## 7. Histórico

| Data | Alteração |
|------|-----------|
| 2026-07-02 | Baseline inicial + testes de caracterização (Fase 0) |
| 2026-07-02 | Auditoria integrada MP/produção/preço/margem — script, API e UI |
| 2026-07-02 | Testes E2E service `costPriceMarginFlow.server.test.ts` — fluxo ponta a ponta |
| 2026-07-02 | Hardening: doc final, fallback vivo desabilitado por padrão, script margem alinhado |
