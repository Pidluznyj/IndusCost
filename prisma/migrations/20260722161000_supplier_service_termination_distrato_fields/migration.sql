-- Campos do termo de distrato + realinha status FINALIZED legado
-- (sem concessão automática de quitação).

UPDATE "SupplierServiceTermination"
SET "status" = 'SIGNED_AWAITING_PAYMENT'
WHERE "status" = 'FINALIZED';

ALTER TABLE "SupplierServiceTermination"
  ADD COLUMN IF NOT EXISTS "documentCode" TEXT,
  ADD COLUMN IF NOT EXISTS "documentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedesId" UUID,
  ADD COLUMN IF NOT EXISTS "originalContractDate" DATE,
  ADD COLUMN IF NOT EXISTS "originalContractReference" TEXT,
  ADD COLUMN IF NOT EXISTS "contractingPartyName" TEXT,
  ADD COLUMN IF NOT EXISTS "contractingPartyDocument" TEXT,
  ADD COLUMN IF NOT EXISTS "contractingPartyRepName" TEXT,
  ADD COLUMN IF NOT EXISTS "contractingPartyRepRole" TEXT,
  ADD COLUMN IF NOT EXISTS "contractingPartyRepDocument" TEXT,
  ADD COLUMN IF NOT EXISTS "contractedPartyName" TEXT,
  ADD COLUMN IF NOT EXISTS "contractedPartyDocument" TEXT,
  ADD COLUMN IF NOT EXISTS "contractedPartyRepName" TEXT,
  ADD COLUMN IF NOT EXISTS "contractedPartyRepDocument" TEXT,
  ADD COLUMN IF NOT EXISTS "contractedServiceDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "signaturePlace" TEXT,
  ADD COLUMN IF NOT EXISTS "terminationModality" "SupplierServiceTerminationModality",
  ADD COLUMN IF NOT EXISTS "terminationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentDueDate" DATE,
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentEffectiveDate" DATE,
  ADD COLUMN IF NOT EXISTS "paymentConfirmedAmount" DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS "paymentProofStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofWaiverReason" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionTreatment" "SupplierServiceTerminationCommissionTreatment",
  ADD COLUMN IF NOT EXISTS "commissionPendingNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionNegotiatedAmount" DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS "commissionNegotiatedOrders" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionNegotiatedJustification" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionNegotiatedApprover" TEXT,
  ADD COLUMN IF NOT EXISTS "noticePenaltyOrigin" "SupplierServiceTerminationNoticeOrigin",
  ADD COLUMN IF NOT EXISTS "noticePenaltyClauseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "noticePenaltyClauseDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "proportionalCompensationJustification" TEXT,
  ADD COLUMN IF NOT EXISTS "extraServicesDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "otherDiscountsDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "contractualNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingObligationsNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "hasPendingObligations" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "witness1Name" TEXT,
  ADD COLUMN IF NOT EXISTS "witness1Document" TEXT,
  ADD COLUMN IF NOT EXISTS "witness2Name" TEXT,
  ADD COLUMN IF NOT EXISTS "witness2Document" TEXT,
  ADD COLUMN IF NOT EXISTS "integrityCode" TEXT,
  ADD COLUMN IF NOT EXISTS "settledSnapshotJson" JSONB,
  ADD COLUMN IF NOT EXISTS "contractTypeConfirmedPj" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "SupplierServiceTermination_documentCode_idx"
  ON "SupplierServiceTermination"("documentCode");
CREATE INDEX IF NOT EXISTS "SupplierServiceTermination_supersedesId_idx"
  ON "SupplierServiceTermination"("supersedesId");
