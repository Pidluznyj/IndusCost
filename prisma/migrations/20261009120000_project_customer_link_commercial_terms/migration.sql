-- Projetos: vínculo com o cadastro oficial de clientes + condições comerciais estruturadas.
-- Aditivo: só colunas opcionais. Não altera dados existentes; o vínculo dos projetos antigos
-- é feito pela conciliação por CNPJ (scripts/projectCustomerLinkReconcile.ts, dry-run + confirmação).
-- customerName/customerDocument continuam como snapshot histórico.
-- Também cria ProjectIssuedDocument (emissões imutáveis dos documentos do projeto).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "application" TEXT,
ADD COLUMN     "clientNotes" TEXT,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "customerLinkSource" TEXT,
ADD COLUMN     "customerLinkedAt" TIMESTAMPTZ(6),
ADD COLUMN     "deliveryLocation" TEXT,
ADD COLUMN     "deliveryTimeDays" INTEGER,
ADD COLUMN     "desiredDeadline" TIMESTAMPTZ(6),
ADD COLUMN     "freightCondition" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "proposalValidityDays" INTEGER;

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Vocabulário fechado (mesmo da Proposta comercial / ficha).
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_freightCondition_check" CHECK ("freightCondition" IS NULL OR "freightCondition" IN ('CIF', 'FOB')),
  ADD CONSTRAINT "Project_priority_check" CHECK ("priority" IS NULL OR "priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  ADD CONSTRAINT "Project_customerLinkSource_check" CHECK ("customerLinkSource" IS NULL OR "customerLinkSource" IN ('LOOKUP', 'CNPJ_RECONCILIATION')),
  ADD CONSTRAINT "Project_commercial_days_check" CHECK (("proposalValidityDays" IS NULL OR "proposalValidityDays" >= 0) AND ("deliveryTimeDays" IS NULL OR "deliveryTimeDays" >= 0));

-- Emissões de documentos do projeto (conteúdo congelado + sha256).
-- CreateTable
CREATE TABLE "ProjectIssuedDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID,
    "projectCode" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "versionId" UUID,
    "versionNumber" INTEGER,
    "valueSource" TEXT NOT NULL,
    "pricingSavedAt" TIMESTAMPTZ(6),
    "pricingStale" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" UUID,
    "issuedByName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    CONSTRAINT "ProjectIssuedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIssuedDocument_documentNumber_key" ON "ProjectIssuedDocument"("documentNumber");

-- CreateIndex
CREATE INDEX "ProjectIssuedDocument_projectId_issuedAt_idx" ON "ProjectIssuedDocument"("projectId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIssuedDocument_projectId_documentType_revision_key" ON "ProjectIssuedDocument"("projectId", "documentType", "revision");

-- AddForeignKey
ALTER TABLE "ProjectIssuedDocument" ADD CONSTRAINT "ProjectIssuedDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ProjectIssuedDocument"
  ADD CONSTRAINT "ProjectIssuedDocument_documentType_check" CHECK ("documentType" IN ('QUICK_FORM', 'FULL_FORM', 'SPREADSHEET', 'EXECUTIVE_REPORT', 'CLIENT_PROPOSAL')),
  ADD CONSTRAINT "ProjectIssuedDocument_valueSource_check" CHECK ("valueSource" IN ('SAVED_PRICING', 'NO_SAVED_PRICING')),
  ADD CONSTRAINT "ProjectIssuedDocument_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "ProjectIssuedDocument_sha256_check" CHECK ("payloadSha256" ~ '^[0-9a-f]{64}$');

-- Imutabilidade: emissões não podem ser alteradas nem apagadas. Única exceção: o vínculo
-- projectId vira NULL quando o projeto é excluído (ON DELETE SET NULL); todo o resto fica igual.
CREATE FUNCTION "ProjectIssuedDocument_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProjectIssuedDocument é imutável (DELETE bloqueado)';
  END IF;
  IF OLD."projectId" IS NOT NULL AND NEW."projectId" IS NULL
     AND (to_jsonb(NEW) - 'projectId') = (to_jsonb(OLD) - 'projectId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ProjectIssuedDocument é imutável (UPDATE bloqueado)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectIssuedDocument_immutable_trg"
  BEFORE UPDATE OR DELETE ON "ProjectIssuedDocument"
  FOR EACH ROW EXECUTE FUNCTION "ProjectIssuedDocument_immutable"();
