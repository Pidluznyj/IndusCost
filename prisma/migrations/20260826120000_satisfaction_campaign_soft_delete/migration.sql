-- Satisfação — exclusão LÓGICA de pesquisa (só SUPER_ADMIN).
--
-- A pesquisa excluída some de todas as telas (grid, dashboard, resultados)
-- e para de aceitar respostas (os tokens ativos são revogados no mesmo ato),
-- mas os dados permanecem no banco para auditoria — nunca hard delete.
--
-- Aditivo e reversível: só adiciona colunas anuláveis, não toca dado.
-- IF NOT EXISTS mantém o reprocessamento idempotente (padrão do projeto).

ALTER TABLE "SatisfactionSurveyCampaign"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deletedByUserId" UUID;
