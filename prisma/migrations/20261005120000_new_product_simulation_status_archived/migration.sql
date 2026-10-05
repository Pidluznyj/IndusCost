-- Simulações de novo produto: status ARCHIVED (arquivar em vez de excluir registro congelado).
--
-- Estritamente ADITIVA: um valor de enum, sem DROP, sem backfill. Migration própria porque o
-- valor novo não pode ser usado na mesma transação em que é criado.
ALTER TYPE "NewProductSimulationStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
