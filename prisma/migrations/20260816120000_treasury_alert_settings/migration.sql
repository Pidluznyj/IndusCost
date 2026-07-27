-- Central de Tesouraria — configuração global de alertas (Prompt 41).
-- Padrão singleton GLOBAL (como MaterialMarketAlertGlobalConfig). Aditiva.

CREATE TABLE "TreasuryAlertSettings" (
    "id" TEXT NOT NULL,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "relevantReceiptMinAmount" DECIMAL(20,2) NOT NULL DEFAULT 10000.00,
    "customerConcentrationTopN" INTEGER NOT NULL DEFAULT 3,
    "customerConcentrationMinSharePercent" DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    "staleBalanceHours" INTEGER NOT NULL DEFAULT 36,
    "syncMaxAgeHours" INTEGER NOT NULL DEFAULT 24,
    "severityByKindJson" JSONB,
    "enabledByKindJson" JSONB,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" UUID,

    CONSTRAINT "TreasuryAlertSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TreasuryAlertSettings" ADD CONSTRAINT "TreasuryAlertSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TreasuryAlertSettings" ("id") VALUES ('GLOBAL');
