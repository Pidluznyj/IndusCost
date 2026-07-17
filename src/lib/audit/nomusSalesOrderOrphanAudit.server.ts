/**
 * OP-81 — Carrega universo local + impacto read-only para auditoria de órfãos Nomus.
 * Apenas findMany / count — sem create, update, upsert ou delete.
 */

import { prisma } from "@/src/lib/prisma.js";
import {
  expandNomusOrderCodeLookupVariants,
  NOMUS_SALES_ORDER_SOURCE,
} from "@/src/lib/salesOrderNomusSync.server.js";
import {
  type LocalImpactSnapshot,
  type LocalSalesOrderIdentity,
} from "@/src/lib/audit/nomusSalesOrderOrphanAudit.js";

function decimalToNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value != null && typeof value === "object" && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type LocalOrphanUniverseRow = LocalSalesOrderIdentity & {
  impact: LocalImpactSnapshot;
  impactDetail: {
    official: {
      nfeLinks: number;
      productionOrderLinks: number;
      commissionSnapshots: number;
      commissionReceivableSchedules: number;
      flowSnapshot: boolean;
    };
    derived: {
      orderToCashFacts: number;
      portfolioFacts: number;
      stockDocumentsViaPortfolio: number;
      commissionRecords: number;
      commissionPaidOrConfirmed: number;
    };
    textualInformative: {
      arDescriptionHints: number;
      note: string;
    };
  };
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

/**
 * Universo A: SalesOrder NOMUS no período, com externalSalesOrderId e impacto local.
 */
export async function loadLocalNomusSalesOrdersForOrphanAudit(args: {
  from: Date;
  to: Date;
  orderCode?: string | null;
}): Promise<LocalOrphanUniverseRow[]> {
  const from = startOfUtcDay(args.from);
  const to = endOfUtcDay(args.to);
  const orderCodeFilter = args.orderCode?.trim()
    ? {
        OR: expandNomusOrderCodeLookupVariants(args.orderCode).flatMap((code) => [
          { orderCode: code },
          { externalSalesOrderCode: code },
        ]),
      }
    : {};

  const orders = await prisma.salesOrder.findMany({
    where: {
      sourceSystem: NOMUS_SALES_ORDER_SOURCE,
      externalSalesOrderId: { not: null },
      issueDate: { gte: from, lte: to },
      ...orderCodeFilter,
    },
    include: {
      Customer: { select: { name: true } },
      items: { select: { id: true } },
      nfeLinks: { select: { id: true } },
      productionOrderSalesLinks: { select: { id: true } },
      commissionOrderSnapshots: { select: { id: true } },
      commissionReceivableSchedules: { select: { id: true } },
      flowSnapshot: { select: { id: true } },
    },
    orderBy: [{ issueDate: "asc" }, { orderCode: "asc" }],
  });

  if (orders.length === 0) return [];

  const salesOrderIds = orders.map((o) => o.id);
  const orderCodes = [...new Set(orders.map((o) => o.orderCode))];
  const externalIds = orders
    .map((o) => o.externalSalesOrderId)
    .filter((id): id is number => id != null);

  const allCodeVariants = [
    ...new Set(orders.flatMap((o) => expandNomusOrderCodeLookupVariants(o.orderCode))),
  ].filter((v) => v.length >= 4);

  const [o2cGroups, portfolioGroups, stockGroups, commissionRecords, arHintRows] =
    await Promise.all([
      prisma.orderToCashAuditFact.groupBy({
        by: ["salesOrderId"],
        where: { salesOrderId: { in: salesOrderIds } },
        _count: { _all: true },
      }),
      prisma.portfolioReconciliationFact.groupBy({
        by: ["salesOrderId"],
        where: { salesOrderId: { in: salesOrderIds } },
        _count: { _all: true },
      }),
      prisma.portfolioReconciliationFact.groupBy({
        by: ["salesOrderId"],
        where: {
          salesOrderId: { in: salesOrderIds },
          stockDocumentId: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.commissionRecord.findMany({
        where: {
          OR: [
            { orderCode: { in: orderCodes } },
            ...(externalIds.length > 0 ? [{ nomusOrderId: { in: externalIds } }] : []),
          ],
        },
        select: {
          orderCode: true,
          nomusOrderId: true,
          status: true,
          paidAmount: true,
          paidAt: true,
          confirmedAt: true,
        },
      }),
      allCodeVariants.length === 0
        ? Promise.resolve(
            [] as Array<{ description: string | null; comments: string | null }>
          )
        : prisma.nomusAccountsReceivable.findMany({
            where: {
              OR: allCodeVariants.flatMap((variant) => [
                { description: { contains: variant, mode: "insensitive" as const } },
                { comments: { contains: variant, mode: "insensitive" as const } },
              ]),
            },
            select: { description: true, comments: true },
            take: 5000,
          }),
    ]);

  const o2cByOrder = new Map(
    o2cGroups.map((g) => [g.salesOrderId ?? "", g._count._all] as const)
  );
  const portfolioByOrder = new Map(
    portfolioGroups.map((g) => [g.salesOrderId ?? "", g._count._all] as const)
  );
  const stockDocByOrder = new Map(
    stockGroups.map((g) => [g.salesOrderId ?? "", g._count._all] as const)
  );

  return orders.map((order) => {
    const o2c = o2cByOrder.get(order.id) ?? 0;
    const portfolio = portfolioByOrder.get(order.id) ?? 0;
    const stockViaPortfolio = stockDocByOrder.get(order.id) ?? 0;
    const relatedCommissions = commissionRecords.filter(
      (r) =>
        r.orderCode === order.orderCode ||
        (order.externalSalesOrderId != null && r.nomusOrderId === order.externalSalesOrderId)
    );
    const paidOrConfirmed = relatedCommissions.filter(
      (r) =>
        r.paidAt != null ||
        decimalToNumber(r.paidAmount) > 0 ||
        r.confirmedAt != null ||
        r.status === "PAID_TOTAL" ||
        r.status === "PAID_PARTIAL"
    ).length;

    const variants = expandNomusOrderCodeLookupVariants(order.orderCode).map((v) =>
      v.toLowerCase()
    );
    const arHints = arHintRows.filter((row) => {
      const hay = `${row.description ?? ""}\n${row.comments ?? ""}`.toLowerCase();
      return variants.some((v) => v.length >= 4 && hay.includes(v));
    }).length;

    const impactDetail = {
      official: {
        nfeLinks: order.nfeLinks.length,
        productionOrderLinks: order.productionOrderSalesLinks.length,
        commissionSnapshots: order.commissionOrderSnapshots.length,
        commissionReceivableSchedules: order.commissionReceivableSchedules.length,
        flowSnapshot: order.flowSnapshot != null,
      },
      derived: {
        orderToCashFacts: o2c,
        portfolioFacts: portfolio,
        stockDocumentsViaPortfolio: stockViaPortfolio,
        commissionRecords: relatedCommissions.length,
        commissionPaidOrConfirmed: paidOrConfirmed,
      },
      textualInformative: {
        arDescriptionHints: arHints,
        note: "Correspondência textual em descrição/comentário de CR — não é vínculo oficial.",
      },
    };

    const highRisk =
      impactDetail.official.nfeLinks > 0 ||
      impactDetail.derived.stockDocumentsViaPortfolio > 0 ||
      impactDetail.derived.commissionPaidOrConfirmed > 0 ||
      impactDetail.official.commissionReceivableSchedules > 0;

    const impact: LocalImpactSnapshot = {
      nfeLinkCount: impactDetail.official.nfeLinks,
      productionOrderLinkCount: impactDetail.official.productionOrderLinks,
      commissionSnapshotCount: impactDetail.official.commissionSnapshots,
      commissionReceivableCount: impactDetail.official.commissionReceivableSchedules,
      hasFlowSnapshot: impactDetail.official.flowSnapshot,
      orderToCashFactCount: o2c,
      portfolioFactCount: portfolio,
      arTextualHints: arHints,
      highRisk,
    };

    return {
      id: order.id,
      externalSalesOrderId: order.externalSalesOrderId,
      orderCode: order.orderCode,
      externalSalesOrderCode: order.externalSalesOrderCode,
      issueDateIso: order.issueDate.toISOString().slice(0, 10),
      status: order.status,
      totalNetValue: decimalToNumber(order.totalNetValue),
      customerName: order.Customer?.name ?? null,
      sellerName: order.nomusSellerName ?? order.responsible ?? null,
      itemCount: order.items.length,
      impact,
      impactDetail,
    };
  });
}

/** Guardrail: este módulo é estritamente read-only. */
export const ORPHAN_AUDIT_SERVER_READ_ONLY = true as const;
