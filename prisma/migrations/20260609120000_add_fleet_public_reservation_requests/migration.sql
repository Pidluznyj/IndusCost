-- Solicitações públicas de reserva de veículo (QR Code) + configurações FleetSettings.

CREATE TYPE "FleetPublicReservationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "FleetPublicReservationRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publicCode" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT,
    "requesterPhone" TEXT,
    "requesterDepartment" TEXT,
    "requesterEmployeeId" TEXT,
    "responsibilityAccepted" BOOLEAN NOT NULL DEFAULT false,
    "requestedDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "notes" TEXT,
    "passengersCount" INTEGER,
    "hasCargo" BOOLEAN,
    "cargoDescription" TEXT,
    "vehicleId" UUID,
    "status" "FleetPublicReservationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewComment" TEXT,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "fleetReservationId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetPublicReservationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetPublicReservationRequest_publicCode_key" ON "FleetPublicReservationRequest"("publicCode");
CREATE UNIQUE INDEX "FleetPublicReservationRequest_fleetReservationId_key" ON "FleetPublicReservationRequest"("fleetReservationId");
CREATE INDEX "FleetPublicReservationRequest_status_idx" ON "FleetPublicReservationRequest"("status");
CREATE INDEX "FleetPublicReservationRequest_requestedDate_idx" ON "FleetPublicReservationRequest"("requestedDate");
CREATE INDEX "FleetPublicReservationRequest_vehicleId_idx" ON "FleetPublicReservationRequest"("vehicleId");
CREATE INDEX "FleetPublicReservationRequest_createdAt_idx" ON "FleetPublicReservationRequest"("createdAt");

ALTER TABLE "FleetPublicReservationRequest" ADD CONSTRAINT "FleetPublicReservationRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "FleetPublicReservationRequest" ADD CONSTRAINT "FleetPublicReservationRequest_fleetReservationId_fkey" FOREIGN KEY ("fleetReservationId") REFERENCES "FleetReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

INSERT INTO "FleetSettings" ("key", "value", "description") VALUES
('publicReservationEnabled', 'false', 'Habilitar solicitação pública de reserva via QR Code'),
('publicReservationToken', '', 'Token público (64 caracteres hex) para URL de solicitação'),
('publicReservationTitle', 'Solicitar reserva de veículo', 'Título exibido na tela pública'),
('publicReservationInstructions', 'Informe seus dados e escolha um horário disponível. Sua solicitação será analisada pela equipe de frota.', 'Texto de boas-vindas na tela pública'),
('publicReservationSlotMinutes', '180', 'Duração de cada slot em minutos (padrão 3 horas)'),
('publicReservationStartHour', '6', 'Hora inicial da janela diária (0-23)'),
('publicReservationEndHour', '20', 'Hora final da janela diária — último slot deve terminar neste horário')
ON CONFLICT ("key") DO NOTHING;
