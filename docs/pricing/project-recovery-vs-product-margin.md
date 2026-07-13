# Recuperação de projeto vs margem operacional do produto

## Problema

Quando a amortização de molde/projeto entra no **custo** do item, a formação de preço aplica margem/markup sobre esse custo. Em alguns casos o negócio quer apenas **repassar o investimento** no preço final, sem tratar esse valor como base de margem.

## Separação conceitual

| Conceito | Origem | Entra na margem do produto? |
|----------|--------|------------------------------|
| Custo do produto | Custo base + amortização em modo `COST` | Sim (base de formação) |
| Amortização no custo | `costComponentUnit` / modo `COST` | Sim (via custo) |
| Repasse de amortização no preço | `amortizationPriceAddOnUnit` / modo `FINAL_PRICE` | **Não** |
| Margem do produto | Resultado da formação sobre o custo do produto | — |
| Recuperação de projeto | Igual ao add-on de preço | Não é margem operacional |
| Preço comercial final | Preço do produto + recuperação | — |

## Campos no DTO de precificação do projeto

- `baseProductCost` / `costBaseUnit` — custo sem add-on de preço
- `amortizationUnitCost` — componente de custo (modo COST)
- `amortizationPriceAddOnUnit` — add-on pós-margem
- `calculatedProductPrice` — preço após impostos/margem sobre o custo
- `suggestedPrice` / `finalPriceWithAmortization` — preço comercial final
- `marginAmount` — margem operacional do produto
- `projectRecoveryValue` — recuperação de investimento (= add-on)
- `commissionableBaseWithoutProjectRecovery` — preparatório; **não altera** módulo de comissões nesta entrega

## Regra fiscal (1ª entrega)

Não inventar regra tributária nova. O preço comercial final pode embutir o repasse; impostos continuam conforme o motor atual sobre o custo/preço do produto. O add-on é somado **depois** do cálculo de margem do produto. Documentar qualquer ajuste fiscal futuro à parte.

## Default

`COST` — preserva preços e margens já calculados com amortização no custo.

## Relatórios

Onde houver custo/preço/margem do projeto, separar:

- custo do produto
- amortização no custo
- repasse no preço
- margem do produto
- recuperação de projeto

Não misturar recuperação de projeto com margem operacional.
