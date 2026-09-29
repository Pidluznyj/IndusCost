-- Política viva: snapshot normativo e changeset imutáveis da versão.
ALTER TABLE "CommercialPolicyVersion" ADD COLUMN "normativeSnapshot" JSONB;
ALTER TABLE "CommercialPolicyVersion" ADD COLUMN "normativeSnapshotHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CommercialPolicyVersion" ADD COLUMN "changeSet" JSONB;
ALTER TABLE "CommercialPolicyVersion" ADD COLUMN "changeSetHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CommercialPolicyVersion" ADD COLUMN "previousVersionId" UUID;

ALTER TABLE "CommercialPolicyAcceptance" ADD COLUMN "normativeSnapshotHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CommercialPolicyAcceptance" ADD COLUMN "changeSetHash" TEXT NOT NULL DEFAULT '';
