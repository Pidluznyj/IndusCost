# Regras oficiais — status do item do Pedido de Venda (Nomus)

| | |
|---|---|
| **Atualizado** | 2026-07-13 |
| **Normalizador** | `src/lib/sales/nomusSalesOrderItemStatus.ts` |
| **Sync** | `docs/sales/sales-order-item-nomus-status-sync.md` |
| **Inventário** | `docs/sales/sales-order-item-status-impact-audit.md` |

## Status bruto Nomus (`itensPedido[].status`)

| Código | Significado | Normalizado |
|--------|-------------|-------------|
| 1 | Aguardando liberação | `PENDING` |
| 2 | Liberado | `RELEASED` |
| 3 | Atendido parcialmente | `PARTIAL` |
| 4 | Atendido totalmente | `FULFILLED` |
| 5 | Atendido com corte | `FULFILLED_WITH_CUT` |
| 6 | Cancelado | `CANCELED` |
| outro | Desconhecido | `UNKNOWN` (bruto preservado, **não** presumir cancelado) |

Também aceita texto PT: `Atendido totalmente`, `Atendido com corte`, `Liberado`, `Cancelado`, `Aguardando liberação`.

## Status por LINHA do item, não por produto

O mesmo SKU pode aparecer várias vezes no pedido com status diferentes (ex.: PD 02534 tem 5 linhas de `309.86AA` — apenas a linha 00080 está cancelada).

**Regras de casamento local × raw (por linha):**

1. `nomusItemExternalId` (`itensPedido[].id`) — HIGH.
2. Tag `[nomus-line:N]` em `notes` — HIGH.
3. `nomusItemSequence` (`itensPedido[].item`) — HIGH.
4. Produto único no pedido (uma linha local, um rawItem) — HIGH.
5. Múltiplas linhas do mesmo produto: casamento por `quantidade + valorUnitario` únicos — HIGH.
6. Fallback posicional 1:1 quando cardinalidade bate — LOW.
7. Caso contrário → `AMBIGUOUS` — **não** aplicar cancelamento automático; preserva `UNKNOWN`.

Fallback por `externalProductId`/SKU só é permitido quando o produto aparece **uma única vez** no pedido.

**Nunca:**
- somar como cancelado todas as linhas de um SKU porque uma delas está cancelada;
- aplicar status por `idProduto` quando há repetição;
- transformar linhas ativas em canceladas por herança do produto.

## Flags persistidas

- `nomusIsCanceled` — cancelado no Nomus (linha)
- `nomusIsCut` — atendido com corte (saldo cortado encerrado)
- `nomusIsStale` — linha local sumiu do payload atual (não apagar; não tratar como ativo)
- `nomusItemStatusRaw` / `nomusItemStatusNormalized`
- `nomusMatchConfidence` / `nomusMatchReason` — auditoria do casamento por linha
- `nomusRawItem` / `nomusLastSeenAt`

## Gates de “ativo”

| Função | Uso |
|--------|-----|
| `isSalesOrderItemActiveForCommercialValue` | CRM / carteira / valor ativo |
| `isSalesOrderItemActiveForReceivableForecast` | Forecast / parcelas planejadas |
| `isSalesOrderItemActiveForCommission` | Motor de comissão |
| `isSalesOrderItemActiveForMargin` | Formação de preço / margem |

`CANCELED`, `STALE` e item zerado → **sempre inativo**.

## Impacto por módulo

### Status Pedidos

- `originalOrderValue`, `canceledOrderValue`, `activeOrderValue`
- `pendingActiveOrderValue` / `%` só sobre ativos
- parcial só com saldo ativo real
- card **Com cancelamento**; PD 02207 → recebido/completo com cancelamento

### Auditoria Pedido → Caixa

- lineType `ORDER_ITEM_CANCELED` (não `ORDER_ITEM_PENDING`)
- sem alerta de entrega vencida / documento faltante / forecast
- parcelas planejadas recalculadas sobre valor ativo
- CR real existente permanece (não apagar)

### Forecast / recebíveis planejados

- cancelado/stale/zerado fora do forecast
- CR real prevalece sobre previsão
- Contas a Receber oficial intacto

### Comissão

- não gera comissão nem `NO_MARGIN`
- classificação de auditoria: `IGNORED_CANCELED_ITEM` / `IGNORED_STALE_ITEM`
- comissão já paga não é alterada automaticamente
- vendedor continua do Pedido/Nomus

### Margem

- `ITEM_CANCELADO` / ignorado na consolidação
- não busca tabela de preço como receita inválida

### CRM / carteira

- leading product e ranking excluem cancelado/stale
- carteira aberta deve usar valor ativo quando o fluxo calcular a partir de itens

## Caso âncora — PD 02207

| Métrica | Valor |
|---------|-------|
| fulfilled / canceled / pending ativo | 2 / 2 / 0 |
| original / cancelado / ativo | 197030 / 125625 / 71405 |
| atendido / pendente ativo / % | 71405 / 0 / 100 |
| status | `RECEBIDO_COM_CANCELAMENTO` (não Parcial) |

## Caso âncora — PD 02534 (SKU repetido)

5 linhas do `309.86AA` — apenas a linha 00080 está cancelada no Nomus:

| Item | Qtd | Valor | Status Nomus | Regra |
|------|-----|-------|--------------|-------|
| 00080 | 2.000 | R$ 3.180 | Cancelado (6) | `CANCELED` — linha específica |
| 00090 | 4.000 | R$ 6.360 | Liberado (2) | `RELEASED` (ativo) |
| 00100 | 8.000 | R$ 12.720 | Liberado (2) | `RELEASED` (ativo) |
| 00110 | 4.000 | R$ 6.360 | Liberado (2) | `RELEASED` (ativo) |
| 00120 | 8.000 | R$ 12.720 | Liberado (2) | `RELEASED` (ativo) |

Esperado:

- `canceledOrderValue` = **R$ 3.180,00** (só a linha 00080)
- `activeOrderValue` = **R$ 38.160,00**
- **NUNCA** cancelar R$ 41.340,00 (soma todo o SKU 309.86AA)
- pedido pode continuar `PARCIAL_COM_CANCELAMENTO` se houver saldo ativo pendente real
- itens 00090/00100/00110/00120 aparecem como ativos/liberados no detalhe

## Impacto do "Atendido com corte"

- saldo cortado (`quantityCut`) é encerrado — não conta como pendente
- não gera forecast/recebível planejado sobre o cortado
- não gera comissão nem `NO_MARGIN` sobre o cortado
- fica visível em auditoria com `FULFILLED_WITH_CUT` / `ORDER_ITEM_CUT`
