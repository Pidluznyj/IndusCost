-- TreasuryScenarioPolicy — singleton "GLOBAL" com parâmetros dos cenários
-- Otimista/Realista/Pessimista da Caixa (fase 2 da consolidação de cenários).
-- Additivo puro: nada é apagado, nenhum default histórico é reescrito.
-- Alterações são auditadas via TreasuryAuditLog (entityType MODULE,
-- entityId "SCENARIO_POLICY:GLOBAL").

CREATE TABLE IF NOT EXISTS "TreasuryScenarioPolicy" (
    "id"                                     TEXT NOT NULL DEFAULT 'GLOBAL',
    "pessimisticEnabled"                     BOOLEAN NOT NULL DEFAULT true,
    "optimisticReceivableAdvanceLimitDays"   INTEGER NOT NULL DEFAULT 0,
    "optimisticPayableDelayLimitDays"        INTEGER NOT NULL DEFAULT 0,
    "pessimisticReceivableDelayDays"         INTEGER NOT NULL DEFAULT 15,
    "pessimisticOverdueReceivableDelayDays"  INTEGER,
    "pessimisticTreatBrokenPromiseAsDelayed" BOOLEAN NOT NULL DEFAULT true,
    "useCustomerBehaviorHistory"             BOOLEAN NOT NULL DEFAULT false,
    "useSupplierBehaviorHistory"             BOOLEAN NOT NULL DEFAULT false,
    "version"                                INTEGER NOT NULL DEFAULT 1,
    "updatedAt"                              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"                              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId"                        UUID,

    CONSTRAINT "TreasuryScenarioPolicy_pkey" PRIMARY KEY ("id")
);

-- Relação com AppUser (SetNull ao apagar o usuário — política sobrevive).
ALTER TABLE "TreasuryScenarioPolicy"
  ADD CONSTRAINT "TreasuryScenarioPolicy_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed do singleton com valores conservadores da política inicial. Se já
-- existir (rerun local), mantém sem sobrescrever — nunca reescrever config
-- em rerun de migration.
INSERT INTO "TreasuryScenarioPolicy" (
    "id",
    "pessimisticEnabled",
    "optimisticReceivableAdvanceLimitDays",
    "optimisticPayableDelayLimitDays",
    "pessimisticReceivableDelayDays",
    "pessimisticOverdueReceivableDelayDays",
    "pessimisticTreatBrokenPromiseAsDelayed",
    "useCustomerBehaviorHistory",
    "useSupplierBehaviorHistory",
    "version"
) VALUES (
    'GLOBAL',
    true,
    0,
    0,
    15,
    NULL,
    true,
    false,
    false,
    1
)
ON CONFLICT ("id") DO NOTHING;
