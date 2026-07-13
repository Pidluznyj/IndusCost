# OrderToCashAudit — regras de evidência de item

## Problema

`receivableTotalValue` e `nfeNumber` no fato são, em muitos casos, dados do **título/pedido** (NF + Contas a Receber), não do **item** (produto).

Quando uma linha `ORDER_ITEM_PENDING` herdava NF/CR do título, a UI sugeria que o produto estava na NF/CR — o que é falso (ex.: PD 02534 / 309.86AA).

## Níveis de evidência

| Nível | Significado |
| --- | --- |
| `ITEM` | Linha com documento/NF de item (alocada, excedente ou extra) |
| `ORDER_TITLE` | Contexto de título apenas (PENDING sem item faturado) |

## Matching pedido × documento

Prioridade:

1. `externalProductId` (normalizado como número)
2. `productId` (se ambos existirem)
3. `productCode` / `sku` normalizados

Com vários saldos do mesmo produto no pedido: **FIFO** por

1. data de entrega mais antiga
2. `orderItemSequence` mais antigo
3. maior saldo pendente > 0

`DOCUMENT_EXTRA_ITEM` só quando **não** há saldo compatível no pedido.

Ambiguidade (2+ linhas do mesmo produto) **não** vira EXTRA: aloca FIFO.

## ORDER_ITEM_PENDING

Não preencher como evidência de item:

- `stockDocumentExternalId` / campos de item de documento
- `nfeNumber` / `nfeExternalId` / `nfeHeaderValue`
- `receivableTotalValue` / aberto / recebido

Estágios da linha pendente:

- operacional: `NOT_FULFILLED`
- fiscal: `NO_NFE`
- financeiro: `NO_CR`

## ORDER_ITEM_CUT

Item **atendido com corte** (`FULFILLED_WITH_CUT`) — saldo cortado encerrado:

- não gera `ORDER_ITEM_PENDING` sobre o cortado
- `plannedReceivableValue = null`
- não exige NF/documento sobre o corte
- alerta `ITEM_ATENDIDO_COM_CORTE`
- operacional: `FULLY_FULFILLED`; sem forecast

## ORDER_ITEM_CANCELED

Item cancelado/stale no Pedido de Venda/Nomus:

- **não** gera `ORDER_ITEM_PENDING`
- **não** exige NF/documento/CR
- **não** gera previsão de recebível (`plannedReceivableValue = null`)
- **não** gera alerta `ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO`
- aparece no detalhe com `orderItemStatus = CANCELADO` e alerta `ITEM_CANCELADO_PEDIDO_VENDA`
- operacional: `CANCELADO`; cash: `NO_CASH`

Itens cancelados são excluídos da alocação (não competem por saldo de SKU com linhas ativas).

Parcelas planejadas do pedido usam **valor ativo** (original − cancelados), não o header bruto quando há cancelamentos.

**Ressalva:** se já existir NF/CR real ligado ao pedido, Contas a Receber oficial **não** é apagado. A linha cancelada apenas deixa de exigir documento e de inflar saldo pendente.

## Valor cobrado da linha (`lineBilledValue`)

| `lineType` | Cálculo | Source |
| --- | --- | --- |
| `ORDER_ITEM_ALLOCATED` | `quantityUsedForOrder × stockDocumentItemUnitValue` | `STOCK_DOCUMENT_ITEM` |
| `QUANTITY_SURPLUS` | `excessQuantity × unitValue` | `STOCK_DOCUMENT_ITEM` |
| `DOCUMENT_EXTRA_ITEM` | `outsideOrderQuantity × unitValue` | `STOCK_DOCUMENT_ITEM` |
| `ORDER_ITEM_PENDING` | `null` | `NOT_BILLED` (“Não faturado nesta NF”) |
| `ORDER_ITEM_CANCELED` | `null` | `NOT_BILLED` |

**Nunca** usar CR total do título para calcular valor de item.

## Título financeiro (DTO)

Campos de rastreabilidade (não são valor do produto):

- `titleReceivableTotalValue`
- `titleReceivableOpenValue`
- `titleNfeNumber`
- `titleNfeExternalId`

Na UI, a coluna **CR total título** usa esses campos (ou o CR denormalizado em linhas com evidência de item). Em PENDING, a coluna NF do item mostra "—".

## Caso PD 02534

- `309.86AA` (`externalProductId` 1004): `ORDER_ITEM_PENDING`, sem NF/CR de item
- `612.03AA` (391): alocado 12.200 × 3,35 = R$ 40.870
- `612.02AA` (390): alocado 10.000 × 3,35 = R$ 33.500
- `619.21AA` (432): alocado 10.000 × 2,89 = R$ 28.900
- `619.24AA` (423): FIFO nas linhas do documento 8457 até o saldo do pedido

## Rebuild

Após deploy do builder, é necessário **reaplicar** a run OrderToCashAudit afetada para materializar os facts corrigidos:

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode "PD 02534"
```

Diagnóstico:

```bash
npx tsx tmp-audits/inspect-pd02534-order-to-cash-db.ts
```
