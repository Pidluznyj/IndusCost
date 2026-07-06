-- Gestão de Frota — Fase 1

CREATE TYPE "FleetVehicleOrigin" AS ENUM ('OWNED', 'RENTED', 'LEASING', 'COMODATO', 'THIRD_PARTY');
CREATE TYPE "FleetVehicleStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'BLOCKED', 'CLAIMED', 'INACTIVE', 'RETURNED', 'SOLD');
CREATE TYPE "FleetDriverStatus" AS ENUM ('AUTHORIZED', 'PENDING', 'BLOCKED', 'INACTIVE');
CREATE TYPE "FleetDocumentStatus" AS ENUM ('VALID', 'EXPIRING', 'EXPIRED', 'REPLACED');
CREATE TYPE "FleetReservationStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELED', 'IN_USE', 'FINISHED', 'FINISHED_WITH_PENDING', 'NO_SHOW');
CREATE TYPE "FleetMaintenanceStatus" AS ENUM ('OPEN', 'SCHEDULED', 'QUOTING', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "FleetCostStatus" AS ENUM ('ACTIVE', 'CANCELED');
CREATE TYPE "FleetChecklistResult" AS ENUM ('OK', 'NOT_OK', 'NOT_APPLICABLE');
CREATE TYPE "FleetIncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELED');
CREATE TYPE "FleetFineStatus" AS ENUM ('RECEIVED', 'IDENTIFYING_DRIVER', 'PENDING_PAYMENT', 'PAID', 'CONTESTED', 'CANCELED');
CREATE TYPE "FleetUsageStatus" AS ENUM ('CHECKED_OUT', 'CHECKED_IN', 'CANCELED');
CREATE TYPE "FleetChecklistType" AS ENUM ('CHECKOUT', 'CHECKIN', 'INSPECTION', 'MAINTENANCE');
CREATE TYPE "FleetChecklistStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED');

CREATE TABLE "FleetVehicle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plate" TEXT,
    "renavam" TEXT,
    "chassis" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelYear" INTEGER,
    "manufactureYear" INTEGER,
    "color" TEXT,
    "vehicleType" TEXT,
    "fuelType" TEXT,
    "origin" "FleetVehicleOrigin" NOT NULL DEFAULT 'OWNED',
    "status" "FleetVehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "ownershipType" TEXT,
    "currentKm" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "initialKm" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "costCenter" TEXT,
    "responsibleUserId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetVehicle_plate_active_key" ON "FleetVehicle" ("plate")
WHERE "plate" IS NOT NULL AND "plate" <> '' AND "status" NOT IN ('INACTIVE', 'SOLD', 'RETURNED');

CREATE INDEX "FleetVehicle_status_idx" ON "FleetVehicle"("status");
CREATE INDEX "FleetVehicle_origin_idx" ON "FleetVehicle"("origin");
CREATE INDEX "FleetVehicle_unit_idx" ON "FleetVehicle"("unit");
CREATE INDEX "FleetVehicle_costCenter_idx" ON "FleetVehicle"("costCenter");
CREATE INDEX "FleetVehicle_plate_idx" ON "FleetVehicle"("plate");

CREATE TABLE "FleetVehicleContract" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierDocument" TEXT,
    "contractNumber" TEXT,
    "contractType" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "monthlyValue" DECIMAL(20,6),
    "billingDay" INTEGER,
    "kmFranchise" DECIMAL(20,6),
    "excessKmValue" DECIMAL(20,6),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetVehicleContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetVehicleContract_vehicleId_idx" ON "FleetVehicleContract"("vehicleId");
CREATE INDEX "FleetVehicleContract_status_idx" ON "FleetVehicleContract"("status");
CREATE INDEX "FleetVehicleContract_endDate_idx" ON "FleetVehicleContract"("endDate");

ALTER TABLE "FleetVehicleContract" ADD CONSTRAINT "FleetVehicleContract_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "FleetVehicleDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expirationDate" DATE,
    "status" "FleetDocumentStatus" NOT NULL DEFAULT 'VALID',
    "responsible" TEXT,
    "attachmentUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetVehicleDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetVehicleDocument_vehicleId_idx" ON "FleetVehicleDocument"("vehicleId");
CREATE INDEX "FleetVehicleDocument_expirationDate_idx" ON "FleetVehicleDocument"("expirationDate");
CREATE INDEX "FleetVehicleDocument_status_idx" ON "FleetVehicleDocument"("status");

ALTER TABLE "FleetVehicleDocument" ADD CONSTRAINT "FleetVehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "FleetDriver" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "cnhNumber" TEXT,
    "cnhCategory" TEXT,
    "cnhExpirationDate" DATE,
    "phone" TEXT,
    "email" TEXT,
    "unit" TEXT,
    "costCenter" TEXT,
    "status" "FleetDriverStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetDriver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetDriver_cpf_active_key" ON "FleetDriver" ("cpf")
WHERE "status" NOT IN ('INACTIVE');

CREATE INDEX "FleetDriver_status_idx" ON "FleetDriver"("status");
CREATE INDEX "FleetDriver_cpf_idx" ON "FleetDriver"("cpf");

CREATE TABLE "FleetReservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "requesterUserId" UUID,
    "driverId" UUID,
    "startDateTime" TIMESTAMPTZ(6) NOT NULL,
    "endDateTime" TIMESTAMPTZ(6) NOT NULL,
    "destination" TEXT,
    "reason" TEXT,
    "costCenter" TEXT,
    "status" "FleetReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvalStatus" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "rejectionReason" TEXT,
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetReservation_vehicleId_idx" ON "FleetReservation"("vehicleId");
CREATE INDEX "FleetReservation_driverId_idx" ON "FleetReservation"("driverId");
CREATE INDEX "FleetReservation_status_idx" ON "FleetReservation"("status");
CREATE INDEX "FleetReservation_startDateTime_endDateTime_idx" ON "FleetReservation"("startDateTime", "endDateTime");

ALTER TABLE "FleetReservation" ADD CONSTRAINT "FleetReservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetReservation" ADD CONSTRAINT "FleetReservation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "FleetUsage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "checkoutAt" TIMESTAMPTZ(6),
    "checkoutKm" DECIMAL(20,6),
    "checkoutFuelLevel" TEXT,
    "checkinAt" TIMESTAMPTZ(6),
    "checkinKm" DECIMAL(20,6),
    "checkinFuelLevel" TEXT,
    "kmDriven" DECIMAL(20,6),
    "checkoutNotes" TEXT,
    "checkinNotes" TEXT,
    "status" "FleetUsageStatus" NOT NULL DEFAULT 'CHECKED_OUT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetUsage_reservationId_key" ON "FleetUsage"("reservationId");
CREATE INDEX "FleetUsage_vehicleId_idx" ON "FleetUsage"("vehicleId");
CREATE INDEX "FleetUsage_driverId_idx" ON "FleetUsage"("driverId");

ALTER TABLE "FleetUsage" ADD CONSTRAINT "FleetUsage_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetUsage" ADD CONSTRAINT "FleetUsage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetUsage" ADD CONSTRAINT "FleetUsage_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "FleetChecklist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "reservationId" UUID,
    "usageId" UUID,
    "checklistType" "FleetChecklistType" NOT NULL,
    "status" "FleetChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "performedBy" TEXT,
    "performedAt" TIMESTAMPTZ(6),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetChecklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetChecklist_vehicleId_idx" ON "FleetChecklist"("vehicleId");
CREATE INDEX "FleetChecklist_reservationId_idx" ON "FleetChecklist"("reservationId");

ALTER TABLE "FleetChecklist" ADD CONSTRAINT "FleetChecklist_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetChecklist" ADD CONSTRAINT "FleetChecklist_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "FleetChecklist" ADD CONSTRAINT "FleetChecklist_usageId_fkey" FOREIGN KEY ("usageId") REFERENCES "FleetUsage"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "FleetChecklistItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checklistId" UUID NOT NULL,
    "itemName" TEXT NOT NULL,
    "result" "FleetChecklistResult",
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetChecklistItem_checklistId_idx" ON "FleetChecklistItem"("checklistId");

ALTER TABLE "FleetChecklistItem" ADD CONSTRAINT "FleetChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "FleetChecklist"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "FleetMaintenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "reservationId" UUID,
    "maintenanceType" TEXT NOT NULL,
    "status" "FleetMaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIA',
    "description" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "supplierName" TEXT,
    "estimatedValue" DECIMAL(20,6),
    "finalValue" DECIMAL(20,6),
    "currentKm" DECIMAL(20,6),
    "blocksVehicle" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetMaintenance_vehicleId_idx" ON "FleetMaintenance"("vehicleId");
CREATE INDEX "FleetMaintenance_status_idx" ON "FleetMaintenance"("status");

ALTER TABLE "FleetMaintenance" ADD CONSTRAINT "FleetMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetMaintenance" ADD CONSTRAINT "FleetMaintenance_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "FleetCost" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "contractId" UUID,
    "maintenanceId" UUID,
    "reservationId" UUID,
    "costType" TEXT NOT NULL,
    "costDate" DATE NOT NULL,
    "competence" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "supplierName" TEXT,
    "documentNumber" TEXT,
    "costCenter" TEXT,
    "status" "FleetCostStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetCost_vehicleId_idx" ON "FleetCost"("vehicleId");
CREATE INDEX "FleetCost_costDate_idx" ON "FleetCost"("costDate");
CREATE INDEX "FleetCost_status_idx" ON "FleetCost"("status");

ALTER TABLE "FleetCost" ADD CONSTRAINT "FleetCost_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetCost" ADD CONSTRAINT "FleetCost_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "FleetVehicleContract"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "FleetCost" ADD CONSTRAINT "FleetCost_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "FleetMaintenance"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "FleetCost" ADD CONSTRAINT "FleetCost_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "FleetFueling" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "fuelingDate" TIMESTAMPTZ(6) NOT NULL,
    "km" DECIMAL(20,6) NOT NULL,
    "fuelType" TEXT,
    "liters" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,6),
    "totalValue" DECIMAL(20,6) NOT NULL,
    "stationName" TEXT,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetFueling_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetFueling_vehicleId_idx" ON "FleetFueling"("vehicleId");
CREATE INDEX "FleetFueling_fuelingDate_idx" ON "FleetFueling"("fuelingDate");

ALTER TABLE "FleetFueling" ADD CONSTRAINT "FleetFueling_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetFueling" ADD CONSTRAINT "FleetFueling_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "FleetFine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "reservationId" UUID,
    "infractionDate" TIMESTAMPTZ(6) NOT NULL,
    "location" TEXT,
    "noticeNumber" TEXT,
    "agency" TEXT,
    "amount" DECIMAL(20,6) NOT NULL,
    "points" INTEGER,
    "status" "FleetFineStatus" NOT NULL DEFAULT 'RECEIVED',
    "paidAt" TIMESTAMPTZ(6),
    "contestReason" TEXT,
    "attachmentUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetFine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetFine_vehicleId_idx" ON "FleetFine"("vehicleId");
CREATE INDEX "FleetFine_status_idx" ON "FleetFine"("status");

ALTER TABLE "FleetFine" ADD CONSTRAINT "FleetFine_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetFine" ADD CONSTRAINT "FleetFine_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "FleetFine" ADD CONSTRAINT "FleetFine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "FleetIncident" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "reservationId" UUID,
    "incidentType" TEXT NOT NULL,
    "incidentDate" TIMESTAMPTZ(6) NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIA',
    "status" "FleetIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "insuranceClaimNumber" TEXT,
    "deductibleValue" DECIMAL(20,6),
    "blocksVehicle" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetIncident_vehicleId_idx" ON "FleetIncident"("vehicleId");
CREATE INDEX "FleetIncident_status_idx" ON "FleetIncident"("status");

ALTER TABLE "FleetIncident" ADD CONSTRAINT "FleetIncident_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetIncident" ADD CONSTRAINT "FleetIncident_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "FleetIncident" ADD CONSTRAINT "FleetIncident_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE "FleetAttachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID,
    "contractId" UUID,
    "documentId" UUID,
    "maintenanceId" UUID,
    "fineId" UUID,
    "incidentId" UUID,
    "reservationId" UUID,
    "attachmentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "FleetAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetAttachment_vehicleId_idx" ON "FleetAttachment"("vehicleId");

ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "FleetVehicleContract"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FleetVehicleDocument"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "FleetMaintenance"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "FleetFine"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "FleetIncident"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "FleetAttachment" ADD CONSTRAINT "FleetAttachment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "FleetAuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetAuditLog_entityType_entityId_idx" ON "FleetAuditLog"("entityType", "entityId");
CREATE INDEX "FleetAuditLog_createdAt_idx" ON "FleetAuditLog"("createdAt");

CREATE TABLE "FleetSettings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetSettings_key_key" ON "FleetSettings"("key");

INSERT INTO "FleetSettings" ("key", "value", "description") VALUES
('bloquearReservaDocumentoVencido', 'false', 'Bloquear reserva quando documento do veículo estiver vencido'),
('bloquearRetiradaCnhVencida', 'true', 'Bloquear retirada quando CNH do motorista estiver vencida'),
('checklistRetiradaObrigatorio', 'false', 'Checklist de retirada obrigatório'),
('checklistDevolucaoObrigatorio', 'false', 'Checklist de devolução obrigatório'),
('diasAlertaDocumento', '30', 'Dias antes do vencimento para alerta de documento'),
('diasAlertaCnh', '30', 'Dias antes do vencimento para alerta de CNH'),
('percentualAlertaFranquiaKm', '80', 'Percentual da franquia de km para alerta');
