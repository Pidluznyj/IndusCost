# Arquitetura: custo versionado, preço e margem

> **Baseline técnico** — documento de referência antes da sequência de implementação.  
> **Atualizado:** 2026-07-02  
> **Escopo:** matéria-prima, custo de produção, preço de venda, margem comercial.

---

## 1. Estado atual (as-is)

### Camadas existentes

| Camada | Entidades Prisma | Status |
|--------|------------------|--------|
| Matéria-prima | `Material`, `MaterialPriceHistory` | **Sem versionamento oficial** — motor usa `Material.currentCost + freight` (vivo) |
| Custo de produção | `ProductionCostTableVersion`, `ProductionCostTableItem` | **Implementado** — DRAFT / PUBLISHED / SUPERSEDED / ARCHIVED |
| Preço comercial | `PriceTable`, `PriceTableVersion`, `PriceTableItem` | **Implementado** — DRAFT / PUBLISHED / ARCHIVED |
| Margem pedido | — (motor puro + service) | **Usa custo de produção publicado** na `SalesOrder.issueDate` |

### Motor industrial (único)

- `getProductCostAnalysis` em `src/lib/productCostAnalysisEngine.server.ts`
- Custo oficial = **MP + HH + HM** (`totalIndustrialCost`)
- Resolução canônica: `resolveOfficialProductFinalCostFromAnalysis`

### Fluxos de geração hoje

```
Material.currentCost (vivo)
        ↓
getProductCostAnalysis
        ↓
┌───────────────────────────────┐     ┌──────────────────────────────┐
│ ProductionCostTable DRAFT     │     │ PriceTableVersion DRAFT      │
│ (PRODUCT + COMPONENT elegível)│     │ (somente PRODUCT)            │
│ congela snapshot por produto  │     │ usa motor VIVO na geração    │
└───────────────────────────────┘     └──────────────────────────────┘
        ↓ publish                           ↓ publish
   Margem / Comissão                   Preço congelado (salePrice)
   (custo publicado + receita real)
```

### Gaps conhecidos (baseline)

1. **Matéria-prima não versionada** — mudança de `currentCost` afeta próxima geração de DRAFT, não custo já publicado.
2. **Geração de preço usa custo vivo** — não consome `ProductionCostTableItem` publicado.
3. **Tabela de preço exclui COMPONENT** — só `Product.type = PRODUCT` no generate-draft.
4. **Componentes vendidos** — elegíveis no backend de custo de produção, mas cobertura publicada incompleta (cadastro/engenharia/UI).
5. **Parâmetros HH/HM globais** (`IndirectCost`) — vivos no momento do cálculo; não versionados.
6. **BOM Nomus** — viva; corretamente não altera snapshots publicados, mas altera novos DRAFTs.

---

## 2. Arquitetura desejada (to-be)

```
Suprimentos / compras
        ↓
MaterialCostTableVersion + MaterialCostTableItem   ← FASE 3 (não existe)
        ↓
getProductCostAnalysis(materialCatalog congelado)
        ↓
ProductionCostTableVersion (+ FK materialCostTableVersionId)   ← FASE 4
        ↓
PriceTableVersion (+ FK productionCostTableVersionId)          ← FASE 5
        ↓
Margem / decisão comercial (custo publicado + receita real)   ← FASE 6
```

Princípios:

- **Um motor** — sem duplicar `getProductCostAnalysis`.
- **Três congelamentos** — MP, produção, preço — cada um com DRAFT → PUBLISHED → revisão.
- **Resolver automático por data** — usuário não escolhe tabela por pedido (salvo auditoria).
- **Pendência explícita** — custo faltante = erro/SEM_CUSTO, nunca zero silencioso.

---

## 3. Ordem das fases

| Fase | Entrega | Schema? |
|------|---------|---------|
| **0 — Baseline** | Este doc + testes de caracterização + CI verde | Não |
| **1 — Auditoria/cobertura** | Dashboards/scripts de gap (produto/componente/MP) | Não |
| **2 — Componentes no custo publicado** | UI + universo + master data | Mínimo |
| **3 — MP versionada** | `MaterialCostTableVersion/Item` | Sim |
| **4 — Produção ↔ MP** | FK + motor lê catálogo congelado na geração | Sim |
| **5 — Preço desacoplado** | Preço a partir de produção publicada; incluir COMPONENT | Sim/leve |
| **6 — Margem enriquecida** | KPI desvio vs preço tabela (opcional) | Não |
| **7 — Testes + auditoria contínua** | Scripts CI, relatórios | Não |

**Fora de escopo desta sequência:** alterar sync BOM Nomus, recalcular passado automaticamente, segundo motor de custo.

---

## 4. Regras invioláveis

Estas regras são **travas de segurança** — qualquer PR da sequência deve respeitá-las.

| ID | Regra |
|----|-------|
| **R1** | **BOM viva não altera custo publicado** — `ProductionCostTableItem` de versão PUBLISHED/SUPERSEDED é imutável; mudança de BOM só impacta nova geração de DRAFT. |
| **R2** | **MP viva não altera custo publicado** — após Fase 3, MP congelada na geração; até lá, custo publicado permanece snapshot histórico. |
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
| Margem | `src/lib/salesOrderMarginResolver.ts`, `src/lib/salesOrderMarginService.server.ts` |
| Elegibilidade | `src/lib/productEngineeringCostSnapshot.ts` (`PRODUCT` + `COMPONENT`) |
| Testes baseline | `src/lib/versionedCostArchitectureBaseline.test.ts` |

---

## 6. Validação contínua

Scripts/npm recomendados antes de cada fase:

```bash
npm run test:versioned-cost-baseline
npm run test:production-cost-tables
npm run test:sales-orders-margins
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

## 7. Histórico

| Data | Alteração |
|------|-----------|
| 2026-07-02 | Baseline inicial + testes de caracterização (Fase 0) |
| 2026-07-02 | Auditoria integrada MP/produção/preço/margem — script, API e UI |
| 2026-07-02 | Testes E2E service `costPriceMarginFlow.server.test.ts` — fluxo ponta a ponta |
