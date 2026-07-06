import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptPreviewResult,
  type MaterializedReceivableScheduleInput,
  resolveMaterializedItemExclusionMeta,
} from "./commissionReceiptEngine.js";
import { loadActiveCommissionRules } from "./commission-rule-engine.js";
import { parseCommissionVisualAuditQuery } from "./commissionQuery.js";
import {
  indexOrderBundlesByNfeId,
  mapReceivableSource,
} from "./commission-source-resolver.js";
import {
  loadCommissionOrderSourcesByNfeExternalIds,
  resolveCommissionPeriod,
} from "./commission-source-resolver.server.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import { decimalToNumber } from "./commission-money.js";
import type { CommissionReceivableScheduleStatusValue } from "./commissionReceivableScheduler.js";
import {
  enrichVisualAuditRowsWithSellerIdentity,
  filterRowsByAppraisalMode,
} from "./commissionVisualAudit.js";
import { listCommissionVisualAuditPage } from "./commissionVisualAudit.server.js";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

export type LoadCommissionReceiptPreviewInput = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
  /** Fallback explícito: recalcular comissão por item (auditoria legada). */
  allowItemRecalculationFallback?: boolean;
};

function mapPrismaScheduleStatus(
  value: string
): CommissionReceivableScheduleStatusValue {
  const allowed: CommissionReceivableScheduleStatusValue[] = [
    "ACTIVE",
    "STALE",
    "SUPERSEDED",
    "ORPHAN",
    "CUSTOMER_EXCLUDED",
    "ERROR",
  ];
  return allowed.includes(value as CommissionReceivableScheduleStatusValue)
    ? (value as CommissionReceivableScheduleStatusValue)
    : "ERROR";
}

export async function loadMaterializedSchedulesByReceivableId(
  receivableIds: number[]
): Promise<Map<number, MaterializedReceivableScheduleInput[]>> {
  const map = new Map<number, MaterializedReceivableScheduleInput[]>();
  if (receivableIds.length === 0) return map;

  const rows = await prisma.commissionReceivableSchedule.findMany({
    where: { receivableId: { in: receivableIds } },
    include: {
      orderSnapshot: {
        select: {
          rawSellerId: true,
          rawSellerName: true,
          canonicalSellerName: true,
          sellerResolutionStatus: true,
          items: {
            select: {
              exclusionReason: true,
              status: true,
              ruleSnapshotJson: true,
            },
            take: 1,
          },
        },
      },
      salesOrder: { select: { orderCode: true } },
      canonicalSeller: { select: { id: true, name: true } },
    },
  });

  for (const row of rows) {
    const itemSnapshot = row.orderSnapshot.items[0];
    const exclusionMeta = resolveMaterializedItemExclusionMeta(itemSnapshot);
    const list = map.get(row.receivableId) ?? [];
    list.push({
      id: row.id,
      orderSnapshotId: row.orderSnapshotId,
      receivableId: row.receivableId,
      receivableCode: row.receivableCode,
      installmentNumber: row.installmentNumber,
      nfeId: row.nfeId,
      salesOrderId: row.salesOrderId,
      customerId: row.customerId,
      canonicalSellerId: row.canonicalSellerId,
      canonicalSellerName:
        row.canonicalSeller?.name ?? row.orderSnapshot.canonicalSellerName,
      rawSellerId: row.orderSnapshot.rawSellerId,
      rawSellerName: row.orderSnapshot.rawSellerName,
      orderCode: row.salesOrder.orderCode,
      receivableNominalAmount: decimalToNumber(row.receivableNominalAmount),
      receivableSharePercent: decimalToNumber(row.receivableSharePercent),
      scheduledCommissionAmount: decimalToNumber(row.scheduledCommissionAmount),
      scheduleStatus: mapPrismaScheduleStatus(row.status),
      sellerResolutionStatus: row.orderSnapshot.sellerResolutionStatus,
      exclusionRuleId: exclusionMeta.exclusionRuleId,
      exclusionReason:
        exclusionMeta.exclusionReason ??
        (mapPrismaScheduleStatus(row.status) === "CUSTOMER_EXCLUDED"
          ? "Cliente excluído de comissão"
          : null),
    });
    map.set(row.receivableId, list);
  }

  return map;
}

export async function loadCommissionReceiptPreview(
  input: LoadCommissionReceiptPreviewInput
): Promise<CommissionReceiptPreviewResult> {
  const period = resolveCommissionPeriod({ year: input.year, month: input.month });

  const arPrismaRows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: period.from, lte: period.to },
      amountReceived: { gt: 0 },
      suspendCollection: { not: true },
      OR: [{ status: null }, { status: true }],
    },
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
      suspendCollection: true,
      status: true,
    },
  });

  const receivables = arPrismaRows
    .map((row) => {
      const source = mapReceivableSource(row);
      if (!source.settlementDate || decimalToNumber(row.amountReceived) <= 0) return null;
      if (row.status === false || row.suspendCollection === true) return null;
      return {
        nomusReceivableId: source.nomusReceivableId,
        receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
        installmentNumber: source.installmentNumber,
        settlementDate: source.settlementDate,
        dueDate: source.dueDate,
        amountReceivable: source.amountReceivable,
        amountReceived: source.amountReceived,
        balanceReceivable: source.balanceReceivable,
        nomusNfeId: source.nomusNfeId,
        nfeNumber: row.sourceInvoiceNumber,
        customerExternalId: row.personId,
        customerId: null,
        customerName: row.personName,
        cancelled: row.status === false,
        suspended: row.suspendCollection === true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const receivableIds = receivables.map((row) => row.nomusReceivableId);
  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.nomusNfeId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const useLegacyFallback = input.allowItemRecalculationFallback === true;

  const [
    materializedSchedulesByReceivableId,
    orderBundles,
    identityCtx,
    rules,
    exclusionRules,
    auditPayload,
  ] = await Promise.all([
    loadMaterializedSchedulesByReceivableId(receivableIds),
    useLegacyFallback
      ? loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds)
      : Promise.resolve([]),
    loadCommissionSellerIdentityContext(prisma),
    useLegacyFallback ? loadActiveCommissionRules(prisma) : Promise.resolve([]),
    loadActiveCustomerExclusionRuleSnapshots(),
    useLegacyFallback
      ? listCommissionVisualAuditPage(
          parseCommissionVisualAuditQuery({
            year: input.year,
            month: input.month,
            appraisalMode: "payable",
            page: 1,
            pageSize: 500000,
            customer: input.customer,
            commissionPersonId: input.seller,
          }),
          GLOBAL_SCOPE
        )
      : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 0 }),
  ]);

  const ordersByNfeId = indexOrderBundlesByNfeId(orderBundles);
  const persistedAuditRows = useLegacyFallback
    ? enrichVisualAuditRowsWithSellerIdentity(
        filterRowsByAppraisalMode(auditPayload.rows, "PAYABLE", period),
        identityCtx
      )
    : [];

  return buildCommissionReceiptPreview({
    year: input.year,
    month: input.month,
    seller: input.seller,
    customer: input.customer,
    includeExcluded: input.includeExcluded,
    includeExceptions: input.includeExceptions,
    receivables,
    ordersByNfeId,
    materializedSchedulesByReceivableId,
    allowItemRecalculationFallback: useLegacyFallback,
    persistedAuditRows,
    rules,
    exclusionRules,
    identityCtx,
  });
}

/** Converte linha Prisma AR para input do motor (uso em testes integrados). */
export function mapNomusArRowToReceiptReceivableInput(row: {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personId: number | null;
  personName: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  description?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
}) {
  const source = mapReceivableSource(row);
  if (!source.settlementDate) return null;
  return {
    nomusReceivableId: source.nomusReceivableId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: source.installmentNumber,
    settlementDate: source.settlementDate,
    dueDate: source.dueDate,
    amountReceivable: source.amountReceivable,
    amountReceived: source.amountReceived,
    balanceReceivable: source.balanceReceivable,
    nomusNfeId: source.nomusNfeId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    cancelled: row.status === false,
    suspended: row.suspendCollection === true,
  };
}

export function receivableReceivedTotal(
  rows: ReturnType<typeof mapNomusArRowToReceiptReceivableInput>[]
): number {
  const seen = new Set<number>();
  let total = 0;
  for (const row of rows) {
    if (!row || seen.has(row.nomusReceivableId)) continue;
    seen.add(row.nomusReceivableId);
    total += decimalToNumber(row.amountReceived);
  }
  return total;
}
