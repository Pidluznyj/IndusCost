-- Backfill após commit dos novos valores de enum (migration estrutural anterior).
-- Solicitações pendentes legadas aguardavam aprovação da reserva (motoristas já cadastrados internamente).

UPDATE "FleetPublicReservationRequest"
SET "status" = 'PENDING_RESERVATION_APPROVAL'
WHERE "status" = 'PENDING';

ALTER TABLE "FleetPublicReservationRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING_RESERVATION_APPROVAL';
