-- Aprovação em duas etapas: motorista antes da reserva (fluxo público QR)

ALTER TYPE "FleetPublicReservationRequestStatus" ADD VALUE 'PENDING_DRIVER_APPROVAL';
ALTER TYPE "FleetPublicReservationRequestStatus" ADD VALUE 'PENDING_RESERVATION_APPROVAL';

ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "createdFromPublicReservation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationReviewedAt" TIMESTAMPTZ(6);
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationReviewedByUserId" UUID;
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationRejectionReason" TEXT;

-- Solicitações pendentes legadas aguardavam aprovação da reserva (motoristas já cadastrados internamente)
UPDATE "FleetPublicReservationRequest"
SET "status" = 'PENDING_RESERVATION_APPROVAL'
WHERE "status" = 'PENDING';

ALTER TABLE "FleetPublicReservationRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING_RESERVATION_APPROVAL';
