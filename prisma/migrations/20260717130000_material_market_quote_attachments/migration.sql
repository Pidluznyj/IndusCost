-- Anexos e nível de confiabilidade sugerido para cotações de mercado.

CREATE TYPE "MaterialMarketQuoteReliabilityLevel" AS ENUM ('MANUAL', 'BAIXA', 'MEDIA', 'ALTA');
CREATE TYPE "MaterialMarketQuoteAttachmentType" AS ENUM ('PDF', 'IMAGE', 'SPREADSHEET', 'EMAIL', 'PROPOSAL', 'OTHER');

ALTER TABLE "MaterialMarketQuote"
ADD COLUMN "suggestedReliabilityLevel" "MaterialMarketQuoteReliabilityLevel";

CREATE TABLE "MaterialMarketQuoteAttachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quoteId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "attachmentType" "MaterialMarketQuoteAttachmentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "suggestedReliabilityLevel" "MaterialMarketQuoteReliabilityLevel",
    "notes" TEXT,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMarketQuoteAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketQuoteAttachment_quoteId_uploadedAt_idx"
ON "MaterialMarketQuoteAttachment"("quoteId", "uploadedAt" DESC);

ALTER TABLE "MaterialMarketQuoteAttachment"
ADD CONSTRAINT "MaterialMarketQuoteAttachment_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "MaterialMarketQuote"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "MaterialMarketQuoteAuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quoteId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMarketQuoteAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketQuoteAuditLog_quoteId_createdAt_idx"
ON "MaterialMarketQuoteAuditLog"("quoteId", "createdAt" DESC);

ALTER TABLE "MaterialMarketQuoteAuditLog"
ADD CONSTRAINT "MaterialMarketQuoteAuditLog_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "MaterialMarketQuote"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
