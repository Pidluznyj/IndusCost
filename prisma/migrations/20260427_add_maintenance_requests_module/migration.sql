-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM (
  'NOVA_SOLICITACAO',
  'EM_ANALISE',
  'AGUARDANDO_MATERIAL',
  'AGUARDANDO_COMPRA',
  'PROGRAMADO',
  'EM_EXECUCAO',
  'CONCLUIDO',
  'CANCELADO'
);

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM (
  'ELETRICA',
  'HIDRAULICA',
  'PINTURA',
  'CIVIL_ALVENARIA',
  'TELHADO_CALHA',
  'INFRAESTRUTURA',
  'SEGURANCA',
  'LIMPEZA_CORRETIVA',
  'OUTRO'
);

-- CreateTable
CREATE TABLE "MaintenanceRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "requester" TEXT NOT NULL,
  "areaSector" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "category" "MaintenanceCategory" NOT NULL,
  "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIA',
  "status" "MaintenanceStatus" NOT NULL DEFAULT 'NOVA_SOLICITACAO',
  "responsible" TEXT,
  "desiredDate" TIMESTAMPTZ(6),
  "notes" TEXT,
  "needsMaterial" BOOLEAN NOT NULL DEFAULT false,
  "materialNotes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRequestStatusHistory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "maintenanceRequestId" UUID NOT NULL,
  "fromStatus" "MaintenanceStatus",
  "toStatus" "MaintenanceStatus" NOT NULL,
  "comment" TEXT,
  "changedBy" TEXT,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MaintenanceRequestStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRequest_number_key" ON "MaintenanceRequest" ("number");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_status_idx" ON "MaintenanceRequest" ("status");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_priority_idx" ON "MaintenanceRequest" ("priority");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_category_idx" ON "MaintenanceRequest" ("category");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_createdAt_idx" ON "MaintenanceRequest" ("createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_status_priority_createdAt_idx" ON "MaintenanceRequest" ("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceRequestStatusHistory_maintenanceRequestId_idx" ON "MaintenanceRequestStatusHistory" ("maintenanceRequestId");

-- CreateIndex
CREATE INDEX "MaintenanceRequestStatusHistory_changedAt_idx" ON "MaintenanceRequestStatusHistory" ("changedAt");

-- AddForeignKey
ALTER TABLE "MaintenanceRequestStatusHistory"
ADD CONSTRAINT "MaintenanceRequestStatusHistory_maintenanceRequestId_fkey"
FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
