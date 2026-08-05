-- Regra dos N dias de conciliação — captura o padrão real de baixa Nomus
-- (paymentDate/settlementDate = data do lançamento, não do dinheiro).
-- Aditiva pura: defaults `true`/`3` preservam a intenção da regra sem
-- exigir passe humano; a política pode ser desligada depois na UI de
-- admin (ver treasuryScenarioPolicyService.server.ts).
--
-- Não altera valores oficiais, não faz backfill, não toca em títulos.

ALTER TABLE "TreasuryScenarioPolicy"
  ADD COLUMN IF NOT EXISTS "settlementReconciliationEnabled"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "settlementReconciliationToleranceDays" INTEGER NOT NULL DEFAULT 3;
