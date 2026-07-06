/**
 * Tipos e query builder client-safe — drilldown do horizonte de faturamento.
 */

import type { FinanceBillingNfeDraftFilters } from "./financeBillingNfeFiltersTypes.js";

export type FinanceBillingHorizonDrilldownFilters = Pick<
  FinanceBillingNfeDraftFilters,
  "customerCnpj" | "documentNumber"
>;

export type FinanceBillingHorizonOrderRow = {
  orderId: string;
  orderCode: string;
  customerName: string;
  customerDocument: string | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  expectedDeliveryDate: string | null;
  totalNetValue: number;
  status: string;
  statusLabel: string;
  operationNature: string | null;
};

export type FinanceBillingHorizonBucketTotals = {
  amount: number;
  ordersCount: number;
};

export type FinanceBillingHorizonDrilldownPayload = {
  generatedAt: string;
  horizonBucket: string;
  selectedBucket: {
    key: string;
    label: string;
  };
  bucketTotals: FinanceBillingHorizonBucketTotals;
  dateField: "expectedDeliveryDate";
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: FinanceBillingHorizonOrderRow[];
  filters: {
    customerCnpj: string | null;
    documentNumber: string | null;
  };
};

export function buildFinanceBillingHorizonDrilldownQuery(
  filters: FinanceBillingHorizonDrilldownFilters,
  options: {
    horizonBucket: string;
    page?: number;
    limit?: number;
  }
): string {
  const params = new URLSearchParams();
  params.set("horizonBucket", options.horizonBucket.trim());
  if (options.page != null && options.page > 0) {
    params.set("page", String(options.page));
  }
  if (options.limit != null && options.limit > 0) {
    params.set("limit", String(options.limit));
  }
  if (filters.customerCnpj.trim()) {
    params.set("customerCnpj", filters.customerCnpj.trim());
  }
  if (filters.documentNumber.trim()) {
    params.set("documentNumber", filters.documentNumber.trim());
  }
  return params.toString();
}
