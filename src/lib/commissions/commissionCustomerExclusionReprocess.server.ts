import type { Prisma, PrismaClient } from "@prisma/client";
import { buildAuditIssueKey, shouldBlockAutoChangePaidRecord } from "./commission-calculation-hash.js";
import { upsertCommissionAuditIssues } from "./commission-audit-service.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  applyCustomerExclusionToCommission,
  parseCustomerExclusionFromMetadata,
  resolveCustomerExclusionForSale,
} from "./commissionCustomerExclusionApply.js";
import {
  buildExclusionImpactPreview,
  evaluateExclusionReprocessSafety,
  recordMatchesCustomerFilter,
  resolveRecordEligibilityReferenceDate,
  ruleMatchesCustomerFilter,
  simulateExclusionImpactLine,
  type ClosedPaymentBatchMonth,
  type ExclusionImpactPreview,
  type ExclusionReprocessApplyLineResult,
  type ExclusionReprocessApplyResult,
  type ExclusionReprocessCustomerFilter,
  type ExclusionReprocessDateRange,
  type ExclusionReprocessMode,
  type ExclusionReprocessRecordInput,
} from "./commissionCustomerExclusionReprocess.js";
import {
  getCustomerExclusionRuleSnapshotById,
} from "./commissionCustomerExclusionRules.server.js";
import { decimalToNumber, roundMoney, toPrismaDecimal } from "./commission-money.js";
import {
  computeBalanceAfterRelease,
  recomputeCommissionRecordRelease,
  resolveEffectiveReleaseRule,
} from "./commission-release-service.js";
import { activeCommissionRecordWhere } from "./commission-record-status.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import { buildMonthKey } from "./commissionMonthlyPayable.js";

function mapRecordRow(record: {
  id: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  customerExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string;
  status: string;
  originStage: string;
  baseAmount: unknown;
  ratePercent: unknown;
  commissionAmount: unknown;
  releasedAmount: unknown;
  paidAmount: unknown;
  confirmedAt: Date | null;
  calculatedAt: Date;
  metadataJson: unknown;
  commissionPerson: { name: string };
  paymentSchedules: Array<{
    id: string;
    nomusReceivableId: number | null;
    dueDate: Date | null;
    commissionExpectedAmount: unknown;
    commissionReleasedAmount: unknown;
    receivedAmount: unknown | null;
  }>;
}): ExclusionReprocessRecordInput {
  return {
    recordId: record.id,
    orderCode: record.orderCode,
    nfeNumber: record.nfeNumber,
    nomusNfeId: record.nomusNfeId,
    customerExternalId: record.customerExternalId,
    customerName: record.customerName,
    commissionPersonId: record.commissionPersonId,
    commissionPersonName: record.commissionPerson.name,
    status: record.status,
    originStage: record.originStage,
    baseAmount: decimalToNumber(record.baseAmount),
    ratePercent: decimalToNumber(record.ratePercent),
    commissionAmount: decimalToNumber(record.commissionAmount),
    releasedAmount: decimalToNumber(record.releasedAmount),
    paidAmount: decimalToNumber(record.paidAmount),
    confirmedAt: record.confirmedAt,
    calculatedAt: record.calculatedAt,
    metadataJson: record.metadataJson,
    schedules: record.paymentSchedules.map((schedule) => ({
      id: schedule.id,
      nomusReceivableId: schedule.nomusReceivableId,
      dueDate: schedule.dueDate,
      settlementDate: null,
      commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
      commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
      receivedAmount:
        schedule.receivedAmount != null
          ? decimalToNumber(schedule.receivedAmount)
          : null,
    })),
  };
}

async function loadReceivableSettlementMap(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  receivableIds: number[]
): Promise<Map<number, Date | null>> {
  if (receivableIds.length === 0) return new Map();
  const rows = await db.nomusAccountsReceivable.findMany({
    where: { externalId: { in: receivableIds } },
    select: { externalId: true, settlementDate: true },
  });
  return new Map(rows.map((row) => [row.externalId, row.settlementDate]));
}

function attachSettlementDates(
  records: ExclusionReprocessRecordInput[],
  settlementMap: Map<number, Date | null>
): ExclusionReprocessRecordInput[] {
  return records.map((record) => ({
    ...record,
    schedules: record.schedules.map((schedule) => ({
      ...schedule,
      settlementDate:
        schedule.nomusReceivableId != null
          ? settlementMap.get(schedule.nomusReceivableId) ?? null
          : null,
    })),
  }));
}

function buildCustomerRecordWhere(
  filter: ExclusionReprocessCustomerFilter
): Prisma.CommissionRecordWhereInput {
  const parts: Prisma.CommissionRecordWhereInput[] = [];
  if (filter.customerExternalId != null) {
    parts.push({ customerExternalId: filter.customerExternalId });
  }
  if (filter.customerName) {
    parts.push({
      customerName: { contains: filter.customerName, mode: "insensitive" },
    });
  }
  return parts.length === 1 ? parts[0]! : { OR: parts };
}

export async function loadExclusionReprocessRecords(
  db: PrismaClient,
  input: {
    customerFilter: ExclusionReprocessCustomerFilter;
    dateRange: ExclusionReprocessDateRange;
  }
): Promise<ExclusionReprocessRecordInput[]> {
  const records = await db.commissionRecord.findMany({
    where: {
      AND: [
        activeCommissionRecordWhere(),
        buildCustomerRecordWhere(input.customerFilter),
        {
          OR: [
            { confirmedAt: { gte: input.dateRange.from, lte: input.dateRange.to } },
            {
              AND: [
                { confirmedAt: null },
                { calculatedAt: { gte: input.dateRange.from, lte: input.dateRange.to } },
              ],
            },
          ],
        },
      ],
    },
    include: {
      commissionPerson: { select: { name: true } },
      paymentSchedules: {
        orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { orderCode: "asc" }],
  });

  const mapped = records.map(mapRecordRow);
  const receivableIds = [
    ...new Set(
      mapped.flatMap((record) =>
        record.schedules
          .map((schedule) => schedule.nomusReceivableId)
          .filter((id): id is number => id != null)
      )
    ),
  ];
  const settlementMap = await loadReceivableSettlementMap(db, receivableIds);
  const withSettlement = attachSettlementDates(mapped, settlementMap);

  return withSettlement.filter((record) => {
    if (!recordMatchesCustomerFilter(record, input.customerFilter)) return false;
    const { date } = resolveRecordEligibilityReferenceDate(record);
    return (
      date.getTime() >= input.dateRange.from.getTime() &&
      date.getTime() <= input.dateRange.to.getTime()
    );
  });
}

export async function loadActiveExclusionRulesForFilter(
  db: PrismaClient,
  filter: ExclusionReprocessCustomerFilter
): Promise<CustomerExclusionRuleSnapshot[]> {
  const rows = await db.commissionCustomerExclusionRule.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      customerId: true,
      customerExternalId: true,
      customerNameSnapshot: true,
      normalizedCustomerName: true,
      reason: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
      notes: true,
    },
  });
  return rows
    .map((row) => ({
      id: row.id,
      customerId: row.customerId,
      customerExternalId: row.customerExternalId,
      customerNameSnapshot: row.customerNameSnapshot,
      normalizedCustomerName: row.normalizedCustomerName,
      reason: row.reason,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      status: row.status,
      notes: row.notes,
    }))
    .filter((rule) => ruleMatchesCustomerFilter(rule, filter));
}

export async function loadClosedPaymentBatchMonths(
  db: PrismaClient,
  input: {
    sellerIds: string[];
    monthKeys: string[];
  }
): Promise<ClosedPaymentBatchMonth[]> {
  if (input.sellerIds.length === 0 || input.monthKeys.length === 0) return [];

  const monthBounds = input.monthKeys.map((key) => {
    const [yearRaw, monthRaw] = key.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    return {
      monthKey: key,
      from: new Date(Date.UTC(year, month - 1, 1)),
      to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  });

  const batches = await db.commissionPaymentBatch.findMany({
    where: {
      commissionPersonId: { in: input.sellerIds },
      status: { in: ["APPROVED", "PAID"] },
    },
    select: {
      id: true,
      commissionPersonId: true,
      status: true,
      periodStart: true,
      periodEnd: true,
    },
  });

  const closed: ClosedPaymentBatchMonth[] = [];
  for (const batch of batches) {
    for (const bound of monthBounds) {
      const overlaps =
        batch.periodStart.getTime() <= bound.to.getTime() &&
        batch.periodEnd.getTime() >= bound.from.getTime();
      if (!overlaps) continue;
      closed.push({
        monthKey: bound.monthKey,
        sellerId: batch.commissionPersonId,
        batchId: batch.id,
        batchStatus: batch.status as "APPROVED" | "PAID",
      });
    }
  }
  return closed;
}

export async function previewCustomerExclusionImpact(
  db: PrismaClient,
  input: {
    customerFilter: ExclusionReprocessCustomerFilter;
    dateRange: ExclusionReprocessDateRange;
    ruleId?: string | null;
  }
): Promise<ExclusionImpactPreview> {
  const settings = await loadCommissionSettings(db);
  const records = await loadExclusionReprocessRecords(db, input);

  const ruleSnapshot = input.ruleId
    ? await getCustomerExclusionRuleSnapshotById(input.ruleId)
    : null;
  const rules = ruleSnapshot
    ? [ruleSnapshot]
    : await loadActiveExclusionRulesForFilter(db, input.customerFilter);

  const monthKeys = [
    ...new Set(
      records.flatMap((record) =>
        record.schedules
          .map((schedule) =>
            schedule.settlementDate
              ? buildMonthKey(
                  schedule.settlementDate.getUTCFullYear(),
                  schedule.settlementDate.getUTCMonth() + 1
                )
              : null
          )
          .filter((key): key is string => key != null)
      )
    ),
  ];
  const sellerIds = [...new Set(records.map((record) => record.commissionPersonId))];
  const closedMonths = await loadClosedPaymentBatchMonths(db, {
    sellerIds,
    monthKeys,
  });

  return buildExclusionImpactPreview({
    customerFilter: input.customerFilter,
    dateRange: input.dateRange,
    rules,
    records,
    paidBlockAutoChange: settings.paidCommissionBlockAutoChange,
    closedMonths,
  });
}

async function applyExclusionToRecord(
  db: PrismaClient,
  recordId: string,
  rule: CustomerExclusionRuleSnapshot,
  paidBlockAutoChange: boolean
): Promise<ExclusionReprocessApplyLineResult> {
  const record = await db.commissionRecord.findUnique({
    where: { id: recordId },
    include: {
      paymentSchedules: true,
    },
  });
  if (!record) {
    return {
      recordId,
      orderCode: null,
      applied: false,
      skippedReason: "Registro não encontrado.",
    };
  }

  if (shouldBlockAutoChangePaidRecord(record.status, paidBlockAutoChange)) {
    return {
      recordId,
      orderCode: record.orderCode,
      applied: false,
      skippedReason: "Registro pago bloqueado para alteração automática.",
    };
  }

  const reference = resolveRecordEligibilityReferenceDate(record);
  const exclusion = resolveCustomerExclusionForSale({
    customerExternalId: record.customerExternalId,
    customerName: record.customerName,
    referenceDate: reference.date,
    rules: [rule],
  });
  if (!exclusion || exclusion.rule.id !== rule.id) {
    return {
      recordId,
      orderCode: record.orderCode,
      applied: false,
      skippedReason: "Regra não aplicável na data de referência do registro.",
    };
  }

  const meta = parseCustomerExclusionFromMetadata(record.metadataJson);
  const originalRate = meta.originalRatePercent ?? decimalToNumber(record.ratePercent);
  const originalCommission =
    meta.originalCommissionAmount ?? decimalToNumber(record.commissionAmount);
  const applied = applyCustomerExclusionToCommission({
    exclusion,
    ratePercent: originalRate,
    commissionAmount: originalCommission,
  });

  const currentCommission = decimalToNumber(record.commissionAmount);
  if (
    meta.customerExcluded &&
    Math.abs(currentCommission) < 0.005 &&
    Math.abs(decimalToNumber(record.ratePercent)) < 0.0001
  ) {
    return {
      recordId,
      orderCode: record.orderCode,
      applied: false,
      skippedReason: "Comissão já zerada para este registro.",
    };
  }

  const mergedMetadata = {
    ...(record.metadataJson && typeof record.metadataJson === "object"
      ? (record.metadataJson as Record<string, unknown>)
      : {}),
    ...applied.metadataPatch,
    customerExclusionReprocessedAt: new Date().toISOString(),
    customerExclusionReprocessRuleId: rule.id,
  };

  await db.commissionRecord.update({
    where: { id: recordId },
    data: {
      ratePercent: toPrismaDecimal(applied.ratePercent),
      commissionAmount: toPrismaDecimal(applied.commissionAmount),
      metadataJson: mergedMetadata as Prisma.InputJsonValue,
    },
  });

  for (const schedule of record.paymentSchedules) {
    await db.commissionPaymentSchedule.update({
      where: { id: schedule.id },
      data: {
        commissionExpectedAmount: toPrismaDecimal(0),
        commissionReleasedAmount: toPrismaDecimal(0),
        status: schedule.source === "ACCOUNTS_RECEIVABLE" ? "ACTIVE" : schedule.status,
      },
    });
  }

  const refreshed = await db.commissionRecord.findUnique({
    where: { id: recordId },
    include: { paymentSchedules: true },
  });
  if (!refreshed) {
    return {
      recordId,
      orderCode: record.orderCode,
      applied: true,
      skippedReason: null,
    };
  }

  const settings = await loadCommissionSettings(db);
  const releaseRule = resolveEffectiveReleaseRule(refreshed.releaseRule, settings);
  const recomputed = recomputeCommissionRecordRelease({
    releaseRule,
    commissionAmount: 0,
    paidAmount: decimalToNumber(refreshed.paidAmount),
    receivableAsDefinitiveReleaseSource: settings.receivableAsDefinitiveReleaseSource,
    schedules: refreshed.paymentSchedules.map((schedule) => ({
      id: schedule.id,
      commissionExpectedAmount: 0,
      receivableAmount: decimalToNumber(schedule.receivableAmount),
      receivedAmount: decimalToNumber(schedule.receivedAmount),
      receivable:
        schedule.nomusReceivableId != null
          ? {
              amountReceivable: decimalToNumber(schedule.receivableAmount),
              dueDate: schedule.dueDate,
              amountReceived: decimalToNumber(schedule.receivedAmount),
              balanceReceivable: decimalToNumber(schedule.openBalance),
              settlementDate: null,
            }
          : null,
    })),
  });

  for (const scheduleUpdate of recomputed.scheduleUpdates) {
    await db.commissionPaymentSchedule.update({
      where: { id: scheduleUpdate.id },
      data: {
        commissionReleasedAmount: toPrismaDecimal(scheduleUpdate.commissionReleasedAmount),
        status: scheduleUpdate.scheduleStatus,
      },
    });
  }

  await db.commissionRecord.update({
    where: { id: recordId },
    data: {
      releasedAmount: toPrismaDecimal(recomputed.releasedAmount),
      status: recomputed.status,
      balanceAmount: toPrismaDecimal(
        computeBalanceAfterRelease(
          0,
          recomputed.releasedAmount,
          decimalToNumber(refreshed.paidAmount)
        )
      ),
      releasedAt: recomputed.releasedAmount > 0 ? refreshed.releasedAt : null,
    },
  });

  return {
    recordId,
    orderCode: record.orderCode,
    applied: true,
    skippedReason: null,
  };
}

export async function applyCustomerExclusionReprocess(
  db: PrismaClient,
  input: {
    ruleId: string;
    dateRange: ExclusionReprocessDateRange;
    mode: ExclusionReprocessMode;
    skipClosedMonths: boolean;
  }
): Promise<ExclusionReprocessApplyResult> {
  const rule = await getCustomerExclusionRuleSnapshotById(input.ruleId);
  if (!rule) {
    throw new Error(`Regra de exclusão não encontrada: ${input.ruleId}`);
  }

  const customerFilter: ExclusionReprocessCustomerFilter = {
    customerName: rule.customerNameSnapshot,
    customerExternalId: rule.customerExternalId,
  };

  const preview = await previewCustomerExclusionImpact(db, {
    customerFilter,
    dateRange: input.dateRange,
    ruleId: input.ruleId,
  });

  const monthKeys = [
    ...new Set(preview.lines.flatMap((line) => line.settlementMonthKeys)),
  ];
  const sellerIds = [...new Set(preview.lines.map((line) => line.sellerId))];
  const closedMonths = await loadClosedPaymentBatchMonths(db, {
    sellerIds,
    monthKeys,
  });

  const safety = evaluateExclusionReprocessSafety({
    preview,
    mode: input.mode,
    skipClosedMonths: input.skipClosedMonths,
    closedMonths,
    ruleId: input.ruleId,
  });

  if (input.mode === "dry-run") {
    return {
      dryRun: true,
      runId: null,
      ruleId: input.ruleId,
      dateRange: input.dateRange,
      warnings: safety.warnings,
      blockers: safety.blockers,
      safe: safety.safe,
      preview,
      applied: [],
      auditIssuesCreated: 0,
    };
  }

  if (!safety.safe) {
    return {
      dryRun: false,
      runId: null,
      ruleId: input.ruleId,
      dateRange: input.dateRange,
      warnings: safety.warnings,
      blockers: safety.blockers,
      safe: false,
      preview,
      applied: [],
      auditIssuesCreated: 0,
    };
  }

  const settings = await loadCommissionSettings(db);
  const run = await db.commissionCalculationRun.create({
    data: {
      periodStart: input.dateRange.from,
      periodEnd: input.dateRange.to,
      mode: "FULL_RECALC",
      status: "RUNNING",
    },
  });

  const closedMonthKeys = new Set(closedMonths.map((m) => m.monthKey));
  const applied: ExclusionReprocessApplyLineResult[] = [];
  let appliedCount = 0;

  try {
    for (const line of preview.lines) {
      if (!line.wouldChange) {
        applied.push({
          recordId: line.recordId,
          orderCode: line.orderCode,
          applied: false,
          skippedReason: line.alreadyExcluded
            ? "Comissão já zerada."
            : "Sem diferença a aplicar.",
        });
        continue;
      }

      if (
        input.skipClosedMonths &&
        line.settlementMonthKeys.some((key) => closedMonthKeys.has(key))
      ) {
        applied.push({
          recordId: line.recordId,
          orderCode: line.orderCode,
          applied: false,
          skippedReason: "Mês com lote APPROVED/PAID (--skip-closed-months).",
        });
        continue;
      }

      const result = await applyExclusionToRecord(
        db,
        line.recordId,
        rule,
        settings.paidCommissionBlockAutoChange
      );
      applied.push(result);
      if (result.applied) appliedCount += 1;
    }

    const auditIssuesCreated = await upsertCommissionAuditIssues(db, [
      {
        issueKey: buildAuditIssueKey({
          type: "MANUAL_REVIEW_REQUIRED",
          entityType: "CommissionCustomerExclusionRule",
          entityId: input.ruleId,
        }),
        severity: "INFO",
        type: "MANUAL_REVIEW_REQUIRED",
        entityType: "CommissionCustomerExclusionRule",
        entityId: input.ruleId,
        message: `Reprocessamento de exclusão por cliente aplicado (${appliedCount} registro(s)).`,
        metadataJson: {
          runId: run.id,
          ruleId: input.ruleId,
          dateRange: input.dateRange.label,
          appliedCount,
          skippedCount: applied.filter((row) => !row.applied).length,
        },
      },
    ]);

    await db.commissionCalculationRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        commissionsUpdated: appliedCount,
        finishedAt: new Date(),
        summaryJson: {
          kind: "CUSTOMER_EXCLUSION_REPROCESS",
          ruleId: input.ruleId,
          appliedCount,
          skippedCount: applied.filter((row) => !row.applied).length,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      dryRun: false,
      runId: run.id,
      ruleId: input.ruleId,
      dateRange: input.dateRange,
      warnings: safety.warnings,
      blockers: [],
      safe: true,
      preview,
      applied,
      auditIssuesCreated,
    };
  } catch (err) {
    await db.commissionCalculationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorsCount: 1,
        finishedAt: new Date(),
        summaryJson: {
          kind: "CUSTOMER_EXCLUSION_REPROCESS",
          error: err instanceof Error ? err.message : String(err),
        } as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}

export function summarizeSettlementMonthKeys(
  lines: ExclusionImpactPreview["lines"]
): string[] {
  return [...new Set(lines.flatMap((line) => line.settlementMonthKeys))].sort();
}

export function monthKeyFromSettlementDate(value: Date): string {
  return buildMonthKey(value.getUTCFullYear(), value.getUTCMonth() + 1);
}

// Re-export simulate for tests with in-memory records
export { simulateExclusionImpactLine };
