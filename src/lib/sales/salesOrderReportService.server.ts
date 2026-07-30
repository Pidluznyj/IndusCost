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
  buildOrderFiscalFinancialMetrics,
  type OrderOfficialCrSummary,
} from "./orderFiscalFinancialMetrics.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
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
  resolveSalesOrderBillingStatus,
  salesOrderBillingStatusLabel,
} from "./salesOrderListBillingStatus.js";
import {
  buildSalesOrderReportFilterLabels,
  computeSalesOrderReportSummaryFromRows,
  formatSalesOrderReportStatusLabel,
  SALES_ORDER_REPORT_ROWS_LIMIT,
  type SalesOrderReportAppliedFilters,
  type SalesOrderReportPayload,
  type SalesOrderReportRow,
} from "./salesOrderReport.js";
import { resolveSalesOrderReportOrderValues } from "./salesOrderReportOrderValues.js";

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
        // Customer.taxId no schema Prisma é o CNPJ/CPF do cliente. Não existe
        // coluna `cnpj` no model — usar `taxId` aqui evita 500 no findMany.
        taxId: string | null;
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
  const where = await resolveSalesOrderListWhere(prisma, parsed, sellerWhere);
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
        // Model `Customer` expõe o CNPJ como `taxId` (schema.prisma). Selecionar
        // `cnpj` aqui gerava `Invalid prisma.salesOrder.findMany()` → 500 no
        // endpoint /api/sales-orders/report.
        select: { id: true, companyName: true, tradeName: true, taxId: true },
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

  // CR oficial por sourceInvoiceId das NFs vinculadas (mesma regra da Auditoria 360º).
  const nfeExternalIdsByOrder = new Map<string, number[]>();
  const allNfeExternalIds = new Set<number>();
  for (const order of orders) {
    const linked = linkedNfeContextMap.get(order.id);
    const ids = (linked?.nfeLinks ?? [])
      .map((l) => l.nfeExternalId)
      .filter((id): id is number => Number.isFinite(id) && id > 0);
    nfeExternalIdsByOrder.set(order.id, ids);
    for (const id of ids) allNfeExternalIds.add(id);
  }
  const crByOrderId = await loadOfficialCrSummaryByOrderNfes(
    prisma,
    nfeExternalIdsByOrder,
    [...allNfeExternalIds]
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
    const nfeProductsValue = linked?.nfeProductsValue ?? 0;
    const nfeHighlightedTaxesValue = linked?.nfeHighlightedTaxesValue ?? 0;
    const lastNfeDate = isoOrNull(linked?.lastNfeProcessingDate ?? null);
    const crSummary = crByOrderId.get(order.id) ?? {
      hasOfficialCr: false,
      crOriginal: 0,
      crReceived: 0,
      crOpen: 0,
    };

    // Status/quantidade oficial por item (nomusRawResponse.itensPedido[]).
    // Valor ativo/desconto: helper puro — totalNetValue é líquido; qty×unitário
    // costuma ser bruto e NÃO pode virar "A faturar".
    const rawItems = extractNomusRawItems(order.nomusRawResponse);
    const officialOrderNetValue = decimalToNumber(order.totalNetValue) ?? 0;
    const orderValues = resolveSalesOrderReportOrderValues({
      officialOrderNetValue,
      orderStatus: order.status,
      itemsCountFallback: order.totalItems ?? rawItems.length,
      rawItems: rawItems.map((raw) => {
        const parsed = parseNomusSalesOrderItemStatusFromRawItem(raw);
        return {
          quantityOrdered: parsed.quantityOrdered ?? raw.quantidade ?? 0,
          unitPrice: readUnitPriceFromRawItem(raw.raw) ?? 0,
          statusNormalized: parsed.statusNormalized,
          quantityCut: parsed.quantityCut ?? 0,
        };
      }),
    });
    const {
      itemsCount,
      activeItemsCount,
      canceledItemsCount,
      cutItemsCount,
      originalValue,
      canceledValue,
      cutValue,
      activeValue,
      discountValue,
    } = orderValues;
    const metrics = buildOrderFiscalFinancialMetrics({
      orderActiveValue: activeValue,
      nfeProductsValue,
      nfeHighlightedTaxesValue,
      nfeValidTotalValue: invoicedValue,
      cr: crSummary,
    });
    const amountToInvoice = metrics.amountToInvoice;
    const financialBalance = metrics.financialBalance;
    // Compat: pendingBalance legado = A faturar (operacional), NÃO saldo CR.
    const pendingBalance = amountToInvoice;

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
      amountToInvoice,
      financialBalance,
      hasOfficialCr: crSummary.hasOfficialCr,
      invoicedValue,
      activeValue,
    });

    // Faturamento oficial (2026-07) — regra única compartilhada com a
    // listagem operacional e com a Auditoria 360º. Nunca deriva de CR/Proposta.
    const billingStatus = resolveSalesOrderBillingStatus({
      status: order.status,
      hasNfe: hasInvoice,
      isFullyInvoiced: linked?.isFullyInvoiced,
      isPartiallyInvoiced: linked?.isPartiallyInvoiced,
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
      discountValue: roundMoney(discountValue),
      invoicedValue: roundMoney(invoicedValue),
      nfeProductsValue: roundMoney(nfeProductsValue),
      nfeHighlightedTaxesValue: roundMoney(nfeHighlightedTaxesValue),
      amountToInvoice: roundMoney(amountToInvoice),
      hasOfficialCr: crSummary.hasOfficialCr,
      crOriginal: roundMoney(crSummary.crOriginal),
      crReceived: roundMoney(crSummary.crReceived),
      crOpen: roundMoney(crSummary.crOpen),
      financialBalance:
        financialBalance == null ? null : roundMoney(financialBalance),
      pendingBalance: roundMoney(pendingBalance),
      hasInvoice,
      billingStatus,
      billingStatusLabel: salesOrderBillingStatusLabel(billingStatus),
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
  amountToInvoice: number;
  financialBalance: number | null;
  hasOfficialCr: boolean;
  invoicedValue: number;
  activeValue: number;
}): string {
  const parts: string[] = [];
  if (input.canceledItemsCount > 0) parts.push(`${input.canceledItemsCount} cancelado(s)`);
  if (input.cutItemsCount > 0) parts.push(`${input.cutItemsCount} cortado(s)`);
  if (!input.hasInvoice && input.activeValue > 0) parts.push("Sem NF");
  if (input.amountToInvoice > 0.01) parts.push("A faturar");
  if (!input.hasOfficialCr && input.hasInvoice) parts.push("Sem CR gerado");
  if (input.hasOfficialCr && (input.financialBalance ?? 0) > 0.01) {
    parts.push("Saldo financeiro");
  }
  if (input.activeValue > 0 && Math.abs(input.invoicedValue - input.activeValue) < 0.01) {
    parts.push("100% faturado");
  }
  return parts.join(" · ");
}

/**
 * Agrega CR oficial por pedido via sourceInvoiceId ∈ NFs vinculadas.
 * Dedup por receivable.externalId.
 */
async function loadOfficialCrSummaryByOrderNfes(
  prisma: PrismaClient,
  nfeExternalIdsByOrder: Map<string, number[]>,
  allNfeExternalIds: number[]
): Promise<Map<string, OrderOfficialCrSummary>> {
  const result = new Map<string, OrderOfficialCrSummary>();
  for (const orderId of nfeExternalIdsByOrder.keys()) {
    result.set(orderId, {
      hasOfficialCr: false,
      crOriginal: 0,
      crReceived: 0,
      crOpen: 0,
    });
  }
  if (allNfeExternalIds.length === 0) return result;

  const receivables = await prisma.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { in: allNfeExternalIds } },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
    },
  });

  const orderIdByNfeId = new Map<number, string>();
  for (const [orderId, nfeIds] of nfeExternalIdsByOrder) {
    for (const nfeId of nfeIds) {
      // Se a mesma NF aparecer em mais de um pedido (anomalia), o primeiro ganha —
      // o relatório sinaliza divergência via hasValueDivergence no linked context.
      if (!orderIdByNfeId.has(nfeId)) orderIdByNfeId.set(nfeId, orderId);
    }
  }

  const seenReceivableByOrder = new Map<string, Set<number>>();
  for (const row of receivables) {
    if (row.sourceInvoiceId == null) continue;
    const orderId = orderIdByNfeId.get(row.sourceInvoiceId);
    if (!orderId) continue;
    const seen = seenReceivableByOrder.get(orderId) ?? new Set<number>();
    if (seen.has(row.externalId)) continue;
    seen.add(row.externalId);
    seenReceivableByOrder.set(orderId, seen);

    const cur = result.get(orderId) ?? {
      hasOfficialCr: false,
      crOriginal: 0,
      crReceived: 0,
      crOpen: 0,
    };
    cur.hasOfficialCr = true;
    cur.crOriginal += decimalToNumber(row.amountReceivable) ?? 0;
    cur.crReceived += decimalToNumber(row.amountReceived) ?? 0;
    cur.crOpen += decimalToNumber(row.balanceReceivable) ?? 0;
    result.set(orderId, cur);
  }

  return result;
}
