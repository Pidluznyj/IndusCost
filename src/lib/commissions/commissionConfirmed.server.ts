import type { CommissionAuditIssueType, CommissionRecordStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  buildCommissionRecordsWhere,
  paginatedMeta,
  resolveConfirmedStatusIn,
  type CommissionConfirmedQuery,
} from "./commissionQuery.js";

const DIVERGENCE_AUDIT_TYPES: CommissionAuditIssueType[] = [
  "NFE_WITHOUT_OUTPUT_DOCUMENT",
  "NFE_WITHOUT_RECEIVABLE",
  "OUTPUT_DOCUMENT_WITHOUT_ORDER_MATCH",
  "RECEIVABLE_WITHOUT_NFE",
  "CANCELLED_NFE_WITH_ACTIVE_COMMISSION",
  "RECEIVED_WITHOUT_RELEASE",
  "PAID_WITHOUT_RELEASE",
  "DIVERGENT_AMOUNT",
  "MANUAL_REVIEW_REQUIRED",
];

export type CommissionConfirmedCards = {
  totalConfirmedCommission: number;
  invoicedAmount: number;
  receivedAmount: number;
  waitingReceivableCommission: number;
  partiallyReleasedCommission: number;
  fullyReleasedCommission: number;
  balanceToRelease: number;
  inconsistentDocumentsCount: number;
};

export type CommissionConfirmedRow = {
  confirmKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  outputDocumentLabel: string | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  confirmedBaseAmount: number;
  ratePercent: number;
  confirmedCommissionAmount: number;
  receivedAmount: number;
  releasedCommissionAmount: number;
  pendingBalance: number;
  status: string;
  highlight: "confirmed" | "waiting_receivable" | "divergence" | "cancelled";
  hasDivergence: boolean;
  recordIds: string[];
  confirmedAt: string | null;
};

export type CommissionConfirmedPagePayload = {
  cards: CommissionConfirmedCards;
  rows: CommissionConfirmedRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionConfirmedDetailPayload = {
  confirmKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  outputDocumentLabel: string | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  status: string;
  confirmedAt: string | null;
  totalBaseAmount: number;
  totalConfirmedCommission: number;
  totalReceivedAmount: number;
  totalReleasedAmount: number;
  pendingBalance: number;
  orderItems: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    ruleId: string | null;
    ruleName: string | null;
  }>;
  outputDocumentItems: Array<{
    movementId: string;
    documentNumber: string | null;
    productLabel: string | null;
    quantity: number;
    movementDate: string;
  }>;
  receivables: Array<{
    nomusReceivableId: number | null;
    installmentNumber: number | null;
    dueDate: string | null;
    amountReceivable: number;
    amountReceived: number;
    balanceReceivable: number;
    commissionExpectedAmount: number;
    commissionReleasedAmount: number;
  }>;
  supersessionHistory: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    commissionAmount: number;
    supersededAt: string;
  }>;
  auditIssues: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
};

type RecordWithRelations = {
  id: string;
  status: CommissionRecordStatus;
  orderCode: string | null;
  nomusOrderId: number | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  nomusOutputDocumentId: number | null;
  customerName: string | null;
  productCode: string | null;
  productName: string | null;
  commissionPersonId: string;
  baseAmount: unknown;
  ratePercent: unknown;
  commissionAmount: unknown;
  releasedAmount: unknown;
  balanceAmount: unknown;
  calculatedAt: Date;
  confirmedAt: Date | null;
  metadataJson: unknown;
  commissionPerson: { id: string; name: string };
  paymentSchedules: Array<{
    id: string;
    nomusReceivableId: number | null;
    installmentNumber: number | null;
    dueDate: Date | null;
    receivableAmount: unknown;
    receivedAmount: unknown;
    openBalance: unknown;
    commissionExpectedAmount: unknown;
    commissionReleasedAmount: unknown;
  }>;
};

type GroupAggregate = {
  confirmKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  outputDocumentMovementId: string | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  statuses: Set<CommissionRecordStatus>;
  baseAmount: number;
  commissionAmount: number;
  releasedAmount: number;
  balanceAmount: number;
  receivedAmount: number;
  scheduleIds: Set<string>;
  recordIds: string[];
  latestConfirmedAt: Date | null;
};

function confirmKeyFromRecord(row: {
  orderCode: string | null;
  nomusNfeId: number | null;
  commissionPersonId: string;
}): string {
  const order = row.orderCode?.trim() || "unknown";
  const nfe = row.nomusNfeId != null ? String(row.nomusNfeId) : "no-nfe";
  return `${order}|${nfe}|${row.commissionPersonId}`;
}

function metadataFields(metadataJson: unknown): {
  ruleId: string | null;
  ruleName: string | null;
  localOutputDocumentMovementId: string | null;
} {
  if (!metadataJson || typeof metadataJson !== "object") {
    return { ruleId: null, ruleName: null, localOutputDocumentMovementId: null };
  }
  const meta = metadataJson as Record<string, unknown>;
  return {
    ruleId: typeof meta.ruleId === "string" ? meta.ruleId : null,
    ruleName: typeof meta.ruleName === "string" ? meta.ruleName : null,
    localOutputDocumentMovementId:
      typeof meta.localOutputDocumentMovementId === "string"
        ? meta.localOutputDocumentMovementId
        : null,
  };
}

function resolveGroupStatus(statuses: Set<CommissionRecordStatus>): CommissionRecordStatus {
  const priority: CommissionRecordStatus[] = [
    "CANCELLED",
    "REVERSED",
    "ERROR",
    "WAITING_RECEIVABLE",
    "WAITING_PAYMENT",
    "CONFIRMED_BY_OUTPUT_DOCUMENT",
    "PARTIALLY_RELEASED",
    "RELEASED",
    "PAID_PARTIAL",
    "PAID_TOTAL",
  ];
  for (const status of priority) {
    if (statuses.has(status)) return status;
  }
  return [...statuses][0] ?? "CONFIRMED_BY_OUTPUT_DOCUMENT";
}

function resolveHighlight(
  status: CommissionRecordStatus,
  hasDivergence: boolean
): CommissionConfirmedRow["highlight"] {
  if (hasDivergence) return "divergence";
  if (status === "CANCELLED" || status === "REVERSED") return "cancelled";
  if (
    status === "WAITING_RECEIVABLE" ||
    status === "WAITING_PAYMENT" ||
    status === "CONFIRMED_BY_OUTPUT_DOCUMENT"
  ) {
    return "waiting_receivable";
  }
  return "confirmed";
}

async function buildConfirmedWhere(
  query: CommissionConfirmedQuery,
  scope: CommissionAccessScope
): Promise<Prisma.CommissionRecordWhereInput> {
  const statusIn = resolveConfirmedStatusIn(query);
  const base = buildCommissionRecordsWhere(
    { ...query, statusIn, status: null },
    scope
  );

  if (!query.outputDocument) return base;

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      documentNumber: { contains: query.outputDocument, mode: "insensitive" },
    },
    select: { id: true, nfeNumber: true, salesOrderCode: true },
    take: 200,
  });

  if (movements.length === 0) {
    return { AND: [base, { id: { in: [] } }] };
  }

  const movementIds = movements.map((m) => m.id);
  const nfeNumbers = [
    ...new Set(movements.map((m) => m.nfeNumber).filter((v): v is string => Boolean(v))),
  ];
  const orderCodes = [
    ...new Set(
      movements.map((m) => m.salesOrderCode).filter((v): v is string => Boolean(v))
    ),
  ];

  const orFilters: Prisma.CommissionRecordWhereInput[] = [
    ...movementIds.map((id) => ({
      metadataJson: { path: ["localOutputDocumentMovementId"], equals: id },
    })),
    ...nfeNumbers.map((nfeNumber) => ({ nfeNumber })),
    ...orderCodes.map((orderCode) => ({ orderCode })),
  ];

  return { AND: [base, { OR: orFilters }] };
}

function aggregateRecords(rows: RecordWithRelations[]): GroupAggregate[] {
  const map = new Map<string, GroupAggregate>();

  for (const row of rows) {
    const key = confirmKeyFromRecord(row);
    let agg = map.get(key);
    if (!agg) {
      const meta = metadataFields(row.metadataJson);
      agg = {
        confirmKey: key,
        orderCode: row.orderCode,
        nomusOrderId: row.nomusOrderId,
        nfeNumber: row.nfeNumber,
        nomusNfeId: row.nomusNfeId,
        outputDocumentMovementId: meta.localOutputDocumentMovementId,
        customerName: row.customerName,
        commissionPersonId: row.commissionPersonId,
        commissionPersonName: row.commissionPerson.name,
        statuses: new Set(),
        baseAmount: 0,
        commissionAmount: 0,
        releasedAmount: 0,
        balanceAmount: 0,
        receivedAmount: 0,
        scheduleIds: new Set(),
        recordIds: [],
        latestConfirmedAt: row.confirmedAt,
      };
      map.set(key, agg);
    }

    agg.statuses.add(row.status);
    agg.baseAmount = roundMoney(agg.baseAmount + decimalToNumber(row.baseAmount));
    agg.commissionAmount = roundMoney(
      agg.commissionAmount + decimalToNumber(row.commissionAmount)
    );
    agg.releasedAmount = roundMoney(
      agg.releasedAmount + decimalToNumber(row.releasedAmount)
    );
    agg.balanceAmount = roundMoney(
      agg.balanceAmount + decimalToNumber(row.balanceAmount)
    );
    agg.recordIds.push(row.id);
    if (row.customerName) agg.customerName = row.customerName;
    if (row.nfeNumber) agg.nfeNumber = row.nfeNumber;
    if (row.confirmedAt && (!agg.latestConfirmedAt || row.confirmedAt > agg.latestConfirmedAt)) {
      agg.latestConfirmedAt = row.confirmedAt;
    }
    const meta = metadataFields(row.metadataJson);
    if (meta.localOutputDocumentMovementId) {
      agg.outputDocumentMovementId = meta.localOutputDocumentMovementId;
    }

    for (const schedule of row.paymentSchedules) {
      if (!agg.scheduleIds.has(schedule.id)) {
        agg.scheduleIds.add(schedule.id);
        agg.receivedAmount = roundMoney(
          agg.receivedAmount + decimalToNumber(schedule.receivedAmount)
        );
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTime = a.latestConfirmedAt?.getTime() ?? 0;
    const bTime = b.latestConfirmedAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}

async function resolveOutputDocumentLabels(
  movementIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(movementIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.inventoryMovement.findMany({
    where: { id: { in: unique } },
    select: { id: true, documentNumber: true, movementType: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      row.documentNumber?.trim() || row.movementType || row.id.slice(0, 8),
    ])
  );
}

async function resolveSalesOrderIds(
  orderCodes: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(orderCodes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.salesOrder.findMany({
    where: { orderCode: { in: unique } },
    select: { id: true, orderCode: true },
  });
  return new Map(rows.map((row) => [row.orderCode, row.id]));
}

async function countInconsistentDocuments(
  aggregates: GroupAggregate[],
  query: CommissionConfirmedQuery
): Promise<number> {
  const orderCodes = aggregates
    .map((a) => a.orderCode)
    .filter((c): c is string => Boolean(c));
  const nfeNumbers = aggregates
    .map((a) => a.nfeNumber)
    .filter((n): n is string => Boolean(n));

  const where: Prisma.CommissionAuditIssueWhereInput = {
    type: { in: DIVERGENCE_AUDIT_TYPES },
    resolved: false,
  };

  const orParts: Prisma.CommissionAuditIssueWhereInput[] = [];
  for (const code of orderCodes) {
    orParts.push({ metadataJson: { path: ["orderCode"], equals: code } });
  }
  for (const nfe of nfeNumbers) {
    orParts.push({ metadataJson: { path: ["nfeNumber"], equals: nfe } });
  }
  if (query.nfeNumber) {
    orParts.push({ metadataJson: { path: ["nfeNumber"], equals: query.nfeNumber } });
  }
  if (query.orderCode) {
    orParts.push({ metadataJson: { path: ["orderCode"], equals: query.orderCode } });
  }

  if (orParts.length === 0) {
    const issues = await prisma.commissionAuditIssue.findMany({
      where,
      select: { metadataJson: true },
      take: 500,
    });
    const keys = new Set<string>();
    for (const issue of issues) {
      const meta = issue.metadataJson as Record<string, unknown> | null;
      const key = `${meta?.orderCode ?? ""}|${meta?.nfeNumber ?? meta?.nfeExternalId ?? ""}`;
      if (key !== "|") keys.add(key);
    }
    return keys.size;
  }

  const issues = await prisma.commissionAuditIssue.findMany({
    where: { ...where, OR: orParts },
    select: { metadataJson: true },
  });
  const keys = new Set<string>();
  for (const issue of issues) {
    const meta = issue.metadataJson as Record<string, unknown> | null;
    const key = `${meta?.orderCode ?? ""}|${meta?.nfeNumber ?? meta?.nfeExternalId ?? ""}`;
    if (key !== "|") keys.add(key);
  }
  return keys.size;
}

async function resolveDivergenceKeys(
  aggregates: GroupAggregate[]
): Promise<Set<string>> {
  const orderCodes = aggregates
    .map((a) => a.orderCode)
    .filter((c): c is string => Boolean(c));
  if (orderCodes.length === 0) return new Set();

  const issues = await prisma.commissionAuditIssue.findMany({
    where: {
      type: { in: DIVERGENCE_AUDIT_TYPES },
      resolved: false,
      OR: orderCodes.map((code) => ({
        metadataJson: { path: ["orderCode"], equals: code },
      })),
    },
    select: { metadataJson: true },
  });

  const divergent = new Set<string>();
  for (const issue of issues) {
    const meta = issue.metadataJson as Record<string, unknown> | null;
    const orderCode = typeof meta?.orderCode === "string" ? meta.orderCode : null;
    const nfeNumber =
      typeof meta?.nfeNumber === "string"
        ? meta.nfeNumber
        : meta?.nfeExternalId != null
          ? String(meta.nfeExternalId)
          : null;
    if (!orderCode) continue;
    for (const agg of aggregates) {
      if (agg.orderCode !== orderCode) continue;
      if (nfeNumber && agg.nomusNfeId != null && String(agg.nomusNfeId) !== nfeNumber) {
        continue;
      }
      divergent.add(agg.confirmKey);
    }
  }
  return divergent;
}

function buildCards(aggregates: GroupAggregate[]): Omit<
  CommissionConfirmedCards,
  "inconsistentDocumentsCount"
> {
  let totalConfirmedCommission = 0;
  let invoicedAmount = 0;
  let receivedAmount = 0;
  let waitingReceivableCommission = 0;
  let partiallyReleasedCommission = 0;
  let fullyReleasedCommission = 0;
  let balanceToRelease = 0;

  for (const agg of aggregates) {
    totalConfirmedCommission = roundMoney(totalConfirmedCommission + agg.commissionAmount);
    invoicedAmount = roundMoney(invoicedAmount + agg.baseAmount);
    receivedAmount = roundMoney(receivedAmount + agg.receivedAmount);

    const status = resolveGroupStatus(agg.statuses);
    const pending = roundMoney(agg.commissionAmount - agg.releasedAmount);
    balanceToRelease = roundMoney(balanceToRelease + Math.max(0, pending));

    if (
      status === "WAITING_RECEIVABLE" ||
      status === "WAITING_PAYMENT" ||
      status === "CONFIRMED_BY_OUTPUT_DOCUMENT"
    ) {
      waitingReceivableCommission = roundMoney(
        waitingReceivableCommission + agg.commissionAmount
      );
    } else if (status === "PARTIALLY_RELEASED" || agg.releasedAmount > 0) {
      if (agg.releasedAmount >= agg.commissionAmount) {
        fullyReleasedCommission = roundMoney(
          fullyReleasedCommission + agg.releasedAmount
        );
      } else {
        partiallyReleasedCommission = roundMoney(
          partiallyReleasedCommission + agg.releasedAmount
        );
      }
    } else if (
      status === "RELEASED" ||
      status === "PAID_PARTIAL" ||
      status === "PAID_TOTAL"
    ) {
      fullyReleasedCommission = roundMoney(
        fullyReleasedCommission + agg.releasedAmount
      );
    }
  }

  return {
    totalConfirmedCommission,
    invoicedAmount,
    receivedAmount,
    waitingReceivableCommission,
    partiallyReleasedCommission,
    fullyReleasedCommission,
    balanceToRelease,
  };
}

async function fetchConfirmedRecords(
  where: Prisma.CommissionRecordWhereInput
): Promise<RecordWithRelations[]> {
  return prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { id: true, name: true } },
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE" },
        orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { calculatedAt: "desc" }],
  });
}

export async function listCommissionConfirmedPage(
  query: CommissionConfirmedQuery,
  scope: CommissionAccessScope
): Promise<CommissionConfirmedPagePayload> {
  const where = await buildConfirmedWhere(query, scope);
  const rows = await fetchConfirmedRecords(where);
  const aggregates = aggregateRecords(rows);

  const [outputDocLabels, salesOrderIds, inconsistentDocumentsCount, divergenceKeys] =
    await Promise.all([
      resolveOutputDocumentLabels(
        aggregates.map((a) => a.outputDocumentMovementId).filter((id): id is string => Boolean(id))
      ),
      resolveSalesOrderIds(
        aggregates.map((a) => a.orderCode).filter((c): c is string => Boolean(c))
      ),
      countInconsistentDocuments(aggregates, query),
      resolveDivergenceKeys(aggregates),
    ]);

  const cardBase = buildCards(aggregates);
  const total = aggregates.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageAggregates = aggregates.slice(skip, skip + query.pageSize);

  const tableRows: CommissionConfirmedRow[] = pageAggregates.map((agg) => {
    const status = resolveGroupStatus(agg.statuses);
    const hasDivergence = divergenceKeys.has(agg.confirmKey);
    const pendingBalance = roundMoney(
      Math.max(0, agg.commissionAmount - agg.releasedAmount)
    );
    const ratePercent =
      agg.baseAmount > 0
        ? Math.round((agg.commissionAmount / agg.baseAmount) * 10000) / 100
        : 0;

    return {
      confirmKey: agg.confirmKey,
      orderCode: agg.orderCode,
      nomusOrderId: agg.nomusOrderId,
      localOrderId: agg.orderCode ? salesOrderIds.get(agg.orderCode) ?? null : null,
      nfeNumber: agg.nfeNumber,
      nomusNfeId: agg.nomusNfeId,
      outputDocumentLabel: agg.outputDocumentMovementId
        ? outputDocLabels.get(agg.outputDocumentMovementId) ?? agg.outputDocumentMovementId
        : null,
      customerName: agg.customerName,
      commissionPersonId: agg.commissionPersonId,
      commissionPersonName: agg.commissionPersonName,
      confirmedBaseAmount: agg.baseAmount,
      ratePercent,
      confirmedCommissionAmount: agg.commissionAmount,
      receivedAmount: agg.receivedAmount,
      releasedCommissionAmount: agg.releasedAmount,
      pendingBalance,
      status,
      highlight: resolveHighlight(status, hasDivergence),
      hasDivergence,
      recordIds: agg.recordIds,
      confirmedAt: agg.latestConfirmedAt?.toISOString() ?? null,
    };
  });

  return {
    cards: { ...cardBase, inconsistentDocumentsCount },
    rows: tableRows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function getCommissionConfirmedDetail(
  confirmKey: string,
  query: CommissionConfirmedQuery,
  scope: CommissionAccessScope
): Promise<CommissionConfirmedDetailPayload | null> {
  const where = await buildConfirmedWhere(query, scope);
  const rows = await fetchConfirmedRecords(where);
  const aggregates = aggregateRecords(rows);
  const agg = aggregates.find((a) => a.confirmKey === confirmKey);
  if (!agg) return null;

  const filtered = rows.filter((row) => confirmKeyFromRecord(row) === confirmKey);
  if (filtered.length === 0) return null;

  const [outputDocLabels, salesOrderIds, auditIssues, superseded, outputMovements] =
    await Promise.all([
      resolveOutputDocumentLabels(
        agg.outputDocumentMovementId ? [agg.outputDocumentMovementId] : []
      ),
      resolveSalesOrderIds(agg.orderCode ? [agg.orderCode] : []),
      prisma.commissionAuditIssue.findMany({
        where: {
          resolved: false,
          OR: [
            ...(agg.orderCode
              ? [{ metadataJson: { path: ["orderCode"], equals: agg.orderCode } }]
              : []),
            ...(agg.nfeNumber
              ? [{ metadataJson: { path: ["nfeNumber"], equals: agg.nfeNumber } }]
              : []),
            ...(agg.nomusNfeId != null
              ? [{ metadataJson: { path: ["nfeExternalId"], equals: agg.nomusNfeId } }]
              : []),
          ],
        },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 50,
      }),
      prisma.commissionRecord.findMany({
        where: {
          status: "SUPERSEDED_BY_OUTPUT_DOCUMENT",
          commissionPersonId: agg.commissionPersonId,
          orderCode: agg.orderCode ?? undefined,
          nomusNfeId: null,
        },
        select: {
          id: true,
          productCode: true,
          productName: true,
          commissionAmount: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.inventoryMovement.findMany({
        where: {
          OR: [
            ...(agg.outputDocumentMovementId ? [{ id: agg.outputDocumentMovementId }] : []),
            ...(agg.nfeNumber ? [{ nfeNumber: agg.nfeNumber }] : []),
            ...(agg.orderCode ? [{ salesOrderCode: agg.orderCode }] : []),
          ],
        },
        select: {
          id: true,
          documentNumber: true,
          quantity: true,
          movementDate: true,
          reason: true,
          productId: true,
        },
        take: 100,
      }),
    ]);

  const productIds = outputMovements
    .map((m) => m.productId)
    .filter((id): id is string => Boolean(id));
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, name: true },
        })
      : [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  const receivableMap = new Map<
    string,
    CommissionConfirmedDetailPayload["receivables"][number]
  >();

  for (const row of filtered) {
    for (const schedule of row.paymentSchedules) {
      const key = schedule.id;
      if (receivableMap.has(key)) continue;
      receivableMap.set(key, {
        nomusReceivableId: schedule.nomusReceivableId,
        installmentNumber: schedule.installmentNumber,
        dueDate: schedule.dueDate?.toISOString() ?? null,
        amountReceivable: decimalToNumber(schedule.receivableAmount),
        amountReceived: decimalToNumber(schedule.receivedAmount),
        balanceReceivable: decimalToNumber(schedule.openBalance),
        commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
        commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
      });
    }
  }

  const status = resolveGroupStatus(agg.statuses);
  const totalReceivedAmount = agg.receivedAmount;
  const pendingBalance = roundMoney(
    Math.max(0, agg.commissionAmount - agg.releasedAmount)
  );

  return {
    confirmKey: agg.confirmKey,
    orderCode: agg.orderCode,
    nomusOrderId: agg.nomusOrderId,
    localOrderId: agg.orderCode ? salesOrderIds.get(agg.orderCode) ?? null : null,
    nfeNumber: agg.nfeNumber,
    nomusNfeId: agg.nomusNfeId,
    outputDocumentLabel: agg.outputDocumentMovementId
      ? outputDocLabels.get(agg.outputDocumentMovementId) ?? agg.outputDocumentMovementId
      : null,
    customerName: agg.customerName,
    commissionPersonId: agg.commissionPersonId,
    commissionPersonName: agg.commissionPersonName,
    status,
    confirmedAt: agg.latestConfirmedAt?.toISOString() ?? null,
    totalBaseAmount: agg.baseAmount,
    totalConfirmedCommission: agg.commissionAmount,
    totalReceivedAmount,
    totalReleasedAmount: agg.releasedAmount,
    pendingBalance,
    orderItems: filtered.map((row) => {
      const meta = metadataFields(row.metadataJson);
      return {
        recordId: row.id,
        productCode: row.productCode,
        productName: row.productName,
        baseAmount: decimalToNumber(row.baseAmount),
        ratePercent: decimalToNumber(row.ratePercent),
        commissionAmount: decimalToNumber(row.commissionAmount),
        ruleId: meta.ruleId,
        ruleName: meta.ruleName,
      };
    }),
    outputDocumentItems: outputMovements.map((movement) => {
      const product = movement.productId ? productMap.get(movement.productId) : null;
      return {
        movementId: movement.id,
        documentNumber: movement.documentNumber,
        productLabel: product
          ? `${product.sku} · ${product.name}`
          : movement.reason || null,
        quantity: decimalToNumber(movement.quantity),
        movementDate: movement.movementDate.toISOString(),
      };
    }),
    receivables: [...receivableMap.values()].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }),
    supersessionHistory: superseded.map((row) => ({
      recordId: row.id,
      productCode: row.productCode,
      productName: row.productName,
      commissionAmount: decimalToNumber(row.commissionAmount),
      supersededAt: row.updatedAt.toISOString(),
    })),
    auditIssues: auditIssues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      type: issue.type,
      message: issue.message,
      resolved: issue.resolved,
      createdAt: issue.createdAt.toISOString(),
    })),
  };
}
