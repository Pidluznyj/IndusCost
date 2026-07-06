-- Projetos — orçamentos técnicos e simulações

CREATE TYPE "ProjectType" AS ENUM (
  'NEW_PRODUCT',
  'NEW_COMPONENT',
  'MOLD',
  'PRODUCT_CHANGE',
  'PRODUCT_WITH_NEW_COMPONENT',
  'FULL_DEVELOPMENT',
  'QUICK_ESTIMATE'
);

CREATE TYPE "ProjectStatus" AS ENUM (
  'DRAFT',
  'TECHNICAL_ANALYSIS',
  'WAITING_QUOTATION',
  'WAITING_INTERNAL_APPROVAL',
  'SENT_TO_CUSTOMER',
  'NEGOTIATION',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CONVERTED'
);

CREATE TYPE "ProjectSimulatedItemType" AS ENUM (
  'RAW_MATERIAL',
  'COMPONENT',
  'FINISHED_PRODUCT',
  'PACKAGING',
  'SERVICE',
  'MOLD',
  'TOOLING',
  'OUTSOURCED_PROCESS',
  'OTHER'
);

CREATE TYPE "ProjectStructureSourceType" AS ENUM (
  'EXISTING_PRODUCT',
  'EXISTING_MATERIAL',
  'SIMULATED_ITEM',
  'MANUAL'
);

CREATE TYPE "ProjectStructureLineType" AS ENUM (
  'RAW_MATERIAL',
  'COMPONENT',
  'PACKAGING',
  'SERVICE',
  'PROCESS',
  'MOLD_AMORTIZATION',
  'OTHER'
);

CREATE TYPE "ProjectMoldChargeMode" AS ENUM (
  'CHARGED_SEPARATELY',
  'AMORTIZED_IN_PRODUCT',
  'PARTIALLY_ABSORBED',
  'INTERNAL_INVESTMENT'
);

CREATE TYPE "ProjectMoldOwnership" AS ENUM (
  'CUSTOMER',
  'COMPANY',
  'SHARED',
  'UNDEFINED'
);

CREATE TABLE "Project" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerDocument" TEXT,
  "description" TEXT,
  "projectType" "ProjectType" NOT NULL,
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "commercialOwner" TEXT,
  "technicalOwner" TEXT,
  "expectedMonthlyVolume" DECIMAL(20,6),
  "targetPrice" DECIMAL(20,6),
  "targetMarginPercent" DECIMAL(10,6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_number_key" ON "Project"("number");
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "Project_projectType_idx" ON "Project"("projectType");
CREATE INDEX "Project_customerName_idx" ON "Project"("customerName");
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");

CREATE TABLE "ProjectVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "assumptionsJson" TEXT,
  "totalEstimatedCost" DECIMAL(20,6),
  "totalMoldCost" DECIMAL(20,6),
  "totalAmortizedMoldCost" DECIMAL(20,6),
  "unitCost" DECIMAL(20,6),
  "suggestedPrice" DECIMAL(20,6),
  "marginPercent" DECIMAL(10,6),
  "markupPercent" DECIMAL(10,6),
  "expectedVolume" DECIMAL(20,6),
  "notes" TEXT,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectVersion_projectId_versionNumber_key" ON "ProjectVersion"("projectId", "versionNumber");
CREATE INDEX "ProjectVersion_projectId_idx" ON "ProjectVersion"("projectId");
CREATE INDEX "ProjectVersion_isCurrent_idx" ON "ProjectVersion"("isCurrent");

ALTER TABLE "ProjectVersion"
  ADD CONSTRAINT "ProjectVersion_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "ProjectSimulatedProduct" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "versionId" UUID NOT NULL,
  "provisionalCode" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'UN',
  "estimatedWeight" DECIMAL(20,6),
  "expectedVolume" DECIMAL(20,6),
  "batchSize" DECIMAL(20,6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSimulatedProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectSimulatedProduct_projectId_idx" ON "ProjectSimulatedProduct"("projectId");
CREATE INDEX "ProjectSimulatedProduct_versionId_idx" ON "ProjectSimulatedProduct"("versionId");

ALTER TABLE "ProjectSimulatedProduct"
  ADD CONSTRAINT "ProjectSimulatedProduct_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProjectSimulatedProduct"
  ADD CONSTRAINT "ProjectSimulatedProduct_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "ProjectSimulatedItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "versionId" UUID NOT NULL,
  "provisionalCode" TEXT,
  "description" TEXT NOT NULL,
  "itemType" "ProjectSimulatedItemType" NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'UN',
  "estimatedUnitCost" DECIMAL(20,6),
  "quotedUnitCost" DECIMAL(20,6),
  "supplierName" TEXT,
  "leadTimeDays" INTEGER,
  "estimatedWeight" DECIMAL(20,6),
  "lossPercent" DECIMAL(10,6) DEFAULT 0,
  "requiresQuotation" BOOLEAN NOT NULL DEFAULT false,
  "requiresEngineeringReview" BOOLEAN NOT NULL DEFAULT false,
  "canBecomeOfficial" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSimulatedItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectSimulatedItem_projectId_idx" ON "ProjectSimulatedItem"("projectId");
CREATE INDEX "ProjectSimulatedItem_versionId_idx" ON "ProjectSimulatedItem"("versionId");
CREATE INDEX "ProjectSimulatedItem_itemType_idx" ON "ProjectSimulatedItem"("itemType");

ALTER TABLE "ProjectSimulatedItem"
  ADD CONSTRAINT "ProjectSimulatedItem_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProjectSimulatedItem"
  ADD CONSTRAINT "ProjectSimulatedItem_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "ProjectStructureLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "versionId" UUID NOT NULL,
  "simulatedProductId" UUID,
  "lineType" "ProjectStructureLineType" NOT NULL,
  "sourceType" "ProjectStructureSourceType" NOT NULL,
  "existingProductId" UUID,
  "existingMaterialId" UUID,
  "simulatedItemId" UUID,
  "descriptionSnapshot" TEXT NOT NULL,
  "unitSnapshot" TEXT NOT NULL,
  "quantity" DECIMAL(20,6) NOT NULL,
  "lossPercent" DECIMAL(10,6) DEFAULT 0,
  "unitCostSnapshot" DECIMAL(20,6) NOT NULL,
  "totalCost" DECIMAL(20,6) NOT NULL,
  "supplierNameSnapshot" TEXT,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectStructureLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectStructureLine_projectId_idx" ON "ProjectStructureLine"("projectId");
CREATE INDEX "ProjectStructureLine_versionId_idx" ON "ProjectStructureLine"("versionId");
CREATE INDEX "ProjectStructureLine_simulatedProductId_idx" ON "ProjectStructureLine"("simulatedProductId");

ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_simulatedProductId_fkey"
  FOREIGN KEY ("simulatedProductId") REFERENCES "ProjectSimulatedProduct"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_existingProductId_fkey"
  FOREIGN KEY ("existingProductId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_existingMaterialId_fkey"
  FOREIGN KEY ("existingMaterialId") REFERENCES "Material"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectStructureLine"
  ADD CONSTRAINT "ProjectStructureLine_simulatedItemId_fkey"
  FOREIGN KEY ("simulatedItemId") REFERENCES "ProjectSimulatedItem"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "ProjectMold" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "versionId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "moldType" TEXT,
  "cavities" INTEGER,
  "estimatedLifeCycles" INTEGER,
  "supplierName" TEXT,
  "constructionCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "maintenanceCost" DECIMAL(20,6),
  "changeCost" DECIMAL(20,6),
  "leadTimeDays" INTEGER,
  "chargeMode" "ProjectMoldChargeMode" NOT NULL DEFAULT 'CHARGED_SEPARATELY',
  "amortizationQuantity" DECIMAL(20,6),
  "amortizedCostPerUnit" DECIMAL(20,6),
  "ownership" "ProjectMoldOwnership" NOT NULL DEFAULT 'UNDEFINED',
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectMold_projectId_idx" ON "ProjectMold"("projectId");
CREATE INDEX "ProjectMold_versionId_idx" ON "ProjectMold"("versionId");

ALTER TABLE "ProjectMold"
  ADD CONSTRAINT "ProjectMold_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ProjectMold"
  ADD CONSTRAINT "ProjectMold_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
