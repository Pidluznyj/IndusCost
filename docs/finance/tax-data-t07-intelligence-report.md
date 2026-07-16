# T07 — Relatórios e inteligência tributária

**Atualizado:** 2026-07-16  
**Depende de:** T04–T06 (destacados, apuração/guias, settlements no pedido)

## Escopo

Análise histórica de **destacado × apurado × pago**, com filtros, KPIs, tabela em tela, export **XLSX** e drilldown.

**Não altera** o Relatório Presidencial.

## Onde fica

- UI: **Financeiro > Tributos > Inteligência fiscal**
- API:
  - `GET /api/finance/fiscal-settlements/reports`
  - `GET /api/finance/fiscal-settlements/reports/export.xlsx`
  - `GET /api/finance/fiscal-settlements/reports/drill`
- Permissão: `finance.tax_apuration.view` | `taxes.view`

## Camadas (nunca misturar sem rótulo)

| Indicador | Camada | Fonte |
|-----------|--------|-------|
| Tributos destacados | A | XML NF-e `NomusNfeTaxLine` HEADER (ITEM só em visão produto/NCM/CFOP) |
| Créditos / apurado / devido | B/C | Guia / linhas de apuração |
| Tributos pagos, juros, multas, saldo | C | Guia (canceladas/estornadas fora dos totais pagos) |
| Alocado gerencialmente | D | `FiscalAllocation` |
| Receita / carga fiscal | A + C | vProd−vDesc ÷ pago |

## Agrupamentos

período, tributo, guia, status de pagamento, jurisdição/UF, cliente, pedido, NF, produto (item NF), NCM, CFOP, empresa emissora.

## Drilldown

`período → tributo → guia → NF → pedido` (via alocações da guia).

## Export

XLSX com abas KPIs, Fontes (natureza por coluna), Detalhe e Filtros. PDF executivo **não** incluído (padrão não consolidado neste módulo).
