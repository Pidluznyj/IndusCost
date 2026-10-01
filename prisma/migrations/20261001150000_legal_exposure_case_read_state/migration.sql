-- Exposure: estado de leitura das movimentações por usuário e CNJ canônico. Aditivo.

CREATE TABLE IF NOT EXISTS "LegalExposureCaseReadState" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "processNumberNormalized" TEXT NOT NULL,
    "lastMovementsReadAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalExposureCaseReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegalExposureCaseReadState_userId_processNumberNormalized_key"
  ON "LegalExposureCaseReadState"("userId", "processNumberNormalized");

CREATE INDEX IF NOT EXISTS "LegalExposureCaseReadState_userId_idx"
  ON "LegalExposureCaseReadState"("userId");

CREATE INDEX IF NOT EXISTS "LegalExposureCaseReadState_processNumberNormalized_idx"
  ON "LegalExposureCaseReadState"("processNumberNormalized");

ALTER TABLE "LegalExposureCaseReadState"
  DROP CONSTRAINT IF EXISTS "LegalExposureCaseReadState_userId_fkey";

ALTER TABLE "LegalExposureCaseReadState"
  ADD CONSTRAINT "LegalExposureCaseReadState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
