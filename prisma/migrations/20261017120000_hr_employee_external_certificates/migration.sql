-- Certificados externos do colaborador (upload na ficha › Certificados).
-- Aditivo: só cria a tabela. O arquivo continua no dossiê (HrEmployeeDocument, tipo
-- TRAINING_CERTIFICATE); excluir o documento exclui o certificado (CASCADE).

-- CreateTable
CREATE TABLE "HrEmployeeExternalCertificate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "workloadHours" DECIMAL(7,1),
    "completedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "competencyId" UUID,
    "notes" TEXT,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeExternalCertificate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrEmployeeExternalCertificate_title_check" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "HrEmployeeExternalCertificate_institution_check" CHECK (length(btrim("institution")) > 0),
    CONSTRAINT "HrEmployeeExternalCertificate_workload_check" CHECK ("workloadHours" IS NULL OR "workloadHours" > 0),
    CONSTRAINT "HrEmployeeExternalCertificate_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt" >= "completedAt")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeExternalCertificate_documentId_key" ON "HrEmployeeExternalCertificate"("documentId");

-- CreateIndex
CREATE INDEX "HrEmployeeExternalCertificate_employeeId_completedAt_idx" ON "HrEmployeeExternalCertificate"("employeeId", "completedAt" DESC);

-- CreateIndex
CREATE INDEX "HrEmployeeExternalCertificate_competencyId_idx" ON "HrEmployeeExternalCertificate"("competencyId");

-- AddForeignKey
ALTER TABLE "HrEmployeeExternalCertificate" ADD CONSTRAINT "HrEmployeeExternalCertificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeExternalCertificate" ADD CONSTRAINT "HrEmployeeExternalCertificate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "HrEmployeeDocument"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeExternalCertificate" ADD CONSTRAINT "HrEmployeeExternalCertificate_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

