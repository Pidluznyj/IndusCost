/**
 * Carrega dados para exportação interna de margem (server-only).
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
  buildSalesOrderManagementWhere,
} from "./salesOrderManagement.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import {
  countMarginItemStatuses,
  matchesSalesOrderMarginStatusFilter,
} from "./salesOrderManagementMargin.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import {
  parseSalesOrderMarginIndicatorFilters,
  buildSalesOrderMarginIndicatorWhere,
} from "./salesOrderMarginIndicators.server.js";
import {
  buildSalesOrderListWhere,
  isValidSalesOrderListStatus,
} from "./salesOrdersListSummary.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
} from "./salesOrderPeriodFilter.js";
import type {
  SalesOrderInternalMarginExportAlertRow,
  SalesOrderInternalMarginExportFilterRow,
  SalesOrderInternalMarginExportItemRow,
  SalesOrderInternalMarginExportOrderRow,
  SalesOrderInternalMarginExportPayload,
} from "./salesOrderInternalMarginExport.js";
import {
  formatInternalMarginExportCostConfidence,
  formatInternalMarginExportCostSource,
} from "./salesOrderInternalMarginExport.js";
import {
  buildSalesOrderNomusSellerDto,
  buildSalesOrderNomusSellerWhereFilter,
  formatSalesOrderNomusSellerListLabel,
} from "./salesOrderNomusSellerDisplay.js";
import { loadCommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.server.js";

export type SalesOrderInternalMarginExportScope = "list" | "management" | "indicators";

function parseDateQueryStart(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(`${value.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDateQueryEnd(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(`${value.trim()}T23:59:59.999`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function customerDisplayName(customer?: {
  companyName?: string | null;
  tradeName?: string | null;
} | null): string {
  return customer?.tradeName?.trim() || customer?.companyName?.trim() || "Cliente não informado";
}

function formatIssueDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function weightedSummary(
  orders: SalesOrderInternalMarginExportOrderRow[],
  items: SalesOrderInternalMarginExportItemRow[]
): SalesOrderInternalMarginExportPayload["summary"] {
  const netRevenue = orders.reduce((s, r) => s + r.netRevenue, 0);
  const totalCost = orders.reduce((s, r) => s + r.totalCost, 0);
  const marginValue = orders.reduce((s, r) => s + r.marginValue, 0);
  const marginPercent = netRevenue > 0 ? (marginValue / netRevenue) * 100 : null;
  const markup = totalCost > 0 ? netRevenue / totalCost : null;
  return {
    netRevenue,
    totalCost,
    marginValue,
    marginPercent,
    markup,
    ordersCount: orders.length,
    itemsCount: items.length,
    ordersWithNegativeMargin: orders.filter((r) => r.itemsWithNegativeMargin > 0).length,
    itemsWithoutCost: 0,
    itemsWithoutProduct: 0,
  };
}

function buildAlertRows(items: SalesOrderInternalMarginExportItemRow[]): SalesOrderInternalMarginExportAlertRow[] {
  const alerts: SalesOrderInternalMarginExportAlertRow[] = [];
  for (const row of items) {
    const label = row.marginStatusLabel.toLowerCase();
    if (
      !label.includes("sem custo") &&
      !label.includes("sem produto") &&
      !label.includes("negativa")
    ) {
      continue;
    }
    let alertType = row.marginStatusLabel;
    if (label.includes("sem custo")) alertType = "Sem custo";
    else if (label.includes("sem produto")) alertType = "Sem produto vinculado";
    else if (label.includes("negativa")) alertType = "Margem negativa";

    alerts.push({
      alertType,
      orderCode: row.orderCode,
      customerName: row.customerName,
      sellerName: row.sellerName,
      sku: row.sku,
      productName: row.productName,
      netRevenue: row.netRevenue,
      marginValue: row.marginValue,
      marginPercent: row.marginPercent,
      marginStatusLabel: row.marginStatusLabel,
    });
  }
  return alerts;
}

function buildPayloadFromMarginContext(input: {
  scopeLabel: string;
  appliedFilters: SalesOrderInternalMarginExportFilterRow[];
  orders: Array<{
    id: string;
    orderCode: string;
    issueDate: Date;
    responsible: string | null;
    customerName: string;
    logisticStatusLabel?: string;
    items: Array<{
      id: string;
      skuSnapshot: string | null;
      productNameSnapshot: string | null;
      quantity: unknown;
    }>;
  }>;
  marginByOrder: Awaited<ReturnType<typeof calculateSalesOrderMarginsForOrders>>;
}): SalesOrderInternalMarginExportPayload {
  const orderRows: SalesOrderInternalMarginExportOrderRow[] = [];
  const itemRows: SalesOrderInternalMarginExportItemRow[] = [];
  let itemsWithoutCost = 0;
  let itemsWithoutProduct = 0;

  for (const order of input.orders) {
    const marginResult = input.marginByOrder.get(order.id);
    if (!marginResult) continue;

    const summary = marginResult.marginSummary;
    const itemCounts = countMarginItemStatuses(marginResult.itemResults);
    const itemResultsById = new Map(
      marginResult.itemResults
        .filter((r) => r.salesOrderItemId)
        .map((r) => [r.salesOrderItemId!, r])
    );
    const itemMarginsById = marginResult.itemMargins;

    orderRows.push({
      orderCode: order.orderCode,
      customerName: order.customerName,
      sellerName: order.responsible?.trim() || "—",
      issueDate: formatIssueDate(order.issueDate),
      netRevenue: summary.netRevenue,
      totalCost: summary.totalCost,
      marginValue: summary.marginValue,
      marginPercent: summary.marginPercent,
      markup: summary.markup,
      marginStatusLabel: summary.statusLabel,
      logisticStatusLabel: order.logisticStatusLabel,
      itemsWithoutCost: itemCounts.itemsWithoutCost,
      itemsWithoutProduct: itemCounts.itemsWithoutProduct,
      itemsWithNegativeMargin: itemCounts.itemsWithNegativeMargin,
    });

    for (const dbItem of order.items) {
      const itemResult = itemResultsById.get(dbItem.id);
      const itemMargin = itemMarginsById.get(dbItem.id);
      if (!itemResult && !itemMargin) continue;

      if (itemResult?.status === "SEM_CUSTO") itemsWithoutCost += 1;
      if (itemResult?.status === "SEM_PRODUTO_VINCULADO") itemsWithoutProduct += 1;

      const payload = itemMargin ?? {
        netRevenue: itemResult!.netRevenue,
        unitCost: itemResult!.unitCost,
        totalCost: itemResult!.totalCost,
        marginValue: itemResult!.marginValue,
        marginPercent: itemResult!.marginPercent,
        markup: itemResult!.markup,
        costSource: itemResult!.costSource,
        costConfidence: itemResult!.costConfidence,
        statusLabel: itemResult!.statusLabel,
        notes: itemResult!.notes,
      };

      itemRows.push({
        orderCode: order.orderCode,
        customerName: order.customerName,
        sellerName: order.responsible?.trim() || "—",
        sku: dbItem.skuSnapshot?.trim() || "—",
        productName: dbItem.productNameSnapshot?.trim() || "Produto não informado",
        quantity: decimalToNumber(dbItem.quantity) ?? 0,
        netRevenue: payload.netRevenue,
        unitCost: payload.unitCost,
        totalCost: payload.totalCost,
        marginValue: payload.marginValue,
        marginPercent: payload.marginPercent,
        markup: payload.markup,
        costSourceLabel: formatInternalMarginExportCostSource(payload.costSource),
        costConfidenceLabel: formatInternalMarginExportCostConfidence(payload.costConfidence),
        marginStatusLabel: payload.statusLabel ?? itemResult?.statusLabel ?? "—",
        notes: (payload.notes ?? itemResult?.notes ?? []).join(" · "),
      });
    }
  }

  const summary = weightedSummary(orderRows, itemRows);
  summary.itemsWithoutCost = itemsWithoutCost;
  summary.itemsWithoutProduct = itemsWithoutProduct;
  const alerts = buildAlertRows(itemRows);

  return {
    generatedAt: new Date().toISOString(),
    scopeLabel: input.scopeLabel,
    appliedFilters: input.appliedFilters,
    summary,
    orders: orderRows,
    items: itemRows,
    alerts,
  };
}

function buildListExportFilters(query: Record<string, unknown>): SalesOrderInternalMarginExportFilterRow[] {
  const rows: SalesOrderInternalMarginExportFilterRow[] = [
    { label: "Origem", value: "Pedidos de Venda (lista)" },
  ];
  const status = String(query.status ?? "").trim();
  if (status) rows.push({ label: "Status pedido", value: status });
  const customerId = String(query.customerId ?? "").trim();
  if (customerId) rows.push({ label: "Cliente (ID)", value: customerId });
  const seller = String(query.seller ?? query.responsible ?? "").trim();
  if (seller) rows.push({ label: "Vendedor", value: seller });
  const year = parseSalesOrderYearParam(query.year);
  if (year) rows.push({ label: "Ano emissão", value: String(year) });
  const month = parseSalesOrderMonthParam(query.month);
  if (month) rows.push({ label: "Mês emissão", value: String(month) });
  const startDate = String(query.startDate ?? "").trim();
  if (startDate) rows.push({ label: "Emissão de", value: startDate });
  const endDate = String(query.endDate ?? "").trim();
  if (endDate) rows.push({ label: "Emissão até", value: endDate });
  const q = String(query.q ?? "").trim();
  if (q) rows.push({ label: "Busca", value: q });
  return rows;
}

function buildManagementExportFilters(
  filters: ReturnType<typeof parseSalesOrderManagementFilters>
): SalesOrderInternalMarginExportFilterRow[] {
  const rows: SalesOrderInternalMarginExportFilterRow[] = [
    { label: "Origem", value: "Gestão de Pedidos de Venda" },
  ];
  if (filters.allYears) rows.push({ label: "Ano", value: "Todos" });
  else if (filters.year) rows.push({ label: "Ano emissão", value: String(filters.year) });
  if (filters.month) rows.push({ label: "Mês emissão", value: String(filters.month) });
  if (filters.customerId) rows.push({ label: "Cliente (ID)", value: filters.customerId });
  if (filters.responsible) rows.push({ label: "Vendedor", value: filters.responsible });
  if (filters.companyIssuer) rows.push({ label: "Empresa", value: filters.companyIssuer });
  if (filters.operationalStatus) rows.push({ label: "Status operacional", value: filters.operationalStatus });
  if (filters.logisticStatus || filters.managementStatus) {
    rows.push({
      label: "Status logístico",
      value: filters.logisticStatus || filters.managementStatus || "",
    });
  }
  if (filters.marginStatus) rows.push({ label: "Status margem", value: filters.marginStatus });
  if (filters.q) rows.push({ label: "Busca", value: filters.q });
  return rows;
}

function buildIndicatorsExportFilters(
  filters: ReturnType<typeof parseSalesOrderMarginIndicatorFilters>
): SalesOrderInternalMarginExportFilterRow[] {
  const rows: SalesOrderInternalMarginExportFilterRow[] = [
    { label: "Origem", value: "Indicadores de margem" },
    { label: "Ano", value: String(filters.year) },
  ];
  if (filters.month) rows.push({ label: "Mês", value: String(filters.month) });
  if (filters.customerId) rows.push({ label: "Cliente (ID)", value: filters.customerId });
  if (filters.responsible) rows.push({ label: "Vendedor", value: filters.responsible });
  if (filters.companyIssuer) rows.push({ label: "Empresa", value: filters.companyIssuer });
  if (filters.productId) rows.push({ label: "Produto (ID)", value: filters.productId });
  if (filters.status) rows.push({ label: "Status pedido", value: filters.status });
  if (filters.marginStatus) rows.push({ label: "Status margem", value: filters.marginStatus });
  if (filters.itemMarginStatus) rows.push({ label: "Status margem item", value: filters.itemMarginStatus });
  return rows;
}

export async function loadSalesOrderInternalMarginExportPayload(
  prisma: PrismaClient,
  scope: SalesOrderInternalMarginExportScope,
  query: Record<string, unknown>
): Promise<SalesOrderInternalMarginExportPayload> {
  if (scope === "management") {
    const filters = parseSalesOrderManagementFilters(query);
    const where = buildSalesOrderManagementWhere(filters);
    const orders = await prisma.salesOrder.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      include: {
        Customer: { select: { companyName: true, tradeName: true, taxId: true } },
        items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
      },
    });

    const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap(
      orders.map((order) => ({
        id: order.id,
        totalNetValue: order.totalNetValue,
        issueDate: order.issueDate,
        expectedDeliveryDate: order.expectedDeliveryDate,
        nomusRawResponse: order.nomusRawResponse,
      }))
    );

    const { rows } = buildManagementRowsFromOrders(
      orders,
      filters,
      undefined,
      linkedNfeContextMap
    );

    const marginByOrder = await calculateSalesOrderMarginsForOrders(
      prisma,
      orders.map((order) => ({
        id: order.id,
        issueDate: order.issueDate,
        nomusRawResponse: order.nomusRawResponse,
        items: order.items,
      }))
    );

    const filteredRows = filters.marginStatus
      ? rows.filter((row) =>
          matchesSalesOrderMarginStatusFilter(row.marginSummary, filters.marginStatus!)
        )
      : rows;

    const orderById = new Map(orders.map((o) => [o.id, o]));
    const exportOrders = filteredRows
      .map((row) => {
        const order = orderById.get(row.id);
        if (!order) return null;
        return {
          id: row.id,
          orderCode: row.orderCode,
          issueDate: order.issueDate,
          responsible: row.nomusSellerDisplayName || row.sellerName || "—",
          customerName: row.customerName,
          logisticStatusLabel: row.logisticStatusLabel,
          items: order.items,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return buildPayloadFromMarginContext({
      scopeLabel: "Gestão de Pedidos de Venda",
      appliedFilters: buildManagementExportFilters(filters),
      orders: exportOrders,
      marginByOrder,
    });
  }

  if (scope === "indicators") {
    const filters = parseSalesOrderMarginIndicatorFilters(query);
    const where = buildSalesOrderMarginIndicatorWhere(filters);
    const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
    const orders = await prisma.salesOrder.findMany({
      where,
      select: {
        id: true,
        orderCode: true,
        issueDate: true,
        externalSellerId: true,
        customerId: true,
        nomusRawResponse: true,
        Customer: { select: { companyName: true, tradeName: true } },
        items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
      },
    });

    const marginByOrder = await calculateSalesOrderMarginsForOrders(
      prisma,
      orders as SalesOrderForMargin[]
    );

    const exportOrders = orders
      .filter((order) => {
        const marginResult = marginByOrder.get(order.id);
        if (!marginResult) return false;
        if (
          filters.marginStatus &&
          !matchesSalesOrderMarginStatusFilter(marginResult.marginSummary, filters.marginStatus)
        ) {
          return false;
        }
        return true;
      })
      .map((order) => {
        const seller = buildSalesOrderNomusSellerDto(
          {
            externalSellerId: order.externalSellerId ?? null,
            issueDate: order.issueDate,
          },
          sellerIdentityCtx
        );
        return {
          id: order.id,
          orderCode: order.orderCode,
          issueDate: order.issueDate,
          responsible: formatSalesOrderNomusSellerListLabel(seller),
          customerName: customerDisplayName(order.Customer),
          items: order.items.filter((item) => {
            if (filters.productId && item.productId !== filters.productId) return false;
            if (filters.itemMarginStatus) {
              const itemResult = marginByOrder
                .get(order.id)
                ?.itemResults.find((r) => r.salesOrderItemId === item.id);
              if (!itemResult || itemResult.status !== filters.itemMarginStatus) return false;
            }
            return true;
          }),
        };
      });

    return buildPayloadFromMarginContext({
      scopeLabel: "Indicadores de margem",
      appliedFilters: buildIndicatorsExportFilters(filters),
      orders: exportOrders,
      marginByOrder,
    });
  }

  const status = String(query.status ?? "").trim();
  const customerId = String(query.customerId ?? "").trim();
  const sellerFilter = String(query.seller ?? query.responsible ?? "").trim();
  const year = parseSalesOrderYearParam(query.year);
  const month = parseSalesOrderMonthParam(query.month);
  const startDate = parseDateQueryStart(query.startDate);
  const endDate = parseDateQueryEnd(query.endDate);
  const q = String(query.q ?? "").trim();

  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  const sellerWhere = buildSalesOrderNomusSellerWhereFilter(sellerFilter, sellerIdentityCtx);

  const where = buildSalesOrderListWhere({
    status: status && isValidSalesOrderListStatus(status) ? status : undefined,
    customerId: customerId || undefined,
    seller: sellerFilter || undefined,
    sellerWhere,
    startDate,
    endDate,
    year,
    month,
    q: q || undefined,
  });

  const orders = await prisma.salesOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { issueDate: "desc" }],
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      externalSellerId: true,
      nomusRawResponse: true,
      Customer: { select: { companyName: true, tradeName: true } },
      items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
    },
  });

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    orders as SalesOrderForMargin[]
  );

  return buildPayloadFromMarginContext({
    scopeLabel: "Pedidos de Venda (lista)",
    appliedFilters: buildListExportFilters(query),
    orders: orders.map((order) => {
      const seller = buildSalesOrderNomusSellerDto(
        {
          externalSellerId: order.externalSellerId ?? null,
          issueDate: order.issueDate,
        },
        sellerIdentityCtx
      );
      return {
        id: order.id,
        orderCode: order.orderCode,
        issueDate: order.issueDate,
        responsible: formatSalesOrderNomusSellerListLabel(seller),
        customerName: customerDisplayName(order.Customer),
        items: order.items,
      };
    }),
    marginByOrder,
  });
}
