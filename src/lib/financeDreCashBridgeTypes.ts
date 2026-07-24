/**
 * DTO da Ponte Lucro × Caixa (DRE Gerencial).
 * Valores patrimoniais/caixa ausentes são `null` — nunca zero silencioso.
 */

import type { FinanceDreCompany, FinanceDreFilters } from "@/src/lib/financeDreTypes.js";

export const FINANCE_DRE_CASH_BRIDGE_TIMEZONE = "America/Sao_Paulo" as const;

export type CashBridgeCoverageStatus = "available" | "partial" | "unavailable";

export type CashBridgeLineClassification =
  | "available"
  | "partial"
  | "unavailable"
  | "derived";

export type CashBridgeReconciliationBadge =
  | "reconciled"
  | "not_reconciled"
  | "partial_data";

export type CashBridgeLineId =
  | "dre_net_result"
  | "non_cash_adjustments"
  | "accounts_receivable"
  | "inventory"
  | "operational_payables"
  | "other_working_capital"
  | "investments_paid"
  | "financing_inflows"
  | "principal_amortization"
  | "distributions"
  | "other_identified"
  | "reconciliation_difference"
  | "actual_cash_variation";

export type CashBridgeCoverageComponentId =
  | "dre_net_result"
  | "non_cash_adjustments"
  | "accounts_receivable"
  | "inventory"
  | "operational_payables"
  | "investments_paid"
  | "financing_and_equity"
  | "bank_cash"
  | "period_cash_movements";

export type CashBridgeCoverageRow = {
  componentId: CashBridgeCoverageComponentId;
  label: string;
  status: CashBridgeCoverageStatus;
  sourceLabel: string;
  limitation: string;
};

export type CashBridgeLine = {
  id: CashBridgeLineId;
  label: string;
  /** Efeito na variação de caixa explicada; null = indisponível (≠ 0). */
  cashEffect: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  classification: CashBridgeLineClassification;
  missingReason: string | null;
  criteria: string;
  sources: string[];
  limitations: string[];
  lastSyncedAt: string | null;
  /** Linha entra na soma `explainedCashVariation`. */
  includeInExplained: boolean;
};

export type CashBridgePeriodCashMovementsReference = {
  /** Sempre false — movimentos do período não entram na fórmula patrimonial. */
  includedInExplained: false;
  classification: CashBridgeCoverageStatus;
  receivablesCollected: number | null;
  payablesPaid: number | null;
  netMovements: number | null;
  note: string;
  missingReason: string | null;
  hasInitialBankBalance: false;
  sources: string[];
};

export type CashBridgeWarning = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type CashBridgeCards = {
  netResult: number | null;
  workingCapitalEffect: number | null;
  investmentsPaid: number | null;
  actualCashVariation: number | null;
};

export type CashBridgeReport = {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  generatedAt: string;
  timezone: typeof FINANCE_DRE_CASH_BRIDGE_TIMEZONE;
  filters: FinanceDreFilters;
  companyLabel: string;
  periodLabel: string;
  /** Lucro/prejuízo líquido aproximado da DRE (mês destaque). */
  dreNetResult: number;
  receitaLiquida: number | null;
  materialityThreshold: number;
  canReconcile: boolean;
  isReconciled: boolean;
  badge: CashBridgeReconciliationBadge;
  explainedCashVariation: number | null;
  actualCashVariation: number | null;
  residual: number | null;
  cards: CashBridgeCards;
  lines: CashBridgeLine[];
  coverage: CashBridgeCoverageRow[];
  explanation: string;
  warnings: CashBridgeWarning[];
  periodCashMovementsReference: CashBridgePeriodCashMovementsReference;
  implementationStatus: "partial";
};

export type CashBridgeWorkingCapitalBalances = {
  accountsReceivableOpening: number | null;
  accountsReceivableClosing: number | null;
  inventoryOpening: number | null;
  inventoryClosing: number | null;
  payablesOpening: number | null;
  payablesClosing: number | null;
};

/** Alias útil para filtros UI (mesmos da DRE). */
export type CashBridgeCompany = FinanceDreCompany;
