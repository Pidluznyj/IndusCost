-- Metas (OKR) — alvo derivado de um período de comparação.
--
-- Por que: o alvo só podia ser um número digitado. Metas reais são ditas em
-- relação ao passado ("30% a mais que o mesmo período do ano passado"), e
-- traduzir isso na mão obriga o usuário a consultar relatório, calcular e
-- digitar — errando fácil.
--
-- Semântica: `targetBasis` continua MANUAL por padrão (nada muda para os
-- indicadores existentes). Em COMPARISON, o valor apurado na janela de
-- comparação é CONGELADO (`comparisonValue` + `comparisonComputedAt`) e
-- `target` segue sendo a verdade única do cálculo de progresso — um alvo que
-- se recalcula sozinho deixaria de ser compromisso, ainda mais com o sync do
-- Nomus reescrevendo pedidos antigos.
--
-- Aditivo: todas as colunas novas são nulas (ou têm default) e nenhum dado
-- existente é tocado.

CREATE TYPE "GoalTargetBasis" AS ENUM ('MANUAL', 'COMPARISON');

CREATE TYPE "GoalTargetComparisonMode" AS ENUM (
  'SAME_PERIOD_LAST_YEAR',
  'PREVIOUS_PERIOD',
  'CUSTOM'
);

ALTER TABLE "GoalKeyResult"
  ADD COLUMN IF NOT EXISTS "targetBasis" "GoalTargetBasis" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "comparisonMode" "GoalTargetComparisonMode",
  ADD COLUMN IF NOT EXISTS "comparisonStartDate" DATE,
  ADD COLUMN IF NOT EXISTS "comparisonEndDate" DATE,
  ADD COLUMN IF NOT EXISTS "comparisonValue" DECIMAL(20, 6),
  ADD COLUMN IF NOT EXISTS "comparisonPercent" DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS "comparisonComputedAt" TIMESTAMPTZ(6);
