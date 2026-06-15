# Fonte oficial do custo final de produto

**Versão:** 1.0  
**Módulo:** Engenharia de Produtos → consumo transversal

## 1. Fonte oficial

O custo final unitário oficial de um produto cadastrado é o **CIU (Custo Industrial Unitário)** calculado pelo motor `getProductCostAnalysis` em `server.ts`, exposto na aba **Engenharia de Produtos → Análise de Custo / Composição**.

```text
totalIndustrialCost = MP + HH + HM
```

Camada canônica de leitura (aplicação):

```text
src/lib/productOfficialFinalCost.ts
  → resolveOfficialProductFinalCostFromAnalysis()
  → extractOfficialProductFinalUnitCost()
```

**Source constant:** `PRODUCT_ENGINEERING_FINAL_COST`

## 2. Três tipos de custo no sistema

| Tipo | Quando usar | Persistência |
|------|-------------|--------------|
| **Oficial (engenharia)** | Precificação ao vivo, proposta nova, dashboard, relatórios atuais | Calculado — não coluna em `Product` |
| **Projeto** | Estrutura simulada, custos guiados, amortização | `ProjectStructureLine.unitCostSnapshot`, versões |
| **Simulação** | Sandbox de produto novo / cenário what-if | JSON em `NewProductSimulation`, ajustes em `Simulation` |

## 3. Onde usar custo final da Engenharia

- `GET /api/products/:id/cost-analysis`
- `GET /api/products/:id/pricing-snapshot` (campo `unitCost`)
- `GET /api/products?cost=1` (grid CIU)
- Formação de Preço (`/api/pricing`, `/api/pricing/*/calculate`, simulações unitárias/lote)
- Tabelas de preço — **geração** de draft (`frozenTotalCost` a partir do motor)
- Proposta — inclusão de item **sem** tabela congelada (via `pricing-snapshot`)
- Relatórios com custo **atual** do produto
- Importação **inicial** de produto oficial em projeto (snapshot inicial apenas)

## 4. Onde preservar snapshot (não sobrescrever)

- `ProposalItem.unitCost` já gravado
- `SalesOrderItem.unitCost` / sync Nomus histórico
- `PriceTableItem.frozenTotalCost` publicado
- Linhas e versões de **Projeto** após importação
- **Simulação** salva (`NewProductSimulation.snapshot`, `Simulation` legacy)
- Relatórios já emitidos com valores históricos

## 5. Diagnóstico quando não há custo final

Códigos retornados por `resolveOfficialProductFinalCostFromAnalysis`:

| Código | Significado |
|--------|-------------|
| `CUSTO_OFICIAL_NAO_CALCULADO` | Análise ausente |
| `BOM_CYCLE` | Ciclo na BOM |
| `CONFIG_MISSING` | Parâmetros globais de custeio |
| `PRODUTO_SEM_ENGENHARIA` | Estrutura incompleta / filho órfão |
| `MOTOR_ERROR` | Outro erro do motor |
| `INVALID_COST_VALUE` | `totalIndustrialCost` ausente ou inválido |

O sistema **não** deve usar `costPerUnit` legado nem zero silencioso como substituto.

## 6. O que não é custo de produto

- `Material.currentCost` — insumo; alimenta o motor, não é CIU do produto pai
- `costPerUnit` em payloads antigos — **ignorado** pelo resolver canônico
- Campos financeiros AP/AR — módulo Financeiro, escopo separado
