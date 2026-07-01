import type { CommissionAuditIssueType, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { applyCommissionRecordScope } from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  buildCommissionReleasesDueWhere,
  COMMISSION_CONFIRMED_STATUSES,
  paginatedMeta,
  type CommissionReleasesQuery,
} from "./commissionQuery.js";

const RELEASE_AUDIT_TYPES: CommissionAuditIssueType[] = [
  "RECEIVED_WITHOUT_RELEASE",
  "PAID_WITHOUT_RELEASE",
  "DIVERGENT_AMOUNT",
  "NFE_WITHOUT_RECEIVABLE",
  "MANUAL_REVIEW_REQUIRED",
];

export type CommissionReleasesCards = {
  commissionToRelease: number;
  commissionAlreadyReleased: number;
  commissionBlockedByNoReceipt: number;
  accountsReceivedCount: number;
  accountsOpenCount: number;
  accountsOverdueCount: number;
  upcomingReleasesCount: number;
};

export type CommissionReleaseParcelRow = {
  scheduleId: string;
  commissionRecordId: string;
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  customerName: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  installmentNumber: number | null;
  parcelAmount: number;
  receivedAmount: number;
  receivableBalance: number;
  receivedPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  allocationPercent: number | null;
  status: string;
  highlight: "overdue" | "received" | "partial_release" | "open" | "released";
  recordCommissionTotal: number;
};

export type CommissionReleasesPagePayload = {
  cards: CommissionReleasesCards;
  rows: CommissionReleaseParcelRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionReleaseDetailPayload = {
  scheduleId: string;
  commissionRecordId: string;
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  customerName: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  installmentNumber: number | null;
  releaseRule: string;
  recordCommissionTotal: number;
  allocationPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  parcelAmount: number;
  receivedAmount: number;
  receivableBalance: number;
  receivedPercent: number | null;
  releaseExplanation: string;
  releaseHistory: Array<{
    scheduleId: string;
    installmentNumber: number | null;
    dueDate: string | null;
    commissionExpectedAmount: number;
    commissionReleasedAmount: number;
    receivedAmount: number;
    status: string;
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

type ScheduleRow = {
  id: string;
  commissionRecordId: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  dueDate: Date | null;
  receivableAmount: unknown;
  receivedAmount: unknown;
  openBalance: unknown;
  allocationPercent: unknown;
  commissionExpectedAmount: unknown;
  commissionReleasedAmount: unknown;
  status: string;
  commissionRecord: {
    id: string;
    orderCode: string | null;
    nfeNumber: string | null;
    customerName: string | null;
    commissionAmount: unknown;
    releaseRule: string;
    commissionPersonId: string;
    commissionPerson: { name: string };
  };
};

type ReceivableMeta = {
  settlementDate: Date | null;
  balanceReceivable: number;
  amountReceived: number;
};

function resolveHighlight(row: {
  dueDate: Date | null;
  receivedAmount: number;
  receivableBalance: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
}): CommissionReleaseParcelRow["highlight"] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = row.dueDate ? new Date(row.dueDate) : null;
  if (due) due.setHours(0, 0, 0, 0);

  if (row.balanceToRelease <= 0 && row.commissionReleasedAmount > 0) return "released";
  if (row.commissionReleasedAmount > 0 && row.balanceToRelease > 0) return "partial_release";
  if (row.receivedAmount > 0) return "received";
  if (due && due.getTime() < today.getTime() && row.receivableBalance > 0) return "overdue";
  return "open";
}

function matchesReleaseFilter(
  row: { commissionReleasedAmount: number; balanceToRelease: number; commissionParcelAmount: number },
  filter: CommissionReleasesQuery["releaseFilter"]
): boolean {
  if (!filter) return true;
  if (filter === "not_released") return row.commissionReleasedAmount <= 0;
  if (filter === "released") {
    return row.balanceToRelease <= 0 && row.commissionReleasedAmount > 0;
  }
  if (filter === "partial") {
    return row.commissionReleasedAmount > 0 && row.balanceToRelease > 0;
  }
  return true;
}

function mapScheduleRow(
  row: ScheduleRow,
  receivableMeta: Map<number, ReceivableMeta>
): CommissionReleaseParcelRow {
  const receivableAmount = decimalToNumber(row.receivableAmount);
  const receivedAmount = decimalToNumber(row.receivedAmount);
  const commissionExpected = decimalToNumber(row.commissionExpectedAmount);
  const commissionReleased = decimalToNumber(row.commissionReleasedAmount);
  const balanceToRelease = roundMoney(Math.max(0, commissionExpected - commissionReleased));
  const receivedPercent =
    receivableAmount > 0 ? roundMoney((receivedAmount / receivableAmount) * 100) : null;

  const arMeta =
    row.nomusReceivableId != null ? receivableMeta.get(row.nomusReceivableId) : undefined;
  const receivableBalance =
    arMeta != null
      ? arMeta.balanceReceivable
      : decimalToNumber(row.openBalance);

  const mapped: CommissionReleaseParcelRow = {
    scheduleId: row.id,
    commissionRecordId: row.commissionRecordId,
    commissionPersonId: row.commissionRecord.commissionPersonId,
    commissionPersonName: row.commissionRecord.commissionPerson.name,
    orderCode: row.commissionRecord.orderCode,
    nfeNumber: row.commissionRecord.nfeNumber,
    nomusReceivableId: row.nomusReceivableId,
    customerName: row.commissionRecord.customerName,
    dueDate: row.dueDate?.toISOString() ?? null,
    settlementDate: arMeta?.settlementDate?.toISOString() ?? null,
    installmentNumber: row.installmentNumber,
    parcelAmount: receivableAmount > 0 ? receivableAmount : decimalToNumber(row.openBalance),
    receivedAmount,
    receivableBalance,
    receivedPercent,
    commissionParcelAmount: commissionExpected,
    commissionReleasedAmount: commissionReleased,
    balanceToRelease,
    allocationPercent:
      row.allocationPercent != null ? decimalToNumber(row.allocationPercent) : null,
    status: row.status,
    highlight: "open",
    recordCommissionTotal: decimalToNumber(row.commissionRecord.commissionAmount),
  };

  mapped.highlight = resolveHighlight({
    dueDate: row.dueDate,
    receivedAmount,
    receivableBalance,
    commissionReleasedAmount: commissionReleased,
    balanceToRelease,
  });

  return mapped;
}

async function buildReleasesScheduleWhere(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<Prisma.CommissionPaymentScheduleWhereInput> {
  const recordScope = applyCommissionRecordScope(scope, {
    commissionPersonId: query.commissionPersonId,
    sellerId: query.sellerId,
    representativeId: query.representativeId,
  });

  const recordFilters: Prisma.CommissionRecordWhereInput[] = [
    recordScope,
    { status: { in: COMMISSION_CONFIRMED_STATUSES } },
  ];
  if (query.commissionPersonId) {
    recordFilters.push({ commissionPersonId: query.commissionPersonId });
  }
  if (query.customer) {
    recordFilters.push({
      customerName: { contains: query.customer, mode: "insensitive" },
    });
  }
  if (query.orderCode) {
    recordFilters.push({
      orderCode: { contains: query.orderCode, mode: "insensitive" },
    });
  }
  if (query.nfeNumber) {
    recordFilters.push({
      nfeNumber: { contains: query.nfeNumber, mode: "insensitive" },
    });
  }

  const and: Prisma.CommissionPaymentScheduleWhereInput[] = [
    { source: "ACCOUNTS_RECEIVABLE" },
    { commissionRecord: { AND: recordFilters } },
    buildCommissionReleasesDueWhere(query),
  ];

  if (query.receivableId != null) {
    and.push({ nomusReceivableId: query.receivableId });
  }
  if (query.accountStatus) {
    and.push({
      status: query.accountStatus as import("@prisma/client").CommissionPaymentScheduleStatus,
    });
  }

  if (query.settlementFrom || query.settlementTo) {
    const arWhere: Prisma.NomusAccountsReceivableWhereInput = {};
    if (query.settlementFrom && query.settlementTo) {
      arWhere.settlementDate = { gte: query.settlementFrom, lte: query.settlementTo };
    } else if (query.settlementFrom) {
      arWhere.settlementDate = { gte: query.settlementFrom };
    } else if (query.settlementTo) {
      arWhere.settlementDate = { lte: query.settlementTo };
    }
    const receivables = await prisma.nomusAccountsReceivable.findMany({
      where: arWhere,
      select: { externalId: true },
      take: 5000,
    });
    const ids = receivables.map((r) => r.externalId);
    and.push(ids.length > 0 ? { nomusReceivableId: { in: ids } } : { id: { in: [] } });
  }

  const filtered = and.filter((p) => Object.keys(p).length > 0);
  if (filtered.length === 1) return filtered[0]!;
  return { AND: filtered };
}

async function loadReceivableMeta(
  receivableIds: number[]
): Promise<Map<number, ReceivableMeta>> {
  const unique = [...new Set(receivableIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.nomusAccountsReceivable.findMany({
    where: { externalId: { in: unique } },
    select: {
      externalId: true,
      settlementDate: true,
      balanceReceivable: true,
      amountReceived: true,
    },
  });
  return new Map(
    rows.map((row) => [
      row.externalId,
      {
        settlementDate: row.settlementDate,
        balanceReceivable: decimalToNumber(row.balanceReceivable),
        amountReceived: decimalToNumber(row.amountReceived),
      },
    ])
  );
}

function buildCards(rows: CommissionReleaseParcelRow[]): CommissionReleasesCards {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);

  let commissionToRelease = 0;
  let commissionAlreadyReleased = 0;
  let commissionBlockedByNoReceipt = 0;
  let accountsReceivedCount = 0;
  let accountsOpenCount = 0;
  let accountsOverdueCount = 0;
  let upcomingReleasesCount = 0;

  for (const row of rows) {
    commissionToRelease = roundMoney(commissionToRelease + row.balanceToRelease);
    commissionAlreadyReleased = roundMoney(
      commissionAlreadyReleased + row.commissionReleasedAmount
    );
    if (row.receivedAmount <= 0 && row.balanceToRelease > 0) {
      commissionBlockedByNoReceipt = roundMoney(
        commissionBlockedByNoReceipt + row.commissionParcelAmount
      );
    }
    if (row.receivedAmount > 0) accountsReceivedCount += 1;
    if (row.receivableBalance > 0) accountsOpenCount += 1;
    if (row.highlight === "overdue") accountsOverdueCount += 1;

    if (row.dueDate && row.balanceToRelease > 0) {
      const due = new Date(row.dueDate);
      due.setHours(0, 0, 0, 0);
      if (due.getTime() >= today.getTime() && due.getTime() <= in30.getTime()) {
        upcomingReleasesCount += 1;
      }
    }
  }

  return {
    commissionToRelease,
    commissionAlreadyReleased,
    commissionBlockedByNoReceipt,
    accountsReceivedCount,
    accountsOpenCount,
    accountsOverdueCount,
    upcomingReleasesCount,
  };
}

async function fetchReleaseSchedules(
  where: Prisma.CommissionPaymentScheduleWhereInput
): Promise<ScheduleRow[]> {
  return prisma.commissionPaymentSchedule.findMany({
    where,
    include: {
      commissionRecord: {
        select: {
          id: true,
          orderCode: true,
          nfeNumber: true,
          customerName: true,
          commissionAmount: true,
          releaseRule: true,
          commissionPersonId: true,
          commissionPerson: { select: { name: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
  });
}

export async function listCommissionReleasesPage(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<CommissionReleasesPagePayload> {
  const where = await buildReleasesScheduleWhere(query, scope);
  const scheduleRows = await fetchReleaseSchedules(where);

  const receivableIds = scheduleRows
    .map((r) => r.nomusReceivableId)
    .filter((id): id is number => id != null);
  const receivableMeta = await loadReceivableMeta(receivableIds);

  let mapped = scheduleRows.map((row) => mapScheduleRow(row, receivableMeta));
  if (query.releaseFilter) {
    mapped = mapped.filter((row) => matchesReleaseFilter(row, query.releaseFilter));
  }

  const cards = buildCards(mapped);
  const total = mapped.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageRows = mapped.slice(skip, skip + query.pageSize);

  return {
    cards,
    rows: pageRows,
    items: pageRows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

function buildReleaseExplanation(input: {
  releaseRule: string;
  recordCommissionTotal: number;
  allocationPercent: number | null;
  commissionParcelAmount: number;
  parcelAmount: number;
  receivedAmount: number;
  commissionReleasedAmount: number;
}): string {
  const alloc =
    input.allocationPercent != null
      ? `${input.allocationPercent}%`
      : input.recordCommissionTotal > 0
        ? `${roundMoney((input.commissionParcelAmount / input.recordCommissionTotal) * 100)}%`
        : "—";

  if (input.releaseRule === "EACH_RECEIVABLE_PAID") {
    const pct =
      input.parcelAmount > 0
        ? roundMoney((input.receivedAmount / input.parcelAmount) * 100)
        : 0;
    return `Regra proporcional ao recebimento (EACH_RECEIVABLE_PAID). Rateio da parcela: ${alloc} da comissão total (${input.recordCommissionTotal.toFixed(2)}). Com ${pct}% recebido do título, liberação acumulada: ${input.commissionReleasedAmount.toFixed(2)}.`;
  }

  return `Regra ${input.releaseRule}. Rateio da parcela: ${alloc}. Comissão da parcela: ${input.commissionParcelAmount.toFixed(2)}; liberado: ${input.commissionReleasedAmount.toFixed(2)}.`;
}

export async function getCommissionReleaseDetail(
  scheduleId: string,
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<CommissionReleaseDetailPayload | null> {
  const where = await buildReleasesScheduleWhere(query, scope);
  const row = await prisma.commissionPaymentSchedule.findFirst({
    where: { AND: [where, { id: scheduleId }] },
    include: {
      commissionRecord: {
        select: {
          id: true,
          orderCode: true,
          nfeNumber: true,
          customerName: true,
          commissionAmount: true,
          releaseRule: true,
          commissionPersonId: true,
          commissionPerson: { select: { name: true } },
          paymentSchedules: {
            where: { source: "ACCOUNTS_RECEIVABLE" },
            orderBy: [{ installmentNumber: "asc" }, { dueDate: "asc" }],
          },
        },
      },
    },
  });

  if (!row) return null;

  const receivableMeta = await loadReceivableMeta(
    row.nomusReceivableId != null ? [row.nomusReceivableId] : []
  );
  const mapped = mapScheduleRow(row as ScheduleRow, receivableMeta);

  const auditIssues = await prisma.commissionAuditIssue.findMany({
    where: {
      type: { in: RELEASE_AUDIT_TYPES },
      resolved: false,
      OR: [
        ...(mapped.orderCode
          ? [{ metadataJson: { path: ["orderCode"], equals: mapped.orderCode } }]
          : []),
        ...(mapped.nomusReceivableId != null
          ? [
              {
                metadataJson: {
                  path: ["receivableId"],
                  equals: mapped.nomusReceivableId,
                },
              },
            ]
          : []),
      ],
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 30,
  });

  const releaseHistory = row.commissionRecord.paymentSchedules.map((schedule) => ({
    scheduleId: schedule.id,
    installmentNumber: schedule.installmentNumber,
    dueDate: schedule.dueDate?.toISOString() ?? null,
    commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
    commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
    receivedAmount: decimalToNumber(schedule.receivedAmount),
    status: schedule.status,
  }));

  return {
    scheduleId: mapped.scheduleId,
    commissionRecordId: mapped.commissionRecordId,
    commissionPersonId: mapped.commissionPersonId,
    commissionPersonName: mapped.commissionPersonName,
    orderCode: mapped.orderCode,
    nfeNumber: mapped.nfeNumber,
    nomusReceivableId: mapped.nomusReceivableId,
    customerName: mapped.customerName,
    dueDate: mapped.dueDate,
    settlementDate: mapped.settlementDate,
    installmentNumber: mapped.installmentNumber,
    releaseRule: row.commissionRecord.releaseRule,
    recordCommissionTotal: mapped.recordCommissionTotal,
    allocationPercent: mapped.allocationPercent,
    commissionParcelAmount: mapped.commissionParcelAmount,
    commissionReleasedAmount: mapped.commissionReleasedAmount,
    balanceToRelease: mapped.balanceToRelease,
    parcelAmount: mapped.parcelAmount,
    receivedAmount: mapped.receivedAmount,
    receivableBalance: mapped.receivableBalance,
    receivedPercent: mapped.receivedPercent,
    releaseExplanation: buildReleaseExplanation({
      releaseRule: row.commissionRecord.releaseRule,
      recordCommissionTotal: mapped.recordCommissionTotal,
      allocationPercent: mapped.allocationPercent,
      commissionParcelAmount: mapped.commissionParcelAmount,
      parcelAmount: mapped.parcelAmount,
      receivedAmount: mapped.receivedAmount,
      commissionReleasedAmount: mapped.commissionReleasedAmount,
    }),
    releaseHistory,
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
