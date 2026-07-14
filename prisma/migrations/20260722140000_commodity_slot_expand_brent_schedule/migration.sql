-- Expande CommodityCollectionSlot para a nova agenda Brent 2026-07:
--   MORNING_EARLY    → 07:00 (America/Sao_Paulo)
--   MORNING_LATE     → 11:00
--   AFTERNOON_EARLY  → 14:00
--   AFTERNOON_LATE   → 16:00
--
-- Mantém MORNING e AFTERNOON no enum para preservar linhas históricas
-- (rows anteriores continuam válidas — nada é sobrescrito).
-- `ALTER TYPE ... ADD VALUE` no PostgreSQL não roda em transação, por isso
-- cada instrução fica solta (Prisma respeita a diretiva `IF NOT EXISTS`).

ALTER TYPE "CommodityCollectionSlot" ADD VALUE IF NOT EXISTS 'MORNING_EARLY';
ALTER TYPE "CommodityCollectionSlot" ADD VALUE IF NOT EXISTS 'MORNING_LATE';
ALTER TYPE "CommodityCollectionSlot" ADD VALUE IF NOT EXISTS 'AFTERNOON_EARLY';
ALTER TYPE "CommodityCollectionSlot" ADD VALUE IF NOT EXISTS 'AFTERNOON_LATE';
