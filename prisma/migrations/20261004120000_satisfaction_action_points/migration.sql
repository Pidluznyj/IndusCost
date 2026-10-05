-- Satisfação — action points de pesquisa encerrada.
--
-- Um action point por ponto de atenção (resposta com nota crítica <= 2):
-- responsável, plano de ação, data limite, situação e retorno ao cliente.
--
-- Aditivo: 2 CREATE TYPE, 1 CREATE TABLE; nenhuma tabela existente é alterada.

-- CreateEnum
CREATE TYPE "SatisfactionActionPointStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SatisfactionActionPointPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "SatisfactionActionPoint" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "answerId" UUID NOT NULL,
    "responsibleUserId" UUID NOT NULL,
    "responsibleNameSnapshot" TEXT NOT NULL,
    "priority" "SatisfactionActionPointPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "SatisfactionActionPointStatus" NOT NULL DEFAULT 'OPEN',
    "rootCause" TEXT,
    "actionPlan" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "resultNotes" TEXT,
    "customerFeedbackAt" DATE,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionActionPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionActionPoint_answerId_key" ON "SatisfactionActionPoint"("answerId");

-- CreateIndex
CREATE INDEX "SatisfactionActionPoint_campaignId_status_idx" ON "SatisfactionActionPoint"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SatisfactionActionPoint_responsibleUserId_status_dueDate_idx" ON "SatisfactionActionPoint"("responsibleUserId", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "SatisfactionActionPoint" ADD CONSTRAINT "SatisfactionActionPoint_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionActionPoint" ADD CONSTRAINT "SatisfactionActionPoint_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "SatisfactionSurveyAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

