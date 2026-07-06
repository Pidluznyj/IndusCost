import type { PrismaClient } from "@prisma/client";
import {
  buildCustomerExclusionAuditReport,
  type CustomerExclusionAuditReport,
} from "./commissionCustomerExclusionAudit.js";
import { parseCustomerExclusionFromMetadata } from "./commissionCustomerExclusionApply.js";
import {
  loadActiveExclusionRulesForFilter,
  loadExclusionReprocessRecords,
  previewCustomerExclusionImpact,
} from "./commissionCustomerExclusionReprocess.server.js";
import type {
  ExclusionReprocessCustomerFilter,
  ExclusionReprocessDateRange,
} from "./commissionCustomerExclusionReprocess.js";
import { roundMoney } from "./commission-money.js";

function buildReceivedByRecordId(
  records: Awaited<ReturnType<typeof loadExclusionReprocessRecords>>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const record of records) {
    let received = 0;
    for (const schedule of record.schedules) {
      received = roundMoney(received + (schedule.receivedAmount ?? 0));
    }
    map.set(record.recordId, received);
  }
  return map;
}

function enrichPreviewWithOriginalCommission(
  preview: Awaited<ReturnType<typeof previewCustomerExclusionImpact>>,
  records: Awaited<ReturnType<typeof loadExclusionReprocessRecords>>
): Awaited<ReturnType<typeof previewCustomerExclusionImpact>> {
  const recordById = new Map(records.map((record) => [record.recordId, record]));
  return {
    ...preview,
    lines: preview.lines.map((line) => {
      if (line.wouldChange) return line;
      const record = recordById.get(line.recordId);
      if (!record) return line;
      const meta = parseCustomerExclusionFromMetadata(record.metadataJson);
      if (meta.originalCommissionAmount == null) return line;
      const original = meta.originalCommissionAmount;
      return {
        ...line,
        currentCommissionAmount: record.commissionAmount,
        commissionDiff: roundMoney(line.afterCommissionAmount - record.commissionAmount),
      };
    }),
  };
}

export async function auditCustomerCommissionExclusion(
  db: PrismaClient,
  input: {
    customerFilter: ExclusionReprocessCustomerFilter;
    dateRange: ExclusionReprocessDateRange;
  }
): Promise<CustomerExclusionAuditReport> {
  const [previewRaw, records, rules] = await Promise.all([
    previewCustomerExclusionImpact(db, {
      customerFilter: input.customerFilter,
      dateRange: input.dateRange,
    }),
    loadExclusionReprocessRecords(db, input),
    loadActiveExclusionRulesForFilter(db, input.customerFilter),
  ]);

  const preview = enrichPreviewWithOriginalCommission(previewRaw, records);
  const receivedByRecordId = buildReceivedByRecordId(records);

  return buildCustomerExclusionAuditReport({
    preview,
    rules,
    receivedByRecordId,
  });
}
