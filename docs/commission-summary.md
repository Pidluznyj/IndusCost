# Campos de resumo — Comissões IndusCost

Documentação dos totais exibidos nos scripts de auditoria visual, conciliação AR × comissão e fechamento mensal.

## Modos de apuração

| Modo | Filtro de período | Uso |
|------|-------------------|-----|
| **GENERATED** | Data da NF/documento ou pedido | Comissão gerada por vendas/faturamento |
| **FORECAST** | `dueDate` do título | Títulos em aberto / a liberar |
| **PAYABLE** | `settlementDate` do CR Nomus | Comissão oficial a pagar no mês (comparável ao Nomus) |

A comissão **oficial do mês** usa **PAYABLE** com `settlementDate` (data de baixa do contas a receber).

### Fonte oficial de pagamento (2026-07)

| Prioridade (`--source=auto`) | Origem | Status exibido |
|------------------------------|--------|----------------|
| 1 | Ledger `RECEIPT_BASED` fechado (`CommissionReceiptLedgerLine`) | **FECHADO** |
| 2 | Prévia do motor por recebimento (`commissionReceiptEngine`) | **PREVIEW** (aviso: prévia não fechada) |
| 3 | Visual audit legado (`CommissionRecord` + `CommissionPaymentSchedule`) | **LEGADO** (deprecation) |

**Regra:** quando existir fechamento RECEIPT_BASED `CLOSED` para o mês, relatórios e exports oficiais de pagamento usam o ledger gravado — não somam `CommissionPaymentSchedule` legado.

Scripts e APIs aceitam `--source=auto|receipt|legacy`:
- `auto` — ledger fechado se existir; senão prévia receipt; `--source=legacy` força visual audit.
- `receipt` — ledger fechado ou prévia; nunca legado.
- `legacy` — mantém comportamento antigo com aviso de depreciação.

Telas/APIs:
- **Fechamento por Recebimento** (`/commissions`) — fonte oficial.
- **Fechamento mensal legado** (`/api/commissions/monthly-closing`) — usa `resolveMonthlyPayableReport` com `auto`.
- **Previstas/Confirmadas/Liberação/Pagamentos** — continuam em `CommissionRecord` (previsão/geração); não substituem pagamento oficial.
- **Dashboard** — cards por `CommissionRecord`; quando `year`+`month` informados, inclui `monthlyOfficialPayable`.

## Diferença entre comissão gerada, prevista e pagável

| Conceito | Eixo | Uso |
|----------|------|-----|
| **Gerada** | `confirmedAt` / NF | Apuração, confirmadas |
| **Prevista** | `dueDate` título em aberto | Forecast |
| **Pagável no mês** | `settlementDate` CR baixado | Fechamento oficial, Nomus |

## Cliente excluído

Cliente com regra de exclusão: base e recebido aparecem; comissão zero; motivo em `exclusionReason` / status `CUSTOMER_EXCLUDED`.

## Título sem vínculo

Sem pedido/NF: status `NO_SALES_LINK` / `NO_ORDER_NFE_LINK`; comissão zero; aparece em cards de exceção.

## Reprocessar fechamento

UI **Fechamento por Recebimento** → Reprocessar (exige `REPROCESSAR COMISSAO` + motivo). Fechamento anterior vira `REPROCESSED`; novo fica `CLOSED`.

## Comparar com Nomus

Use `--nomus-base` e `--nomus-commission` nos scripts. Compare sempre com fonte **FECHADO** ou **PREVIEW receipt**, não legado.


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

Script: `npx tsx scripts/reconcile-ar-vs-commission.ts --year=YYYY --month=M [--source=auto|receipt|legacy] [--json] [--csv] [--details] [--seller=] [--customer=]`

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
