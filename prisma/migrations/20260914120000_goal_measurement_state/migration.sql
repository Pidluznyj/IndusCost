-- Metas (OKR) — estado canônico da medição do KR (P0-B).
--
-- Por que: hoje o valor 0 de um indicador automático pode significar quatro
-- coisas diferentes (zero medido, nunca medido, erro engolido, dado velho) e
-- o usuário não tem como distinguir. Este estado persiste a resposta.
--
-- Semântica:
--   MANUAL  → indicador de lançamento manual (sem medição automática);
--   PENDING → automático aguardando a primeira execução bem-sucedida;
--   OK      → última medição concluiu (lastMeasurementAt = leitura válida);
--   ERROR   → última medição falhou; achievedValue preserva o último valor
--             VÁLIDO e lastMeasurementError guarda mensagem sanitizada
--             (nunca SQL, stack trace ou segredo).
--
-- Aditivo e backward compatible: colunas novas com default; NENHUMA meta é
-- recomputada aqui. Backfill conservador só reclassifica o que já se sabe:
--   - manuais → MANUAL (default);
--   - automáticos COM snapshot de motor → OK, com lastMeasurementAt derivado
--     do último snapshot (não é recomputo — é leitura do histórico);
--   - automáticos SEM snapshot → PENDING (nunca foram medidos de fato).

CREATE TYPE "GoalMeasurementStatus" AS ENUM ('MANUAL', 'PENDING', 'OK', 'ERROR');

ALTER TABLE "GoalKeyResult"
  ADD COLUMN IF NOT EXISTS "measurementStatus" "GoalMeasurementStatus" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "lastMeasurementAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "lastMeasurementError" TEXT;

-- Automáticos já medidos alguma vez: OK + data do último retrato.
UPDATE "GoalKeyResult" kr
SET "measurementStatus" = 'OK',
    "lastMeasurementAt" = s."lastSnapshotDate"
FROM (
  SELECT "keyResultId", MAX("snapshotDate") AS "lastSnapshotDate"
  FROM "GoalKeyResultSnapshot"
  GROUP BY "keyResultId"
) s
WHERE s."keyResultId" = kr."id"
  AND kr."manualTracking" = false
  AND kr."ruleJson" IS NOT NULL;

-- Automáticos nunca medidos: aguardando a primeira leitura.
UPDATE "GoalKeyResult"
SET "measurementStatus" = 'PENDING'
WHERE "manualTracking" = false
  AND "ruleJson" IS NOT NULL
  AND "measurementStatus" = 'MANUAL';
