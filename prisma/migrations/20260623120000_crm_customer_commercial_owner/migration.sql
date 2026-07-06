-- Responsável comercial manual do cliente (camada local CRM).
CREATE TABLE "CrmCustomerCommercialOwner" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "customerNameSnapshot" TEXT,
    "sellerExternalId" INTEGER,
    "sellerResponsibleName" TEXT,
    "sellerCanonicalName" TEXT NOT NULL,
    "sellerIdentityKey" TEXT NOT NULL,
    "sellerAliasExternalIds" JSONB NOT NULL DEFAULT '[]',
    "assignmentSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdByName" TEXT,
    "updatedByUserId" UUID,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCustomerCommercialOwner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmCustomerCommercialOwner_customerId_key" ON "CrmCustomerCommercialOwner"("customerId");

CREATE INDEX "CrmCustomerCommercialOwner_sellerIdentityKey_idx" ON "CrmCustomerCommercialOwner"("sellerIdentityKey");

CREATE INDEX "CrmCustomerCommercialOwner_sellerExternalId_idx" ON "CrmCustomerCommercialOwner"("sellerExternalId");

CREATE INDEX "CrmCustomerCommercialOwner_isActive_idx" ON "CrmCustomerCommercialOwner"("isActive");

ALTER TABLE "CrmCustomerCommercialOwner" ADD CONSTRAINT "CrmCustomerCommercialOwner_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
