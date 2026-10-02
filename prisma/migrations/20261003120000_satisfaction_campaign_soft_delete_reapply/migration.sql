-- Satisfação — reaplica as colunas da exclusão lógica na ordem correta.
--
-- 20260826120000_satisfaction_campaign_soft_delete ordena ANTES da migration
-- que cria "SatisfactionSurveyCampaign" (20260913120000), então em banco novo
-- ela não tinha tabela para alterar. Aqui a tabela já existe em qualquer
-- ambiente. Onde as colunas já foram criadas isto é no-op (IF NOT EXISTS).
--
-- Aditivo: só colunas anuláveis, nenhum dado tocado.

ALTER TABLE "SatisfactionSurveyCampaign"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deletedByUserId" UUID;
