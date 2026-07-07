/**
 * Montagem read-only da auditoria de rastreabilidade de venda — reutiliza serviços existentes.
 */
import type { PrismaClient } from "@prisma/client";
import { loadCommissionOrderSourceBySalesOrderId } from "./commissions/commission-source-resolver.server.js";
import { resolveCustomerExclusionForSale } from "./commissions/commissionCustomerExclusionApply.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissions/commissionCustomerExclusionRules.server.js";
import { extractSellerFromOrder } from "./commissions/commission-source-resolver.js";
import { loadCommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.server.js";
import { resolveCommissionSellerIdentity } from "./commissions/commissionSellerIdentity.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import { parseSalesOrderItemStoredUnitCost } from "./salesOrderMarginResolver.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import { setSalesOrderMarginProductCostResolver } from "./salesOrderMarginProductCostResolver.js";
import { SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE } from "./salesOrderCostSemantics.js";
import {
  DEFAULT_SALES_ORDER_MARGIN_COST_POLICY,
} from "./salesOrderMarginTypes.js";
import {
  buildEmptySalesOrderTraceReport,
  buildSalesOrderTraceAlerts,
  computeSalesOrderTraceTotals,
  mapMarginPayloadToTraceItem,
  type SalesOrderTraceAuditQuery,
  type SalesOrderTraceAuditReport,
  type SalesOrderTraceDataSource,
  type SalesOrderTraceNfe,
} from "./salesOrderTraceAudit.js";

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const ORDER_SELECT = {
  id: true,
  orderCode: true,
  customerId: true,
  externalSellerId: true,
  nomusSellerName: true,
  responsible: true,
  issueDate: true,
  totalNetValue: true,
  status: true,
  proposalId: true,
  nomusRawResponse: true,
  Customer: { select: { companyName: true, tradeName: true } },
  nfeLinks: {
    select: {
      nfeExternalId: true,
      nfeNumber: true,
      nfeSerie: true,
      nfeStatus: true,
      dataProcessamento: true,
      nfeKey: true,
    },
    orderBy: { dataProcessamento: "desc" as const },
  },
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

type LoadedOrder = {
  id: string;
  orderCode: string;
  customerId: string;
  externalSellerId: number | null;
  responsible: string | null;
  issueDate: Date;
  totalNetValue: unknown;
  status: string;
  proposalId: string | null;
  nomusRawResponse: unknown;
  Customer: { companyName: string; tradeName: string | null };
  nfeLinks: Array<{
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeSerie: string | null;
    nfeStatus: number | null;
    dataProcessamento: Date | null;
    nfeKey: string | null;
  }>;
  items: Array<{
    id: string;
    salesOrderId: string;
    productId: string;
    proposalItemId: string | null;
    externalProductId: number | null;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: unknown;
    negotiatedPrice: unknown;
    totalNetValue: unknown;
    unitCost: unknown;
  }>;
};

export async function resolveSalesOrderForTraceAudit(
  db: PrismaClient,
  query: SalesOrderTraceAuditQuery
): Promise<{ order: LoadedOrder | null; errorMessage: string | null }> {
  const salesOrderId = query.salesOrderId?.trim() || null;
  const orderNumber = query.orderNumber?.trim() || null;
  const nfeNumber = query.nfeNumber?.trim() || null;
  const customer = query.customer?.trim() || null;

  if (salesOrderId) {
    const order = await db.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: ORDER_SELECT,
    });
    if (!order) {
      return { order: null, errorMessage: `Pedido não encontrado: id=${salesOrderId}` };
    }
    return { order, errorMessage: null };
  }

  if (orderNumber) {
    const order = await db.salesOrder.findUnique({
      where: { orderCode: orderNumber },
      select: ORDER_SELECT,
    });
    if (!order) {
      return { order: null, errorMessage: `Pedido não encontrado: orderNumber=${orderNumber}` };
    }
    return { order, errorMessage: null };
  }

  if (nfeNumber) {
    const link = await db.salesOrderNfeLink.findFirst({
      where: { nfeNumber },
      select: { salesOrderId: true },
    });
    if (!link) {
      return { order: null, errorMessage: `Pedido não encontrado para NF: ${nfeNumber}` };
    }
    const order = await db.salesOrder.findUnique({
      where: { id: link.salesOrderId },
      select: ORDER_SELECT,
    });
    if (!order) {
      return { order: null, errorMessage: `Pedido vinculado à NF ${nfeNumber} não encontrado.` };
    }
    return { order, errorMessage: null };
  }

  if (customer && query.year != null) {
    const year = query.year;
    const month = query.month;
    const from = month != null ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
    const to =
      month != null ? new Date(year, month, 1) : new Date(year + 1, 0, 1);

    const matches = await db.salesOrder.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        Customer: {
          OR: [
            { companyName: { contains: customer, mode: "insensitive" } },
            { tradeName: { contains: customer, mode: "insensitive" } },
          ],
        },
      },
      select: ORDER_SELECT,
      orderBy: { issueDate: "desc" },
      take: 5,
    });

    if (matches.length === 0) {
      return {
        order: null,
        errorMessage: `Nenhum pedido encontrado para cliente "${customer}" em ${month != null ? `${month}/${year}` : year}.`,
      };
    }
    if (matches.length > 1) {
      const codes = matches.map((row) => row.orderCode).join(", ");
      return {
        order: null,
        errorMessage: `Múltiplos pedidos encontrados (${codes}). Informe --order-number ou --sales-order-id.`,
      };
    }
    return { order: matches[0]!, errorMessage: null };
  }

  return {
    order: null,
    errorMessage:
      "Informe --sales-order-id, --order-number, --nfe-number ou --customer com --year (e opcional --month).",
  };
}

export async function buildSalesOrderTraceAudit(
  db: PrismaClient,
  query: SalesOrderTraceAuditQuery
): Promise<SalesOrderTraceAuditReport> {
  const includeItems = query.includeItems !== false;
  const { order, errorMessage } = await resolveSalesOrderForTraceAudit(db, query);

  if (!order) {
    return buildEmptySalesOrderTraceReport(errorMessage ?? "Pedido não encontrado.");
  }

  setSalesOrderMarginProductCostResolver(null);

  const marginOrder: SalesOrderForMargin = {
    id: order.id,
    proposalId: order.proposalId,
    issueDate: order.issueDate,
    nomusRawResponse: order.nomusRawResponse,
    items: includeItems ? order.items : [],
  };

  const marginByOrder = await calculateSalesOrderMarginsForOrders(db, [marginOrder], {
    costPolicy: DEFAULT_SALES_ORDER_MARGIN_COST_POLICY,
    itemsByOrderId: new Map([[order.id, order.items]]),
  });
  const marginResult = marginByOrder.get(order.id);

  const [sellerContext, exclusionRules, commissionSource, commissionSnapshot] = await Promise.all([
    loadCommissionSellerIdentityContext(db),
    loadActiveCustomerExclusionRuleSnapshots(),
    loadCommissionOrderSourceBySalesOrderId(db, order.id),
    db.commissionOrderSnapshot.findFirst({
      where: { salesOrderId: order.id, status: "ACTIVE" },
      orderBy: { saleDate: "desc" },
      select: {
        id: true,
        sourceHash: true,
        saleDate: true,
        totalSoldAmount: true,
        canonicalSellerName: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  const sellerInfo = extractSellerFromOrder({
    externalSellerId: order.externalSellerId,
    nomusSellerName: order.nomusSellerName,
  });
  const sellerResolution = resolveCommissionSellerIdentity(
    {
      rawSellerId: sellerInfo.nomusSellerId,
      rawSellerName: sellerInfo.responsibleName,
      source: "SALES_ORDER",
    },
    sellerContext
  );

  const customerName =
    order.Customer.tradeName?.trim() || order.Customer.companyName?.trim() || "—";

  const exclusion = resolveCustomerExclusionForSale({
    customerId: order.customerId,
    customerName,
    referenceDate: order.issueDate,
    rules: exclusionRules,
  });
  const customerExcluded = exclusion != null;
  const customerExclusionReason = exclusion?.reason ?? null;

  const sellerResolved =
    sellerResolution.canonicalSellerId != null &&
    sellerResolution.resolutionStatus === "OK_CANONICAL";

  const nomusUnitCostByItemId = new Map(
    order.items.map((item) => [item.id, parseSalesOrderItemStoredUnitCost(item.unitCost)])
  );

  const items = includeItems
    ? (marginResult?.itemResults ?? []).map((itemResult) => {
        const itemId = itemResult.salesOrderItemId ?? "";
        const marginPayload = marginResult?.itemMargins.get(itemId);
        return mapMarginPayloadToTraceItem(
          itemResult,
          marginPayload,
          nomusUnitCostByItemId.get(itemId) ?? null
        );
      })
    : [];

  const alerts = buildSalesOrderTraceAlerts({
    items,
    sellerResolved,
    customerExcluded,
    customerExclusionReason,
  });

  const nfes: SalesOrderTraceNfe[] = order.nfeLinks.map((link) => ({
    nfeExternalId: link.nfeExternalId,
    nfeNumber: link.nfeNumber,
    nfeSerie: link.nfeSerie,
    nfeStatus: link.nfeStatus,
    dataProcessamento: link.dataProcessamento?.toISOString() ?? null,
    nfeKey: link.nfeKey,
  }));

  const dataSources: SalesOrderTraceDataSource[] = [
    {
      field: "soldAmount",
      source: "SalesOrderItem.totalNetValue (Nomus)",
      note: "Receita líquida da venda",
    },
    {
      field: "officialUnitCost",
      source: "getEffectiveProductProductionCost via buildSalesOrderMarginInputsFromVersionedProductionCosts",
      note: "VERSIONED_PRODUCTION_COST na SalesOrder.issueDate",
    },
    {
      field: "margin",
      source: "calculateSalesOrderItemMargin (salesOrderMarginMath)",
      note: "marginValue = netRevenue − quantity × unitCost oficial",
    },
    {
      field: "commercialPrice",
      source: "loadOfficialPriceTableItemsForPairs",
      note: "Referência — não altera margem realizada",
    },
    {
      field: "seller",
      source: "resolveCommissionSellerIdentity",
    },
    {
      field: "commissionSnapshot",
      source: commissionSnapshot ? "CommissionOrderSnapshot ACTIVE" : "—",
      note: commissionSnapshot
        ? "Snapshot materializado disponível para cruzamento"
        : "Sem snapshot materializado",
    },
    {
      field: "nomusUnitCost",
      source: "SalesOrderItem.unitCost",
      note: "Somente diagnóstico — NUNCA usado como custo industrial",
    },
  ];

  const checklist: Record<string, boolean | string> = {
    salesOrderInPrisma: true,
    nfeLinked: nfes.length > 0,
    productResolution: items.every((row) => row.productId != null),
    officialCostOnIssueDate: items.some((row) => row.costSource === "VERSIONED_PRODUCTION_COST"),
    commercialPublishedPriceLookup: items.some((row) => row.publishedCommercialUnitPrice != null),
    marginFromIndusCost: items.every(
      (row) => row.costSource !== "SALES_ORDER_ITEM_SNAPSHOT" && row.costSource !== "LIVE_PRODUCT_COST"
    ),
    sellerResolution: sellerResolved,
    customerExclusionChecked: true,
    commissionSnapshotReused: commissionSnapshot != null,
    avoidsDivergentRecalc:
      "calculateSalesOrderMarginsForOrders + DEFAULT_SALES_ORDER_MARGIN_COST_POLICY (allowLiveCostFallback=false)",
    commissionBundleAvailable: commissionSource != null,
  };

  return {
    status: "PASS",
    auditedAt: new Date().toISOString(),
    order: {
      salesOrderId: order.id,
      orderNumber: order.orderCode,
      customerId: order.customerId,
      customerName,
      rawSellerId: order.externalSellerId,
      rawSellerName: sellerInfo.responsibleName,
      canonicalSellerId: sellerResolution.canonicalSellerId,
      canonicalSellerName: sellerResolution.canonicalSellerName,
      sellerResolutionStatus: sellerResolution.resolutionStatus,
      issueDate: toCivilDateKey(order.issueDate) ?? order.issueDate.toISOString().slice(0, 10),
      totalNetValue: decimalToNumber(order.totalNetValue),
      orderStatus: order.status,
    },
    nfes,
    items,
    totals: computeSalesOrderTraceTotals(items, marginResult?.marginSummary ?? null),
    commissionSnapshot: commissionSnapshot
      ? {
          snapshotId: commissionSnapshot.id,
          sourceHash: commissionSnapshot.sourceHash,
          saleDate: commissionSnapshot.saleDate.toISOString(),
          totalSoldAmount: decimalToNumber(commissionSnapshot.totalSoldAmount),
          canonicalSellerName: commissionSnapshot.canonicalSellerName,
          itemCount: commissionSnapshot._count.items,
        }
      : null,
    customerExcludedFromCommission: customerExcluded,
    customerExclusionReason,
    alerts,
    dataSources,
    checklist,
    costPolicyNote: SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE,
  };
}
