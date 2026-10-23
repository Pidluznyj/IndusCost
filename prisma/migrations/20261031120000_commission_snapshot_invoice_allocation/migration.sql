-- B5 (N:N de comissões): snapshot (pedido, NF-e) mede só o que a NF-e faturou.
--
-- Até aqui todo snapshot (pedido, NF-e) carregava o pedido inteiro, e um pedido
-- faturado em N NF-e reproduzia a comissão integral N vezes (R1). Agora o snapshot
-- declara sua base:
--   * FULL_ORDER_LEGACY (default, todos os snapshots existentes): pedido inteiro;
--   * INVOICED_ALLOCATION: só itens/quantidades desta NF-e, com evidência oficial
--     do documento de saída (idItemPedido / sequência do item no Nomus);
--   * ALLOCATION_PENDING: pedido em mais de uma NF-e sem evidência suficiente —
--     comissão retida (schedule ERROR), nunca integral.
-- Os itens do snapshot guardam quantidade pedida, faturada nesta NF-e, acumulada e
-- a evidência. Sem tabela nova: a alocação vive no snapshot versionado que o
-- scheduler, o fechamento e a Provisão já leem.
--
-- Compatibilidade: snapshots existentes ficam FULL_ORDER_LEGACY com colunas novas
-- nulas — exatamente o que eram. Sem backfill automático: a próxima materialização
-- (já existente) cria a versão alocada e substitui a anterior pelo fluxo oficial
-- (SUPERSEDED). Fechamentos CLOSED intocados.

CREATE TYPE "CommissionOrderSnapshotAllocationBasis" AS ENUM ('FULL_ORDER_LEGACY', 'INVOICED_ALLOCATION', 'ALLOCATION_PENDING');

ALTER TABLE "CommissionOrderSnapshot" ADD COLUMN     "allocationBasis" "CommissionOrderSnapshotAllocationBasis" NOT NULL DEFAULT 'FULL_ORDER_LEGACY';

ALTER TABLE "CommissionOrderItemSnapshot" ADD COLUMN     "allocationEvidenceJson" JSONB,
ADD COLUMN     "cumulativeInvoicedQuantity" DECIMAL(20,6),
ADD COLUMN     "invoicedQuantity" DECIMAL(20,6),
ADD COLUMN     "itemFullCommissionAmount" DECIMAL(20,2),
ADD COLUMN     "itemFullSoldAmount" DECIMAL(20,2),
ADD COLUMN     "orderedQuantity" DECIMAL(20,6);
