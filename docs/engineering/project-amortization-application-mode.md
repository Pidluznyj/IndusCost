# Amortização de projeto — modo de aplicação (COST vs FINAL_PRICE)

## Objetivo

Permitir, **por item** que recebe amortização de molde/outro custo, escolher se o valor unitário entra:

1. **no custo do item** (`COST`) — comportamento legado; ou
2. **no preço final** (`FINAL_PRICE`) — repasse de investimento sem compor margem do produto.

## Campo

Na alocação (`ProjectCostAmortizationAllocation`):

| Campo | Significado |
|-------|-------------|
| `applicationMode` | `COST` (default) \| `FINAL_PRICE` |
| `unitAmortizedCost` | Amortização unitária calculada (`alocado / qtd`) — sempre auditável |
| `costComponentUnit` | Parte que entra no custo (`= unitAmortizedCost` em COST; `0` em FINAL_PRICE) |
| `priceAddOnUnit` | Parte somada após o preço do produto (`0` em COST; `= unitAmortizedCost` em FINAL_PRICE) |
| `finalUnitCostSnapshot` | `base + costComponentUnit` (nunca inclui add-on de preço) |

## Fórmulas

### COST (default — preserva comportamento antigo)

```
custoFinalUnitario = custoBaseUnitario + amortizacaoUnitaria
priceAddOnUnit = 0
```

A Formação de Preço / Precificação comercial do projeto usa o custo final amortizado como base de margem.

### FINAL_PRICE

```
custoFinalUnitario = custoBaseUnitario
priceAddOnUnit = amortizacaoUnitaria
```

Preço:

```
precoProduto = formação normal a partir do custo (sem add-on)
precoFinal = precoProduto + priceAddOnUnit
```

A margem do produto **não** é calculada sobre o add-on. O add-on é recuperação de investimento (`projectRecoveryValue`).

## Backfill

Amortizações existentes: `applicationMode = COST`, `costComponentUnit = unitAmortizedCost`, `priceAddOnUnit = 0`.

## UI

Modal **Configurar amortização**: coluna **Aplicar amortização em** (Custo do item / Preço final), preview em tempo real, resumo separado (via custo vs via preço final vs absorvido).

Tabela **Distribuição por item**: Amortização no custo | Repasse no preço | Modo | Fontes.

## API

`PUT /api/projects/:id/cost-amortizations` — cada allocation pode enviar:

- `amortizationApplicationMode` ou `applicationMode`: `COST` \| `FINAL_PRICE`

## Escopo

Não altera Contas a Receber, Fluxo de Caixa, Comissões pagas, Relatório Presidencial, Sync Nomus, Pedido de Venda.
