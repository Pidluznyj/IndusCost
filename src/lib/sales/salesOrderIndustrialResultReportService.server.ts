/**
 * Loader server-side — Relatório de Resultado Industrial dos Pedidos.
 *
 * Reutiliza:
 * - parseSalesOrderListQuery / resolveSalesOrderListWhere (mesmos filtros do PDF comercial)
 * - custo versionado vigente em SalesOrder.issueDate (sem fallback live)
 * - impostos reais via NomusNfeFiscalSummary das NF vinculadas válidas
 * - impostos estimados via TaxRule oficial (Parâmetros Nomus / ProductPricing)
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "../executiveDashboardHelpers.js";
import { computeSalesTaxAmount } from "../averageSalesTaxEngine.js";
import { roundMoney } from "../commissions/commission-money.shared.js";
import { loadCommissionSellerIdentityContext } from "../commissions/commissionSellerIdentity.server.js";
import {
  parseDocumentaryMoney,
  sumDocumentaryMoney,
  type DocumentarySummaryTaxTotals,
} from "../sales-orders/salesOrderDocumentaryTaxes.js";
import { resolveOfficialSalesMarginTaxContext } from "../salesMarginNomusTaxContext.server.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
  type SalesOrderListQuery,
} from "../salesOrderListQuery.server.js";
import { loadSalesOrderLinkedNfeContextMap } from "../salesOrderLinkedNfe.js";
import {
  buildSalesOrderNomusSellerDto,
  formatSalesOrderNomusSellerListLabel,
  formatSalesOrderNoSellerFilterLabel,
} from "../salesOrderNomusSellerDisplay.js";
import {
  effectiveProductionCostLookupKey,
  type EffectiveProductProductionCostOk,
  type ProductionCostBreakdown,
} from "../productionCostVersioning.js";
import { getEffectiveProductProductionCostsForPairs } from "../productionCostTables.server.js";
import {
  resolveSalesOrderItemProducts,
  type SalesOrderMarginResolverItem,
} from "../salesOrderMarginResolver.js";
import { loadSalesOrderMarginProductBatchIndex } from "../salesOrderMarginResolver.server.js";
import {
  loadSalesOrderItemsForMargin,
  type SalesOrderForMargin,
  type SalesOrderItemForMargin,
} from "../salesOrderMarginService.server.js";
import { extractNomusRawItems, matchRawItemToDbItem, resolveSalesOrderItemNomusStatus } from "../salesOrderNomusRaw.js";
import {
  resolveSalesOrderBillingStatus,
  salesOrderBillingStatusLabel,
} from "./salesOrderListBillingStatus.js";
import { formatSalesOrderReportStatusLabel } from "./salesOrderReport.js";
import {
  buildSalesOrderReportFilterLabels,
  computeSalesOrderIndustrialResultReportSummaryFromRows,
  industrialCostSourceStatusLabel,
  industrialTaxSourceLabel,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_ROWS_LIMIT,
  type SalesOrderIndustrialResultReportPayload,
  type SalesOrderIndustrialResultReportRow,
  type SalesOrderReportAppliedFilters,
} from "./salesOrderIndustrialResultReport.js";
import {
  classifyIndustrialTaxSource,
  computeIndustrialResult,
  emptyIndustrialTaxBreakdown,
  reconcileIndustrialCostBreakdown,
  reconcileTaxBreakdownColumns,
  resolveUninvoicedCommercialValue,
  sumIndustrialTaxBreakdown,
  type IndustrialCostSourceStatus,
  type IndustrialTaxBreakdown,
} from "./salesOrderIndustrialResultReportMath.js";
import {
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_SUBTITLE,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_TITLE,
} from "./salesOrderIndustrialResultReportPrintMeta.js";

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function civilDateKey(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

function resolveSellerLabelForFilters(
  query: SalesOrderListQuery,
  ctx: Awaited<ReturnType<typeof loadCommissionSellerIdentityContext>>
): string | null {
  if (query.sellerKey.kind === "no_seller") return formatSalesOrderNoSellerFilterLabel();
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

function mapItemToResolverInput(
  item: SalesOrderItemForMargin,
  order: SalesOrderForMargin,
  itemIndex: number,
  totalItems: number
): SalesOrderMarginResolverItem {
  const dbItem = {
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
  };
  const matchOptions = { itemIndex, totalDbItems: totalItems };
  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  const matched = matchRawItemToDbItem(rawItems, dbItem, matchOptions);
  const nomusStatus = resolveSalesOrderItemNomusStatus(
    order.nomusRawResponse,
    dbItem,
    matchOptions
  );
  const persistedCanceled =
    item.nomusIsCanceled === true ||
    item.nomusIsStale === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED" ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELADO";
  const persistedCut =
    item.nomusIsCut === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "FULFILLED_WITH_CUT";
  const isCanceled = persistedCanceled || persistedCut || nomusStatus === "cancelled";

  return {
    salesOrderItemId: item.id,
    productId: item.productId,
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
    quantity: item.quantity,
    negotiatedPrice: item.negotiatedPrice,
    totalNetValue: item.totalNetValue,
    unitCost: item.unitCost,
    itemStatus: isCanceled
      ? "CANCELADO"
      : item.nomusItemStatusNormalized ?? matched?.status ?? null,
    isCanceled,
    nomusRawItem: matched?.raw ?? null,
    referenceDate: order.issueDate ?? null,
  };
}

function qtyNumber(value: unknown): number {
  const n = decimalToNumber(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function scaleBreakdown(
  unit: ProductionCostBreakdown,
  qty: number
): ProductionCostBreakdown {
  return {
    materialCost: roundMoney(unit.materialCost * qty),
    processCost: roundMoney(unit.processCost * qty),
    laborCost: roundMoney(unit.laborCost * qty),
    machineCost: roundMoney(unit.machineCost * qty),
    overheadCost: roundMoney(unit.overheadCost * qty),
    otherCost: roundMoney(unit.otherCost * qty),
  };
}

function taxBreakdownFromDocumentarySummary(
  summary: DocumentarySummaryTaxTotals | null | undefined
): IndustrialTaxBreakdown {
  if (!summary) return emptyIndustrialTaxBreakdown();
  const icms = parseDocumentaryMoney(summary.vICMS) ?? 0;
  const ipi = sumDocumentaryMoney([
    parseDocumentaryMoney(summary.vIPI),
    parseDocumentaryMoney(summary.vIPIDevol),
  ]);
  const pis = parseDocumentaryMoney(summary.vPIS) ?? 0;
  const cofins = parseDocumentaryMoney(summary.vCOFINS) ?? 0;
  const icmsSt = parseDocumentaryMoney(summary.vST) ?? 0;
  const fcp = sumDocumentaryMoney([
    parseDocumentaryMoney(summary.vFCP),
    parseDocumentaryMoney(summary.vFCPST),
    parseDocumentaryMoney(summary.vFCPSTRet),
  ]);
  const otherTaxes = sumDocumentaryMoney([
    parseDocumentaryMoney(summary.vICMSDeson),
    parseDocumentaryMoney(summary.vII),
    parseDocumentaryMoney(summary.vISS),
  ]);
  return reconcileTaxBreakdownColumns({
    icms,
    ipi,
    pis,
    cofins,
    icmsSt,
    difal: 0,
    fcp,
    otherTaxes,
    totalTaxes: 0,
  });
}

export type LoadSalesOrderIndustrialResultReportInput = {
  query: Record<string, unknown>;
  emitterName?: string | null;
  referenceDate?: Date;
  /** Quando informado, restringe aos pedidos (ex.: detalhe de um único id). */
  salesOrderIds?: string[];
};

export async function loadSalesOrderIndustrialResultReportPayload(
  prisma: PrismaClient,
  input: LoadSalesOrderIndustrialResultReportInput
): Promise<SalesOrderIndustrialResultReportPayload> {
  const startedAt = Date.now();
  const parsed = parseSalesOrderListQuery(input.query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: parsed.sellerKeyRaw,
    sellerText: parsed.sellerText,
  });
  const baseWhere = await resolveSalesOrderListWhere(prisma, parsed, sellerWhere);
  const scopedIds = (input.salesOrderIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const where =
    scopedIds.length > 0
      ? ({ AND: [baseWhere, { id: { in: scopedIds } }] } as typeof baseWhere)
      : baseWhere;
  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  const sellerLabel = resolveSellerLabelForFilters(parsed, sellerIdentityCtx);

  const totalOrdersInScope = await prisma.salesOrder.count({ where });
  const orders = await prisma.salesOrder.findMany({
    where,
    take: SALES_ORDER_INDUSTRIAL_RESULT_REPORT_ROWS_LIMIT,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
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
      nomusRawResponse: true,
      proposalId: true,
      Customer: {
        select: {
          id: true,
          companyName: true,
          tradeName: true,
        },
      },
    },
  });

  const truncated = totalOrdersInScope > orders.length;
  const orderIds = orders.map((o) => o.id);
  const itemsByOrderId = await loadSalesOrderItemsForMargin(prisma, orderIds);

  const resolverItems: SalesOrderMarginResolverItem[] = [];
  const itemOrderMap = new Map<string, string>();
  for (const order of orders) {
    const items = itemsByOrderId.get(order.id) ?? [];
    items.forEach((item, index) => {
      const mapped = mapItemToResolverInput(
        item,
        {
          id: order.id,
          proposalId: order.proposalId,
          issueDate: order.issueDate,
          nomusRawResponse: order.nomusRawResponse,
          items,
        },
        index,
        items.length
      );
      resolverItems.push(mapped);
      itemOrderMap.set(item.id, order.id);
    });
  }

  const productIndex = await loadSalesOrderMarginProductBatchIndex(prisma, resolverItems);
  const productResolutions = resolveSalesOrderItemProducts(resolverItems, productIndex);

  const pairs: Array<{ productId: string; referenceDate: Date }> = [];
  for (const item of resolverItems) {
    if (item.isCanceled) continue;
    const productId = productResolutions.get(item.salesOrderItemId)?.productId;
    if (!productId || !item.referenceDate) continue;
    const ref =
      item.referenceDate instanceof Date
        ? item.referenceDate
        : new Date(item.referenceDate);
    if (Number.isNaN(ref.getTime())) continue;
    pairs.push({ productId, referenceDate: ref });
  }

  const effectiveCostsByKey = await getEffectiveProductProductionCostsForPairs(prisma, pairs);

  const productIdsForTax = [
    ...new Set(
      [...productResolutions.values()]
        .map((p) => p.productId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const taxContext = await resolveOfficialSalesMarginTaxContext(prisma, productIdsForTax);

  const linkedNfeMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((o) => ({
      id: o.id,
      totalNetValue: o.totalNetValue,
      issueDate: o.issueDate,
      expectedDeliveryDate: o.expectedDeliveryDate,
      nomusRawResponse: o.nomusRawResponse,
    })),
    input.referenceDate ?? new Date()
  );

  // Contagem de vínculos por NF (evita atribuir imposto integral a vários pedidos).
  const nomusNfeIds = new Set<string>();
  for (const ctx of linkedNfeMap.values()) {
    for (const link of ctx.nfeLinks ?? []) {
      if (link.nomusNfeId) nomusNfeIds.add(link.nomusNfeId);
    }
  }
  const sharedNfeIds = new Set<string>();
  if (nomusNfeIds.size > 0) {
    const linkCounts = await prisma.salesOrderNfeLink.groupBy({
      by: ["nomusNfeId"],
      where: { nomusNfeId: { in: [...nomusNfeIds] } },
      _count: { _all: true },
    });
    for (const row of linkCounts) {
      if (row.nomusNfeId && row._count._all > 1) sharedNfeIds.add(row.nomusNfeId);
    }
  }

  const fiscalByNfeId = new Map<string, DocumentarySummaryTaxTotals>();
  if (nomusNfeIds.size > 0) {
    const summaries = await prisma.nomusNfeFiscalSummary.findMany({
      where: { nomusNfeId: { in: [...nomusNfeIds] } },
      select: {
        nomusNfeId: true,
        vICMS: true,
        vICMSDeson: true,
        vST: true,
        vFCP: true,
        vFCPST: true,
        vFCPSTRet: true,
        vIPI: true,
        vIPIDevol: true,
        vPIS: true,
        vCOFINS: true,
        vII: true,
        vISS: true,
      },
    });
    for (const s of summaries) {
      fiscalByNfeId.set(s.nomusNfeId, s);
    }
  }

  let customerName: string | null = null;
  if (parsed.customerId) {
    const c = await prisma.customer.findUnique({
      where: { id: parsed.customerId },
      select: { companyName: true, tradeName: true },
    });
    customerName = customerDisplayName(c);
  }

  const filters: SalesOrderReportAppliedFilters = {
    customerId: parsed.customerId ?? "",
    customerName,
    status: parsed.status ?? "",
    sellerKey: parsed.sellerKeyRaw ?? "",
    sellerLabel,
    startDate: parsed.startDate ?? null,
    endDate: parsed.endDate ?? null,
    year: parsed.year ?? null,
    month: parsed.month ?? null,
    search: parsed.q ?? "",
  };

  const rows: SalesOrderIndustrialResultReportRow[] = [];

  for (const order of orders) {
    const warnings: string[] = [];
    const commercialValue = roundMoney(Math.max(0, decimalToNumber(order.totalNetValue) ?? 0));
    const seller = buildSalesOrderNomusSellerDto(
      { externalSellerId: order.externalSellerId, issueDate: order.issueDate },
      sellerIdentityCtx
    );
    const linked = linkedNfeMap.get(order.id);
    const billingStatus = resolveSalesOrderBillingStatus({
      status: order.status,
      hasNfe: linked?.hasNfe ?? false,
      isPartiallyInvoiced: linked?.isPartiallyInvoiced ?? false,
      isFullyInvoiced: linked?.isFullyInvoiced ?? false,
    });

    const items = itemsByOrderId.get(order.id) ?? [];
    let material = 0;
    let labor = 0;
    let machine = 0;
    let process = 0;
    let overhead = 0;
    let otherUnit = 0;
    let totalCost = 0;
    let costOk = true;
    let costStatus: IndustrialCostSourceStatus = "OK";
    const costRefs: string[] = [];
    let primaryCostLabel: string | null = null;
    let costBaseDate = civilDateKey(order.issueDate);
    let revenueCoveredForTaxEstimate = 0;
    let estimatedTaxAmount = 0;

    items.forEach((item, index) => {
      const mapped = mapItemToResolverInput(
        item,
        {
          id: order.id,
          proposalId: order.proposalId,
          issueDate: order.issueDate,
          nomusRawResponse: order.nomusRawResponse,
          items,
        },
        index,
        items.length
      );
      if (mapped.isCanceled) return;

      const product = productResolutions.get(item.id);
      const productId = product?.productId ?? null;
      const qty = qtyNumber(mapped.quantity);
      const lineRevenue = roundMoney(
        Math.max(0, decimalToNumber(mapped.totalNetValue) ?? qty * (decimalToNumber(mapped.negotiatedPrice) ?? 0))
      );

      if (!productId || !order.issueDate) {
        costOk = false;
        costStatus = "CUSTO_NAO_LOCALIZADO";
        warnings.push(
          !productId
            ? `Item ${item.skuSnapshot ?? item.id}: produto não vinculado.`
            : `Item ${item.skuSnapshot ?? item.id}: issueDate ausente.`
        );
        return;
      }

      const key = effectiveProductionCostLookupKey(productId, order.issueDate);
      const effective = effectiveCostsByKey.get(key);
      if (!effective || effective.status !== "OK") {
        costOk = false;
        costStatus = "CUSTO_NAO_LOCALIZADO";
        warnings.push(
          `Item ${item.skuSnapshot ?? productId}: custo publicado não localizado na data ${costBaseDate}.`
        );
        return;
      }

      const ok = effective as EffectiveProductProductionCostOk;
      const scaled = scaleBreakdown(ok.breakdown, qty);
      const lineTotal = roundMoney(ok.unitProductionCost * qty);
      material += scaled.materialCost;
      labor += scaled.laborCost;
      machine += scaled.machineCost;
      process += scaled.processCost;
      overhead += scaled.overheadCost;
      otherUnit += scaled.otherCost;
      totalCost += lineTotal;
      const label = `${ok.versionCode} rev.${ok.revision}`;
      if (!costRefs.includes(label)) costRefs.push(label);
      if (!primaryCostLabel) primaryCostLabel = label;

      // Imposto estimado por linha (só sobre saldo não faturado, rateado depois).
      const taxPercent =
        taxContext.productTaxIndex.get(productId) ?? taxContext.defaultTaxPercent;
      revenueCoveredForTaxEstimate += lineRevenue;
      estimatedTaxAmount += computeSalesTaxAmount(lineRevenue, taxPercent);
    });

    const costBreakdown = costOk
      ? reconcileIndustrialCostBreakdown({
          materialCost: material,
          laborHourCost: labor,
          machineHourCost: machine,
          totalIndustrialCost: totalCost,
          otherIndustrialCostOfficial: process + overhead + otherUnit,
        })
      : null;

    // Impostos reais (NF vinculadas válidas)
    let realTaxes = emptyIndustrialTaxBreakdown();
    let taxIncomplete = false;
    const nfeLinks = linked?.nfeLinks ?? [];
    if (nfeLinks.length > 0 && (linked?.hasValidInvoice ?? linked?.hasNfe)) {
      const parts: IndustrialTaxBreakdown[] = [];
      let usedHighlightedFallback = false;
      for (const link of nfeLinks) {
        if (link.nomusNfeId && sharedNfeIds.has(link.nomusNfeId)) {
          taxIncomplete = true;
          warnings.push(
            `NF ${link.nfeNumber ?? link.nomusNfeId} vinculada a múltiplos pedidos — apuração tributária incompleta.`
          );
          continue;
        }
        if (link.nomusNfeId && fiscalByNfeId.has(link.nomusNfeId)) {
          parts.push(taxBreakdownFromDocumentarySummary(fiscalByNfeId.get(link.nomusNfeId)));
        } else {
          usedHighlightedFallback = true;
        }
      }
      if (parts.length > 0) {
        realTaxes = sumIndustrialTaxBreakdown(parts);
      } else if (usedHighlightedFallback && (linked?.nfeHighlightedTaxesValue ?? 0) > 0) {
        realTaxes = reconcileTaxBreakdownColumns({
          ...emptyIndustrialTaxBreakdown(),
          otherTaxes: linked?.nfeHighlightedTaxesValue ?? 0,
          totalTaxes: linked?.nfeHighlightedTaxesValue ?? 0,
        });
      }
    }

    const invoicedComparable = linked?.nfeTotalValue ?? 0;
    const uninvoiced = resolveUninvoicedCommercialValue({
      orderCommercialValue: commercialValue,
      invoicedComparableValue: invoicedComparable,
    });

    // Escala o imposto estimado das linhas para o saldo não faturado.
    let estimatedOnUninvoiced = 0;
    if (uninvoiced > 0.009 && revenueCoveredForTaxEstimate > 0.009) {
      const ratio = Math.min(1, uninvoiced / revenueCoveredForTaxEstimate);
      estimatedOnUninvoiced = roundMoney(estimatedTaxAmount * ratio);
    } else if (uninvoiced > 0.009 && revenueCoveredForTaxEstimate <= 0) {
      // Sem receita de itens: usa alíquota padrão sobre o saldo.
      estimatedOnUninvoiced = computeSalesTaxAmount(
        uninvoiced,
        taxContext.defaultTaxPercent
      );
    }

    if (!taxContext.fiscalConfigComplete && uninvoiced > 0.009 && estimatedOnUninvoiced <= 0) {
      // Sem NF e sem regra fiscal → incompleto se ainda há saldo a estimar.
      if (nfeLinks.length === 0) {
        taxIncomplete = true;
        warnings.push(taxContext.taxRuleSource);
      }
    }

    const estimatedBreakdown =
      estimatedOnUninvoiced > 0
        ? reconcileTaxBreakdownColumns({
            ...emptyIndustrialTaxBreakdown(),
            otherTaxes: estimatedOnUninvoiced,
            totalTaxes: estimatedOnUninvoiced,
          })
        : emptyIndustrialTaxBreakdown();

    const combinedTaxes = taxIncomplete
      ? emptyIndustrialTaxBreakdown()
      : sumIndustrialTaxBreakdown([realTaxes, estimatedBreakdown]);

    const taxSource = classifyIndustrialTaxSource({
      realTaxTotal: realTaxes.totalTaxes,
      estimatedTaxTotal: estimatedBreakdown.totalTaxes,
      incomplete: taxIncomplete,
    });

    const includedInConsolidation = costOk && !taxIncomplete && costBreakdown != null;

    let resultFields: {
      revenueAfterTaxes: number | null;
      industrialResult: number | null;
      industrialMarginPercent: number | null;
    } = {
      revenueAfterTaxes: null,
      industrialResult: null,
      industrialMarginPercent: null,
    };

    if (includedInConsolidation && costBreakdown) {
      resultFields = computeIndustrialResult({
        orderCommercialValue: commercialValue,
        totalTaxes: combinedTaxes.totalTaxes,
        totalIndustrialCost: costBreakdown.totalIndustrialCost,
      });
    } else if (!costOk) {
      warnings.push("Pedido excluído da consolidação: custo histórico não apurado.");
    } else if (taxIncomplete) {
      warnings.push("Pedido excluído da consolidação: imposto incompleto.");
    }

    rows.push({
      salesOrderId: order.id,
      orderCode: order.orderCode || order.externalSalesOrderCode || order.id.slice(0, 8),
      issueDate: isoOrNull(order.issueDate),
      customerName: customerDisplayName(order.Customer),
      sellerName: formatSalesOrderNomusSellerListLabel(seller),
      orderStatus: order.status,
      orderStatusLabel: formatSalesOrderReportStatusLabel(order.status),
      invoiceStatus: billingStatus,
      invoiceStatusLabel: salesOrderBillingStatusLabel(billingStatus),
      orderCommercialValue: commercialValue,
      materialCost: costBreakdown?.materialCost ?? null,
      laborHourCost: costBreakdown?.laborHourCost ?? null,
      machineHourCost: costBreakdown?.machineHourCost ?? null,
      otherIndustrialCost: costBreakdown?.otherIndustrialCost ?? null,
      totalIndustrialCost: costBreakdown?.totalIndustrialCost ?? null,
      icms: taxIncomplete ? null : combinedTaxes.icms,
      ipi: taxIncomplete ? null : combinedTaxes.ipi,
      pis: taxIncomplete ? null : combinedTaxes.pis,
      cofins: taxIncomplete ? null : combinedTaxes.cofins,
      icmsSt: taxIncomplete ? null : combinedTaxes.icmsSt,
      difal: taxIncomplete ? null : combinedTaxes.difal,
      fcp: taxIncomplete ? null : combinedTaxes.fcp,
      otherTaxes: taxIncomplete ? null : combinedTaxes.otherTaxes,
      totalTaxes: taxIncomplete ? null : combinedTaxes.totalTaxes,
      revenueAfterTaxes: resultFields.revenueAfterTaxes,
      industrialResult: resultFields.industrialResult,
      industrialMarginPercent: resultFields.industrialMarginPercent,
      taxSource,
      taxSourceLabel: industrialTaxSourceLabel(taxSource),
      costSourceStatus: costStatus,
      costSourceStatusLabel: industrialCostSourceStatusLabel(costStatus),
      costTableVersionLabel: primaryCostLabel,
      costBaseDate,
      costTableReferences: costRefs,
      priceTableReference: null,
      warnings,
      includedInConsolidation,
    });
  }

  const summary = computeSalesOrderIndustrialResultReportSummaryFromRows(rows);
  console.info(
    "[sales-order-industrial-result-report] generated",
    JSON.stringify({
      orders: rows.length,
      complete: summary.completeOrdersCount,
      ms: Date.now() - startedAt,
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    emitterName: input.emitterName?.trim() || null,
    title: SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_TITLE,
    subtitle: SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_SUBTITLE,
    filters,
    filterLabels: buildSalesOrderReportFilterLabels(filters),
    summary,
    rows,
    truncated,
    totalOrdersInScope,
    rowsLimit: SALES_ORDER_INDUSTRIAL_RESULT_REPORT_ROWS_LIMIT,
  };
}
