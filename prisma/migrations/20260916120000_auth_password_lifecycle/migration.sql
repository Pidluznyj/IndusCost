-- Ciclo seguro de senha dos usuários humanos.
--
-- Estritamente ADITIVA: nenhuma coluna renomeada, nenhum DROP, nenhum backfill.
--
-- "mustChangePassword" nasce FALSE para todo mundo: nenhum usuário existente é
-- forçado a trocar a senha no deploy. Só o reset administrativo liga a flag.
--
-- "passwordChangedAt" fica NULL nos usuários históricos DE PROPÓSITO. NULL
-- significa "data desconhecida", não "nunca trocou". Preencher com NOW() aqui
-- inventaria um fato que o sistema não observou.
--
-- Senha de usuário humano NÃO expira por tempo: não existe (e não deve
-- existir) coluna de validade/rotação.

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMPTZ(6);

-- Auditoria de eventos de credencial. Separada de "PermissionAuditLog", que
-- audita mutação de ACL e não tem onde guardar origem da requisição.
-- NUNCA armazena senha, hash, salt ou token — apenas metadados.
CREATE TABLE IF NOT EXISTS "SecurityAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventType" TEXT NOT NULL,
  "actorUserId" UUID,
  "targetUserId" UUID,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityAuditLog_actorUserId_createdAt_idx"
  ON "SecurityAuditLog" ("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAuditLog_targetUserId_createdAt_idx"
  ON "SecurityAuditLog" ("targetUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAuditLog_eventType_createdAt_idx"
  ON "SecurityAuditLog" ("eventType", "createdAt");

-- ON DELETE SET NULL: excluir um usuário não pode apagar a trilha de auditoria.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SecurityAuditLog_actorUserId_fkey'
  ) THEN
    ALTER TABLE "SecurityAuditLog"
      ADD CONSTRAINT "SecurityAuditLog_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SecurityAuditLog_targetUserId_fkey'
  ) THEN
    ALTER TABLE "SecurityAuditLog"
      ADD CONSTRAINT "SecurityAuditLog_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "AppUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
