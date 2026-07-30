/**
 * Loader server-side — Relatório de descontos comerciais.
 *
 * - Filtros base via resolveSalesOrderListWhere (emissão/vendedor/cliente/NF).
 * - Composição canônica: resolveSalesOrderItemCommercialValues.
 * - Margem comercial: motor oficial via buildSalesOrderCommercialMarginReadModels.
 * - Paginação da tabela detalhada no servidor (após agregação do escopo).
 * - Sem N+1: batch de pedidos + um passe no motor.
 * - Sem Proposta. Sem alterar fórmula de margem.
 */
import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderCommercialMarginReadModels } from "@/src/lib/salesOrderCommercialMarginReadService.server.js";
import { resolveSalesOrderItemCommercialValues } from "@/src/lib/salesOrderItemCommercialValues.js";
import { SALES_ORDER_ITEM_MARGIN_SELECT } from "@/src/lib/salesOrderMarginService.server.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "@/src/lib/salesOrderListQuery.server.js";
import { loadCommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.server.js";
import {
  buildSalesOrderNomusSellerDto,
  formatSalesOrderNomusSellerListLabel,
  formatSalesOrderNoSellerFilterLabel,
} from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import { roundPricingMoney } from "@/src/lib/pricingCalculations.js";
import {
  buildCommercialDiscountFilterLabels,
  redactMarginFromDetailRow,
  redactMarginFromKpis,
  applyCommercialDiscountPeriodOverride,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_EXPORT_ROWS_MAX,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_DEFAULT,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_MAX,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_TITLE,
  type CommercialDiscountBillingFilter,
  type CommercialDiscountPresenceFilter,
  type CommercialDiscountReportFilters,
  type CommercialDiscountReportPayload,
  type CommercialDiscountReportSortBy,
} from "./salesOrderCommercialDiscountReport.js";
import {
  buildCommercialDiscountViews,
  compareDetailRows,
  computeCommercialDiscountKpis,
  itemMatchesBandFilters,
  itemMatchesBilling,
  itemMatchesPresence,
  paginateSortedRows,
  toDetailRow,
  type DiscountReportItemInput,
} from "./salesOrderCommercialDiscountReportMath.js";

type Decimalish = { toNumber?: () => number } | number | string | null | undefined;

function toNum(value: Decimalish): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function customerDisplayName(customer?: {
  companyName?: string | null;
  tradeName?: string | null;
} | null): string {
  return (
    customer?.tradeName?.trim() ||
    customer?.companyName?.trim() ||
    "Cliente não informado"
  );
}

function parseRate01(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Aceita 5 (→ 0.05) ou 0.05.
  return n > 1 ? n / 100 : n;
}

function parsePercent(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parsePresence(raw: unknown): CommercialDiscountPresenceFilter {
  const s = String(raw ?? "all").trim().toLowerCase();
  if (
    s === "with_discount" ||
    s === "without_discount" ||
    s === "with_addition" ||
    s === "margin_unavailable"
  ) {
    return s;
  }
  return "all";
}

function parseBilling(raw: unknown): CommercialDiscountBillingFilter {
  const s = String(raw ?? "all").trim().toLowerCase();
  if (s === "invoiced" || s === "not_invoiced") return s;
  return "all";
}

function parseSortBy(raw: unknown): CommercialDiscountReportSortBy {
  const s = String(raw ?? "discountValue").trim();
  const allowed = new Set<CommercialDiscountReportSortBy>([
    "issueDate",
    "orderCode",
    "customer",
    "seller",
    "discountValue",
    "discountRate",
    "grossValue",
    "netValue",
    "commercialMarginValue",
    "commercialMarginPercent",
  ]);
  return allowed.has(s as CommercialDiscountReportSortBy)
    ? (s as CommercialDiscountReportSortBy)
    : "discountValue";
}

function parsePageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_DEFAULT;
  }
  return Math.min(n, SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_MAX);
}

/** Extrai desconto informado do payload Nomus do item (quando existir). */
export function extractInformedDiscountFromNomusRaw(raw: unknown): {
  informedDiscountRate: number | null;
  informedDiscountValue: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { informedDiscountRate: null, informedDiscountValue: null };
  }
  const o = raw as Record<string, unknown>;
  const rateKeys = [
    "percentualDesconto",
    "percDesconto",
    "descontoPercentual",
    "discountPercent",
    "discountPerc",
  ];
  const valueKeys = [
    "valorDesconto",
    "descontoValor",
    "discountValue",
    "discountAmount",
  ];
  let informedDiscountRate: number | null = null;
  for (const key of rateKeys) {
    const n = toNum(o[key] as Decimalish);
    if (n != null && n >= 0) {
      informedDiscountRate = n > 1 ? n / 100 : n;
      break;
    }
  }
  let informedDiscountValue: number | null = null;
  for (const key of valueKeys) {
    const n = toNum(o[key] as Decimalish);
    if (n != null && n >= 0) {
      informedDiscountValue = roundPricingMoney(n);
      break;
    }
  }
  return { informedDiscountRate, informedDiscountValue };
}

function isFullyCanceledItem(item: {
  quantity: unknown;
  nomusIsCanceled?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  flowItemSnapshot?: { canceledQuantity?: unknown } | null;
}): { orderedQty: number; canceledQty: number; isFullyCanceled: boolean } {
  const orderedQty = toNum(item.quantity) ?? 0;
  const canceledQty = toNum(item.flowItemSnapshot?.canceledQuantity) ?? 0;
  const status = (item.nomusItemStatusNormalized ?? "").toUpperCase();
  const isFullyCanceled =
    item.nomusIsCanceled === true ||
    item.nomusIsCut === true ||
    status === "CANCELED" ||
    status === "CANCELADO" ||
    (orderedQty > 0 && canceledQty >= orderedQty);
  return { orderedQty, canceledQty, isFullyCanceled };
}

export type LoadCommercialDiscountReportInput = {
  query: Record<string, unknown>;
  emitterName?: string | null;
  includeMargin?: boolean;
  /** Exportação: ignora paginação da tabela (respeita teto de linhas). */
  includeAllRows?: boolean;
};

export async function loadSalesOrderCommercialDiscountReportPayload(
  prisma: PrismaClient,
  input: LoadCommercialDiscountReportInput
): Promise<CommercialDiscountReportPayload> {
  const listQuery = parseSalesOrderListQuery(
    applyCommercialDiscountPeriodOverride(input.query)
  );
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderListWhere(prisma, listQuery, sellerWhere);
  const sellerCtx = await loadCommissionSellerIdentityContext(prisma);

  let sellerLabel: string | null = null;
  if (listQuery.sellerKey.kind === "no_seller") {
    sellerLabel = formatSalesOrderNoSellerFilterLabel();
  } else if (listQuery.sellerKey.kind === "seller_id") {
    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: listQuery.sellerKey.externalSellerId },
      sellerCtx
    );
    sellerLabel = formatSalesOrderNomusSellerListLabel(seller);
  } else if (listQuery.sellerText) {
    sellerLabel = listQuery.sellerText;
  }

  const presence = parsePresence(input.query.presence);
  const billing = parseBilling(input.query.billing ?? input.query.invoice);
  const discountRateMin = parseRate01(input.query.discountRateMin);
  const discountRateMax = parseRate01(input.query.discountRateMax);
  const marginPercentMin = parsePercent(input.query.marginPercentMin);
  const marginPercentMax = parsePercent(input.query.marginPercentMax);
  const productId = String(input.query.productId ?? "").trim() || null;
  const productQuery = String(input.query.productQuery ?? input.query.product ?? "")
    .trim() || null;
  const family = String(input.query.family ?? "").trim() || null;
  const sortBy = parseSortBy(input.query.sortBy);
  const sortDir = String(input.query.sortDir ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const page = listQuery.page;
  const pageSize = parsePageSize(input.query.pageSize ?? listQuery.pageSize);
  const includeAllRows =
    input.includeAllRows === true ||
    String(input.query.includeAllRows ?? "").trim() === "1";
  const includeMargin = input.includeMargin !== false;

  const filters: CommercialDiscountReportFilters = {
    startDate: listQuery.startDate ? listQuery.startDate.toISOString().slice(0, 10) : null,
    endDate: listQuery.endDate ? listQuery.endDate.toISOString().slice(0, 10) : null,
    year: listQuery.year,
    month: listQuery.month,
    customerId: listQuery.customerId || null,
    customerName: null,
    sellerKey: listQuery.sellerKeyRaw || null,
    sellerLabel,
    productId,
    productQuery,
    family,
    discountRateMin,
    discountRateMax,
    marginPercentMin,
    marginPercentMax,
    presence,
    billing,
    page,
    pageSize,
    sortBy,
    sortDir,
  };

  // Passo 1: ids leves (query budget).
  const idRows = await prisma.salesOrder.findMany({
    where,
    select: { id: true },
    orderBy: { issueDate: "desc" },
    take: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
  });
  const orderIds = idRows.map((r) => r.id);
  const truncated =
    orderIds.length >= SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX;

  if (orderIds.length === 0) {
    const emptyKpis = computeCommercialDiscountKpis([]);
    return {
      title: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_TITLE,
      subtitle: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE,
      generatedAt: new Date().toISOString(),
      emitterName: input.emitterName ?? null,
      filters,
      filterLabels: buildCommercialDiscountFilterLabels(filters),
      kpis: includeMargin ? emptyKpis : redactMarginFromKpis(emptyKpis),
      views: {
        monthlyEvolution: [],
        bySeller: [],
        byCustomer: [],
        byProduct: [],
        byFamily: [],
        topOrdersByDiscountValue: [],
        topOrdersByDiscountRate: [],
        highDiscountLowMarginProducts: [],
        kpisBeforeBandFilters: includeMargin
          ? emptyKpis
          : redactMarginFromKpis(emptyKpis),
        divergenceItemCount: 0,
      },
      rows: [],
      pagination: { page: 1, pageSize, totalRows: 0, totalPages: 1 },
      meta: {
        ordersLoaded: 0,
        ordersTakeLimit: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
        truncated: false,
        includeMargin,
        queryBudgetOrders: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
      },
    };
  }

  // Passo 2: batch pedidos + itens (sem N+1).
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      customerId: true,
      externalSellerId: true,
      totalNetValue: true,
      Customer: {
        select: { id: true, companyName: true, tradeName: true },
      },
      items: {
        select: {
          ...SALES_ORDER_ITEM_MARGIN_SELECT,
          nomusItemSequence: true,
          nomusRawItem: true,
          Product: {
            select: {
              id: true,
              sku: true,
              name: true,
              InventoryItem: {
                select: { family: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const nfeMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((o) => ({
      id: o.id,
      totalNetValue: o.totalNetValue,
      issueDate: o.issueDate,
    })),
    new Date(),
    { omitLinkRawPayload: true }
  );

  // Passo 3: margem comercial canônica em um passe.
  const marginByOrder = await buildSalesOrderCommercialMarginReadModels(
    prisma,
    orders.map((o) => ({
      id: o.id,
      issueDate: o.issueDate,
      customerId: o.customerId,
      items: o.items,
    }))
  );

  const allItems: DiscountReportItemInput[] = [];

  for (const order of orders) {
    const customerName = customerDisplayName(order.Customer);
    if (filters.customerId && !filters.customerName) {
      filters.customerName = customerName;
    }
    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: order.externalSellerId },
      sellerCtx
    );
    const sellerName = formatSalesOrderNomusSellerListLabel(seller);
    const nfe = nfeMap.get(order.id);
    const hasInvoice = Boolean(nfe?.hasValidInvoice || nfe?.hasNfe);
    const marginSummary = marginByOrder.get(order.id);
    const marginByItem = new Map(
      (marginSummary?.items ?? []).map((it) => [it.itemId, it])
    );

    for (const item of order.items) {
      const { orderedQty, canceledQty, isFullyCanceled } = isFullyCanceledItem(item);
      const informed = extractInformedDiscountFromNomusRaw(item.nomusRawItem);
      const composition = resolveSalesOrderItemCommercialValues({
        orderedQuantity: orderedQty,
        canceledQuantity: canceledQty,
        isFullyCanceled,
        grossUnitPrice: toNum(item.negotiatedPrice) ?? 0,
        netTotalValue: toNum(item.totalNetValue),
        informedDiscountRate: informed.informedDiscountRate,
        informedDiscountValue: informed.informedDiscountValue,
      });

      const marginItem = marginByItem.get(item.id);
      const marginCalculated = Boolean(marginItem?.isComplete);
      const familyName =
        item.Product?.InventoryItem?.[0]?.family?.trim() ||
        "Sem família";
      const divergence =
        composition.warnings.find((w) => w.includes("DISCOUNT_")) ?? null;

      allItems.push({
        salesOrderId: order.id,
        orderCode: order.orderCode,
        issueDate: isoOrNull(order.issueDate),
        customerId: order.Customer?.id ?? order.customerId ?? null,
        customerName,
        sellerName,
        hasInvoice,
        itemId: item.id,
        itemSequence: item.nomusItemSequence ?? null,
        productId: item.productId,
        sku: item.Product?.sku || item.skuSnapshot || "—",
        productName: item.Product?.name || item.productNameSnapshot || "—",
        familyName,
        activeQuantity: composition.activeQuantity,
        grossUnitPrice: composition.grossUnitPrice,
        grossActiveValue: composition.grossActiveValue,
        discountValue: composition.effectiveDiscountValue,
        discountRate: composition.effectiveDiscountRate,
        netUnitPrice: composition.effectiveNetUnitPrice,
        netActiveValue: composition.netActiveValue,
        commercialAdditionValue: composition.commercialAdditionValue,
        discountStatus: composition.discountStatus,
        commercialMarginValue: marginItem?.commercialMarginValue ?? null,
        commercialMarginPercent: marginItem?.commercialMarginPercent ?? null,
        marginCalculated,
        hasDiscountDivergence: Boolean(divergence),
        divergenceLabel: divergence,
      });
    }
  }

  // Base: só filtros de população (período/vendedor/cliente/NF já no where) + billing/produto/família leves.
  // Faixas e presença entram depois para visão "antes/depois".
  const baseBeforeBands = allItems.filter(
    (item) =>
      item.activeQuantity > 0 &&
      itemMatchesBilling(item, billing) &&
      itemMatchesBandFilters(item, {
        discountRateMin: null,
        discountRateMax: null,
        marginPercentMin: null,
        marginPercentMax: null,
        productId,
        productQuery,
        family,
      })
  );

  const filtered = allItems.filter(
    (item) =>
      item.activeQuantity > 0 &&
      itemMatchesBilling(item, billing) &&
      itemMatchesPresence(item, presence) &&
      itemMatchesBandFilters(item, {
        discountRateMin,
        discountRateMax,
        marginPercentMin,
        marginPercentMax,
        productId,
        productQuery,
        family,
      })
  );

  const kpis = computeCommercialDiscountKpis(filtered);
  const views = buildCommercialDiscountViews(filtered, baseBeforeBands);

  let detailRows = filtered.map(toDetailRow);
  detailRows.sort((a, b) => compareDetailRows(a, b, sortBy, sortDir));

  if (!includeMargin) {
    detailRows = detailRows.map(redactMarginFromDetailRow);
    views.kpisBeforeBandFilters = redactMarginFromKpis(views.kpisBeforeBandFilters);
    views.bySeller = views.bySeller.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.byCustomer = views.byCustomer.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.byProduct = views.byProduct.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.byFamily = views.byFamily.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.monthlyEvolution = views.monthlyEvolution.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
    }));
    views.topOrdersByDiscountValue = views.topOrdersByDiscountValue.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.topOrdersByDiscountRate = views.topOrdersByDiscountRate.map((r) => ({
      ...r,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
    }));
    views.highDiscountLowMarginProducts = [];
  }

  const totalRows = detailRows.length;
  let pageRows = detailRows;
  let totalPages = 1;
  let effectivePage = page;
  if (includeAllRows) {
    pageRows = detailRows.slice(0, SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_EXPORT_ROWS_MAX);
    totalPages = 1;
    effectivePage = 1;
  } else {
    const paged = paginateSortedRows(detailRows, page, pageSize);
    pageRows = paged.pageRows;
    totalPages = paged.totalPages;
    effectivePage = Math.min(Math.max(1, page), totalPages);
  }

  return {
    title: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_TITLE,
    subtitle: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE,
    generatedAt: new Date().toISOString(),
    emitterName: input.emitterName ?? null,
    filters: { ...filters, page: effectivePage, pageSize },
    filterLabels: buildCommercialDiscountFilterLabels(filters),
    kpis: includeMargin ? kpis : redactMarginFromKpis(kpis),
    views,
    rows: pageRows,
    pagination: {
      page: effectivePage,
      pageSize,
      totalRows,
      totalPages,
    },
    meta: {
      ordersLoaded: orderIds.length,
      ordersTakeLimit: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
      truncated,
      includeMargin,
      queryBudgetOrders: SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX,
    },
  };
}
