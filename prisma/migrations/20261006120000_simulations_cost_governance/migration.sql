-- Governança de custo em Simulações da Engenharia e rastreabilidade em Projetos.
--
-- Estritamente ADITIVA: colunas anuláveis e um índice; sem DROP, sem backfill, sem alteração
-- de dado existente. Nenhuma tabela oficial de custo ou preço é tocada.
--
-- "Simulation" não tem migration de criação no histórico (tabela anterior às migrations),
-- por isso ALTER TABLE IF EXISTS.

-- Cenário de produto existente: base explícita (PUBLISHED | LIVE), autoria e arquivamento.
ALTER TABLE IF EXISTS "Simulation"
  ADD COLUMN IF NOT EXISTS "baselineSource" TEXT,
  ADD COLUMN IF NOT EXISTS "baselineProductionCostVersionId" UUID,
  ADD COLUMN IF NOT EXISTS "baselineRevision" INTEGER,
  ADD COLUMN IF NOT EXISTS "baselineCalculatedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "baselineSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "createdByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "archivedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "archivedByName" TEXT;

-- Simulação de novo produto: autoria pela sessão, arquivamento e identidade do snapshot.
ALTER TABLE "NewProductSimulation"
  ADD COLUMN IF NOT EXISTS "createdByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "archivedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "archivedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotHash" TEXT,
  ADD COLUMN IF NOT EXISTS "schemaVersion" INTEGER;

-- Item de projeto: origem do custo copiado de uma simulação congelada.
ALTER TABLE "ProjectSimulatedItem"
  ADD COLUMN IF NOT EXISTS "sourceSimulationId" UUID,
  ADD COLUMN IF NOT EXISTS "sourceSimulationName" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSimulationSnapshotHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSimulationCostBase" DECIMAL(20,6),
  ADD COLUMN IF NOT EXISTS "sourceSimulationCopiedAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_ProjectSimulatedItem_sourceSimulationId"
  ON "ProjectSimulatedItem"("sourceSimulationId");
