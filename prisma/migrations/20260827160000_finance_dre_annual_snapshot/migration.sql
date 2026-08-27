-- Snapshot anual materializado das fontes do DRE Gerencial (year + company).
-- Projecao/cache: nunca fonte da verdade. Aditiva e idempotente; nenhuma
-- tabela existente e tocada, nenhum backfill executado aqui.
CREATE TABLE IF NOT EXISTS "FinanceDreAnnualSnapshot" (
    "year" INTEGER NOT NULL,
    "company" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "seriesJson" JSONB,
    "computedAt" TIMESTAMPTZ(6),
    "computeDurationMs" INTEGER,
    "availableThroughMonthAtCompute" INTEGER,
    "dirtyAt" TIMESTAMPTZ(6),
    "dirtyReason" TEXT,
    "dirtyGeneration" INTEGER NOT NULL DEFAULT 0,
    "refreshClaimedAt" TIMESTAMPTZ(6),
    "refreshClaimToken" TEXT,
    "lastSuccessfulRefreshAt" TIMESTAMPTZ(6),
    "lastRefreshError" TEXT,
    "lastRefreshErrorAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FinanceDreAnnualSnapshot_pkey" PRIMARY KEY ("year", "company")
);

CREATE INDEX IF NOT EXISTS "FinanceDreAnnualSnapshot_dirtyAt_idx"
    ON "FinanceDreAnnualSnapshot"("dirtyAt");
