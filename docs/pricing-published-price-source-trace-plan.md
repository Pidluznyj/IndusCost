# Plano: rastreabilidade completa do preço publicado

> **Projeto:** IndusCost / My Industry  
> **Tela:** Formação de Preço → Modal → aba **Fonte do Preço**  
> **Data:** 2026-07-06

---

## O que já existe hoje (reaproveitado)

| Entidade / campo | Disponível na publicação? | Uso na aba Fonte do Preço |
|------------------|---------------------------|---------------------------|
| `PriceTable` (code, name) | Sim | Tabela comercial |
| `PriceTableVersion` (versionNumber, publishedAt, effectiveFrom, taxRuleId, productionCostTableVersionId, commissionPerc) | Sim | Versão, vigência, comissão da versão |
| `PriceTableItem.salePrice`, custos congelados (MP/HH/HM/tax/other), marginPct, commissionPerc/Value | Sim | Preço, custo usado, deduções |
| `PriceTableItem.costSnapshotJson` | Sim (itens gerados pelo fluxo atual) | Versão/item de custo de produção, unitProductionCost, breakdown |
| `PriceTableItem.formulaSnapshotJson` | Sim | taxRuleId, taxRate, commissionRate, marginPct, freight, productionCost refs |
| `ProductionCostTableVersion` (via FK ou snapshot) | Parcial | Nome, code, revision, effectiveDate |
| `ProductionCostTableItem` (via costSnapshotJson.productionCostTableItemId) | Parcial | Detalhe do item de custo usado |
| `MaterialCostTableVersion` (via ProductionCostTableVersion.materialCostTableVersionId) | Parcial | Versão MP vinculada à versão de produção |
| `TaxRule.name` (via PriceTableVersion.taxRuleId) | Sim | Nome da regra fiscal |
| Markup | Derivável | `salePrice / frozenTotalCost` (valores congelados) |

**Endpoint existente reutilizado como base:**  
`GET /api/price-tables/:tableId/products/:productId/published-price` (modal já consome).

**Novo endpoint read-only:**  
`GET /api/pricing/published-price-source-trace?priceItemId=...`

**Service:** `buildPublishedPriceSourceTrace` em `publishedPriceSourceTrace.server.ts`

---

## O que ainda NÃO está congelado por item

| Campo desejado | Situação | Fallback na UI |
|----------------|----------|----------------|
| `marginRuleId` / nome de regra de margem | Não existe entidade separada | "Não disponível nesta versão publicada" |
| `managerialCost` / OPEX | Não congelado no item | Indisponível |
| `roundingAmount` | Não persistido | Indisponível |
| Explosão MP/BOM por material | Não no PriceTableItem | Apenas total MP congelado |
| `sourceTaxRuleSnapshotJson` dedicado | Parcial (formulaSnapshot.rates) | Taxa e valor de imposto congelados |
| Vínculo MP item-a-item | Não no snapshot comercial | Versão MP da produção, se FK existir |

---

## Migration futura recomendada (não implementada nesta etapa)

Gravar em `PriceTableItem` no momento da publicação:

- `sourceProductionCostTableVersionId` (redundante controlado)
- `sourceProductionCostTableItemId`
- `sourceMaterialCostTableVersionId`
- `sourceTaxRuleSnapshotJson`
- `sourceMarginSnapshotJson`
- `sourceCommissionSnapshotJson`
- `sourceCostBreakdownSnapshotJson`
- `sourceCalculationSnapshotJson`

Isso permitiria rastreabilidade 100% histórica mesmo se versões de custo forem arquivadas ou renomeadas.

---

## Regras implementadas

1. **Sem recálculo** — a aba lê apenas colunas congeladas + JSON snapshots + joins de referência.
2. **Sem inventar** — campos ausentes exibem *"Não disponível nesta versão publicada"*.
3. **Aviso de custo mais recente** — compara revisão publicada usada vs. última `PUBLISHED` do mesmo `code` de custo de produção.
4. **Clique na célula** — abre modal na aba **Fonte do Preço**; clique na linha mantém **Resumo**.

---

## API

```
GET /api/pricing/published-price-source-trace
  ?priceItemId=<uuid>   (obrigatório)
  &tableId=<uuid>       (opcional, validação)
  &versionId=<uuid>     (opcional, validação)
  &productId=<uuid>     (opcional, validação)
```

Permissão: `pricing.view`
