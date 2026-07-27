-- Central de Tesouraria — status da Central de Exceções (Prompt 40).
-- Aditiva: ALTER TYPE ADD VALUE. Não aplicar em produção via Cursor.

ALTER TYPE "TreasuryExceptionStatus" ADD VALUE 'IN_ANALYSIS';
ALTER TYPE "TreasuryExceptionStatus" ADD VALUE 'WAITING_THIRD_PARTY';
ALTER TYPE "TreasuryExceptionStatus" ADD VALUE 'IGNORED';
