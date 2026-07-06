CREATE TABLE IF NOT EXISTS "IntegrationRun" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "sourceSystem" text NOT NULL DEFAULT 'NOMUS',
  "target" text NOT NULL,
  "mode" text NOT NULL,
  "kind" text,
  "status" text NOT NULL,
  "success" boolean,

  "command" text,
  "startedAt" timestamp(3) without time zone,
  "finishedAt" timestamp(3) without time zone,
  "durationMs" integer,
  "exitCode" integer,

  "logFile" text,
  "runnerLogFile" text,

  "pageRead" integer,
  "ordersRead" integer,
  "startPage" integer,
  "maxPages" integer,
  "lastPage" integer,

  "eligibleCount" integer,
  "blockedCount" integer,
  "createdCount" integer,
  "updatedCount" integer,
  "itemsCreated" integer,

  "blockedReasons" jsonb,
  "blockedPreview" jsonb,
  "summaryJson" jsonb,
  "errorMessage" text,

  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationRun_logFile_key"
ON "IntegrationRun" ("logFile")
WHERE "logFile" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IntegrationRun_sourceSystem_target_mode_idx"
ON "IntegrationRun" ("sourceSystem", "target", "mode");

CREATE INDEX IF NOT EXISTS "IntegrationRun_status_idx"
ON "IntegrationRun" ("status");

CREATE INDEX IF NOT EXISTS "IntegrationRun_startedAt_idx"
ON "IntegrationRun" ("startedAt");

CREATE INDEX IF NOT EXISTS "IntegrationRun_createdAt_idx"
ON "IntegrationRun" ("createdAt");

CREATE INDEX IF NOT EXISTS "IntegrationRun_target_status_startedAt_idx"
ON "IntegrationRun" ("target", "status", "startedAt");

CREATE OR REPLACE FUNCTION "set_IntegrationRun_updatedAt"()
RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "IntegrationRun_set_updatedAt" ON "IntegrationRun";

CREATE TRIGGER "IntegrationRun_set_updatedAt"
BEFORE UPDATE ON "IntegrationRun"
FOR EACH ROW
EXECUTE FUNCTION "set_IntegrationRun_updatedAt"();

COMMENT ON TABLE "IntegrationRun" IS 'Histórico estruturado de execuções de integrações e sincronizações, começando por Nomus sales-orders.';
COMMENT ON COLUMN "IntegrationRun"."sourceSystem" IS 'Sistema origem da integração, ex: NOMUS.';
COMMENT ON COLUMN "IntegrationRun"."target" IS 'Alvo sincronizado, ex: sales-orders, proposals, products, customers.';
COMMENT ON COLUMN "IntegrationRun"."mode" IS 'Modo da execução: dry ou apply.';
COMMENT ON COLUMN "IntegrationRun"."kind" IS 'Tipo do log/execução: runner, sync, orchestrator ou similar.';
COMMENT ON COLUMN "IntegrationRun"."status" IS 'Status da execução: RUNNING, SUCCESS, FAILED, SKIPPED ou UNKNOWN.';
COMMENT ON COLUMN "IntegrationRun"."logFile" IS 'Arquivo de log principal da execução, quando existir.';
COMMENT ON COLUMN "IntegrationRun"."runnerLogFile" IS 'Arquivo de log do runner operacional, quando existir.';
COMMENT ON COLUMN "IntegrationRun"."summaryJson" IS 'Resumo estruturado bruto da execução para auditoria e evolução futura.';
