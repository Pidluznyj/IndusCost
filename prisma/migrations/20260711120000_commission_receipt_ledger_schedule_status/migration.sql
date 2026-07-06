-- Novos status de linha do ledger por recebimento (schedule materializado).
ALTER TYPE "CommissionReceiptLedgerLineStatus" ADD VALUE IF NOT EXISTS 'NO_SCHEDULE';
ALTER TYPE "CommissionReceiptLedgerLineStatus" ADD VALUE IF NOT EXISTS 'STALE_SCHEDULE';
