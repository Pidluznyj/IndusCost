-- CreateEnum
CREATE TYPE "NomusOptionalPricingSelectionMode" AS ENUM ('EXACTLY_ONE', 'OPTIONAL_ONE', 'MULTIPLE');

-- CreateTable
CREATE TABLE "NomusOptionalPricingGroup" (
    "id" TEXT NOT NULL,
    "parentCode" TEXT NOT NULL,
    "parentProductId" UUID,
    "listaMateriaisId" INTEGER,
    "listaMateriaisNome" TEXT,
    "groupName" TEXT NOT NULL,
    "selectionMode" "NomusOptionalPricingSelectionMode" NOT NULL DEFAULT 'EXACTLY_ONE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "selectedNone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusOptionalPricingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusOptionalPricingChoice" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "parentCode" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentDescription" TEXT,
    "plannedQuantity" DECIMAL(20,6),
    "nomusSourceLineIds" JSONB,
    "isSelectedForPricing" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusOptionalPricingChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NomusOptionalPricingGroup_parentCode_idx" ON "NomusOptionalPricingGroup"("parentCode");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingGroup_parentProductId_idx" ON "NomusOptionalPricingGroup"("parentProductId");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingGroup_listaMateriaisId_idx" ON "NomusOptionalPricingGroup"("listaMateriaisId");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingGroup_isActive_idx" ON "NomusOptionalPricingGroup"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NomusOptionalPricingChoice_groupId_componentCode_key" ON "NomusOptionalPricingChoice"("groupId", "componentCode");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingChoice_groupId_idx" ON "NomusOptionalPricingChoice"("groupId");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingChoice_parentCode_idx" ON "NomusOptionalPricingChoice"("parentCode");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingChoice_componentCode_idx" ON "NomusOptionalPricingChoice"("componentCode");

-- CreateIndex
CREATE INDEX "NomusOptionalPricingChoice_isSelectedForPricing_idx" ON "NomusOptionalPricingChoice"("isSelectedForPricing");

-- AddForeignKey
ALTER TABLE "NomusOptionalPricingChoice" ADD CONSTRAINT "NomusOptionalPricingChoice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "NomusOptionalPricingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
