-- Satisfação — exclusão LÓGICA de pesquisa (só SUPER_ADMIN).
--
-- A pesquisa excluída some de todas as telas (grid, dashboard, resultados)
-- e para de aceitar respostas (os tokens ativos são revogados no mesmo ato),
-- mas os dados permanecem no banco para auditoria — nunca hard delete.
--
-- Aditivo e reversível: só adiciona colunas anuláveis, não toca dado.
-- IF NOT EXISTS mantém o reprocessamento idempotente (padrão do projeto).

-- IF EXISTS: esta migration ordena ANTES da que cria a tabela
-- (20260913120000_commercial_customer_satisfaction). Em banco novo ela vira
-- no-op e as colunas entram por 20261003120000_satisfaction_campaign_soft_delete_reapply.
ALTER TABLE IF EXISTS "SatisfactionSurveyCampaign"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deletedByUserId" UUID;
