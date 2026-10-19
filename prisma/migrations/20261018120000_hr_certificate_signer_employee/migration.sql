-- Certificados: quem assina pode ser uma pessoa do sistema (nome e cargo vêm do cadastro).
-- O local de emissão passa a ser fixo (Curitiba – PR). O prefixo da numeração é gerado pelo
-- sistema e não muda depois de gravado: a numeração é única e sequencial.
-- Aditivo. Não há certificado emitido em produção antes desta migration (20261016120000 ainda não implantada).

ALTER TABLE "HrTrainingCertificateSettings" ADD COLUMN "signerEmployeeId" UUID;

ALTER TABLE "HrTrainingCertificateSettings" ADD CONSTRAINT "HrTrainingCertificateSettings_signerEmployeeId_fkey" FOREIGN KEY ("signerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

UPDATE "HrTrainingCertificateSettings" SET "issuePlace" = 'Curitiba – PR';
ALTER TABLE "HrTrainingCertificateSettings" ADD CONSTRAINT "HrTrainingCertificateSettings_issuePlace_check" CHECK ("issuePlace" = 'Curitiba – PR');

-- Prefixo imutável depois de gravado.
CREATE FUNCTION "HrTrainingCertificateSettings_prefix_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."numberPrefix" IS DISTINCT FROM OLD."numberPrefix" THEN
    RAISE EXCEPTION 'Prefixo da numeração dos certificados não pode ser alterado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HrTrainingCertificateSettings_prefix_immutable_trg"
  BEFORE UPDATE ON "HrTrainingCertificateSettings"
  FOR EACH ROW EXECUTE FUNCTION "HrTrainingCertificateSettings_prefix_immutable"();
