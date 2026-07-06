# Gap técnico: detalhe publicado da Formação de Preço

## Contexto

O grid comercial (`CommercialPublishedPricesGrid`) exibe preços **congelados** de `PriceTableItem`.
Ao abrir o modal "Resultado da Formação de Preço" a partir de uma célula ou linha publicada, o detalhe deve refletir o **snapshot da publicação**, não uma simulação ao vivo.

## O que já é salvo na publicação (`PriceTableItem`)

| Campo | Salvo? | Uso no modal publicado |
| --- | --- | --- |
| Preço de venda (`salePrice`) | Sim | Valor principal exibido |
| Custo industrial (`frozenTotalCost`, MP/HH/HM) | Sim | Resumo de custos |
| Impostos (`frozenTaxCost`) | Sim | Dedução em valor |
| Comissão (`commissionPerc`, `commissionValue`) | Sim | Dedução em valor e % |
| Margem (`marginPct`) | Sim | Premissa publicada |
| Outras deduções (`frozenOtherCost`) | Sim (agregado) | Valor congelado, sem detalhamento |
| Taxas (`formulaSnapshotJson.rates`) | Sim | % de imposto, comissão, outras |
| Frete (`formulaSnapshotJson.freight`) | Sim | Dedução quando presente no snapshot |
| Markup | Não (derivável) | `salePrice / frozenTotalCost` a partir de valores congelados |
| Margem de contribuição / operacional | Não | Derivável parcialmente; OPEX não congelado |
| Composição MP/BOM detalhada | Não | Apenas totais MP/HH/HM |
| `pricingBreakdown` / open-book completo | Não | Abas de composição detalhada indisponíveis |

### Snapshots JSON

- **`costSnapshotJson`**: referência à versão da tabela de custo de produção e breakdown agregado (material, mão de obra, máquina, etc.). Não inclui explosão de BOM para formação de preço comercial.
- **`formulaSnapshotJson`**: IDs de versão, taxas, divisor, frete e `outputs` com valores congelados da fórmula no momento da publicação.

## Comportamento atual do modal (após correção)

- **Preço publicado**: badge "Preço publicado", metadados de tabela/versão/data, valores lidos apenas de colunas congeladas e `formulaSnapshotJson`.
- **Simulação ao vivo**: badge "Simulação ao vivo", cálculo via `/api/pricing/:productId/:taxRuleId/calculate` (inalterado).
- Campos ausentes no snapshot exibem **"Não disponível nesta versão"** — sem recálculo silencioso.
- Abas "Composição do Preço" e "Composição Detalhada" mostram aviso de fallback quando não há snapshot detalhado.

## O que falta salvar para detalhe 100% confiável

Para reproduzir fielmente as três abas do modal a partir de qualquer versão publicada antiga:

1. **`pricingBreakdownSnapshotJson`** — resultado completo de `buildPricingUnitCalculationBreakdown` no instante da publicação.
2. **`openBookSnapshotJson`** — payload de open-book com explosão de materiais e processos.
3. **OPEX / custo gerencial congelado** — se margem operacional deve ser exibida historicamente.
4. **Decomposição de `frozenOtherCost`** — frete vs comissão vs outras variáveis já embutidas no agregado.

## Endpoint existente

`GET /api/price-tables/:tableId/products/:productId/published-price` — retorna item publicado com `formulaSnapshotJson` e `costSnapshotJson`. Não há endpoint separado de "detail"; o modal monta a view a partir deste payload.

## Próximo passo recomendado

Na rotina de publicação (`publishPriceTableVersion` / `priceTablePublication.server.ts`), persistir `pricingBreakdownSnapshotJson` e `openBookSnapshotJson` em `PriceTableItem` e consumir no modal sem reconstruir breakdown.
