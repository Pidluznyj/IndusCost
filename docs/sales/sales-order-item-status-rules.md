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
| 4 | Atendido totalmente | `FULFILLED` |
| 6 | Cancelado | `CANCELED` |
| 1–3, 5 | Pendente / parcial (mapa inicial) | `PENDING` / `PARTIAL` |
| outro | Desconhecido | `UNKNOWN` (bruto preservado) |

## Flags persistidas

- `nomusIsCanceled` — cancelado no Nomus
- `nomusIsStale` — linha local sumiu do payload atual (não apagar; não tratar como ativo)
- `nomusItemStatusRaw` / `nomusItemStatusNormalized`
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
