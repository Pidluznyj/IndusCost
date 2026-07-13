# Inventário — impacto do status do item do Pedido de Venda

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Atualizado** | 2026-07-13 |
| **Regra canônica** | `src/lib/sales/nomusSalesOrderItemStatus.ts` |
| **Gate ativo** | `isSalesOrderItemActiveForCommercialValue` (CANCELED/STALE/zerado → inativo) |

## Problema

O Nomus envia status do item em `SalesOrder.nomusRawResponse.itensPedido[].status` (ex.: 4 = atendido, 6 = cancelado). Sem persistir/usar, cancelados eram tratados como pendentes (ex.: PD 02207).

## Campos em SalesOrderItem

Já existem (migration `20260713140000_sales_order_item_nomus_status`):  
`nomusItemExternalId`, `nomusItemSequence`, `nomusItemStatusRaw`, `nomusItemStatusNormalized`, `nomusQuantityFulfilled`, `nomusQuantityPending`, `nomusIsCanceled`, `nomusIsStale`, `nomusLastSeenAt`, `nomusRawItem`.

## Inventário técnico

| Arquivo | Função | Decisão | Considerava cancelado? | Risco | Correção |
|---------|--------|---------|------------------------|-------|----------|
| `sales/orderToCashAuditBuilder.ts` | `linkOrderItems…`, PENDING loop | Alocação + PENDING | Não (antes) | Alto — PENDING falso + roubo de saldo | Excluir inativos da alocação; emitir `ORDER_ITEM_CANCELED`; forecast no valor ativo |
| `scripts/rebuildOrderToCashAudit.ts` | map items | Passa status ao builder | Parcial | Alto | Passa flags + stale→CANCELADO |
| `finance/orderToCashFactItemStatusEnrichment.server.ts` | enrich | Lê DB + raw | Sim | Médio se skip | Manter no read-path |
| `finance/portfolioOrderStatusService.ts` | agregação Status Pedidos | Pendência ativa | Sim (pós-enrich) | Baixo | Também trata `ORDER_ITEM_CANCELED` |
| `finance/portfolioReconciliationAllocationEngine.ts` | ORDER_ONLY | Forecast por item | Não (antes) | Alto | `positiveOrderItems` exclui cancel/stale |
| `finance/portfolioCashForecastMaturity.ts` | `pickForecastValue` | Forecast pedido | Header | Médio | Preferir `activeOrderValue` |
| `commissions/commission-source-resolver.server.ts` | load bundle | Itens ativos | Sim | Baixo | Ignore reason `IGNORED_*`; forecast no líquido ativo |
| `salesOrderMarginService.server.ts` | margem | ITEM_CANCELADO | Sim | Baixo | — |
| `commercial/crmSalesOrderMetricsService.ts` | leading product | Mix produto | Não (antes) | Médio | Filtra itens inativos |
| `crmCustomersList.ts` | SQL leading | Mix produto | Não (antes) | Médio | `nomusIsCanceled/Stale = false` |
| `salesProductRanking.ts` | ranking vendidos | Qty/receita | Não (antes) | Médio | Filtro Prisma nos itens |
| `salesOrderRulesAdapter.ts` | select CRM | Carrega itens | — | — | Inclui flags Nomus no select |
| Contas a Receber oficial / Fluxo / Presidencial | — | CR real | N/A | — | **Não alterar** |

## Regra oficial (resumo)

Item cancelado/stale/zerado:

- aparece em auditoria/detalhe (`ORDER_ITEM_CANCELED` ou status CANCELADO);
- não conta como pendente ativo;
- não entra em forecast / comissão / NO_MARGIN / margem ativa;
- compõe valor cancelado;
- permite pedido completo/recebido **com cancelamento**.

CR real / Contas a Receber oficial **nunca** são apagados por regra de pedido.
