/** Tipos de classificação AP / centro de custo — sem Prisma (safe para import no frontend). */

import type { FinanceApClassificationStatusFilter } from "./financeAccountsPayableCostCenterShared.js";

export type FinanceApTitleClassificationLine = {
  allocationId: string;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  percentage: number;
  amount: number;
  source: "AUTO_RULE" | "MANUAL" | "BATCH";
  sourceLabel: string;
  ruleId: string | null;
  ruleLabel: string | null;
  lockedManual: boolean;
};

export type FinanceApTitleClassificationEnrichment = {
  consolidatedSupplierId: string | null;
  consolidatedSupplierName: string;
  consolidatedSupplierDocument: string | null;
  costCenterLabel: string;
  classificationOriginLabel: string;
  classificationStatusLabel: string;
  classificationStatusKey: FinanceApClassificationStatusFilter | "classified";
  isClassified: boolean;
  isSplit: boolean;
  isManualLocked: boolean;
  allocatedPercentage: number;
  allocatedAmount: number;
  lines: FinanceApTitleClassificationLine[];
};

export type FinanceApClassificationSummary = {
  classifiedAmount: number;
  unclassifiedAmount: number;
  classifiedPercentage: number;
};

export type FinanceApClassificationFilterOptions = {
  costCenters: Array<{ id: string; code: string; name: string }>;
  suppliers: Array<{ id: string; name: string; document: string | null }>;
};

export type FinanceApClassificationAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  createdAt: string;
  summary: string;
};

export type FinanceApTitleClassificationDetail = {
  externalId: number;
  enrichment: FinanceApTitleClassificationEnrichment;
  auditHistory: FinanceApClassificationAuditEntry[];
};
