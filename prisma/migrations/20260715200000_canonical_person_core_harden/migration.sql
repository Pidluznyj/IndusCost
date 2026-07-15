-- Endurecimento do núcleo Person (Prompt 02).
-- 1) Remove UNIQUE prematuros de CPF/e-mail (mantém índices de busca).
-- 2) Adiciona origem + auditoria leve + inactivatedAt.
-- Compatível se 20260715190000 ainda não rodou: IF EXISTS / IF NOT EXISTS.
-- Não executar em produção pelo Cursor.

DROP INDEX IF EXISTS "Person_cpfNormalized_uidx";
DROP INDEX IF EXISTS "Person_corporateEmail_lower_uidx";

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "createdByUserId" UUID;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "inactivatedAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "Person_origin_idx" ON "Person"("origin");
CREATE INDEX IF NOT EXISTS "Person_createdByUserId_idx" ON "Person"("createdByUserId");

-- Mantém índices não-únicos para busca (criados na migration anterior ou aqui):
CREATE INDEX IF NOT EXISTS "Person_cpfNormalized_idx" ON "Person"("cpfNormalized");
CREATE INDEX IF NOT EXISTS "Person_corporateEmail_idx" ON "Person"("corporateEmail");
