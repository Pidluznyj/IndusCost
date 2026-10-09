-- SalesOrderItemFlowSnapshot.verifiedAt / SalesOrderFlowSnapshot.verifiedAt
-- Última VERIFICAÇÃO do snapshot: gravado em todo recompute concluído, mesmo
-- quando o conteúdo não muda. `computedAt` continua sendo a última MUDANÇA.
-- Consumido pela regra de frescor do status de faturamento
-- (docs/sales/sales-orders-billing-status.md).
--
-- Aditiva: 1 coluna NULLABLE em cada tabela. Zero DROP / RENAME / índice.
-- Sem backfill: não se sabe quando os snapshots existentes foram conferidos.
-- NULL = "ainda não reprocessado"; a regra de frescor usa computedAt nesses
-- registros até o próximo recompute do pedido preencher verifiedAt.

ALTER TABLE "SalesOrderItemFlowSnapshot"
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

ALTER TABLE "SalesOrderFlowSnapshot"
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);
