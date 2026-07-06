import type { CostToCashChainLink } from "./costToCashTrace.js";
import type { CostToCashTraceApiResponse } from "./costToCashTraceApi.js";
import type { CommissionTrace } from "./commissionTrace.js";
import type { ProductCostTrace } from "./productCostTrace.js";
import type { PublishedPriceTrace } from "./publishedPriceTrace.js";
import type { SalesOrderTrace } from "./salesOrderTrace.js";

export const TRACE_PAGE_UNAVAILABLE = "Não disponível nesta consulta";

export type CostToCashTracePageSections = {
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
  chain: CostToCashChainLink[];
};

export type CostToCashTracePageData = CostToCashTraceApiResponse<CostToCashTracePageSections>;

export function formatTraceMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return TRACE_PAGE_UNAVAILABLE;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatTracePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return TRACE_PAGE_UNAVAILABLE;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formatTraceDate(value: string | null | undefined): string {
  if (!value?.trim()) return TRACE_PAGE_UNAVAILABLE;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("pt-BR");
}

export function chainStatusChipClass(status: string): string {
  switch (status) {
    case "PASS":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "FAIL":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-amber-100 text-amber-900 border-amber-200";
  }
}

export function apiStatusChipClass(status: string): string {
  switch (status) {
    case "PASS":
      return "bg-emerald-100 text-emerald-800";
    case "EMPTY":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-amber-100 text-amber-900";
  }
}

export function hasProductData(sections: CostToCashTracePageSections): boolean {
  return sections.product?.product != null;
}

export function hasPublishedPriceData(sections: CostToCashTracePageSections): boolean {
  return sections.publishedPrice?.commercialPrice?.salePrice != null;
}

export function hasSalesOrderData(sections: CostToCashTracePageSections): boolean {
  return sections.salesOrder?.order != null;
}

export function hasCommissionData(sections: CostToCashTracePageSections): boolean {
  return sections.commission?.sale != null;
}

export function buildTraceSummaryCards(data: CostToCashTracePageData | null) {
  if (!data) return [];
  const { sections } = data;
  return [
    {
      label: "Custo oficial",
      value: formatTraceMoney(sections.product?.currentCost.officialPublishedCost),
      meta: sections.product?.officialVersion.versionCode ?? TRACE_PAGE_UNAVAILABLE,
    },
    {
      label: "Preço publicado",
      value: formatTraceMoney(sections.publishedPrice?.commercialPrice.salePrice),
      meta: sections.publishedPrice?.commercialPrice.tableCode ?? TRACE_PAGE_UNAVAILABLE,
    },
    {
      label: "Venda (líquido)",
      value: formatTraceMoney(sections.salesOrder?.totals.totalSold),
      meta: sections.salesOrder?.order?.orderNumber ?? "Sem venda encontrada",
    },
    {
      label: "Comissão liberada",
      value: formatTraceMoney(sections.commission?.totals.totalReleasedCommission),
      meta: sections.commission?.sale?.canonicalSellerName ?? TRACE_PAGE_UNAVAILABLE,
    },
  ];
}

export function sectionHasWarnings(
  data: CostToCashTracePageData | null,
  source: string
): boolean {
  if (!data) return false;
  return data.warnings.some((w) => w.source === source);
}
