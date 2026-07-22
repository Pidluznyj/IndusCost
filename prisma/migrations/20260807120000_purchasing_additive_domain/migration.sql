-- OP-13 — Domínio aditivo de Compras SC (cotação, negociação, PO, recebimento, evidências).
-- Aditivo apenas: CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD FK.
-- Sem DROP / RENAME. Não altera Material, FinancialSupplier campos oficiais, AP ou Nomus.

-- Enums
CREATE TYPE "PurchaseQuotationStatus" AS ENUM (
  'RASCUNHO', 'ENVIADA', 'EM_ANALISE', 'ADJUDICADA', 'CANCELADA', 'EXPIRADA'
);
CREATE TYPE "PurchaseQuotationSupplierStatus" AS ENUM (
  'CONVIDADO', 'RESPONDIDO', 'DESCARTADO', 'VENCEDOR', 'RECUSADO'
);
CREATE TYPE "PurchaseQuotationOfferStatus" AS ENUM (
  'RASCUNHO', 'RECEBIDA', 'DESCARTADA', 'VENCEDORA'
);
CREATE TYPE "PurchaseNegotiationRoundStatus" AS ENUM (
  'ABERTA', 'FECHADA', 'CANCELADA'
);
CREATE TYPE "PurchaseNegotiationActor" AS ENUM (
  'BUYER', 'SUPPLIER'
);
CREATE TYPE "PurchaseApprovalTargetType" AS ENUM (
  'QUOTATION', 'PURCHASE_ORDER', 'RECEIPT'
);
CREATE TYPE "PurchaseApprovalStatus" AS ENUM (
  'PENDENTE', 'APROVADA', 'REJEITADA', 'CANCELADA'
);
CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'RASCUNHO', 'EMITIDO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO', 'RECEBIDO', 'CANCELADO', 'ENCERRADO'
);
CREATE TYPE "PurchaseReceiptStatus" AS ENUM (
  'RASCUNHO', 'EM_CONFERENCIA', 'DIVERGENTE', 'APROVADO', 'ESTORNADO', 'CANCELADO'
);
CREATE TYPE "PurchaseEvidenceEntityType" AS ENUM (
  'REQUEST', 'QUOTATION', 'QUOTATION_SUPPLIER', 'OFFER', 'NEGOTIATION_ROUND',
  'APPROVAL', 'PURCHASE_ORDER', 'RECEIPT'
);
CREATE TYPE "PurchaseEvidenceType" AS ENUM (
  'PDF', 'IMAGE', 'SPREADSHEET', 'EMAIL', 'PROPOSAL', 'OTHER'
);

-- Cotação SC
CREATE TABLE "PurchaseQuotation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "purchaseRequestId" UUID,
  "status" "PurchaseQuotationStatus" NOT NULL DEFAULT 'RASCUNHO',
  "title" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "neededByDate" DATE,
  "expiresAt" TIMESTAMPTZ(6),
  "justification" TEXT,
  "notes" TEXT,
  "requestedByUserId" TEXT,
  "awardedAt" TIMESTAMPTZ(6),
  "awardedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseQuotation_code_key" ON "PurchaseQuotation"("code");
CREATE INDEX "PurchaseQuotation_status_idx" ON "PurchaseQuotation"("status");
CREATE INDEX "PurchaseQuotation_purchaseRequestId_idx" ON "PurchaseQuotation"("purchaseRequestId");
CREATE INDEX "PurchaseQuotation_expiresAt_idx" ON "PurchaseQuotation"("expiresAt");
CREATE INDEX "PurchaseQuotation_createdAt_idx" ON "PurchaseQuotation"("createdAt");

ALTER TABLE "PurchaseQuotation"
  ADD CONSTRAINT "PurchaseQuotation_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "PurchaseQuotationItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "purchaseRequestItemId" UUID,
  "lineNumber" INTEGER NOT NULL,
  "materialId" UUID,
  "materialCodeSnapshot" TEXT,
  "materialDescriptionSnapshot" TEXT,
  "materialUnitSnapshot" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(20,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseQuotationItem_quotationId_lineNumber_key"
  ON "PurchaseQuotationItem"("quotationId", "lineNumber");
CREATE INDEX "PurchaseQuotationItem_quotationId_idx" ON "PurchaseQuotationItem"("quotationId");
CREATE INDEX "PurchaseQuotationItem_materialId_idx" ON "PurchaseQuotationItem"("materialId");
CREATE INDEX "PurchaseQuotationItem_purchaseRequestItemId_idx"
  ON "PurchaseQuotationItem"("purchaseRequestItemId");

ALTER TABLE "PurchaseQuotationItem"
  ADD CONSTRAINT "PurchaseQuotationItem_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseQuotationItem"
  ADD CONSTRAINT "PurchaseQuotationItem_purchaseRequestItemId_fkey"
  FOREIGN KEY ("purchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseQuotationItem"
  ADD CONSTRAINT "PurchaseQuotationItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseQuotationSupplier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "status" "PurchaseQuotationSupplierStatus" NOT NULL DEFAULT 'CONVIDADO',
  "supplierDisplayNameSnapshot" TEXT NOT NULL,
  "supplierDocumentSnapshot" TEXT,
  "invitedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationSupplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseQuotationSupplier_quotationId_supplierId_key"
  ON "PurchaseQuotationSupplier"("quotationId", "supplierId");
CREATE INDEX "PurchaseQuotationSupplier_quotationId_idx" ON "PurchaseQuotationSupplier"("quotationId");
CREATE INDEX "PurchaseQuotationSupplier_supplierId_idx" ON "PurchaseQuotationSupplier"("supplierId");
CREATE INDEX "PurchaseQuotationSupplier_status_idx" ON "PurchaseQuotationSupplier"("status");

ALTER TABLE "PurchaseQuotationSupplier"
  ADD CONSTRAINT "PurchaseQuotationSupplier_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseQuotationSupplier"
  ADD CONSTRAINT "PurchaseQuotationSupplier_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseQuotationOffer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "quotationSupplierId" UUID NOT NULL,
  "status" "PurchaseQuotationOfferStatus" NOT NULL DEFAULT 'RASCUNHO',
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "initialPaymentTerms" TEXT,
  "initialDeliveryTerms" TEXT,
  "initialFreightValue" DECIMAL(20,6),
  "initialValidityDate" DATE,
  "initialLeadTimeDays" INTEGER,
  "awardedPaymentTerms" TEXT,
  "awardedDeliveryTerms" TEXT,
  "awardedFreightValue" DECIMAL(20,6),
  "awardedValidityDate" DATE,
  "awardedLeadTimeDays" INTEGER,
  "awardedAt" TIMESTAMPTZ(6),
  "submittedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseQuotationOffer_quotationId_quotationSupplierId_key"
  ON "PurchaseQuotationOffer"("quotationId", "quotationSupplierId");
CREATE INDEX "PurchaseQuotationOffer_quotationId_idx" ON "PurchaseQuotationOffer"("quotationId");
CREATE INDEX "PurchaseQuotationOffer_quotationSupplierId_idx" ON "PurchaseQuotationOffer"("quotationSupplierId");
CREATE INDEX "PurchaseQuotationOffer_status_idx" ON "PurchaseQuotationOffer"("status");

ALTER TABLE "PurchaseQuotationOffer"
  ADD CONSTRAINT "PurchaseQuotationOffer_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseQuotationOffer"
  ADD CONSTRAINT "PurchaseQuotationOffer_quotationSupplierId_fkey"
  FOREIGN KEY ("quotationSupplierId") REFERENCES "PurchaseQuotationSupplier"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "PurchaseQuotationOfferItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offerId" UUID NOT NULL,
  "quotationItemId" UUID NOT NULL,
  "initialUnitPrice" DECIMAL(20,6) NOT NULL,
  "initialQuantity" DECIMAL(20,6),
  "initialLeadTimeDays" INTEGER,
  "initialFreightValue" DECIMAL(20,6),
  "initialNotes" TEXT,
  "awardedUnitPrice" DECIMAL(20,6),
  "awardedQuantity" DECIMAL(20,6),
  "awardedLeadTimeDays" INTEGER,
  "awardedFreightValue" DECIMAL(20,6),
  "awardedAt" TIMESTAMPTZ(6),
  "awardedRoundLineId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationOfferItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseQuotationOfferItem_offerId_quotationItemId_key"
  ON "PurchaseQuotationOfferItem"("offerId", "quotationItemId");
CREATE UNIQUE INDEX "PurchaseQuotationOfferItem_awardedRoundLineId_key"
  ON "PurchaseQuotationOfferItem"("awardedRoundLineId");
CREATE INDEX "PurchaseQuotationOfferItem_offerId_idx" ON "PurchaseQuotationOfferItem"("offerId");
CREATE INDEX "PurchaseQuotationOfferItem_quotationItemId_idx" ON "PurchaseQuotationOfferItem"("quotationItemId");

ALTER TABLE "PurchaseQuotationOfferItem"
  ADD CONSTRAINT "PurchaseQuotationOfferItem_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "PurchaseQuotationOffer"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseQuotationOfferItem"
  ADD CONSTRAINT "PurchaseQuotationOfferItem_quotationItemId_fkey"
  FOREIGN KEY ("quotationItemId") REFERENCES "PurchaseQuotationItem"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseNegotiationRound" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "status" "PurchaseNegotiationRoundStatus" NOT NULL DEFAULT 'ABERTA',
  "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),
  "openedByUserId" TEXT,
  "closedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseNegotiationRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseNegotiationRound_quotationId_roundNumber_key"
  ON "PurchaseNegotiationRound"("quotationId", "roundNumber");
CREATE INDEX "PurchaseNegotiationRound_quotationId_idx" ON "PurchaseNegotiationRound"("quotationId");
CREATE INDEX "PurchaseNegotiationRound_status_idx" ON "PurchaseNegotiationRound"("status");

ALTER TABLE "PurchaseNegotiationRound"
  ADD CONSTRAINT "PurchaseNegotiationRound_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Linhas de rodada: append-only (sem updatedAt)
CREATE TABLE "PurchaseNegotiationRoundLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "roundId" UUID NOT NULL,
  "offerItemId" UUID NOT NULL,
  "unitPrice" DECIMAL(20,6) NOT NULL,
  "quantity" DECIMAL(20,6),
  "leadTimeDays" INTEGER,
  "freightValue" DECIMAL(20,6),
  "paymentTerms" TEXT,
  "deliveryTerms" TEXT,
  "proposedBy" "PurchaseNegotiationActor" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "PurchaseNegotiationRoundLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseNegotiationRoundLine_roundId_offerItemId_key"
  ON "PurchaseNegotiationRoundLine"("roundId", "offerItemId");
CREATE INDEX "PurchaseNegotiationRoundLine_roundId_idx" ON "PurchaseNegotiationRoundLine"("roundId");
CREATE INDEX "PurchaseNegotiationRoundLine_offerItemId_idx" ON "PurchaseNegotiationRoundLine"("offerItemId");
CREATE INDEX "PurchaseNegotiationRoundLine_createdAt_idx" ON "PurchaseNegotiationRoundLine"("createdAt");

ALTER TABLE "PurchaseNegotiationRoundLine"
  ADD CONSTRAINT "PurchaseNegotiationRoundLine_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "PurchaseNegotiationRound"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseNegotiationRoundLine"
  ADD CONSTRAINT "PurchaseNegotiationRoundLine_offerItemId_fkey"
  FOREIGN KEY ("offerItemId") REFERENCES "PurchaseQuotationOfferItem"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- FK circular: awardedRoundLine após tabela de linhas existir
ALTER TABLE "PurchaseQuotationOfferItem"
  ADD CONSTRAINT "PurchaseQuotationOfferItem_awardedRoundLineId_fkey"
  FOREIGN KEY ("awardedRoundLineId") REFERENCES "PurchaseNegotiationRoundLine"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- Pedido de compra (antes de approvals que referenciam PO/receipt)
CREATE TABLE "PurchaseOrder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'RASCUNHO',
  "purchaseRequestId" UUID,
  "quotationId" UUID,
  "awardedOfferId" UUID,
  "supplierId" UUID NOT NULL,
  "supplierDisplayNameSnapshot" TEXT NOT NULL,
  "supplierDocumentSnapshot" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "paymentTermsSnapshot" TEXT,
  "deliveryTermsSnapshot" TEXT,
  "freightValueSnapshot" DECIMAL(20,6),
  "totalAmountSnapshot" DECIMAL(20,6),
  "expectedDeliveryDate" DATE,
  "issuedAt" TIMESTAMPTZ(6),
  "confirmedAt" TIMESTAMPTZ(6),
  "issuedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_purchaseRequestId_idx" ON "PurchaseOrder"("purchaseRequestId");
CREATE INDEX "PurchaseOrder_quotationId_idx" ON "PurchaseOrder"("quotationId");
CREATE INDEX "PurchaseOrder_issuedAt_idx" ON "PurchaseOrder"("issuedAt");
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_awardedOfferId_fkey"
  FOREIGN KEY ("awardedOfferId") REFERENCES "PurchaseQuotationOffer"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseOrderItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchaseOrderId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "purchaseRequestItemId" UUID,
  "quotationItemId" UUID,
  "materialId" UUID,
  "materialCodeSnapshot" TEXT,
  "materialDescriptionSnapshot" TEXT,
  "materialUnitSnapshot" TEXT,
  "description" TEXT NOT NULL,
  "quantityOrdered" DECIMAL(20,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitPriceSnapshot" DECIMAL(20,6) NOT NULL,
  "lineTotalSnapshot" DECIMAL(20,6) NOT NULL,
  "inventoryItemId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_lineNumber_key"
  ON "PurchaseOrderItem"("purchaseOrderId", "lineNumber");
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_materialId_idx" ON "PurchaseOrderItem"("materialId");
CREATE INDEX "PurchaseOrderItem_inventoryItemId_idx" ON "PurchaseOrderItem"("inventoryItemId");
CREATE INDEX "PurchaseOrderItem_quotationItemId_idx" ON "PurchaseOrderItem"("quotationItemId");

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseRequestItemId_fkey"
  FOREIGN KEY ("purchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_quotationItemId_fkey"
  FOREIGN KEY ("quotationItemId") REFERENCES "PurchaseQuotationItem"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "status" "PurchaseReceiptStatus" NOT NULL DEFAULT 'RASCUNHO',
  "receivedAt" TIMESTAMPTZ(6),
  "warehouseId" UUID,
  "warehouseCodeSnapshot" TEXT,
  "nfeNumber" TEXT,
  "nfeId" TEXT,
  "notes" TEXT,
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" TEXT,
  "reversedAt" TIMESTAMPTZ(6),
  "inventoryMovementId" UUID,
  "reversalMovementId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseReceipt_code_key" ON "PurchaseReceipt"("code");
CREATE UNIQUE INDEX "PurchaseReceipt_inventoryMovementId_key" ON "PurchaseReceipt"("inventoryMovementId");
CREATE UNIQUE INDEX "PurchaseReceipt_reversalMovementId_key" ON "PurchaseReceipt"("reversalMovementId");
CREATE INDEX "PurchaseReceipt_purchaseOrderId_idx" ON "PurchaseReceipt"("purchaseOrderId");
CREATE INDEX "PurchaseReceipt_status_idx" ON "PurchaseReceipt"("status");
CREATE INDEX "PurchaseReceipt_receivedAt_idx" ON "PurchaseReceipt"("receivedAt");
CREATE INDEX "PurchaseReceipt_warehouseId_idx" ON "PurchaseReceipt"("warehouseId");
CREATE INDEX "PurchaseReceipt_createdAt_idx" ON "PurchaseReceipt"("createdAt");

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseReceiptItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receiptId" UUID NOT NULL,
  "purchaseOrderItemId" UUID NOT NULL,
  "materialId" UUID,
  "materialCodeSnapshot" TEXT,
  "materialDescriptionSnapshot" TEXT,
  "quantityReceived" DECIMAL(20,6) NOT NULL,
  "quantityAccepted" DECIMAL(20,6) NOT NULL,
  "quantityRejected" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL,
  "unitCostSnapshot" DECIMAL(20,6),
  "inventoryMovementId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseReceiptItem_receiptId_purchaseOrderItemId_key"
  ON "PurchaseReceiptItem"("receiptId", "purchaseOrderItemId");
CREATE INDEX "PurchaseReceiptItem_receiptId_idx" ON "PurchaseReceiptItem"("receiptId");
CREATE INDEX "PurchaseReceiptItem_purchaseOrderItemId_idx" ON "PurchaseReceiptItem"("purchaseOrderItemId");
CREATE INDEX "PurchaseReceiptItem_materialId_idx" ON "PurchaseReceiptItem"("materialId");
CREATE INDEX "PurchaseReceiptItem_inventoryMovementId_idx" ON "PurchaseReceiptItem"("inventoryMovementId");

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PurchaseApproval" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "targetType" "PurchaseApprovalTargetType" NOT NULL,
  "status" "PurchaseApprovalStatus" NOT NULL DEFAULT 'PENDENTE',
  "quotationId" UUID,
  "purchaseOrderId" UUID,
  "receiptId" UUID,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "requestedByUserId" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMPTZ(6),
  "reason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseApproval_targetType_status_idx" ON "PurchaseApproval"("targetType", "status");
CREATE INDEX "PurchaseApproval_quotationId_idx" ON "PurchaseApproval"("quotationId");
CREATE INDEX "PurchaseApproval_purchaseOrderId_idx" ON "PurchaseApproval"("purchaseOrderId");
CREATE INDEX "PurchaseApproval_receiptId_idx" ON "PurchaseApproval"("receiptId");
CREATE INDEX "PurchaseApproval_createdAt_idx" ON "PurchaseApproval"("createdAt");

ALTER TABLE "PurchaseApproval"
  ADD CONSTRAINT "PurchaseApproval_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseApproval"
  ADD CONSTRAINT "PurchaseApproval_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PurchaseApproval"
  ADD CONSTRAINT "PurchaseApproval_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "PurchaseEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityType" "PurchaseEvidenceEntityType" NOT NULL,
  "entityId" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "evidenceType" "PurchaseEvidenceType" NOT NULL DEFAULT 'OTHER',
  "notes" TEXT,
  "uploadedBy" TEXT,
  "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseEvidence_entityType_entityId_idx"
  ON "PurchaseEvidence"("entityType", "entityId");
CREATE INDEX "PurchaseEvidence_uploadedAt_idx" ON "PurchaseEvidence"("uploadedAt");
CREATE INDEX "PurchaseEvidence_storageKey_idx" ON "PurchaseEvidence"("storageKey");
