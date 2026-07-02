-- Comissão por faixa da tabela comercial (Formação de Preço).

CREATE TYPE "CommissionRuleCalculationType" AS ENUM (
  'FIXED_PERCENT',
  'COMMERCIAL_PRICE_TIER'
);

ALTER TABLE "CommissionRule"
  ADD COLUMN "calculationType" "CommissionRuleCalculationType" NOT NULL DEFAULT 'FIXED_PERCENT';

ALTER TYPE "CommissionAuditIssueType" ADD VALUE 'NO_COMMERCIAL_PRICE_TABLE';
ALTER TYPE "CommissionAuditIssueType" ADD VALUE 'BELOW_MINIMUM_COMMERCIAL_TABLE_PRICE';
ALTER TYPE "CommissionAuditIssueType" ADD VALUE 'MISSING_OFFICIAL_PRODUCT_COST';
ALTER TYPE "CommissionAuditIssueType" ADD VALUE 'INVALID_COMMERCIAL_PRICE_RANGE';
ALTER TYPE "CommissionAuditIssueType" ADD VALUE 'NO_COMMISSION_TABLE_RATE';
