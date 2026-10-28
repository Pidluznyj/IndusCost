-- Rollback da migration 20261102120000_proposal_sales_order_link_traceability.
-- Executar SOMENTE com o codigo anterior a esta versao ja implantado (o codigo novo grava nessas colunas/tabelas).
-- Remove apenas a estrutura de rastreabilidade; SalesOrder.proposalId e ProposalItem.* existentes nao sao tocados.
-- (Opcional, ANTES deste arquivo: desfazer vinculos criados pela nova politica - ver docs/sales/proposal-sales-order-link.md,
--  secao "Rollback", passo 2.)
-- Depois de executar, remover a linha da migration em _prisma_migrations conforme o runbook.
BEGIN;
DROP TABLE IF EXISTS "SalesOrderProposalLinkEvent";
DROP TABLE IF EXISTS "NomusProposalImportIssue";
DROP INDEX IF EXISTS "SalesOrder_proposalLinkStatus_idx";
ALTER TABLE "SalesOrder"
  DROP COLUMN IF EXISTS "proposalLinkSource",
  DROP COLUMN IF EXISTS "proposalLinkStatus",
  DROP COLUMN IF EXISTS "proposalLinkEvidence",
  DROP COLUMN IF EXISTS "proposalLinkUpdatedAt";
ALTER TABLE "ProposalItem" DROP COLUMN IF EXISTS "nomusProductInactive";
DROP TYPE IF EXISTS "ProposalLinkSource";
DROP TYPE IF EXISTS "ProposalLinkStatus";
COMMIT;
