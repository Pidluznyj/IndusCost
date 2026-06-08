-- Histórico de aprovações/rejeições das solicitações públicas de reserva (QR)

CREATE TYPE "FleetPublicReservationApprovalStage" AS ENUM (
  'DRIVER_REGISTRATION',
  'VEHICLE_RESERVATION',
  'SYSTEM'
);

CREATE TYPE "FleetPublicReservationApprovalAction" AS ENUM (
  'DRIVER_APPROVED',
  'DRIVER_REJECTED',
  'RESERVATION_APPROVED',
  'RESERVATION_REJECTED',
  'RESERVATION_BLOCKED',
  'STATUS_CHANGED'
);

CREATE TABLE "FleetPublicReservationApprovalHistory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publicReservationRequestId" UUID NOT NULL,
  "action" "FleetPublicReservationApprovalAction" NOT NULL,
  "stage" "FleetPublicReservationApprovalStage" NOT NULL,
  "statusBefore" "FleetPublicReservationRequestStatus" NOT NULL,
  "statusAfter" "FleetPublicReservationRequestStatus" NOT NULL,
  "actorUserId" UUID,
  "actorNameSnapshot" TEXT,
  "actorEmailSnapshot" TEXT,
  "driverId" UUID,
  "vehicleId" UUID,
  "fleetReservationId" UUID,
  "comment" TEXT,
  "rejectionReason" TEXT,
  "detailsJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FleetPublicReservationApprovalHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetPublicReservationApprovalHistory_publicReservationRequestId_idx"
  ON "FleetPublicReservationApprovalHistory"("publicReservationRequestId");
CREATE INDEX "FleetPublicReservationApprovalHistory_createdAt_idx"
  ON "FleetPublicReservationApprovalHistory"("createdAt");
CREATE INDEX "FleetPublicReservationApprovalHistory_action_idx"
  ON "FleetPublicReservationApprovalHistory"("action");

ALTER TABLE "FleetPublicReservationApprovalHistory"
  ADD CONSTRAINT "FleetPublicReservationApprovalHistory_publicReservationRequestId_fkey"
  FOREIGN KEY ("publicReservationRequestId")
  REFERENCES "FleetPublicReservationRequest"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
