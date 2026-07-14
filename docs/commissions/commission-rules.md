# Regras de comissão — fontes e status (IndusCost)

## Fonte oficial por superfície

| Superfície | Fonte |
|------------|--------|
| Auditoria 360º — aba Comissões | `CommissionOrderSnapshot` / `CommissionOrderItemSnapshot` (read-only) |
| Comercial > Comissões (listagem / fechamento) | Schedule materializado + snapshot ligado; baixas via `CommissionReceiptLedgerLine` |
| Pagamento | Somente ledger fechado RECEIPT_BASED (`COMMISSIONABLE` liberado) |

Não criar cálculo paralelo de margem na UI.

## Quando `NO_MARGIN` é válido

Somente se **não** houver comissão prevista no snapshot oficial e os itens ACTIVE tiverem falta real de tabela/margem (`NO_COMMERCIAL_PRICE_TABLE`, `INVALID_COMMERCIAL_PRICE_RANGE`), sem schedule/CR com prevista.

## Quando usar `COMMISSION_SOURCE_MISMATCH`

- Schedule ACTIVE com `scheduledCommissionAmount = 0`
- e `CommissionOrderSnapshot.totalFinalCommissionAmount > 0` (ou item com final > 0)

Alerta: `COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT`.

A listagem **mostra** a prevista do snapshot; **não libera** pagamento até materializar de novo.

## Comissão paga

Não alterar automaticamente. Ajustes em valores já pagos = apenas sinalização operacional.

## Vendedor

Usar vendedor canônico (`CommissionPerson` + alias), alinhado entre telas.

Ver também: [commission-main-vs-order-audit-source-map.md](./commission-main-vs-order-audit-source-map.md).
