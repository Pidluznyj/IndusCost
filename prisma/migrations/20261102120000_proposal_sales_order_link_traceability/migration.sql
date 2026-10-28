-- Rastreabilidade do vínculo Pedido de Venda → Proposta (src/lib/sales/proposalSalesOrderLinkPolicy.ts).
-- Somente aditiva: colunas novas anuláveis (ou com default), enums e tabelas novas; nenhum dado existente é alterado.
-- Pedidos já vinculados ficam com proposalLinkSource NULL = LEGADO (não confirmado) até a primeira decisão da política.
-- Rollback: docs/sales/proposal-sales-order-link.rollback.sql (procedimento em docs/sales/proposal-sales-order-link.md).

-- CreateEnum
CREATE TYPE "ProposalLinkSource" AS ENUM ('NOMUS_REFERENCE', 'MANUAL', 'INDUSCOST_GENERATED', 'INFERRED_ITEMS', 'LEGACY');

-- CreateEnum
CREATE TYPE "ProposalLinkStatus" AS ENUM ('CONFIRMED', 'INFERRED', 'AMBIGUOUS', 'NO_EVIDENCE', 'CONFLICT');

-- AlterTable
ALTER TABLE "ProposalItem" ADD COLUMN     "nomusProductInactive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "proposalLinkEvidence" JSONB,
ADD COLUMN     "proposalLinkSource" "ProposalLinkSource",
ADD COLUMN     "proposalLinkStatus" "ProposalLinkStatus",
ADD COLUMN     "proposalLinkUpdatedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "SalesOrderProposalLinkEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "previousProposalId" UUID,
    "newProposalId" UUID,
    "candidateProposalId" UUID,
    "previousSource" "ProposalLinkSource",
    "newSource" "ProposalLinkSource",
    "previousStatus" "ProposalLinkStatus",
    "newStatus" "ProposalLinkStatus",
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "actor" TEXT NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderProposalLinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusProposalImportIssue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "externalProposalId" INTEGER NOT NULL,
    "externalProposalCode" TEXT,
    "externalCustomerId" INTEGER,
    "reasons" TEXT[],
    "missingSkus" TEXT[],
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "NomusProposalImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrderProposalLinkEvent_salesOrderId_createdAt_idx" ON "SalesOrderProposalLinkEvent"("salesOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrderProposalLinkEvent_runId_idx" ON "SalesOrderProposalLinkEvent"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "NomusProposalImportIssue_externalProposalId_key" ON "NomusProposalImportIssue"("externalProposalId");

-- CreateIndex
CREATE INDEX "NomusProposalImportIssue_resolvedAt_idx" ON "NomusProposalImportIssue"("resolvedAt");

-- CreateIndex
CREATE INDEX "SalesOrder_proposalLinkStatus_idx" ON "SalesOrder"("proposalLinkStatus");

-- AddForeignKey
ALTER TABLE "SalesOrderProposalLinkEvent" ADD CONSTRAINT "SalesOrderProposalLinkEvent_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

