-- Cardinalidade financeira V1 — Pedido de Compra Nomus ↔ Contas a Pagar.
--
-- Migration CORRETIVA e ADITIVA sobre 20260924120000_nomus_purchase_order_payable_link
-- (já aplicada em homologação; NÃO é alterada).
--
-- Regra aprovada: sem rateio financeiro explícito, um título de Contas a Pagar
-- (payableExternalId) tem NO MÁXIMO UM dono financeiro no IndusCost. O banco é a
-- autoridade final na corrida entre duas confirmações simultâneas: uma vence, a
-- outra recebe violação de unicidade (P2002 → 409 no domínio).
--
-- Sem dados alterados: nenhum UPDATE/DELETE, nenhuma deduplicação automática.
-- Se algum ambiente já tiver o mesmo título vinculado a dois pedidos, este
-- CREATE UNIQUE INDEX FALHA de propósito — o dado deve ser auditado manualmente.
--
-- O índice não-único antigo NomusPurchaseOrderPayableLink_payableExternalId_idx e a
-- unique composta (nomusPurchaseOrderId, payableExternalId) são mantidos: redundância
-- de índice é aceita para evitar uma migration mais invasiva.

CREATE UNIQUE INDEX "NomusPurchaseOrderPayableLink_payableExternalId_key"
  ON "NomusPurchaseOrderPayableLink"("payableExternalId");
