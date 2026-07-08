/** Tipos client-safe — drilldown Títulos do fornecedor (aba Fornecedores / Centro de Custo). */

import type { CostCenterSupplierPaymentFiltersApplied } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";

export const COST_CENTER_SUPPLIER_TITLES_METRICS_SOURCE =
  "financeCostCenterSupplierTitlesDrilldown" as const;

export const COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE =
  "Período conforme data de vencimento do título de Contas a Pagar. O valor exibido segue a mesma base do grid de fornecedores (títulos no escopo dos filtros globais, independentemente de estarem pagos ou em aberto)." as const;

export const COST_CENTER_SUPPLIER_TITLES_PERIOD_SCOPE_NOTE =
  "Lista os títulos de Contas a Pagar do fornecedor no período selecionado (ano/mês por vencimento), respeitando empresa, status, classificação e centro de custo dos filtros da tela." as const;

export type CostCenterSupplierTitlesPayload = {
  supplierKey: string;
  supplierDisplayName: string;
  supplierDocument: string | null;
  periodLabel: string;
  periodScopeNote: string;
  items: CostCenterSupplierPaymentTitleRow[];
  totalTitleAmount: number;
  titlesCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filtersApplied: CostCenterSupplierPaymentFiltersApplied;
  listFiltersApplied: {
    search: string;
    costCenterFilter: string;
    classificationStatus: string;
  };
  costCenterOptions: Array<{ id: string; code: string; name: string }>;
  dateRuleNote: typeof COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE;
  metricsSource: typeof COST_CENTER_SUPPLIER_TITLES_METRICS_SOURCE;
};
