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
    const rawItems = extractNomusRawItems(order.nomusRawResponse);
    let itemsCount = order.totalItems ?? rawItems.length;
    let activeItemsCount = 0;
    let canceledItemsCount = 0;
    let cutItemsCount = 0;
    /**
     * `originalValue` começa com o `totalNetValue` OFICIAL do pedido (fonte
     * da verdade: coluna `SalesOrder.totalNetValue` gravada pelo Nomus sync).
     * Nunca é sobrescrito por um valor calculado das linhas do
     * `nomusRawResponse` que divirja em ordens de magnitude — isso era o
     * bug do totalizador aparecer menor: quando `unitPrice` das linhas vinha
     * zerado ou em escala diferente, a soma `qtyOrdered × unitPrice` ficava
     * bem abaixo do total oficial e o totalizador do PDF/XLSX herdava esse
     * valor menor.
     */
    const officialOrderNetValue = decimalToNumber(order.totalNetValue) ?? 0;
    let originalValue = officialOrderNetValue;
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
      // Sanity check de escala (2026-07). Só usamos a soma das linhas como
      // `originalValue` quando ela está próxima do total oficial do pedido.
      // Se `unitPrice` das linhas vier zerado, incompleto ou em escala
      // diferente, `originalFromItems` cai bem abaixo do `totalNetValue` e
      // o motor descarta esse valor mantendo o total oficial. Faixa aceita:
      // 90%–200% do valor oficial (respeita frete/imposto/desconto). Se o
      // pedido oficial for zero, preserva o comportamento antigo.
      if (originalFromItems > 0) {
        if (officialOrderNetValue <= 0) {
          originalValue = originalFromItems;
        } else {
          const ratio = originalFromItems / officialOrderNetValue;
          if (ratio >= 0.9 && ratio <= 2) {
            originalValue = originalFromItems;
          }
          // Se ratio fora da faixa → preserva `officialOrderNetValue` (já é
          // o default). E também descarta canceledValue/cutValue calculados
          // nas linhas quando estavam em escala corrompida, evitando
          // inflar/deflacionar activeValue.
          else {
            canceledValue = 0;
            cutValue = 0;
            if (order.status === "CANCELLED") {
              canceledValue = officialOrderNetValue;
            }
          }
        }
      }
    } else if (order.status === "CANCELLED") {
      canceledItemsCount = itemsCount;
      canceledValue = originalValue;
    } else {
      activeItemsCount = itemsCount;
    }

    const activeValue = Math.max(0, originalValue - canceledValue - cutValue);
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
