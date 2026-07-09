import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  buildCommissionReceiptPreview,
  buildCommissionReceivableForecastPreview,
  filterOpenReceivablesForForecast,
  type CommissionReceiptPreviewResult,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
  resolveMaterializedItemExclusionMeta,
} from "./commissionReceiptEngine.js";
import type { CommissionReceiptSellerRecordInput } from "./commissionReceiptSeller.js";
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
import { ensureCommissionMaterializationForReceivableRefs } from "./commissionMaterializationOrchestrator.server.js";
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
      itemSnapshotStatuses: row.orderSnapshot.items.map((item) => item.status),
    });
    map.set(row.receivableId, list);
  }

  return map;
}

export async function loadCommissionRecordSellersByNfeId(
  nfeIds: number[]
): Promise<Map<number, CommissionReceiptSellerRecordInput>> {
  const map = new Map<number, CommissionReceiptSellerRecordInput>();
  const unique = [...new Set(nfeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return map;

  const rows = await prisma.commissionRecord.findMany({
    where: { nomusNfeId: { in: unique } },
    select: {
      nomusNfeId: true,
      commissionPersonId: true,
      nomusSellerId: true,
      commissionPerson: {
        select: { id: true, name: true, nomusPersonId: true },
      },
    },
    orderBy: { calculatedAt: "desc" },
  });

  for (const row of rows) {
    if (row.nomusNfeId == null || map.has(row.nomusNfeId)) continue;
    map.set(row.nomusNfeId, {
      commissionPersonId: row.commissionPersonId,
      commissionPersonName: row.commissionPerson.name,
      nomusSellerId: row.nomusSellerId,
      nomusPersonId: row.commissionPerson.nomusPersonId,
    });
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
      personCnpj: true,
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
        customerCnpj: row.personCnpj,
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
    commissionRecordsByNfeId,
    snapshotRows,
    identityCtx,
    rules,
    exclusionRules,
    auditPayload,
  ] = await Promise.all([
    loadMaterializedSchedulesByReceivableId(receivableIds),
    loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds),
    loadCommissionRecordSellersByNfeId(nfeIds),
    nfeIds.length > 0
      ? prisma.commissionOrderSnapshot.findMany({
          where: { nfeId: { in: nfeIds }, status: "ACTIVE" },
          select: {
            nfeId: true,
            items: { select: { status: true } },
          },
        })
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
  const orderSnapshotDiagnosisByNfeId = new Map(
    snapshotRows
      .filter((row): row is typeof row & { nfeId: number } => row.nfeId != null)
      .map((row) => [
        row.nfeId,
        {
          exists: true,
          itemStatuses: row.items.map((item) => item.status),
        },
      ])
  );
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
    commissionRecordsByNfeId,
    orderSnapshotDiagnosisByNfeId,
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
  personCnpj?: string | null;
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
    customerCnpj: row.personCnpj ?? null,
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

export type LoadCommissionReceivableForecastPreviewInput = {
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
  horizonMonths?: number | null;
  customer?: string | null;
  seller?: string | null;
  commissionPersonId?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  applyMaterialization?: boolean;
};

function mapOpenNomusArRowToReceivableInput(row: {
  externalId: number;
  personId: number | null;
  personName: string | null;
  personCnpj?: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  description?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
}): CommissionReceiptReceivableInput | null {
  const source = mapReceivableSource(row);
  if (row.status === false || row.suspendCollection === true) return null;
  const balance = decimalToNumber(row.balanceReceivable) ?? 0;
  const open =
    balance > 0.009
      ? balance
      : Math.max(0, (decimalToNumber(row.amountReceivable) ?? 0) - (decimalToNumber(row.amountReceived) ?? 0));
  if (open <= 0.009) return null;
  return {
    nomusReceivableId: source.nomusReceivableId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: source.installmentNumber,
    settlementDate: source.settlementDate,
    dueDate: source.dueDate,
    amountReceivable: source.amountReceivable,
    amountReceived: source.amountReceived,
    balanceReceivable: open,
    nomusNfeId: source.nomusNfeId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    customerCnpj: row.personCnpj ?? null,
    cancelled: row.status === false,
    suspended: row.suspendCollection === true,
  };
}

export async function loadCommissionReceivableForecastPreview(
  input: LoadCommissionReceivableForecastPreviewInput
): Promise<CommissionReceiptPreviewResult> {
  const referenceDate = new Date();
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;

  const arPrismaRows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      balanceReceivable: { gt: 0 },
      suspendCollection: { not: true },
      OR: [{ status: null }, { status: true }],
    },
    select: {
      externalId: true,
      personId: true,
      personName: true,
      personCnpj: true,
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

  let receivables = arPrismaRows
    .map((row) => mapOpenNomusArRowToReceivableInput(row))
    .filter((row): row is CommissionReceiptReceivableInput => row != null);

  receivables = filterOpenReceivablesForForecast(
    receivables,
    {
      dueDateFrom: input.dueDateFrom ?? null,
      dueDateTo: input.dueDateTo ?? null,
      horizonMonths: input.horizonMonths ?? null,
    },
    referenceDate
  );

  if (input.nomusReceivableId != null) {
    receivables = receivables.filter((r) => r.nomusReceivableId === input.nomusReceivableId);
  }
  if (input.nfeNumber?.trim()) {
    const needle = input.nfeNumber.trim().toLowerCase();
    receivables = receivables.filter((r) => (r.nfeNumber ?? "").toLowerCase().includes(needle));
  }

  await ensureCommissionMaterializationForReceivableRefs(
    prisma,
    receivables.map((row) => ({
      receivableId: row.nomusReceivableId,
      sourceInvoiceId: row.nomusNfeId ?? null,
    })),
    { apply: input.applyMaterialization === true }
  );

  const receivableIds = receivables.map((row) => row.nomusReceivableId);
  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.nomusNfeId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const [materializedSchedulesByReceivableId, orderBundles, commissionRecordsByNfeId, snapshotRows, identityCtx, exclusionRules] =
    await Promise.all([
      loadMaterializedSchedulesByReceivableId(receivableIds),
      loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds),
      loadCommissionRecordSellersByNfeId(nfeIds),
      nfeIds.length > 0
        ? prisma.commissionOrderSnapshot.findMany({
            where: { nfeId: { in: nfeIds }, status: "ACTIVE" },
            select: {
              nfeId: true,
              items: { select: { status: true } },
            },
          })
        : Promise.resolve([]),
      loadCommissionSellerIdentityContext(prisma),
      loadActiveCustomerExclusionRuleSnapshots(),
    ]);

  if (input.orderCode?.trim()) {
    const needle = input.orderCode.trim().toLowerCase();
    const ordersByNfeId = indexOrderBundlesByNfeId(orderBundles);
    receivables = receivables.filter((row) => {
      const nfeId = row.nomusNfeId ?? null;
      const order = nfeId != null ? ordersByNfeId.get(nfeId) : undefined;
      return (order?.orderCode ?? "").toLowerCase().includes(needle);
    });
  }

  const ordersByNfeId = indexOrderBundlesByNfeId(orderBundles);
  const orderSnapshotDiagnosisByNfeId = new Map(
    snapshotRows
      .filter((row): row is typeof row & { nfeId: number } => row.nfeId != null)
      .map((row) => [
        row.nfeId,
        {
          exists: true,
          itemStatuses: row.items.map((item) => item.status),
        },
      ])
  );

  let preview = buildCommissionReceivableForecastPreview({
    year,
    month,
    seller: input.seller ?? null,
    customer: input.customer ?? null,
    receivables,
    ordersByNfeId,
    materializedSchedulesByReceivableId,
    commissionRecordsByNfeId,
    orderSnapshotDiagnosisByNfeId,
    allowItemRecalculationFallback: false,
    rules: [],
    exclusionRules,
    identityCtx,
    openForecastFilters: {
      dueDateFrom: input.dueDateFrom ?? null,
      dueDateTo: input.dueDateTo ?? null,
      horizonMonths: input.horizonMonths ?? null,
    },
    referenceDate,
  });

  if (input.commissionPersonId?.trim()) {
    const personId = input.commissionPersonId.trim();
    preview = {
      ...preview,
      lines: preview.lines.filter((line) => line.canonicalSellerId === personId),
    };
  }

  return preview;
}
