-- Governança de aprovação para cotações oficiais (HIGH/CRITICAL).

CREATE TYPE "MaterialMarketQuoteOfficialStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'OFFICIAL',
  'REPLACED'
);

CREATE TYPE "MaterialOfficialQuoteAuditAction" AS ENUM (
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SET_OFFICIAL',
  'REPLACED'
);

ALTER TABLE "MaterialMarketQuote"
ADD COLUMN "officialStatus" "MaterialMarketQuoteOfficialStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "submittedForApprovalBy" TEXT,
ADD COLUMN "submittedForApprovalAt" TIMESTAMPTZ(6),
ADD COLUMN "approvedBy" TEXT,
ADD COLUMN "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN "setOfficialBy" TEXT,
ADD COLUMN "setOfficialAt" TIMESTAMPTZ(6);

UPDATE "MaterialMarketQuote"
SET "officialStatus" = 'OFFICIAL'
WHERE "isOfficialReference" = true;

CREATE INDEX "MaterialMarketQuote_materialId_officialStatus_idx"
ON "MaterialMarketQuote" ("materialId", "officialStatus");

ALTER TABLE "MaterialOfficialQuoteAudit"
ADD COLUMN "quoteId" UUID,
ADD COLUMN "action" "MaterialOfficialQuoteAuditAction",
ADD COLUMN "rejectionReason" TEXT;

UPDATE "MaterialOfficialQuoteAudit"
SET
  "quoteId" = "newQuoteId",
  "action" = 'SET_OFFICIAL'
WHERE "quoteId" IS NULL;

ALTER TABLE "MaterialOfficialQuoteAudit"
ALTER COLUMN "quoteId" SET NOT NULL,
ALTER COLUMN "action" SET NOT NULL,
ALTER COLUMN "action" SET DEFAULT 'SET_OFFICIAL';

ALTER TABLE "MaterialOfficialQuoteAudit"
ALTER COLUMN "newQuoteId" DROP NOT NULL;

CREATE INDEX "MaterialOfficialQuoteAudit_quoteId_idx"
ON "MaterialOfficialQuoteAudit" ("quoteId");
