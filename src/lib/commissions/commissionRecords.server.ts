import type { CommissionRecordStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  buildCommissionRecordsWhere,
  inferRecordKind,
  paginatedMeta,
  type CommissionRecordsQuery,
} from "./commissionQuery.js";

export type CommissionRecordDto = {
  id: string;
  status: string;
  originStage: string;
  kind: ReturnType<typeof inferRecordKind>;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  productName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  customerName: string | null;
  baseAmount: number;
  ratePercent: number;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  calculatedAt: string;
  confirmedAt: string | null;
};

export type CommissionRecordsListPayload = {
  items: CommissionRecordDto[];
  pagination: ReturnType<typeof paginatedMeta>;
  totals: {
    commissionAmount: number;
    releasedAmount: number;
    paidAmount: number;
    balanceAmount: number;
    count: number;
  };
  kind: "forecast" | "confirmed" | "mixed";
};

function serializeRecord(
  row: {
    id: string;
    status: string;
    originStage: string;
    orderCode: string | null;
    nfeNumber: string | null;
    productCode: string | null;
    productName: string | null;
    commissionPersonId: string;
    customerName: string | null;
    baseAmount: unknown;
    ratePercent: unknown;
    commissionAmount: unknown;
    releasedAmount: unknown;
    paidAmount: unknown;
    balanceAmount: unknown;
    calculatedAt: Date;
    confirmedAt: Date | null;
    commissionPerson: { name: string };
  }
): CommissionRecordDto {
  return {
    id: row.id,
    status: row.status,
    originStage: row.originStage,
    kind: inferRecordKind(row.status as CommissionRecordStatus),
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    productCode: row.productCode,
    productName: row.productName,
    commissionPersonId: row.commissionPersonId,
    commissionPersonName: row.commissionPerson.name,
    customerName: row.customerName,
    baseAmount: decimalToNumber(row.baseAmount),
    ratePercent: decimalToNumber(row.ratePercent),
    commissionAmount: decimalToNumber(row.commissionAmount),
    releasedAmount: decimalToNumber(row.releasedAmount),
    paidAmount: decimalToNumber(row.paidAmount),
    balanceAmount: decimalToNumber(row.balanceAmount),
    calculatedAt: row.calculatedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}

export async function listCommissionRecords(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope
): Promise<CommissionRecordsListPayload> {
  const where = buildCommissionRecordsWhere(query, scope);
  const skip = (query.page - 1) * query.pageSize;

  const [total, aggregates, rows] = await Promise.all([
    prisma.commissionRecord.count({ where }),
    prisma.commissionRecord.aggregate({
      where,
      _sum: {
        commissionAmount: true,
        releasedAmount: true,
        paidAmount: true,
        balanceAmount: true,
      },
    }),
    prisma.commissionRecord.findMany({
      where,
      include: { commissionPerson: { select: { name: true } } },
      orderBy: [{ calculatedAt: "desc" }, { orderCode: "asc" }],
      skip,
      take: query.pageSize,
    }),
  ]);

  const items = rows.map(serializeRecord);
  const kinds = new Set(items.map((i) => i.kind));
  const kind =
    kinds.size === 1
      ? kinds.has("forecast")
        ? "forecast"
        : kinds.has("confirmed")
          ? "confirmed"
          : "mixed"
      : "mixed";

  return {
    items,
    pagination: paginatedMeta(total, query.page, query.pageSize),
    totals: {
      commissionAmount: decimalToNumber(aggregates._sum.commissionAmount),
      releasedAmount: decimalToNumber(aggregates._sum.releasedAmount),
      paidAmount: decimalToNumber(aggregates._sum.paidAmount),
      balanceAmount: decimalToNumber(aggregates._sum.balanceAmount),
      count: total,
    },
    kind,
  };
}

export async function listCommissionForecastRecords(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope
): Promise<CommissionRecordsListPayload> {
  return listCommissionRecords(
    {
      ...query,
      statusIn: ["FORECAST_FROM_ORDER", "WAITING_NFE"],
      status: null,
    },
    scope
  );
}

export async function listCommissionConfirmedRecords(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope
): Promise<CommissionRecordsListPayload> {
  return listCommissionRecords(
    {
      ...query,
      statusIn: [
        "CONFIRMED_BY_OUTPUT_DOCUMENT",
        "WAITING_RECEIVABLE",
        "WAITING_PAYMENT",
        "PARTIALLY_RELEASED",
        "RELEASED",
      ],
      status: null,
    },
    scope
  );
}

export type CommissionReleaseRow = {
  scheduleId: string;
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  dueDate: string | null;
  installmentNumber: number | null;
  parcelAmount: number | null;
  receivedAmount: number | null;
  receivedPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  status: string;
};

export async function listCommissionReleases(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope
): Promise<{ items: CommissionReleaseRow[]; pagination: ReturnType<typeof paginatedMeta> }> {
  const recordWhere = buildCommissionRecordsWhere(query, scope);
  const skip = (query.page - 1) * query.pageSize;

  const scheduleWhere = {
    source: "ACCOUNTS_RECEIVABLE" as const,
    commissionRecord: recordWhere,
  };

  const [total, rows] = await Promise.all([
    prisma.commissionPaymentSchedule.count({ where: scheduleWhere }),
    prisma.commissionPaymentSchedule.findMany({
      where: scheduleWhere,
      include: {
        commissionRecord: {
          select: {
            orderCode: true,
            nfeNumber: true,
            commissionPersonId: true,
            commissionPerson: { select: { name: true } },
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      skip,
      take: query.pageSize,
    }),
  ]);

  const items: CommissionReleaseRow[] = rows.map((row) => {
    const receivableAmount = decimalToNumber(row.receivableAmount);
    const receivedAmount = decimalToNumber(row.receivedAmount);
    const commissionExpected = decimalToNumber(row.commissionExpectedAmount);
    const commissionReleased = decimalToNumber(row.commissionReleasedAmount);
    const receivedPercent =
      receivableAmount > 0 ? roundMoney((receivedAmount / receivableAmount) * 100) : null;

    return {
      scheduleId: row.id,
      commissionPersonId: row.commissionRecord.commissionPersonId,
      commissionPersonName: row.commissionRecord.commissionPerson.name,
      orderCode: row.commissionRecord.orderCode,
      nfeNumber: row.commissionRecord.nfeNumber,
      nomusReceivableId: row.nomusReceivableId,
      dueDate: row.dueDate?.toISOString() ?? null,
      installmentNumber: row.installmentNumber,
      parcelAmount: receivableAmount > 0 ? receivableAmount : decimalToNumber(row.expectedAmount),
      receivedAmount: receivedAmount > 0 ? receivedAmount : null,
      receivedPercent,
      commissionParcelAmount: commissionExpected,
      commissionReleasedAmount: commissionReleased,
      balanceToRelease: roundMoney(Math.max(0, commissionExpected - commissionReleased)),
      status: row.status,
    };
  });

  return {
    items,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}
