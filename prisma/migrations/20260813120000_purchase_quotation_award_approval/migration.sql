-- OP-19 — Adjudicação e aprovação da cotação vencedora (aditivo).
-- Sem DROP/RENAME. Sem PO/recebimento/Contas a Pagar.

DO $$ BEGIN
  CREATE TYPE "PurchaseQuotationAwardStatus" AS ENUM (
    'PENDENTE_APROVACAO', 'APROVADA', 'REJEITADA', 'CANCELADA'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseQuotationAwardMode" AS ENUM ('SINGLE', 'SPLIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseQuotationAwardHistoryAction" AS ENUM (
    'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseQuotationAward" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "status" "PurchaseQuotationAwardStatus" NOT NULL DEFAULT 'PENDENTE_APROVACAO',
  "mode" "PurchaseQuotationAwardMode" NOT NULL DEFAULT 'SINGLE',
  "finalRoundId" UUID,
  "justification" TEXT NOT NULL,
  "responsibleUserId" TEXT,
  "responsibleUserName" TEXT,
  "approverUserId" TEXT,
  "approverUserName" TEXT,
  "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMPTZ(6),
  "decisionReason" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "initialComparableTotal" DECIMAL(20,6),
  "awardedComparableTotal" DECIMAL(20,6),
  "totalGain" DECIMAL(20,6),
  "percentGain" DECIMAL(20,6),
  "evidenceCountSnapshot" INTEGER NOT NULL DEFAULT 0,
  "usedEvidenceException" BOOLEAN NOT NULL DEFAULT false,
  "commercialConditionsJson" JSONB,
  "notes" TEXT,
  "approvalId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseQuotationAward_approvalId_key"
  ON "PurchaseQuotationAward"("approvalId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAward_quotationId_idx"
  ON "PurchaseQuotationAward"("quotationId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAward_status_idx"
  ON "PurchaseQuotationAward"("status");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAward_finalRoundId_idx"
  ON "PurchaseQuotationAward"("finalRoundId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAward_submittedAt_idx"
  ON "PurchaseQuotationAward"("submittedAt");

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAward"
    ADD CONSTRAINT "PurchaseQuotationAward_quotationId_fkey"
    FOREIGN KEY ("quotationId") REFERENCES "PurchaseQuotation"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAward"
    ADD CONSTRAINT "PurchaseQuotationAward_finalRoundId_fkey"
    FOREIGN KEY ("finalRoundId") REFERENCES "PurchaseNegotiationRound"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAward"
    ADD CONSTRAINT "PurchaseQuotationAward_approvalId_fkey"
    FOREIGN KEY ("approvalId") REFERENCES "PurchaseApproval"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseQuotationAwardAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "awardId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "offerItemId" UUID NOT NULL,
  "quotationItemId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "quantityAwarded" DECIMAL(20,6) NOT NULL,
  "unitPriceAwarded" DECIMAL(20,6) NOT NULL,
  "lineTotalAwarded" DECIMAL(20,6) NOT NULL,
  "roundLineId" UUID,
  "paymentTermsSnapshot" TEXT,
  "deliveryTermsSnapshot" TEXT,
  "freightValueSnapshot" DECIMAL(20,6),
  "leadTimeDaysSnapshot" INTEGER,
  "validityDateSnapshot" DATE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationAwardAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseQuotationAwardAllocation_awardId_offerItemId_key"
  ON "PurchaseQuotationAwardAllocation"("awardId", "offerItemId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardAllocation_awardId_idx"
  ON "PurchaseQuotationAwardAllocation"("awardId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardAllocation_offerId_idx"
  ON "PurchaseQuotationAwardAllocation"("offerId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardAllocation_offerItemId_idx"
  ON "PurchaseQuotationAwardAllocation"("offerItemId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardAllocation_quotationItemId_idx"
  ON "PurchaseQuotationAwardAllocation"("quotationItemId");

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardAllocation"
    ADD CONSTRAINT "PurchaseQuotationAwardAllocation_awardId_fkey"
    FOREIGN KEY ("awardId") REFERENCES "PurchaseQuotationAward"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardAllocation"
    ADD CONSTRAINT "PurchaseQuotationAwardAllocation_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "PurchaseQuotationOffer"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardAllocation"
    ADD CONSTRAINT "PurchaseQuotationAwardAllocation_offerItemId_fkey"
    FOREIGN KEY ("offerItemId") REFERENCES "PurchaseQuotationOfferItem"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardAllocation"
    ADD CONSTRAINT "PurchaseQuotationAwardAllocation_quotationItemId_fkey"
    FOREIGN KEY ("quotationItemId") REFERENCES "PurchaseQuotationItem"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseQuotationAwardRejection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "awardId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "quotationSupplierId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationAwardRejection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseQuotationAwardRejection_awardId_offerId_key"
  ON "PurchaseQuotationAwardRejection"("awardId", "offerId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardRejection_awardId_idx"
  ON "PurchaseQuotationAwardRejection"("awardId");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardRejection_offerId_idx"
  ON "PurchaseQuotationAwardRejection"("offerId");

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardRejection"
    ADD CONSTRAINT "PurchaseQuotationAwardRejection_awardId_fkey"
    FOREIGN KEY ("awardId") REFERENCES "PurchaseQuotationAward"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardRejection"
    ADD CONSTRAINT "PurchaseQuotationAwardRejection_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "PurchaseQuotationOffer"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseQuotationAwardHistoryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "awardId" UUID NOT NULL,
  "action" "PurchaseQuotationAwardHistoryAction" NOT NULL,
  "reason" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseQuotationAwardHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardHistoryEvent_awardId_createdAt_idx"
  ON "PurchaseQuotationAwardHistoryEvent"("awardId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseQuotationAwardHistoryEvent_action_idx"
  ON "PurchaseQuotationAwardHistoryEvent"("action");

DO $$ BEGIN
  ALTER TABLE "PurchaseQuotationAwardHistoryEvent"
    ADD CONSTRAINT "PurchaseQuotationAwardHistoryEvent_awardId_fkey"
    FOREIGN KEY ("awardId") REFERENCES "PurchaseQuotationAward"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
