-- Metas (OKR) — governança e auditoria (P3).
--
-- Por que: snapshots guardam só o VALOR diário. Quando o alvo/base/direção/
-- período de um KR muda, "72% em 10/06" perde o contexto — 72% de qual
-- compromisso? A tabela de versões congela a CONFIGURAÇÃO a cada alteração
-- relevante; o audit log registra mudanças de Goal e exclusões.
--
-- Aditivo e leve: nenhuma meta é recomputada. O backfill cria apenas a
-- versão inicial (1) espelhando a configuração ATUAL de cada KR existente —
-- um INSERT..SELECT set-based e idempotente (WHERE NOT EXISTS).

CREATE TABLE IF NOT EXISTS "GoalKeyResultVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "keyResultId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" UUID,
  "actorName" TEXT,
  "reason" TEXT,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "trackingType" "GoalKeyResultTrackingType" NOT NULL,
  "baseline" DECIMAL(20, 6) NOT NULL,
  "target" DECIMAL(20, 6) NOT NULL,
  "weight" DECIMAL(10, 4) NOT NULL,
  "unit" TEXT,
  "ownerAppUserId" UUID NOT NULL,
  "status" "GoalStatus" NOT NULL,
  "startDate" DATE,
  "endDate" DATE,
  "targetBasis" "GoalTargetBasis" NOT NULL,
  "comparisonMode" "GoalTargetComparisonMode",
  "comparisonValue" DECIMAL(20, 6),
  "comparisonPercent" DECIMAL(10, 4),
  "ruleJson" JSONB,

  CONSTRAINT "GoalKeyResultVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalKeyResultVersion_keyResultId_fkey" FOREIGN KEY ("keyResultId")
    REFERENCES "GoalKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoalKeyResultVersion_keyResultId_version_key"
  ON "GoalKeyResultVersion"("keyResultId", "version");
CREATE INDEX IF NOT EXISTS "GoalKeyResultVersion_keyResultId_idx"
  ON "GoalKeyResultVersion"("keyResultId");
CREATE INDEX IF NOT EXISTS "GoalKeyResultVersion_createdAt_idx"
  ON "GoalKeyResultVersion"("createdAt");

CREATE TABLE IF NOT EXISTS "GoalAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "actorUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GoalAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoalAuditLog_entityType_entityId_idx"
  ON "GoalAuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "GoalAuditLog_createdAt_idx"
  ON "GoalAuditLog"("createdAt");

-- Backfill idempotente: versão inicial = configuração ATUAL (não recompõe o
-- passado — apenas garante que todo KR existente tem versão 1 como base).
INSERT INTO "GoalKeyResultVersion" (
  "keyResultId", "version", "source", "title", "trackingType", "baseline",
  "target", "weight", "unit", "ownerAppUserId", "status", "startDate",
  "endDate", "targetBasis", "comparisonMode", "comparisonValue",
  "comparisonPercent", "ruleJson"
)
SELECT
  kr."id", 1, 'CREATE', kr."title", kr."trackingType", kr."baseline",
  kr."target", kr."weight", kr."unit", kr."ownerAppUserId", kr."status",
  kr."startDate", kr."endDate", kr."targetBasis", kr."comparisonMode",
  kr."comparisonValue", kr."comparisonPercent", kr."ruleJson"
FROM "GoalKeyResult" kr
WHERE NOT EXISTS (
  SELECT 1 FROM "GoalKeyResultVersion" v WHERE v."keyResultId" = kr."id"
);
