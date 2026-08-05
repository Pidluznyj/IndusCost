-- Histórico do VALOR TOTAL de matéria-prima em estoque.
--
-- Motivo: o card "Valor em estoque (MP)" sempre foi calculado ao vivo
-- (Σ quantity × currentCost) e nunca persistido — sem histórico não existe
-- como plotar a flutuação semanal. Cada conferência de estoque passa a
-- gerar uma foto do total (best-effort, após o commit da conferência).
--
-- Aditiva pura: cria tipo + tabela + índices. Não altera nem lê nenhuma
-- tabela existente, não faz backfill, não toca em Material nem em
-- MaterialStockConference.

CREATE TYPE "MaterialStockValueSnapshotSource" AS ENUM (
  'CONFERENCE',
  'MANUAL',
  'BACKFILL'
);

CREATE TABLE "MaterialStockValueSnapshot" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "capturedAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "civilDate"           DATE NOT NULL,
    "totalValue"          DECIMAL(20,6) NOT NULL,
    "materialsWithStock"  INTEGER NOT NULL,
    "materialsConsidered" INTEGER NOT NULL,
    "source"              "MaterialStockValueSnapshotSource" NOT NULL,
    "conferenceId"        UUID,
    "materialId"          UUID,
    "userId"              UUID,
    "userName"            TEXT,
    "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialStockValueSnapshot_pkey" PRIMARY KEY ("id")
);

-- Agregação do gráfico (série por semana a partir da data civil).
CREATE INDEX "MaterialStockValueSnapshot_civilDate_idx"
  ON "MaterialStockValueSnapshot" ("civilDate");

-- Último snapshot / janelas recentes.
CREATE INDEX "MaterialStockValueSnapshot_capturedAt_idx"
  ON "MaterialStockValueSnapshot" ("capturedAt" DESC);

-- Filtro por origem (ex.: só capturas de conferência).
CREATE INDEX "MaterialStockValueSnapshot_source_capturedAt_idx"
  ON "MaterialStockValueSnapshot" ("source", "capturedAt" DESC);

-- Rastreabilidade: qual conferência originou a foto.
CREATE INDEX "MaterialStockValueSnapshot_conferenceId_idx"
  ON "MaterialStockValueSnapshot" ("conferenceId");
