# Diagnóstico — Margem e formação de preço (pré-implementação Pedidos de Venda)

**Data:** 2026-06-24  
**Escopo:** Mapeamento de fórmulas, fontes de custo e campos comerciais. **Sem implementação** de margem em PV.

**Documentos relacionados:** `docs/products/PRODUCT_FINAL_COST_SOURCE.md`, `docs/projects/PROJECT_PRICING.md`, `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`

---

## 1. Fórmula atual usada na precificação

O sistema usa **dois modos conceituais distintos**, conforme o contexto:

### 1.1 Formação de preço (prospectivo — “quanto cobrar?”)

**Modelo canônico:** *markup divisor* com percentuais **sobre o preço de venda (PV)**.

```text
PV = (CIU + frete_fixo) ÷ (1 − i − c − o − m)

Onde (frações sobre PV):
  i = impostos (TaxRule / TaxComponent)
  c = comissão (ProductPricing.commission)
  o = outras variáveis % (ProductPricing.otherVariables)
  m = margem desejada (ProductPricing.desiredMargin)
  CIU = totalIndustrialCost = MP + HH + HM (custo industrial unitário oficial)
```

**Implementações equivalentes:**

| Arquivo | Função |
|---------|--------|
| `src/lib/pricingCalculations.ts` | `calculateSalePriceFromCost` — versão **simplificada** (só imposto + margem) |
| `src/lib/simulationFormula.ts` | `priceFromCostAndMargin` — versão **completa** (+ comissão, outros, frete no numerador) |
| `src/lib/pricingOpenBook.ts` | `projectSuggestedPrice`, `priceDivisorFromPremissas` |
| `server.ts` | `GET /api/pricing`, `GET /api/pricing/:productId/:taxRuleId/calculate`, `GET /api/products/:id/pricing-snapshot` |

**Derivações a partir do PV formado:**

```text
imposto_R$     = PV × i
comissão_R$    = PV × c
margem_R$_meta = PV × m          ← margem-alvo na formação (não é margem realizada)
markup_sobre_CIU = PV ÷ CIU      (documentado em pricingUnitCalculationBreakdown)
fator_sobre_(CIU+F) = PV ÷ (CIU + frete)
```

**Margem de contribuição na simulação unitária** (`server.ts` + `buildPricingUnitCalculationBreakdown`):

```text
contributionMargin = PV − impostos − comissão − frete − CIU
operationalMargin  = contributionMargin − OPEX_unitário
```

### 1.2 Proposta comercial (retrospectivo — “quanto sobrou na linha negociada?”)

Em `ProposalModule.tsx` → `recomputeItemDerivedFields` (espelhado em `proposalLineExplain.ts`):

```text
bruto   = quantidade × preço_negociado
líquido = bruto − desconto
impostos_R$   = líquido × taxesPerc
comissão_R$   = líquido × commissionPerc
custo_total   = quantidade × unitCost

marginValue = líquido − impostos − comissão − frete − custo_total
marginPerc  = marginValue ÷ líquido × 100   (se líquido > 0)
```

Aqui a margem % é **sobre o líquido da linha**, mas o valor em R$ **desconta** impostos, comissão e frete antes de comparar com o custo.

### 1.3 Projetos — precificação comercial

`src/lib/projectsPricing.ts` → `computeProjectPricingItem` chama `calculateSalePriceFromCost` com:

- **Custo:** `finalUnitCost` = base + amortização de projeto (`resolveProjectPricingItemCosts`)
- **Imposto + margem** sobre PV (sem comissão/frete/outros na v1 de projeto)

Ver `docs/projects/PROJECT_PRICING.md`.

### 1.4 Simulações / sandbox

- `SimulationModule` + `simulationFormula.ts` — mesma fórmula divisor completa.
- `newProductSandbox.ts` — `priceFromCostAndMargin` / `marginFromCostAndTargetPrice` com premissas zeradas (só margem).

---

## 2. Funções atuais encontradas

### Preço de venda (formação)

| Função | Arquivo | Uso |
|--------|---------|-----|
| `calculateSalePriceFromCost` | `pricingCalculations.ts` | Projetos, testes, motor compartilhado simplificado |
| `priceFromCostAndMargin` | `simulationFormula.ts` | Simulações, sandbox produto novo |
| `projectSuggestedPrice` | `pricingOpenBook.ts` | Open book / sensibilidade |
| Inline `suggestedPrice = (ciu + freight) / divisor` | `server.ts` | API formação de preço, listagem, snapshot |

### Margem

| Função / local | Tipo | Fórmula |
|----------------|------|---------|
| `calculateSalePriceFromCost` → `marginAmount` | Alvo na formação | `PV × m` |
| `server.ts` calculate endpoint → `contributionMargin` | Pós-formação | `PV − imp − com − frete − CIU` |
| `marginFromCostAndTargetPrice` | Inversa | resolve `m` dado PV alvo |
| `recomputeItemDerivedFields` | Proposta | líquido − deduções − custo |
| `buildPricingUnitCalculationBreakdown` | Documentação UI | estrutura `margin.basis = "SALE_PRICE"` |

### Markup

| Representação | Onde |
|---------------|------|
| Divisor `1 − Σ%` | Todas as formações |
| `priceOverIndustrialCost` = PV/CIU | `pricingUnitCalculationBreakdown.ts` |
| `factorOnCostPlusFreight` = PV/(CIU+F) | idem |
| **Não** usa `PV = CIU × (1 + markup%)` como regra principal | explicitamente proibido em `PROJECT_PRICING.md` |

### Custo do produto

| Função | Arquivo | Papel |
|--------|---------|-------|
| `getProductCostAnalysis` | `server.ts` | Motor runtime MP+HH+HM recursivo na BOM |
| `resolveOfficialProductFinalCostFromAnalysis` | `productOfficialFinalCost.ts` | Leitor canônico de `totalIndustrialCost` |
| `extractOfficialProductFinalUnitCost` | idem | Atalho numérico |
| `buildCurrentCostSnapshotFromAnalysis` | `productCostSnapshot.ts` | Snapshot para impacto BOM Nomus |
| `costRollup.ts` | agregação MP/HH/HM filhos | Peça do motor |
| `openBookMaterialExplosion.ts` | explosão MP open book | Composição para formação de preço |
| `computeProductSimulationCostAnalysis` | `projectsProductSimulationCost.ts` | Custo simulado em projeto (oficial + deltas) |
| `getProjectsProductCostResolver` | `projectsProductCostResolver.ts` | Ponte server → motor oficial em projetos |

### Composição / breakdown (não recalculam preço)

| Função | Arquivo |
|--------|---------|
| `buildPricingUnitCalculationBreakdown` | `pricingUnitCalculationBreakdown.ts` |
| `simulatePricingOpenBookSensitivity` | `pricingOpenBook.ts` |

### UI

| Componente | Papel |
|------------|-------|
| `PricingModule.tsx` | Formação de preço + simulação unitária |
| `PricingDetailedCompositionTab.tsx` | Exibe breakdown markup/margem |
| `OpenBookCompositionTab.tsx` | Composição MP open book |
| `ProposalModule.tsx` | Margem líquida por linha de proposta |
| `ProjectPricingSection.tsx` | Precificação de projeto |

---

## 3. Campos de custo encontrados

### Runtime (oficial engenharia)

| Campo | Origem | Persistido? |
|-------|--------|-------------|
| `totalIndustrialCost` | `getProductCostAnalysis` | **Não** em `Product` — calculado |
| `totalMaterialCost`, `totalHH_Unit`, `totalHM_Unit` | idem | Runtime |
| `totalCIF_Unit`, `totalOPEX_Unit` | idem | Informativo / margem operacional |
| `costAnalysisPartial` | idem | Flag de parcialidade |

Fonte canônica documentada: `docs/products/PRODUCT_FINAL_COST_SOURCE.md` → `PRODUCT_ENGINEERING_FINAL_COST`.

### Persistidos (snapshots / histórico)

| Modelo / campo | Significado |
|----------------|-------------|
| `CostCalculationLog.totalCiu`, `suggestedPrice`, `inputSnapshot` | Log histórico de cálculo por produto |
| `PriceTableItem.frozenTotalCost` (+ MP/HH/HM congelados) | Tabela de preço publicada |
| `PriceTableItem.costSnapshotJson` | JSON do motor no momento da publicação |
| `ProposalItem.unitCost` | CIU no momento da proposta |
| `SalesOrderItem.unitCost` | Campo existe; sync Nomus grava **0** hoje |
| `ProjectStructureLine.unitCostSnapshot`, `officialUnitCostSnapshot` | Snapshot de projeto |
| `ProjectPricingItem.finalUnitCostSnapshot` | Custo usado na precificação do projeto |
| `NewProductSimulation.snapshot` (JSON) | Custo congelado de simulação sandbox |

**Não existe** modelo `ProductCostSnapshot` nem `ProductOfficialFinalCost` no Prisma — o custo oficial é **sempre derivado do motor**, exceto quando explicitamente congelado em entidades acima.

### Tipos de custo (resumo)

| Tipo | Quando | Usar para margem PV? |
|------|--------|----------------------|
| Oficial engenharia (`totalIndustrialCost`) | Produto cadastrado, motor atual | **Sim — recomendado** para PV Nomus |
| Congelado tabela (`frozenTotalCost`) | Item veio de tabela publicada | Opcional se rastreabilidade exigir preço da época |
| Proposta / PV gravado (`SalesOrderItem.unitCost`) | Histórico | Preservar se já preenchido; hoje zerado no sync |
| Projeto / simulação | Cenários what-if | **Não** para PV Nomus |

---

## 4. Campos de preço vendido encontrados

### `SalesOrder` (cabeçalho)

| Campo | Significado |
|-------|-------------|
| `totalGrossValue` | Bruto (sync Nomus: hoje = `valorTotal` do pedido) |
| `totalDiscount` | Desconto agregado |
| `totalNetValue` | **Receita líquida do pedido** (principal para métricas) |
| `totalCost`, `totalMarginValue`, `totalMarginPerc` | Existem; sync Nomus preenche custo **0** e margem **100% placeholder** |

### `SalesOrderItem` (linha)

| Campo | Significado |
|-------|-------------|
| `negotiatedPrice` | Preço unitário (`valorUnitario` Nomus) |
| `quantity` | Quantidade |
| `totalNetValue` | **Receita líquida da linha** |
| `unitCost`, `totalCost` | Custo unitário/total — **0 no sync atual** |
| `marginValue`, `marginPerc` | **Placeholder** no sync (`marginValue = totalNetValue`, `marginPerc = 100`) |

### Origem Nomus (`scripts/nomusSalesOrdersSyncV1.ts`)

```text
calculateItemNetValue(item):
  computed = quantidade × valorUnitario − valorDesconto + valorAcrescimo
  se valorTotal | valorTotalItem | valorLiquido > 0 → usa explícito
  senão → computed

negotiatedPrice = valorUnitario
totalNetValue   = calculateItemNetValue(item)   ← receita líquida da linha
```

### Proposta (referência legada)

`ProposalItem`: `negotiatedPrice`, `discountValue`, `totalNetValue` implícito via `recomputeItemDerivedFields`, `marginValue`, `marginPerc`.

---

## 5. Respostas às 15 perguntas obrigatórias

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Qual função calcula preço de venda? | **`priceFromCostAndMargin`** (completa) e **`calculateSalePriceFromCost`** (simplificada); APIs em **`server.ts`** replicam a fórmula inline. |
| 2 | Qual função calcula margem? | **Formação:** `marginAmount = PV × m` em `calculateSalePriceFromCost`; **realizada em proposta:** `recomputeItemDerivedFields`; **inversa:** `marginFromCostAndTargetPrice`. |
| 3 | Qual função calcula markup? | Não há `calculateMarkup()` isolada. Markup = **divisor** `1−Σ%` e quocientes **`PV/CIU`** em `buildPricingUnitCalculationBreakdown`. |
| 4 | Fórmula exata de margem hoje? | **Formação (alvo):** `m%` sobre PV → `margem_R$ = PV × m/100`. **Proposta (realizada):** `marginValue = líquido − imp − com − frete − qtd×CIU`; `marginPerc = marginValue/líquido×100`. |
| 5 | Margem sobre preço, custo ou markup? | **Formação:** margem **sobre preço** (não markup aditivo). **Markup** aparece como divisor/fator, não como `custo×(1+m)`. |
| 6 | Campo custo oficial final? | **`totalIndustrialCost`** (CIU = MP+HH+HM), lido via **`resolveOfficialProductFinalCostFromAnalysis` → `finalUnitCost`**. |
| 7 | Salvo em tabela ou runtime? | **Runtime** pelo motor. Congelamentos em `PriceTableItem`, `ProposalItem`, `CostCalculationLog`, linhas de projeto. |
| 8 | Snapshot histórico? | **Sim:** `CostCalculationLog`, `PriceTableItem.*`, `ProjectStructureLine.*Snapshot`, `NewProductSimulation.snapshot`. |
| 9 | Custo por data? | **Não** como série temporal nativa. `CostCalculationLog.calculatedAt` é o registro mais próximo; motor sempre usa cadastro **atual**. |
| 10 | Custo aprovado/final/oficial? | **Sim — conceito `PRODUCT_ENGINEERING_FINAL_COST`**, sem flag “aprovado” separada; parcialidade via `costAnalysisPartial`. |
| 11 | Diferença estimado / oficial / simulação? | **Oficial** = motor engenharia; **Simulação** = sandbox/ajustes what-if; **Projeto** = oficial + deltas + amortização; **Tabela** = congelado na publicação. |
| 12 | Custo para margem de PV Nomus? | **`totalIndustrialCost` atual** via `getProductCostAnalysis` / `extractOfficialProductFinalUnitCost`, resolvido por `productId` da linha. Não usar custo 0 do sync. |
| 13 | Funções reutilizáveis? | **`productOfficialFinalCost.ts`**, **`pricingCalculations.ts`** (helpers), padrão numérico de **`proposalLineExplain`** para margem realizada; criar função pura nova `salesOrderLineMargin` alinhada à regra abaixo. |
| 14 | Não reutilizar? | **`projectsProductSimulationCost`**, **`newProductSimulationSnapshot`**, **`projectsPricing.computeProjectPricingItem`** (formação prospectiva), **`simulateScenarioFromBreakdown`** (cenários). |
| 15 | Campos preço líquido vendido? | **Linha:** `SalesOrderItem.totalNetValue` (e `negotiatedPrice`×`quantity` como componentes). **Pedido:** `SalesOrder.totalNetValue`. |

---

## 6. Confronto com a regra conceitual desejada para PV

Regra desejada pelo negócio:

```text
Receita líquida = preço líquido vendido
Custo           = custo oficial conhecido do produto
Margem R$       = Receita líquida − Custo
Margem %        = Margem R$ / Receita líquida
Markup          = Receita líquida / Custo
```

### O que bate

- **Margem % sobre receita líquida** — alinhado ao denominador de `marginPerc` em propostas (`marginValue / líquido`).
- **Custo oficial CIU** — alinhado a `PRODUCT_ENGINEERING_FINAL_COST`.
- **Markup como quociente receita/custo** — coerente com `priceOverIndustrialCost`, porém a formação de preço usa markup **divisor**, não esse quociente como entrada.

### O que NÃO bate (divergências explícitas)

| Aspecto | Formação de preço | Regra desejada PV |
|---------|-------------------|-------------------|
| Direção | Prospectiva (custo → PV) | Retrospectiva (PV vendido → margem) |
| Margem R$ | `PV × m%` (parcela do preço) | `receita_líquida − custo_total_linha` |
| Deduções | Imposto/comissão/frete entram no divisor ou na margem de contribuição | **Não** deduz impostos/comissão na regra desejada |
| Custo na linha | Unitário CIU × quantidade | Igual, mas sync Nomus **não preenche** hoje |
| Proposta atual | `marginValue` desconta imp/com/frete | Regra desejada é **mais simples** (só custo industrial) |

**Conclusão:** A margem de Pedidos de Venda deve seguir o **espírito da margem realizada** (proposta/CRM), usando **CIU oficial** como custo, mas com fórmula **simplificada** igual à regra desejada — **não** reutilizar literalmente `calculateSalePriceFromCost` (que é formação prospectiva) nem `contributionMargin` do endpoint de pricing (que desconta impostos/comissão/frete).

**Recomendação de alinhamento conceitual:** tratar como **margem bruta industrial sobre receita líquida da linha**, análoga à proposta **sem** deduzir impostos/comissão/frete do `marginValue`, ou documentar conscientemente se o negócio preferir a fórmula completa de `ProposalModule`.

---

## 7. Decisão recomendada para margem de Pedidos de Venda

1. **Receita:** `SalesOrderItem.totalNetValue` (já calculado no sync Nomus).
2. **Custo unitário:** `extractOfficialProductFinalUnitCost(getProductCostAnalysis(productId))` no momento do cálculo/enriquecimento.
3. **Custo linha:** `unitCost × quantity` (gravar em `unitCost` / `totalCost` ao enriquecer).
4. **Margem:**
   ```text
   marginValue = totalNetValue − totalCost
   marginPerc  = totalNetValue > 0 ? (marginValue / totalNetValue) × 100 : 0
   markup      = totalCost > 0 ? totalNetValue / totalCost : null
   ```
5. **Função nova sugerida:** `src/lib/salesOrderLineMargin.ts` (pura, testável) — **não** misturar com `calculateSalePriceFromCost`.
6. **Reutilizar:** `productOfficialFinalCost.ts` para obter CIU; padrão de arredondamento de `roundPricingMoney` ou `roundProjectMoney`.
7. **Agregação pedido:** somar `marginValue`, recalcular `totalMarginPerc` = `Σ marginValue / totalNetValue × 100`.

---

## 8. Riscos e pontos de atenção

| Risco | Detalhe |
|-------|---------|
| Sync Nomus com margem fictícia | `unitCost=0`, `marginPerc=100%` — qualquer dashboard que confie nesses campos hoje está **errado**. |
| Custo parcial | `costAnalysisPartial=true` — exibir aviso; não tratar como custo fechado. |
| Produto sem engenharia | CIU indisponível → margem indeterminada; não usar zero silencioso. |
| Performance | `getProductCostAnalysis` por linha é pesado — cache por `productId` no job de enriquecimento. |
| Divergência proposta × PV | Proposta deduz impostos/comissão/frete; regra desejada não — **alinhar com negócio** antes de implementar. |
| Divergência formação × realizada | Formação usa margem **alvo** sobre PV; PV usa margem **realizada** — são métricas diferentes. |
| Histórico | Recalcular com CIU **atual** altera margem de pedidos antigos — considerar snapshot de custo na linha se auditoria exigir. |
| Tabela de preço | Pedido pode não ter vindo de tabela; `frozenTotalCost` só aplica se houver rastreio. |

---

## 9. Próximos passos (fora deste diagnóstico)

1. Validar com negócio: margem PV = **só CIU** ou **margem de contribuição** (como proposta)?
2. Criar `salesOrderLineMargin.ts` + testes unitários.
3. Job/API de enriquecimento pós-sync Nomus (sem alterar payload Nomus).
4. Atualizar `nomusSalesOrdersSyncV1.ts` ou pipeline separado para popular `unitCost`/`margin*`.
5. Revisar consumidores: `customerIntelligenceProducts`, CRM dashboards, `SalesOrdersModule`.
6. UI: exibir margem com tooltip de fórmula e flag “custo parcial / indisponível”.

---

## 10. Arquivos analisados

```text
src/lib/pricingCalculations.ts
src/lib/pricingCalculations.test.ts
src/lib/projectsPricing.ts
src/lib/projectsPricing.test.ts
src/lib/projectsCalculations.ts
src/lib/projectsProductCostResolver.ts
src/lib/projectsProductSimulationCost.ts
src/lib/productOfficialFinalCost.ts
src/lib/productCostSnapshot.ts
src/lib/productCostSummaryView.ts
src/lib/costRollup.ts
src/lib/openBookMaterialExplosion.ts
src/lib/pricingOpenBook.ts
src/lib/pricingUnitCalculationBreakdown.ts
src/lib/simulationFormula.ts
src/lib/newProductSandbox.ts
src/lib/proposalLineExplain.ts
src/components/ProposalModule.tsx
src/components/PricingModule.tsx
src/components/pricing/PricingDetailedCompositionTab.tsx
src/components/product/OpenBookCompositionTab.tsx (referenciado)
src/components/projects/ProjectPricingSection.tsx (referenciado)
scripts/nomusSalesOrdersSyncV1.ts
server.ts (trechos pricing, cost-analysis, pricing-snapshot)
prisma/schema.prisma (ProductPricing, SalesOrder, SalesOrderItem, PriceTableItem, CostCalculationLog, Project*)
docs/products/PRODUCT_FINAL_COST_SOURCE.md
docs/projects/PROJECT_PRICING.md
docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md
```
