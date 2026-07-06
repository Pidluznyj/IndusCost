import type { CommissionRecordStatus, Prisma } from "@prisma/client";

/** Registros históricos/inativos — não entram em totais financeiros operacionais. */
export const INACTIVE_COMMISSION_RECORD_STATUSES: CommissionRecordStatus[] = [
  "SUPERSEDED_BY_OUTPUT_DOCUMENT",
  "CANCELLED",
  "REVERSED",
  "ERROR",
];

export const FORECAST_COMMISSION_RECORD_STATUSES: CommissionRecordStatus[] = [
  "FORECAST_FROM_ORDER",
  "WAITING_NFE",
];

export const CONFIRMED_COMMISSION_RECORD_STATUSES: CommissionRecordStatus[] = [
  "CONFIRMED_BY_OUTPUT_DOCUMENT",
  "WAITING_RECEIVABLE",
  "WAITING_PAYMENT",
  "PARTIALLY_RELEASED",
  "RELEASED",
  "PAID_PARTIAL",
  "PAID_TOTAL",
];

export function isInactiveCommissionRecordStatus(status: string): boolean {
  return (INACTIVE_COMMISSION_RECORD_STATUSES as string[]).includes(status);
}

export function activeCommissionRecordWhere(
  period?: { from: Date; to: Date }
): Prisma.CommissionRecordWhereInput {
  return {
    ...(period
      ? { calculatedAt: { gte: period.from, lte: period.to } }
      : {}),
    status: { notIn: INACTIVE_COMMISSION_RECORD_STATUSES },
  };
}
