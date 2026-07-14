/**
 * Loader server-side do Relatório Comercial > Pedidos de Venda (branding IndusCost).
 *
 * Reutiliza:
 * - parseSalesOrderListQuery / buildSalesOrderListWhereForQuery / resolveSalesOrderListSellerWhere
 * - buildSalesOrderNomusSellerDto / formatSalesOrderNomusSellerListLabel
 * - loadSalesOrderLinkedNfeContextMap (fatura vinculada)
 * - resolveSalesOrderListPaymentSummary (condição de pagamento)
 * - parseNomusSalesOrderItemStatusFromRawItem (status oficial cancelado/corte)
 * - loadManualCommercialOwnersForCustomers (responsável comercial)
 * - loadCommissionSellerIdentityContext (vendedor Nomus)
 *
 * Fonte oficial: SalesOrder / SalesOrderItem (Nomus). Proposta NÃO é fonte.
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "../executiveDashboardHelpers.js";
import { loadCommissionSellerIdentityContext } from "../commissions/commissionSellerIdentity.server.js";
import { loadManualCommercialOwnersForCustomers } from "../crmCustomerCommercialOwner.js";
import { loadSalesOrderLinkedNfeContextMap } from "../salesOrderLinkedNfe.js";
import {
  buildSalesOrderListWhereForQuery,
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  type SalesOrderListQuery,
} from "../salesOrderListQuery.server.js";
import { resolveSalesOrderListPaymentSummary } from "../salesOrderListPaymentSchedule.js";
import {
  buildSalesOrderNomusSellerDto,
  formatSalesOrderNomusSellerListLabel,
  formatSalesOrderNoSellerFilterLabel,
} from "../salesOrderNomusSellerDisplay.js";
import { extractNomusRawItems } from "../salesOrderNomusRaw.js";
import { parseNomusSalesOrderItemStatusFromRawItem } from "./nomusSalesOrderItemStatus.js";
import {
  buildSalesOrderReportFilterLabels,
  computeSalesOrderReportSummaryFromRows,
  formatSalesOrderReportStatusLabel,
  SALES_ORDER_REPORT_ROWS_LIMIT,
  type SalesOrderReportAppliedFilters,
  type SalesOrderReportPayload,
  type SalesOrderReportRow,
} from "./salesOrderReport.js";

const REPORT_ORDER_FIELD_LIMIT = SALES_ORDER_REPORT_ROWS_LIMIT;

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

function customerCnpj(customer?: {
  cnpj?: string | null;
  taxId?: string | null;
} | null): string | null {
  const raw = customer?.cnpj?.trim() || customer?.taxId?.trim() || null;
  return raw || null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function safeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function resolveSellerLabelForFilters(
  query: SalesOrderListQuery,
  ctx: Awaited<ReturnType<typeof loadCommissionSellerIdentityContext>>
): string | null {
  if (query.sellerKey.kind === "no_seller") {
    return formatSalesOrderNoSellerFilterLabel();
  }
  if (query.sellerKey.kind === "seller_id") {
    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: query.sellerKey.externalSellerId },
      ctx
    );
    return formatSalesOrderNomusSellerListLabel(seller);
  }
  if (query.sellerText) return query.sellerText;
  return null;
}

type OrderRow = {
  id: string;
  orderCode: string;
  externalSalesOrderCode: string | null;
  status: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  externalSellerId: number | null;
  responsible: string | null;
  totalNetValue: unknown;
  totalItems: number | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  nomusRawResponse: unknown;
  Customer:
    | {
        id: string;
        companyName: string;
        tradeName: string | null;
        cnpj: string | null;
      }
    | null;
};

/** Parâmetros crus da query string aceitos pelo loader. */
export type LoadSalesOrderReportPayloadInput = {
  query: Record<string, unknown>;
  emitterName?: string | null;
  referenceDate?: Date;
};

/** Carrega o payload completo do Relatório de Pedidos de Venda. */
export async function loadSalesOrderReportPayload(
  prisma: PrismaClient,
  input: LoadSalesOrderReportPayloadInput
): Promise<SalesOrderReportPayload> {
  const parsed = parseSalesOrderListQuery(input.query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: parsed.sellerKeyRaw,
    sellerText: parsed.sellerText,
  });
  const where = buildSalesOrderListWhereForQuery(parsed, sellerWhere);
  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  const sellerLabel = resolveSellerLabelForFilters(parsed, sellerIdentityCtx);

  const totalOrdersInScope = await prisma.salesOrder.count({ where });

  const orders = (await prisma.salesOrder.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: REPORT_ORDER_FIELD_LIMIT,
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderCode: true,
      status: true,
      issueDate: true,
      expectedDeliveryDate: true,
      externalSellerId: true,
      responsible: true,
      totalNetValue: true,
      totalItems: true,
      paymentTerms: true,
      paymentMethod: true,
      nomusRawResponse: true,
      Customer: {
        select: { id: true, companyName: true, tradeName: true, cnpj: true },
      },
    },
  })) as OrderRow[];

  const referenceDate = input.referenceDate ?? new Date();

  const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    referenceDate
  );

  const uniqueCustomerIds = [
    ...new Set(orders.map((order) => order.Customer?.id).filter((id): id is string => !!id)),
  ];
  const commercialOwnersByCustomer = await loadManualCommercialOwnersForCustomers(uniqueCustomerIds);

  const rows: SalesOrderReportRow[] = orders.map((order) => {
    const linked = linkedNfeContextMap.get(order.id);
    const hasInvoice = linked?.hasNfe ?? false;
    const nfeNumbers = linked?.nfeNumbers ?? [];
    const invoicedValue = linked?.nfeTotalValue ?? 0;
    const lastNfeDate = isoOrNull(linked?.lastNfeProcessingDate ?? null);

    // Status/quantidade oficial por item (nomusRawResponse.itensPedido[]).
    const rawItems = extractNomusRawItems(order.nomusRawResponse);
    let itemsCount = order.totalItems ?? rawItems.length;
    let activeItemsCount = 0;
    let canceledItemsCount = 0;
    let cutItemsCount = 0;
    let originalValue = decimalToNumber(order.totalNetValue) ?? 0;
    let canceledValue = 0;
    let cutValue = 0;

    if (rawItems.length > 0) {
      itemsCount = rawItems.length;
      let originalFromItems = 0;
      for (const raw of rawItems) {
        const parsed = parseNomusSalesOrderItemStatusFromRawItem(raw);
        const qtyOrdered = parsed.quantityOrdered ?? raw.quantidade ?? 0;
        const unitPrice = readUnitPriceFromRawItem(raw.raw) ?? 0;
        const totalItemValue = qtyOrdered * unitPrice;
        originalFromItems += totalItemValue;
        if (parsed.statusNormalized === "CANCELED") {
          canceledItemsCount += 1;
          canceledValue += totalItemValue;
        } else if (parsed.statusNormalized === "FULFILLED_WITH_CUT") {
          cutItemsCount += 1;
          const cutQty = parsed.quantityCut ?? 0;
          cutValue += cutQty * unitPrice;
          activeItemsCount += 1;
        } else {
          activeItemsCount += 1;
        }
      }
      if (originalFromItems > 0) originalValue = originalFromItems;
    } else if (order.status === "CANCELLED") {
      canceledItemsCount = itemsCount;
      canceledValue = originalValue;
    } else {
      activeItemsCount = itemsCount;
    }

    const activeValue = Math.max(0, originalValue - canceledValue - cutValue);
    const pendingBalance = Math.max(0, activeValue - invoicedValue);

    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: order.externalSellerId ?? null, issueDate: order.issueDate },
      sellerIdentityCtx
    );

    const customerId = order.Customer?.id ?? null;
    const commercialOwner = customerId
      ? commercialOwnersByCustomer.get(customerId) ?? null
      : null;

    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: order.paymentTerms,
      paymentMethod: order.paymentMethod,
      issueDate: order.issueDate,
      totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
      nomusRawResponse: order.nomusRawResponse,
      nfeDocuments: nfeNumbers,
      receivables: [],
    });

    const alertsSummary = buildAlertsSummary({
      canceledItemsCount,
      cutItemsCount,
      hasInvoice,
      pendingBalance,
      invoicedValue,
      activeValue,
    });

    return {
      orderId: order.id,
      orderCode: order.orderCode,
      externalSalesOrderCode: safeText(order.externalSalesOrderCode) || null,
      customerName: customerDisplayName(order.Customer),
      customerCnpj: customerCnpj(order.Customer),
      companyName: readCompanyNameFromNomus(order.nomusRawResponse),
      issueDate: isoOrNull(order.issueDate),
      expectedDeliveryDate: isoOrNull(order.expectedDeliveryDate),
      sellerName: formatSalesOrderNomusSellerListLabel(seller),
      sellerExternalId: seller.externalSellerId,
      commercialResponsibleName: commercialOwner?.sellerCanonicalName?.trim() || null,
      operationalResponsibleName: safeText(order.responsible) || null,
      status: order.status,
      statusLabel: formatSalesOrderReportStatusLabel(order.status),
      paymentConditionLabel: payment.paymentConditionLabel,
      paymentMethodLabel: safeText(order.paymentMethod) || "—",
      itemsCount,
      activeItemsCount,
      canceledItemsCount,
      cutItemsCount,
      originalValue: roundMoney(originalValue),
      canceledValue: roundMoney(canceledValue),
      cutValue: roundMoney(cutValue),
      activeValue: roundMoney(activeValue),
      invoicedValue: roundMoney(invoicedValue),
      pendingBalance: roundMoney(pendingBalance),
      hasInvoice,
      nfeCount: linked?.nfeCount ?? 0,
      nfeNumbers,
      nfeDocument: nfeNumbers.filter(Boolean).join(", "),
      lastNfeDate,
      alertsSummary,
    };
  });

  const filters: SalesOrderReportAppliedFilters = {
    customerId: safeText(parsed.customerId),
    customerName: extractCustomerNameFromRows(rows, parsed.customerId),
    status: safeText(parsed.status),
    sellerKey: safeText(parsed.sellerKeyRaw),
    sellerLabel,
    startDate: isoOrNull(parsed.startDate) ?? null,
    endDate: isoOrNull(parsed.endDate) ?? null,
    year: parsed.year,
    month: parsed.month,
    search: safeText(parsed.q),
  };

  const summary = computeSalesOrderReportSummaryFromRows(rows);
  const filterLabels = buildSalesOrderReportFilterLabels(filters);

  return {
    generatedAt: referenceDate.toISOString(),
    emitterName: input.emitterName?.trim() || null,
    filters,
    filterLabels,
    summary,
    rows,
    truncated: totalOrdersInScope > orders.length,
    totalOrdersInScope,
  };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function readUnitPriceFromRawItem(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const candidates = [
    obj.valorUnitario,
    obj.valor_unitario,
    obj.precoUnitario,
    obj.preco,
    obj.valorUnitarioComDesconto,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const n = Number(candidate.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readCompanyNameFromNomus(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const candidates = [
    obj.nomeEmpresa,
    obj.empresa,
    obj.razaoSocialEmpresa,
    obj.razaoSocial,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate != null && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = candidate as Record<string, unknown>;
      const nestedName =
        nested.razaoSocial ?? nested.nome ?? nested.nomeFantasia ?? nested.name;
      if (typeof nestedName === "string" && nestedName.trim()) return nestedName.trim();
    }
  }
  return null;
}

function extractCustomerNameFromRows(
  rows: readonly SalesOrderReportRow[],
  customerId: string
): string | null {
  const trimmed = customerId.trim();
  if (!trimmed) return null;
  const match = rows.find((row) => {
    return row.orderId && row.customerName && row.customerName.trim().length > 0;
  });
  return match ? match.customerName : null;
}

function buildAlertsSummary(input: {
  canceledItemsCount: number;
  cutItemsCount: number;
  hasInvoice: boolean;
  pendingBalance: number;
  invoicedValue: number;
  activeValue: number;
}): string {
  const parts: string[] = [];
  if (input.canceledItemsCount > 0) parts.push(`${input.canceledItemsCount} cancelado(s)`);
  if (input.cutItemsCount > 0) parts.push(`${input.cutItemsCount} cortado(s)`);
  if (!input.hasInvoice && input.activeValue > 0) parts.push("Sem NF");
  if (input.pendingBalance > 0.01) parts.push("Saldo pendente");
  if (input.activeValue > 0 && Math.abs(input.invoicedValue - input.activeValue) < 0.01) {
    parts.push("100% faturado");
  }
  return parts.join(" · ");
}
