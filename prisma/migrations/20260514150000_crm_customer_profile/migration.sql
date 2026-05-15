-- CreateTable: perfil de relacionamento comercial do cliente (CRM)
CREATE TABLE "CrmCustomerProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,

    "preferredChannel" TEXT,
    "bestContactTime" TEXT,
    "contactFrequency" TEXT,
    "communicationStyle" TEXT,

    "commercialProfile" TEXT,
    "buyingMotivation" TEXT,
    "commonObjections" TEXT,
    "relationshipLevel" TEXT,
    "commercialTemperature" TEXT,

    "interests" TEXT,
    "favoriteTeam" TEXT,
    "importantDates" TEXT,
    "personalPreferences" TEXT,
    "avoidTopics" TEXT,
    "relationshipNotes" TEXT,

    "informationSource" TEXT,
    "sensitivityLevel" TEXT NOT NULL DEFAULT 'NORMAL',
    "lastConfirmedAt" TIMESTAMP(6),
    "updatedByName" TEXT,

    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCustomerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmCustomerProfile_customerId_key" ON "CrmCustomerProfile"("customerId");

CREATE INDEX "CrmCustomerProfile_relationshipLevel_idx" ON "CrmCustomerProfile"("relationshipLevel");

CREATE INDEX "CrmCustomerProfile_commercialTemperature_idx" ON "CrmCustomerProfile"("commercialTemperature");

ALTER TABLE "CrmCustomerProfile" ADD CONSTRAINT "CrmCustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
