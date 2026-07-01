-- Quantidade por item no conjunto da proposta comercial ao cliente.
CREATE TABLE "ProjectClientProposalItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "quantityPerSet" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectClientProposalItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectClientProposalItem_projectId_targetItemId_key"
ON "ProjectClientProposalItem"("projectId", "targetItemId");

CREATE INDEX "ProjectClientProposalItem_projectId_idx" ON "ProjectClientProposalItem"("projectId");

ALTER TABLE "ProjectClientProposalItem"
ADD CONSTRAINT "ProjectClientProposalItem_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
