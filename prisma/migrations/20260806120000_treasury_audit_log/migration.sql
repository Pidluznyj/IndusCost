-- Central de Tesouraria — auditoria append-only.
-- Aditiva: CREATE TABLE + índices + trigger anti UPDATE/DELETE.
-- Não aplicar em produção via Cursor — usuário executa migrate deploy.

CREATE TABLE "TreasuryAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "metadataJson" JSONB,
  "justification" TEXT,
  "requestId" TEXT,
  "sessionId" TEXT,
  "userId" UUID,
  "userName" TEXT,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryAuditLog_entityType_entityId_idx"
  ON "TreasuryAuditLog"("entityType", "entityId");

CREATE INDEX "TreasuryAuditLog_action_idx"
  ON "TreasuryAuditLog"("action");

CREATE INDEX "TreasuryAuditLog_userId_idx"
  ON "TreasuryAuditLog"("userId");

CREATE INDEX "TreasuryAuditLog_sessionId_idx"
  ON "TreasuryAuditLog"("sessionId");

CREATE INDEX "TreasuryAuditLog_requestId_idx"
  ON "TreasuryAuditLog"("requestId");

CREATE INDEX "TreasuryAuditLog_occurredAt_idx"
  ON "TreasuryAuditLog"("occurredAt");

CREATE INDEX "TreasuryAuditLog_createdAt_idx"
  ON "TreasuryAuditLog"("createdAt");

ALTER TABLE "TreasuryAuditLog"
  ADD CONSTRAINT "TreasuryAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Imutabilidade: bloqueia UPDATE/DELETE comuns (append-only).
CREATE OR REPLACE FUNCTION treasury_audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TreasuryAuditLog is append-only and cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER treasury_audit_log_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryAuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_audit_log_reject_mutation();
