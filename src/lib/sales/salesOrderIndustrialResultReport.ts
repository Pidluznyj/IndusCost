/**
 * Contrato frontend-safe do Relatório de Resultado Industrial dos Pedidos.
 * Espelha o padrão de `salesOrderReport.ts` (sem Prisma).
 */
import {
  buildSalesOrderReportFilterLabels,
  type SalesOrderReportAppliedFilters,
  type SalesOrderReportFilterLabel,
} from "./salesOrderReport.js";
import {
  computeConsolidatedIndustrialMarginPercent,
  industrialCostSourceStatusLabel,
  industrialTaxSourceLabel,
  type IndustrialCostSourceStatus,
  type IndustrialTaxSource,
} from "./salesOrderIndustrialResultReportMath.js";
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";

export const SALES_ORDER_INDUSTRIAL_RESULT_REPORT_ROWS_LIMIT = 5000;

export type {
  IndustrialCostSourceStatus,
  IndustrialTaxSource,
} from "./salesOrderIndustrialResultReportMath.js";

export type SalesOrderIndustrialResultReportRow = {
  salesOrderId: string;
  orderCode: string;
  issueDate: string | null;
  customerName: string;
  sellerName: string;
  orderStatus: string;
  orderStatusLabel: string;
  invoiceStatus: string;
  invoiceStatusLabel: string;

  orderCommercialValue: number;

  materialCost: number | null;
  laborHourCost: number | null;
  machineHourCost: number | null;
  otherIndustrialCost: number | null;
  totalIndustrialCost: number | null;

  icms: number | null;
  ipi: number | null;
  pis: number | null;
  cofins: number | null;
  icmsSt: number | null;
  difal: number | null;
  fcp: number | null;
  otherTaxes: number | null;
  totalTaxes: number | null;

  revenueAfterTaxes: number | null;
  industrialResult: number | null;
  industrialMarginPercent: number | null;

  taxSource: IndustrialTaxSource;
  taxSourceLabel: string;
  costSourceStatus: IndustrialCostSourceStatus;
  costSourceStatusLabel: string;
  costTableVersionLabel: string | null;
  costBaseDate: string | null;
  costTableReferences: string[];
  priceTableReference: string | null;
  warnings: string[];
  includedInConsolidation: boolean;
};

export type SalesOrderIndustrialResultReportSummary = {
  ordersCount: number;
  completeOrdersCount: number;
  incompleteCostOrdersCount: number;
  incompleteTaxOrdersCount: number;
  excludedFromConsolidationCount: number;

  orderCommercialValueTotal: number;
  materialCostTotal: number;
  laborHourCostTotal: number;
  machineHourCostTotal: number;
  otherIndustrialCostTotal: number;
  totalIndustrialCostTotal: number;

  icmsTotal: number;
  ipiTotal: number;
  pisTotal: number;
  cofinsTotal: number;
  icmsStTotal: number;
  difalTotal: number;
  fcpTotal: number;
  otherTaxesTotal: number;
  totalTaxesTotal: number;

  revenueAfterTaxesTotal: number;
  industrialResultTotal: number;
  industrialMarginPercentConsolidated: number | null;
};

export type SalesOrderIndustrialResultReportPayload = {
  generatedAt: string;
  emitterName: string | null;
  title: string;
  subtitle: string;
  filters: SalesOrderReportAppliedFilters;
  filterLabels: SalesOrderReportFilterLabel[];
  summary: SalesOrderIndustrialResultReportSummary;
  rows: SalesOrderIndustrialResultReportRow[];
  truncated: boolean;
  totalOrdersInScope: number;
  rowsLimit: number;
};

export {
  buildSalesOrderReportFilterLabels,
  industrialCostSourceStatusLabel,
  industrialTaxSourceLabel,
};

export function computeSalesOrderIndustrialResultReportSummaryFromRows(
  rows: ReadonlyArray<SalesOrderIndustrialResultReportRow>
): SalesOrderIndustrialResultReportSummary {
  let completeOrdersCount = 0;
  let incompleteCostOrdersCount = 0;
  let incompleteTaxOrdersCount = 0;
  let excludedFromConsolidationCount = 0;

  let orderCommercialValueTotal = 0;
  let materialCostTotal = 0;
  let laborHourCostTotal = 0;
  let machineHourCostTotal = 0;
  let otherIndustrialCostTotal = 0;
  let totalIndustrialCostTotal = 0;
  let icmsTotal = 0;
  let ipiTotal = 0;
  let pisTotal = 0;
  let cofinsTotal = 0;
  let icmsStTotal = 0;
  let difalTotal = 0;
  let fcpTotal = 0;
  let otherTaxesTotal = 0;
  let totalTaxesTotal = 0;
  let revenueAfterTaxesTotal = 0;
  let industrialResultTotal = 0;

  for (const row of rows) {
    if (row.costSourceStatus !== "OK") incompleteCostOrdersCount += 1;
    if (row.taxSource === "INCOMPLETO") incompleteTaxOrdersCount += 1;
    if (!row.includedInConsolidation) {
      excludedFromConsolidationCount += 1;
      continue;
    }
    completeOrdersCount += 1;
    orderCommercialValueTotal += row.orderCommercialValue;
    materialCostTotal += row.materialCost ?? 0;
    laborHourCostTotal += row.laborHourCost ?? 0;
    machineHourCostTotal += row.machineHourCost ?? 0;
    otherIndustrialCostTotal += row.otherIndustrialCost ?? 0;
    totalIndustrialCostTotal += row.totalIndustrialCost ?? 0;
    icmsTotal += row.icms ?? 0;
    ipiTotal += row.ipi ?? 0;
    pisTotal += row.pis ?? 0;
    cofinsTotal += row.cofins ?? 0;
    icmsStTotal += row.icmsSt ?? 0;
    difalTotal += row.difal ?? 0;
    fcpTotal += row.fcp ?? 0;
    otherTaxesTotal += row.otherTaxes ?? 0;
    totalTaxesTotal += row.totalTaxes ?? 0;
    revenueAfterTaxesTotal += row.revenueAfterTaxes ?? 0;
    industrialResultTotal += row.industrialResult ?? 0;
  }

  return {
    ordersCount: rows.length,
    completeOrdersCount,
    incompleteCostOrdersCount,
    incompleteTaxOrdersCount,
    excludedFromConsolidationCount,
    orderCommercialValueTotal: roundMoney(orderCommercialValueTotal),
    materialCostTotal: roundMoney(materialCostTotal),
    laborHourCostTotal: roundMoney(laborHourCostTotal),
    machineHourCostTotal: roundMoney(machineHourCostTotal),
    otherIndustrialCostTotal: roundMoney(otherIndustrialCostTotal),
    totalIndustrialCostTotal: roundMoney(totalIndustrialCostTotal),
    icmsTotal: roundMoney(icmsTotal),
    ipiTotal: roundMoney(ipiTotal),
    pisTotal: roundMoney(pisTotal),
    cofinsTotal: roundMoney(cofinsTotal),
    icmsStTotal: roundMoney(icmsStTotal),
    difalTotal: roundMoney(difalTotal),
    fcpTotal: roundMoney(fcpTotal),
    otherTaxesTotal: roundMoney(otherTaxesTotal),
    totalTaxesTotal: roundMoney(totalTaxesTotal),
    revenueAfterTaxesTotal: roundMoney(revenueAfterTaxesTotal),
    industrialResultTotal: roundMoney(industrialResultTotal),
    industrialMarginPercentConsolidated: computeConsolidatedIndustrialMarginPercent({
      industrialResultTotal: roundMoney(industrialResultTotal),
      revenueAfterTaxesTotal: roundMoney(revenueAfterTaxesTotal),
    }),
  };
}

export function salesOrderIndustrialResultReportExportFilename(input?: {
  customerName?: string | null;
}): string {
  const day = new Date().toISOString().slice(0, 10);
  const slug = (input?.customerName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `resultado-industrial-pedidos-${slug || "todos"}-${day}.pdf`;
}
