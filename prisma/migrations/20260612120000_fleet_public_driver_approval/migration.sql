-- Aprovação em duas etapas: motorista antes da reserva (fluxo público QR)
-- Estrutural apenas: PostgreSQL não permite usar novo valor de enum na mesma transação (P3018 / 55P04).
-- Backfill de status e default ficam em 20260612121000_fleet_public_driver_approval_backfill.

ALTER TYPE "FleetPublicReservationRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_DRIVER_APPROVAL';
ALTER TYPE "FleetPublicReservationRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_RESERVATION_APPROVAL';

ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "createdFromPublicReservation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationReviewedAt" TIMESTAMPTZ(6);
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationReviewedByUserId" UUID;
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "publicRegistrationRejectionReason" TEXT;
