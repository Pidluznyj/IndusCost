/**
 * Carrega dados para exportação Comercial de Pedidos de Venda (server-only).
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { loadCommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.server.js";
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import {
  buildSalesOrderNomusSellerDto,
  formatSalesOrderNoSellerFilterLabel,
  formatSalesOrderNomusSellerListLabel,
} from "./salesOrderNomusSellerDisplay.js";
import {
  buildSalesOrderListFilterLabels,
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
  type SalesOrderListQuery,
} from "./salesOrderListQuery.server.js";
import {
  buildSalesOrderListPaymentOpeningRows,
  buildSalesOrderListPaymentReportSummary,
  resolveSalesOrderListPaymentSummary,
} from "./salesOrderListPaymentSchedule.js";
import {
  collectReceivablesForOrderNfes,
  loadSalesOrderListReceivablesByNfeExternalIds,
} from "./salesOrderListPaymentSchedule.server.js";
import { SALES_ORDER_LIST_STATUS_LABELS } from "./salesOrderListUi.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import {
  buildSalesOrderListReportPeriodLabel,
  formatSalesOrderListReportIssueDate,
  formatSalesOrderListReportNfeDocument,
  type SalesOrderListReportExportPayload,
  type SalesOrderListReportExportRow,
  type SalesOrderListReportPaymentOpeningRow,
} from "./salesOrderListReportExport.js";

function customerDisplayName(customer?: {
  companyName?: string | null;
  tradeName?: string | null;
} | null): string {
  return customer?.tradeName?.trim() || customer?.companyName?.trim() || "Cliente não informado";
}

function formatDueDateBr(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleDateString("pt-BR");
}

function resolveSellerLabelForSummary(
  query: SalesOrderListQuery,
  ctx: Awaited<ReturnType<typeof loadCommissionSellerIdentityContext>>
): string {
  if (query.sellerKey.kind === "no_seller") return formatSalesOrderNoSellerFilterLabel();
  if (query.sellerKey.kind === "seller_id") {
    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: query.sellerKey.externalSellerId },
      ctx
    );
    return formatSalesOrderNomusSellerListLabel(seller);
  }
  if (query.sellerText) return query.sellerText;
  return "Todos os vendedores";
}

export async function loadSalesOrderListReportExportPayload(
  prisma: PrismaClient,
  query: Record<string, unknown>,
  canViewMarginEconomics: boolean
): Promise<SalesOrderListReportExportPayload> {
  const parsed = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: parsed.sellerKeyRaw,
    sellerText: parsed.sellerText,
  });
  const where = await resolveSalesOrderListWhere(prisma, parsed, sellerWhere);
  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  const sellerLabel = resolveSellerLabelForSummary(parsed, sellerIdentityCtx);

  const orders = await prisma.salesOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { issueDate: "desc" }],
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderCode: true,
      status: true,
      issueDate: true,
      externalSellerId: true,
      totalNetValue: true,
      totalItems: true,
      expectedDeliveryDate: true,
      paymentTerms: true,
      paymentMethod: true,
      nomusRawResponse: true,
      Customer: { select: { companyName: true, tradeName: true } },
      items: canViewMarginEconomics ? { select: SALES_ORDER_ITEM_MARGIN_SELECT } : false,
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

  const allNfeExternalIds = [
    ...new Set(
      [...linkedNfeContextMap.values()].flatMap((context) =>
        context.nfeLinks.map((link) => link.nfeExternalId)
      )
    ),
  ];
  const receivablesByNfeId = await loadSalesOrderListReceivablesByNfeExternalIds(
    prisma,
    allNfeExternalIds
  );

  const marginByOrder = canViewMarginEconomics
    ? await calculateSalesOrderMarginsForOrders(
        prisma,
        orders.filter((order) => order.items).map((order) => order as SalesOrderForMargin)
      )
    : new Map();

  let totalNetAmount = 0;
  let totalItems = 0;
  let marginPercentSum = 0;
  let marginPercentWeight = 0;
  let invoicedCount = 0;
  let notInvoicedCount = 0;
  const paymentSummaries = [];
  const paymentOpeningRows: SalesOrderListReportPaymentOpeningRow[] = [];

  const rows: SalesOrderListReportExportRow[] = orders.map((order) => {
    const linked = linkedNfeContextMap.get(order.id);
    const hasInvoice = linked?.hasNfe ?? false;
    const netValue = decimalToNumber(order.totalNetValue) ?? 0;
    const itemsCount = order.totalItems ?? 0;
    totalNetAmount += netValue;
    totalItems += itemsCount;
    if (hasInvoice) invoicedCount += 1;
    else notInvoicedCount += 1;

    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: order.externalSellerId ?? null, issueDate: order.issueDate },
      sellerIdentityCtx
    );
    const marginResult = marginByOrder.get(order.id);
    const marginPercent = marginResult?.marginSummary.marginPercent ?? null;
    const marginValue = marginResult?.marginSummary.marginValue ?? null;
    if (marginPercent != null && netValue > 0) {
      marginPercentSum += marginPercent * netValue;
      marginPercentWeight += netValue;
    }

    const nfeDocument = formatSalesOrderListReportNfeDocument(linked?.nfeNumbers);
    const nfeExternalIds = linked?.nfeLinks.map((link) => link.nfeExternalId) ?? [];
    const receivables = collectReceivablesForOrderNfes(nfeExternalIds, receivablesByNfeId);
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: order.paymentTerms,
      paymentMethod: order.paymentMethod,
      issueDate: order.issueDate,
      totalNetValue: netValue,
      nomusRawResponse: order.nomusRawResponse,
      nfeDocuments: linked?.nfeNumbers ?? [],
      receivables,
    });
    paymentSummaries.push(payment);
    paymentOpeningRows.push(
      ...buildSalesOrderListPaymentOpeningRows({
        orderCode: order.orderCode,
        customerName: customerDisplayName(order.Customer),
        sellerName: formatSalesOrderNomusSellerListLabel(seller),
        nfeDocument,
        payment,
      })
    );

    return {
      orderCode: order.orderCode,
      customerName: customerDisplayName(order.Customer),
      sellerName: formatSalesOrderNomusSellerListLabel(seller),
      issueDate: formatSalesOrderListReportIssueDate(order.issueDate),
      status: order.status,
      statusLabel: SALES_ORDER_LIST_STATUS_LABELS[order.status] ?? order.status,
      hasInvoice,
      netValue,
      marginPercent,
      marginValue,
      itemsCount,
      nfeDocument,
      externalSalesOrderCode: order.externalSalesOrderCode?.trim() ?? "",
      paymentConditionLabel: payment.paymentConditionLabel,
      paymentSourceLabel: payment.paymentSourceLabel,
      installmentCount: payment.installmentCount,
      firstDueDate: formatDueDateBr(payment.firstDueDate),
      lastDueDate: formatDueDateBr(payment.lastDueDate),
      scheduleText: payment.scheduleText,
      totalTitlesAmount: payment.totalTitlesAmount ?? "",
      financialStatusLabel: payment.financialStatusLabel ?? "—",
    };
  });

  const averageMarginPercent =
    marginPercentWeight > 0 ? marginPercentSum / marginPercentWeight : null;
  const paymentReportSummary = buildSalesOrderListPaymentReportSummary({
    payments: paymentSummaries,
  });

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: buildSalesOrderListFilterLabels(parsed, sellerLabel),
    summary: {
      sellerLabel,
      periodLabel: buildSalesOrderListReportPeriodLabel(parsed),
      ordersCount: orders.length,
      totalNetAmount,
      totalItems,
      averageTicket: computeTicketAverage(totalNetAmount, orders.length) ?? 0,
      averageMarginPercent,
      invoicedCount,
      notInvoicedCount,
      cashOrdersCount: paymentReportSummary.cashOrdersCount,
      installmentOrdersCount: paymentReportSummary.installmentOrdersCount,
      noPaymentInfoCount: paymentReportSummary.noPaymentInfoCount,
      withRealTitlesCount: paymentReportSummary.withRealTitlesCount,
      withForecastOnlyCount: paymentReportSummary.withForecastOnlyCount,
      reportFirstDueDate: formatDueDateBr(paymentReportSummary.reportFirstDueDate),
      reportLastDueDate: formatDueDateBr(paymentReportSummary.reportLastDueDate),
      totalTitlesAmount: paymentReportSummary.totalTitlesAmount,
    },
    rows,
    paymentOpeningRows,
  };
}
