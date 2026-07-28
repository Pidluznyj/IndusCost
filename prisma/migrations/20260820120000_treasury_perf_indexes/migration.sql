-- Prompt 58 — índices de leitura da Tesouraria (day-flow, projeção, saldos).
-- Aditivo; sem alteração de regras de negócio.

CREATE INDEX IF NOT EXISTS "NomusAccountsReceivable_settlementDate_idx"
  ON "NomusAccountsReceivable" ("settlementDate");

CREATE INDEX IF NOT EXISTS "NomusAccountsReceivable_sourcePresence_dueDate_idx"
  ON "NomusAccountsReceivable" ("sourcePresenceStatus", "dueDate");

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_settlementDate_idx"
  ON "NomusAccountsPayable" ("settlementDate");

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_paymentDate_idx"
  ON "NomusAccountsPayable" ("paymentDate");

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_scheduleDate_idx"
  ON "NomusAccountsPayable" ("scheduleDate");

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_sourcePresence_dueDate_idx"
  ON "NomusAccountsPayable" ("sourcePresenceStatus", "dueDate");

CREATE INDEX IF NOT EXISTS "TreasuryProjectionRun_company_scenario_status_finished_idx"
  ON "TreasuryProjectionRun" ("companyCode", "scenario", "status", "finishedAt");
