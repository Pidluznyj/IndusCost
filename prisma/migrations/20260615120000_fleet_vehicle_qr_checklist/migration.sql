-- CreateEnum
CREATE TYPE "FleetVehicleChecklistTokenStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "FleetReservationChecklistType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'AUTO_CHECK_OUT');

-- CreateEnum
CREATE TYPE "FleetReservationChecklistSource" AS ENUM ('PUBLIC_QR', 'ADMIN', 'AUTO_FROM_NEXT_CHECKIN');

-- CreateEnum
CREATE TYPE "FleetReservationChecklistStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FleetReservationChecklistItemStatus" AS ENUM ('OK', 'ATENCAO', 'AVARIA', 'NAO_SE_APLICA');

-- CreateTable
CREATE TABLE "FleetVehicleChecklistToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "publicToken" TEXT NOT NULL,
    "status" "FleetVehicleChecklistTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID,

    CONSTRAINT "FleetVehicleChecklistToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetReservationChecklist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "type" "FleetReservationChecklistType" NOT NULL,
    "source" "FleetReservationChecklistSource" NOT NULL,
    "status" "FleetReservationChecklistStatus" NOT NULL DEFAULT 'COMPLETED',
    "odometer" DECIMAL(20,6) NOT NULL,
    "fuelLevel" TEXT,
    "generalNotes" TEXT,
    "responsibilityAccepted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedByCpf" TEXT,
    "completedByName" TEXT,
    "triggeredByChecklistId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetReservationChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetReservationChecklistItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checklistId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "FleetReservationChecklistItemStatus" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetReservationChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicleChecklistToken_vehicleId_key" ON "FleetVehicleChecklistToken"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicleChecklistToken_publicToken_key" ON "FleetVehicleChecklistToken"("publicToken");

-- CreateIndex
CREATE INDEX "FleetVehicleChecklistToken_status_idx" ON "FleetVehicleChecklistToken"("status");

-- CreateIndex
CREATE INDEX "FleetReservationChecklist_reservationId_idx" ON "FleetReservationChecklist"("reservationId");

-- CreateIndex
CREATE INDEX "FleetReservationChecklist_vehicleId_idx" ON "FleetReservationChecklist"("vehicleId");

-- CreateIndex
CREATE INDEX "FleetReservationChecklist_driverId_idx" ON "FleetReservationChecklist"("driverId");

-- CreateIndex
CREATE INDEX "FleetReservationChecklist_type_idx" ON "FleetReservationChecklist"("type");

-- CreateIndex
CREATE INDEX "FleetReservationChecklist_completedAt_idx" ON "FleetReservationChecklist"("completedAt");

-- CreateIndex
CREATE INDEX "FleetReservationChecklistItem_checklistId_idx" ON "FleetReservationChecklistItem"("checklistId");

-- CreateIndex
CREATE INDEX "FleetReservationChecklistItem_code_idx" ON "FleetReservationChecklistItem"("code");

-- AddForeignKey
ALTER TABLE "FleetVehicleChecklistToken" ADD CONSTRAINT "FleetVehicleChecklistToken_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FleetReservationChecklist" ADD CONSTRAINT "FleetReservationChecklist_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "FleetReservation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FleetReservationChecklist" ADD CONSTRAINT "FleetReservationChecklist_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FleetReservationChecklist" ADD CONSTRAINT "FleetReservationChecklist_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FleetReservationChecklist" ADD CONSTRAINT "FleetReservationChecklist_triggeredByChecklistId_fkey" FOREIGN KEY ("triggeredByChecklistId") REFERENCES "FleetReservationChecklist"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FleetReservationChecklistItem" ADD CONSTRAINT "FleetReservationChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "FleetReservationChecklist"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
