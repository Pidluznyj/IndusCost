-- Monitoramento de matéria-prima pela Inteligência de Mercado (Suprimentos).

CREATE TYPE "MaterialMarketCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "Material"
  ADD COLUMN "isMarketMonitored" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketCriticality" "MaterialMarketCriticality",
  ADD COLUMN "marketMonitoringFrequencyDays" INTEGER,
  ADD COLUMN "marketNotes" TEXT;

CREATE INDEX "Material_isMarketMonitored_idx" ON "Material"("isMarketMonitored");
