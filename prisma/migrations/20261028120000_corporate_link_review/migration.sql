-- Candidatos societários e governança do vínculo. Aditiva. Não aplicada neste ambiente.
-- CPF em claro não é gravado. Linhas antigas de vínculo permanecem confirmadas.

ALTER TABLE "CommercialCorporateMembership"
  ADD COLUMN IF NOT EXISTS "memberName" TEXT,
  ADD COLUMN IF NOT EXISTS "memberNameKey" TEXT;

CREATE INDEX IF NOT EXISTS "CommercialCorporateMembership_memberNameKey_idx"
  ON "CommercialCorporateMembership"("memberNameKey");

ALTER TABLE "CustomerCorporateLink"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS "evidenceKind" TEXT,
  ADD COLUMN IF NOT EXISTS "justification" TEXT,
  ADD COLUMN IF NOT EXISTS "actorUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "CustomerCorporateLink_status_idx"
  ON "CustomerCorporateLink"("status");
