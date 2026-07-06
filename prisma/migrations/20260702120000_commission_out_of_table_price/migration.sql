-- Comissão mínima para preço vendido abaixo da tabela Atacado (alerta auditável, não bloqueio).
ALTER TYPE "CommissionAuditIssueType" ADD VALUE IF NOT EXISTS 'OUT_OF_TABLE_PRICE_COMMISSION';
