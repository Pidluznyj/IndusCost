-- Complemento QR: CPF + vínculo com FleetDriver na solicitação pública.

ALTER TABLE "FleetPublicReservationRequest" ADD COLUMN IF NOT EXISTS "requesterCpf" TEXT;
ALTER TABLE "FleetPublicReservationRequest" ADD COLUMN IF NOT EXISTS "driverId" UUID;

CREATE INDEX IF NOT EXISTS "FleetPublicReservationRequest_driverId_idx" ON "FleetPublicReservationRequest"("driverId");
CREATE INDEX IF NOT EXISTS "FleetPublicReservationRequest_requesterCpf_idx" ON "FleetPublicReservationRequest"("requesterCpf");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FleetPublicReservationRequest_driverId_fkey'
  ) THEN
    ALTER TABLE "FleetPublicReservationRequest"
      ADD CONSTRAINT "FleetPublicReservationRequest_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
