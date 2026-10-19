-- Desempenho, Cultura e Potencial: classificação (OFFICIAL/TEST) e ativação (ACTIVE/INACTIVE) do ciclo.
-- Só ADD COLUMN com default e CREATE INDEX. Ciclos existentes ficam OFFICIAL e ACTIVE: nada muda
-- retroativamente na elegibilidade. Reclassificar um ciclo como TEST é ação explícita do SUPER_ADMIN.

-- AlterTable
ALTER TABLE "HrPerformanceCycle" ADD COLUMN     "activation" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "activationChangedAt" TIMESTAMPTZ(6),
ADD COLUMN     "activationChangedByUserId" UUID,
ADD COLUMN     "activationReason" TEXT,
ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'OFFICIAL',
ADD COLUMN     "classifiedAt" TIMESTAMPTZ(6),
ADD COLUMN     "classifiedByUserId" UUID;

-- CreateIndex
CREATE INDEX "HrPerformanceCycle_classification_activation_idx" ON "HrPerformanceCycle"("classification", "activation");
