-- Pessoas 360°: unificação controlada (Person.mergedIntoPersonId) e auditoria de vínculos (PersonLinkEvent).
-- Aditiva e idempotente. Nenhum índice de unicidade novo (ver docs/people/auditoria-cadastro-unico-pessoas-induscost.md §10).
-- NÃO executar em produção sem homologação e autorização explícita.

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "mergedIntoPersonId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Person_mergedIntoPersonId_fkey') THEN
    ALTER TABLE "Person"
      ADD CONSTRAINT "Person_mergedIntoPersonId_fkey"
      FOREIGN KEY ("mergedIntoPersonId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Person_mergedIntoPersonId_idx" ON "Person"("mergedIntoPersonId");

CREATE TABLE IF NOT EXISTS "PersonLinkEvent" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "personId"          UUID NOT NULL,
  "eventKind"         TEXT NOT NULL,
  "entityKind"        TEXT,
  "entityId"          UUID,
  "fromPersonId"      UUID,
  "toPersonId"        UUID,
  "actorUserId"       UUID,
  "actorName"         TEXT,
  "reason"            TEXT,
  "evidence"          TEXT,
  "snapshot"          JSONB,
  "reversible"        BOOLEAN NOT NULL DEFAULT false,
  "revertedAt"        TIMESTAMPTZ(6),
  "revertedByEventId" UUID,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonLinkEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonLinkEvent_personId_fkey') THEN
    ALTER TABLE "PersonLinkEvent"
      ADD CONSTRAINT "PersonLinkEvent_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PersonLinkEvent_personId_createdAt_idx" ON "PersonLinkEvent"("personId", "createdAt");
CREATE INDEX IF NOT EXISTS "PersonLinkEvent_entityKind_entityId_idx" ON "PersonLinkEvent"("entityKind", "entityId");
CREATE INDEX IF NOT EXISTS "PersonLinkEvent_eventKind_idx" ON "PersonLinkEvent"("eventKind");
CREATE INDEX IF NOT EXISTS "PersonLinkEvent_createdAt_idx" ON "PersonLinkEvent"("createdAt");
