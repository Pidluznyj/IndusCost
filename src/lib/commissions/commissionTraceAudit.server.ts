/**
 * Montagem read-only da auditoria de rastreabilidade de comissão.
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import {
  buildCommissionTraceNomusAudit,
  buildCommissionTraceReceipt,
  buildEmptyCommissionTraceReport,
  computeCommissionTraceTotals,
  readRuleNameFromSnapshot,
  type CommissionTraceAuditQuery,
  type CommissionTraceAuditReport,
  type CommissionTraceDataSource,
  type CommissionTraceItem,
  type CommissionTraceReceivable,
} from "./commissionTraceAudit.js";
import {
  loadMaterializedSchedulesByReceivableId,
} from "./commissionReceiptEngine.server.js";
import {
  mapMaterializedScheduleToLedgerStatus,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import { findClosedReceiptClosing } from "./commissionReceiptClosing.server.js";
import { sellerNameMatchesFilter } from "./commissionSellerIdentity.js";

function sellerMatches(
  canonicalName: string | null | undefined,
  rawName: string | null | undefined,
  filter: string | null | undefined
): boolean {
  if (!filter?.trim()) return true;
  const names = [canonicalName, rawName].filter((name): name is string => Boolean(name?.trim()));
  return names.some((name) => sellerNameMatchesFilter(name, filter));
}

async function resolveSalesOrderId(
  db: PrismaClient,
  query: CommissionTraceAuditQuery
): Promise<{ salesOrderId: string | null; errorMessage: string | null }> {
  const salesOrderId = query.salesOrderId?.trim() || null;
  const orderNumber = query.orderNumber?.trim() || null;
  const nfeNumber = query.nfeNumber?.trim() || null;
  const receivableCode = query.receivableCode?.trim() || null;
  const customer = query.customer?.trim() || null;

  if (salesOrderId) return { salesOrderId, errorMessage: null };

  if (orderNumber) {
    const order = await db.salesOrder.findUnique({
      where: { orderCode: orderNumber },
      select: { id: true },
    });
    if (!order) {
      return { salesOrderId: null, errorMessage: `Pedido não encontrado: ${orderNumber}` };
    }
    return { salesOrderId: order.id, errorMessage: null };
  }

  if (nfeNumber) {
    const link = await db.salesOrderNfeLink.findFirst({
      where: { nfeNumber },
      select: { salesOrderId: true },
    });
    if (!link) {
      return { salesOrderId: null, errorMessage: `Pedido não encontrado para NF: ${nfeNumber}` };
    }
    return { salesOrderId: link.salesOrderId, errorMessage: null };
  }

  if (receivableCode) {
    const schedule = await db.commissionReceivableSchedule.findFirst({
      where: { receivableCode },
      orderBy: { createdAt: "desc" },
      select: { salesOrderId: true },
    });
    if (!schedule) {
      return {
        salesOrderId: null,
        errorMessage: `Pedido não encontrado para título AR: ${receivableCode}`,
      };
    }
    return { salesOrderId: schedule.salesOrderId, errorMessage: null };
  }

  if (customer && query.year != null) {
    const year = query.year;
    const month = query.month;
    const from = month != null ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
    const to = month != null ? new Date(year, month, 1) : new Date(year + 1, 0, 1);
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
      select: { id: true, orderCode: true },
      orderBy: { issueDate: "desc" },
      take: 5,
    });
    if (matches.length === 0) {
      return {
        salesOrderId: null,
        errorMessage: `Nenhum pedido para cliente "${customer}" em ${month != null ? `${month}/${year}` : year}.`,
      };
    }
    if (matches.length > 1) {
      return {
        salesOrderId: null,
        errorMessage: `Múltiplos pedidos (${matches.map((m) => m.orderCode).join(", ")}). Informe --order-number ou --sales-order-id.`,
      };
    }
    return { salesOrderId: matches[0]!.id, errorMessage: null };
  }

  return {
    salesOrderId: null,
    errorMessage:
      "Informe --sales-order-id, --order-number, --nfe-number, --receivable-code ou --customer com --year.",
  };
}

function mapReceivableInput(row: {
  externalId: number;
  personId: number | null;
  personName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: unknown;
  amountReceived: unknown;
  balanceReceivable: unknown;
  description: string | null;
}): CommissionReceiptReceivableInput {
  return {
    nomusReceivableId: row.externalId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: 1,
    settlementDate: row.settlementDate,
    dueDate: row.dueDate,
    amountReceivable: decimalToNumber(row.amountReceivable),
    amountReceived: decimalToNumber(row.amountReceived),
    balanceReceivable: decimalToNumber(row.balanceReceivable),
    nomusNfeId: row.sourceInvoiceId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    cancelled: false,
    suspended: false,
  };
}

export async function buildCommissionTraceAudit(
  db: PrismaClient,
  query: CommissionTraceAuditQuery
): Promise<CommissionTraceAuditReport> {
  const includeLines = query.includeLines !== false;
  const { salesOrderId, errorMessage } = await resolveSalesOrderId(db, query);
  if (!salesOrderId) {
    return buildEmptyCommissionTraceReport(errorMessage ?? "Pedido não encontrado.");
  }

  const order = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      id: true,
      orderCode: true,
      customerId: true,
      externalSellerId: true,
      nomusSellerName: true,
      issueDate: true,
      Customer: { select: { companyName: true, tradeName: true } },
      nfeLinks: {
        select: { nfeExternalId: true, nfeNumber: true },
        orderBy: { dataProcessamento: "desc" },
      },
    },
  });

  if (!order) {
    return buildEmptyCommissionTraceReport(`Pedido não encontrado: ${salesOrderId}`);
  }

  const snapshot = await db.commissionOrderSnapshot.findFirst({
    where: { salesOrderId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { sku: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      receivableSchedules: {
        orderBy: [{ installmentNumber: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (
    snapshot &&
    !sellerMatches(
      snapshot.canonicalSellerName,
      snapshot.rawSellerName,
      query.seller
    )
  ) {
    return buildEmptyCommissionTraceReport(
      `Vendedor não corresponde ao filtro --seller para o pedido ${order.orderCode}.`
    );
  }

  const skuFilter = query.sku?.trim().toUpperCase() || null;
  const snapshotItems = includeLines
    ? (snapshot?.items ?? []).filter((item) => {
        const sku = item.product?.sku?.toUpperCase() ?? null;
        return !skuFilter || sku === skuFilter;
      })
    : [];

  const items: CommissionTraceItem[] = snapshotItems.map((item) => ({
    itemSnapshotId: item.id,
    salesOrderItemId: item.salesOrderItemId,
    sku: item.product?.sku ?? null,
    productName: item.productNameSnapshot,
    soldAmount: decimalToNumber(item.soldAmount),
    marginPercent:
      item.marginPercent != null ? decimalToNumber(item.marginPercent) : null,
    ruleId: item.ruleId,
    ruleName: readRuleNameFromSnapshot(item.ruleSnapshotJson),
    commissionRatePercent: decimalToNumber(item.commissionRatePercent),
    grossCommissionAmount: decimalToNumber(item.grossCommissionAmount),
    finalCommissionAmount: decimalToNumber(item.finalCommissionAmount),
    status: item.status,
    exclusionReason: item.exclusionReason,
  }));

  const schedules = snapshot?.receivableSchedules ?? [];
  const receivableIds = schedules.map((row) => row.receivableId);
  const materializedByReceivableId =
    receivableIds.length > 0
      ? await loadMaterializedSchedulesByReceivableId(receivableIds)
      : new Map<number, MaterializedReceivableScheduleInput[]>();

  const arRows =
    receivableIds.length > 0
      ? await db.nomusAccountsReceivable.findMany({
          where: { externalId: { in: receivableIds } },
          select: {
            externalId: true,
            personId: true,
            personName: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            dueDate: true,
            settlementDate: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            description: true,
          },
        })
      : [];
  const arById = new Map(arRows.map((row) => [row.externalId, row]));

  const receivables: CommissionTraceReceivable[] = schedules.map((row) => {
    const materialized = materializedByReceivableId.get(row.receivableId)?.[0] ?? null;
    const ledger = materialized
      ? mapMaterializedScheduleToLedgerStatus(materialized)
      : { status: "NO_SCHEDULE", reason: null };
    return {
      scheduleId: row.id,
      receivableId: row.receivableId,
      receivableCode: row.receivableCode,
      installmentNumber: row.installmentNumber,
      nominalAmount: decimalToNumber(row.receivableNominalAmount),
      sharePercent: decimalToNumber(row.receivableSharePercent),
      scheduledCommissionAmount: decimalToNumber(row.scheduledCommissionAmount),
      grossScheduledCommissionAmount:
        materialized?.grossScheduledCommissionAmount ?? null,
      scheduleStatus: row.status,
      ledgerStatus: ledger.status,
      statusReason: ledger.reason,
    };
  });

  const receipts = schedules.map((row) => {
    const ar = arById.get(row.receivableId);
    const receivableInput: CommissionReceiptReceivableInput = ar
      ? mapReceivableInput(ar)
      : {
          nomusReceivableId: row.receivableId,
          receivableNumber: row.receivableCode,
          installmentNumber: row.installmentNumber,
          settlementDate: null,
          dueDate: null,
          amountReceivable: decimalToNumber(row.receivableNominalAmount),
          amountReceived: 0,
          balanceReceivable: decimalToNumber(row.receivableNominalAmount),
          nomusNfeId: row.nfeId,
          nfeNumber: null,
          customerExternalId: null,
          customerId: order.customerId,
          customerName:
            order.Customer.tradeName?.trim() || order.Customer.companyName?.trim() || null,
          cancelled: false,
          suspended: false,
        };
    const materialized = materializedByReceivableId.get(row.receivableId)?.[0] ?? null;
    return buildCommissionTraceReceipt({ schedule: materialized, receivable: receivableInput });
  });

  // Títulos recebidos sem schedule materializado
  if (snapshot && receivableIds.length === 0) {
    const nfeIds = order.nfeLinks.map((link) => link.nfeExternalId);
    if (nfeIds.length > 0) {
      const orphanAr = await db.nomusAccountsReceivable.findMany({
        where: {
          sourceInvoiceId: { in: nfeIds },
          amountReceived: { gt: 0 },
        },
        take: 20,
      });
      for (const ar of orphanAr) {
        receipts.push(
          buildCommissionTraceReceipt({
            schedule: null,
            receivable: mapReceivableInput(ar),
          })
        );
      }
    }
  }

  const totals = computeCommissionTraceTotals({ items, receipts });

  let closing: CommissionTraceAuditReport["closing"] = null;
  if (query.year != null && query.month != null) {
    const closed = await findClosedReceiptClosing(db, query.year, query.month);
    if (closed) {
      closing = {
        closingId: closed.closingId,
        year: query.year,
        month: query.month,
        status: closed.status,
        calculationHash: closed.calculationHash,
        closedAt: closed.closedAt,
        isImmutable: closed.status === "CLOSED",
      };
    }
  }

  const nomusAudit = buildCommissionTraceNomusAudit({
    nomusBase: query.nomusBase ?? null,
    nomusCommission: query.nomusCommission ?? null,
    indusReleasedCommission: totals.totalReleasedCommission,
    indusCommissionableBase: totals.totalCommissionableBase,
  });

  const alerts: CommissionTraceAuditReport["alerts"] = [];
  if (!snapshot) {
    alerts.push({
      code: "NO_ORDER_SNAPSHOT",
      severity: "error",
      message: "Pedido sem CommissionOrderSnapshot ACTIVE materializado.",
    });
  }
  if (items.some((row) => row.status === "CUSTOMER_EXCLUDED")) {
    alerts.push({
      code: "CUSTOMER_EXCLUDED",
      severity: "info",
      message: "Um ou mais itens com cliente excluído de comissão.",
    });
  }
  if (receipts.some((row) => row.status === "NO_SCHEDULE")) {
    alerts.push({
      code: "NO_SCHEDULE",
      severity: "warning",
      message: "Título recebido sem CommissionReceivableSchedule materializado.",
    });
  }
  if (receipts.some((row) => row.status === "STALE_SCHEDULE")) {
    alerts.push({
      code: "STALE_SCHEDULE",
      severity: "warning",
      message: "Schedule desatualizado — reprocessar materialização.",
    });
  }
  if (items.some((row) => row.status === "SELLER_UNRESOLVED")) {
    alerts.push({
      code: "SELLER_UNRESOLVED",
      severity: "warning",
      message: "Vendedor não resolvido em um ou mais itens.",
    });
  }
  if (items.some((row) => row.status === "NO_RULE")) {
    alerts.push({
      code: "NO_RULE",
      severity: "warning",
      message: "Item sem regra de comissão aplicável.",
    });
  }
  if (skuFilter && items.length === 0) {
    alerts.push({
      code: "SKU_NOT_FOUND",
      severity: "warning",
      message: `SKU ${skuFilter} não encontrado no snapshot do pedido.`,
    });
  }

  const dataSources: CommissionTraceDataSource[] = [
    { field: "saleCommission", source: "CommissionOrderSnapshot + CommissionOrderItemSnapshot" },
    { field: "receivableSchedule", source: "CommissionReceivableSchedule" },
    { field: "receiptRelease", source: "releaseCommissionFromMaterializedSchedule + nomusAccountsReceivable" },
    { field: "closing", source: "CommissionMonthlyClosing + CommissionReceiptLedgerLine", note: closing ? "CLOSED imutável" : "sem fechamento no período" },
  ];

  const checklist: Record<string, boolean | string> = {
    hasCommissionOrderSnapshot: snapshot != null,
    hasCommissionOrderItemSnapshot: (snapshot?.items.length ?? 0) > 0,
    hasCommissionReceivableSchedule: schedules.length > 0,
    hasCommissionReceiptLedger: closing != null,
    usesMaterializedSnapshots: true,
    showsNoScheduleWhenMissing: receipts.some((r) => r.status === "NO_SCHEDULE") || schedules.length > 0,
    customerExcludedVisible: items.some((i) => i.status === "CUSTOMER_EXCLUDED"),
    partialReleaseProportional: receipts.some(
      (r) => r.releasedCommissionAmount > 0 && r.pendingCommissionAmount > 0
    ),
    closedClosingImmutable: closing?.isImmutable === true,
    nomusComparisonAvailable: nomusAudit != null,
    avoidsItemRecalculationFallback: true,
  };

  return {
    status: "PASS",
    auditedAt: new Date().toISOString(),
    sale: {
      salesOrderId: order.id,
      orderNumber: order.orderCode,
      nfeNumbers: order.nfeLinks.map((l) => l.nfeNumber).filter((v): v is string => Boolean(v)),
      nfeExternalIds: order.nfeLinks.map((l) => l.nfeExternalId),
      customerId: order.customerId,
      customerName:
        order.Customer.tradeName?.trim() || order.Customer.companyName?.trim() || "—",
      rawSellerId: snapshot?.rawSellerId ?? order.externalSellerId,
      rawSellerName: snapshot?.rawSellerName ?? order.nomusSellerName,
      canonicalSellerId: snapshot?.canonicalSellerId ?? null,
      canonicalSellerName: snapshot?.canonicalSellerName ?? null,
      sellerResolutionStatus: snapshot?.sellerResolutionStatus ?? null,
      saleDate: snapshot?.saleDate.toISOString() ?? order.issueDate.toISOString(),
    },
    orderSnapshot: {
      snapshotId: snapshot?.id ?? null,
      sourceHash: snapshot?.sourceHash ?? null,
      totalSoldAmount: decimalToNumber(snapshot?.totalSoldAmount),
      totalGrossCommissionAmount: decimalToNumber(snapshot?.totalGrossCommissionAmount),
      totalFinalCommissionAmount: decimalToNumber(snapshot?.totalFinalCommissionAmount),
      snapshotStatus: snapshot?.status ?? null,
    },
    items,
    receivables,
    receipts,
    totals,
    closing,
    nomusAudit,
    alerts,
    dataSources,
    checklist,
  };
}
