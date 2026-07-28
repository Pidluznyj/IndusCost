-- Conferência de Estoque (Suprimentos / Matéria-prima) — aditivo.
-- Preserva Material.quantity (estoque atual oficial) e todos os campos/fórmulas de custo.
-- Parâmetros de nível: NULL = não configurado (sem default zero).
-- Histórico append-only: MaterialStockConference.

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "contingencyQuantity" DECIMAL(20, 6);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "minimumQuantity" DECIMAL(20, 6);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "recommendedQuantity" DECIMAL(20, 6);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "lastStockConferenceAt" TIMESTAMPTZ(6);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "lastStockConferenceUserId" UUID;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "stockConferenceVersion" INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  CREATE TYPE "MaterialStockConferenceSource" AS ENUM ('TABLET_CONFERENCE', 'MANUAL_API', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MaterialStockConference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "materialId" UUID NOT NULL,
  "previousQuantity" DECIMAL(20, 6) NOT NULL,
  "reportedQuantity" DECIMAL(20, 6) NOT NULL,
  "difference" DECIMAL(20, 6) NOT NULL,
  "unitSnapshot" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "userId" UUID NOT NULL,
  "userName" TEXT,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" "MaterialStockConferenceSource" NOT NULL,
  "previousVersion" INTEGER,
  "previousUpdatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialStockConference_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "MaterialStockConference"
    ADD CONSTRAINT "MaterialStockConference_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "Material"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MaterialStockConference_materialId_recordedAt_idx"
  ON "MaterialStockConference"("materialId", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS "MaterialStockConference_userId_recordedAt_idx"
  ON "MaterialStockConference"("userId", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS "MaterialStockConference_source_recordedAt_idx"
  ON "MaterialStockConference"("source", "recordedAt" DESC);
