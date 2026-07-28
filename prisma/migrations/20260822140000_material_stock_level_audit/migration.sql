-- Auditoria append-only dos parâmetros de nível (contingência/mínimo/recomendado).
-- Aditivo: não altera quantity, custos nem MaterialStockConference.

CREATE TABLE IF NOT EXISTS "MaterialStockLevelAudit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "materialId" UUID NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'UPDATE_LEVELS',
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "userId" UUID,
  "userName" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialStockLevelAudit_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "MaterialStockLevelAudit"
    ADD CONSTRAINT "MaterialStockLevelAudit_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "Material"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MaterialStockLevelAudit_materialId_createdAt_idx"
  ON "MaterialStockLevelAudit"("materialId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "MaterialStockLevelAudit_userId_createdAt_idx"
  ON "MaterialStockLevelAudit"("userId", "createdAt" DESC);
