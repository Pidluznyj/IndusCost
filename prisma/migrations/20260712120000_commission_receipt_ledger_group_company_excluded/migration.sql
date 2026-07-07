-- Status de linha para empresas do grupo (auditoria — fora da base comissionável).
ALTER TYPE "CommissionReceiptLedgerLineStatus" ADD VALUE IF NOT EXISTS 'GROUP_COMPANY_EXCLUDED';
