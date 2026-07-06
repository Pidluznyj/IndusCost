# Campos de resumo — Comissões IndusCost

Documentação dos totais exibidos nos scripts de auditoria visual, conciliação AR × comissão e fechamento mensal.

## Modos de apuração

| Modo | Filtro de período | Uso |
|------|-------------------|-----|
| **GENERATED** | Data da NF/documento ou pedido | Comissão gerada por vendas/faturamento |
| **FORECAST** | `dueDate` do título | Títulos em aberto / a liberar |
| **PAYABLE** | `settlementDate` do CR Nomus | Comissão oficial a pagar no mês (comparável ao Nomus) |

A comissão **oficial do mês** usa sempre **PAYABLE** com `settlementDate` (data de baixa do contas a receber).

## Campos de resumo

### `receivedAmountTotal`
Soma dos valores **efetivamente recebidos** no período, considerando títulos únicos (`nomusReceivableId`) com `settlementDate` no mês (modo PAYABLE).

### `receivableAmountTotal`
Soma dos valores **nominais** dos títulos vinculados à comissão no período (valor do CR, sem duplicar parcelas do mesmo título).

### `commissionableBaseTotal`
Soma das **bases comissionáveis** após exclusões de cliente e regras de comissão. Clientes excluídos entram com base e recebido, mas com comissão zero e motivo registrado.

### `commissionExpectedTotal`
Comissão **calculada** (`commissionExpectedAmount` nos schedules) independentemente de liberação/pagamento.

### `commissionReleasedTotal`
Comissão **liberada** para pagamento conforme recebimento (`commissionReleasedAmount`), no período PAYABLE.

### `commissionPendingTotal`
Diferença entre esperado e liberado no período: `commissionExpectedTotal - commissionReleasedTotal`.

### `expectedMinusReleased`
Mesmo valor de `commissionPendingTotal` no script de conciliação — evidencia a diferença a explicar (ex.: títulos parcialmente baixados, regras de liberação, cliente excluído com base positiva).

### `averageRatePercent`
Percentual médio ponderado: `commissionReleasedTotal / commissionableBaseTotal × 100` (quando base > 0).

## Conciliação AR × Comissão

Script: `npx tsx scripts/reconcile-ar-vs-commission.ts --year=YYYY --month=M [--json] [--csv] [--details] [--seller=] [--customer=]`

Categorias de títulos **fora da comissão** ou com divergência:

- `CUSTOMER_EXCLUDED` — cliente com regra de exclusão
- `NO_SELLER` — sem vendedor no registro
- `SELLER_AMBIGUOUS` — vendedor não consolidado / conflito de identidade
- `NO_COMMISSION_RECORD` — título baixado sem schedule/record
- `COMMISSIONABLE_NOT_FULLY_RELEASED` — esperado > liberado
- `PARTIAL_RECEIPT` — recebimento parcial do título
- `ZERO_COMMISSION_RULE` — base com comissão zero por regra

## Identidade de vendedor

Resolução canônica (`CommissionPerson` + `CommissionPersonAlias`):

1. Alias ativo por `(rawSellerId, source)`
2. `CommissionPerson.nomusPersonId`
3. Alias ativo por `normalizedSellerName` (somente com alias aprovado)
4. Conflitos permanecem pendentes — **não há consolidação automática** sem alias

Campos de exportação:

- `rawSellerId` / `rawSellerName` — origem Nomus/pedido
- `canonicalSellerId` / `canonicalSellerName` — cadastro consolidado
- `resolutionStatus` — `OK_CANONICAL`, `MULTIPLE_CANONICALS`, `CONFLICT`, etc.

## Comparação Nomus

Use `--nomus-base` e `--nomus-commission` nos scripts de auditoria visual ou conciliação para comparar base e comissão liberada com o relatório Nomus do mesmo período.
