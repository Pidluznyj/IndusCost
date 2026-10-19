-- Certificados de treinamento (Competências e Desenvolvimento).
-- Aditivo: duas colunas opcionais em HrTraining e duas tabelas novas. Nenhum dado existente muda.
-- Emissões são imutáveis (trigger); a única transição permitida é ACTIVE → CANCELED.

ALTER TABLE "HrTraining" ADD COLUMN "instructorName" TEXT;
ALTER TABLE "HrTraining" ADD COLUMN "syllabus" JSONB;

CREATE TABLE "HrTrainingCertificateSettings" (
    "id" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT NOT NULL,
    "issuePlace" TEXT NOT NULL,
    "numberPrefix" TEXT NOT NULL,
    "updatedByUserId" UUID,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTrainingCertificateSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrTrainingCertificateSettings_singleton_check" CHECK ("id" = 'GLOBAL'),
    CONSTRAINT "HrTrainingCertificateSettings_prefix_check" CHECK ("numberPrefix" ~ '^[A-Z0-9]([A-Z0-9-]{0,14}[A-Z0-9])?$')
);

CREATE TABLE "HrTrainingCertificate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "trainingId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" UUID,
    "issuedByName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "canceledAt" TIMESTAMPTZ(6),
    "canceledByUserId" UUID,
    "canceledByName" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "HrTrainingCertificate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrTrainingCertificate_status_check" CHECK ("status" IN ('ACTIVE', 'CANCELED')),
    CONSTRAINT "HrTrainingCertificate_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "HrTrainingCertificate_cancel_check" CHECK (
      ("status" = 'ACTIVE' AND "canceledAt" IS NULL AND "cancelReason" IS NULL)
      OR ("status" = 'CANCELED' AND "canceledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "HrTrainingCertificate_number_key" ON "HrTrainingCertificate"("number");
CREATE UNIQUE INDEX "HrTrainingCertificate_year_sequence_key" ON "HrTrainingCertificate"("year", "sequence");
CREATE INDEX "HrTrainingCertificate_trainingId_idx" ON "HrTrainingCertificate"("trainingId");
CREATE INDEX "HrTrainingCertificate_employeeId_idx" ON "HrTrainingCertificate"("employeeId");
-- Um certificado vigente por participante do treinamento (cancelados ficam no histórico).
CREATE UNIQUE INDEX "HrTrainingCertificate_active_participant_uidx" ON "HrTrainingCertificate"("trainingId", "employeeId") WHERE "status" = 'ACTIVE';

ALTER TABLE "HrTrainingCertificate" ADD CONSTRAINT "HrTrainingCertificate_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "HrTraining"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrTrainingCertificate" ADD CONSTRAINT "HrTrainingCertificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Imutabilidade: DELETE bloqueado; UPDATE só ACTIVE → CANCELED preenchendo os campos de cancelamento.
CREATE FUNCTION "HrTrainingCertificate_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HrTrainingCertificate é imutável (DELETE bloqueado)';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'CANCELED'
     AND (to_jsonb(NEW) - 'status' - 'canceledAt' - 'canceledByUserId' - 'canceledByName' - 'cancelReason')
       = (to_jsonb(OLD) - 'status' - 'canceledAt' - 'canceledByUserId' - 'canceledByName' - 'cancelReason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'HrTrainingCertificate é imutável (UPDATE bloqueado)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HrTrainingCertificate_immutable_trg"
  BEFORE UPDATE OR DELETE ON "HrTrainingCertificate"
  FOR EACH ROW EXECUTE FUNCTION "HrTrainingCertificate_immutable"();
