/**
 * Conciliação da prévia por recebimento vs relatório oficial Nomus.
 * Lógica pura — separa exclusões internas antes de comparar totais.
 */
import { roundMoney } from "./commission-money.js";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";

export type ExcludedCustomerReconciliationRow = {
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  lineCount: number;
  receivedAmount: number;
  excludedBase: number;
  excludedCommission: number;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
};

export type ReceivableIssueRow = {
  nomusReceivableId: number;
  receivableNumber: string | null;
  installmentNumber: number | null;
  customerName: string | null;
  settlementDate: string | null;
  receivedAmount: number;
  status: string;
  statusReason: string | null;
};

export type DuplicateReceivedRow = {
  nomusReceivableId: number;
  receivableNumber: string | null;
  lineCount: number;
  receivedAmountPerLine: number;
  totalReceivedIfSummed: number;
  excessReceived: number;
};

export type NomusReceiptReconciliationReport = {
  nomusBase: number | null;
  nomusCommission: number | null;
  indusCostBaseBeforeExclusions: number;
  indusCostCommissionBeforeExclusions: number;
  diffBaseBeforeExclusions: number | null;
  diffCommissionBeforeExclusions: number | null;
  excludedCustomers: ExcludedCustomerReconciliationRow[];
  excludedBaseTotal: number;
  excludedCommissionTotal: number;
  indusCostFinalCommission: number;
  indusCostFinalBase: number;
  diffCommissionFinal: number | null;
  diffBaseFinal: number | null;
  divergentReceivableCodes: ReceivableIssueRow[];
  receivablesWithoutSchedule: ReceivableIssueRow[];
  staleSchedules: ReceivableIssueRow[];
  duplicateReceived: DuplicateReceivedRow[];
  uniqueReceivablesCount: number;
  ruleLineCount: number;
  groupCompanyExcludedReceivables: ReceivableIssueRow[];
  groupCompanyExcludedReceivedTotal: number;
  indusCostMarketReceivedTotal: number;
};

function lineGrossCommission(line: CommissionReceiptPreviewLine): number {
  if (line.grossCommissionAmount != null && line.grossCommissionAmount > 0) {
    return roundMoney(line.grossCommissionAmount);
  }
  if (line.status === "COMMISSIONABLE") {
    return roundMoney(line.releasedCommissionAmount);
  }
  return 0;
}

function sumReceivedByUniqueReceivable(lines: CommissionReceiptPreviewLine[]): number {
  const seen = new Set<number>();
  let total = 0;
  for (const line of lines) {
    if (seen.has(line.nomusReceivableId)) continue;
    seen.add(line.nomusReceivableId);
    total = roundMoney(total + line.receivedAmount);
  }
  return total;
}

function sumBaseByRuleLine(lines: CommissionReceiptPreviewLine[]): number {
  return roundMoney(
    lines.reduce((sum, line) => roundMoney(sum + line.commissionableBaseAmount), 0)
  );
}

function sumCommissionByRuleLine(lines: CommissionReceiptPreviewLine[]): number {
  return roundMoney(
    lines.reduce((sum, line) => roundMoney(sum + line.releasedCommissionAmount), 0)
  );
}

export function buildExcludedCustomerRows(
  lines: CommissionReceiptPreviewLine[]
): ExcludedCustomerReconciliationRow[] {
  const map = new Map<string, ExcludedCustomerReconciliationRow>();
  const seenReceivable = new Set<string>();

  for (const line of lines) {
    if (line.status !== "CUSTOMER_EXCLUDED") continue;

    const key = line.customerId ?? String(line.customerExternalId ?? line.customerName ?? "—");
    const receivableKey = `${line.nomusReceivableId}|${line.installmentNumber ?? 0}`;
    const row = map.get(key) ?? {
      customerId: line.customerId,
      customerExternalId: line.customerExternalId,
      customerName: line.customerName,
      lineCount: 0,
      receivedAmount: 0,
      excludedBase: 0,
      excludedCommission: 0,
      exclusionRuleId: line.exclusionRuleId,
      exclusionReason: line.exclusionReason ?? line.statusReason,
    };

    row.lineCount += 1;
    row.excludedBase = roundMoney(row.excludedBase + line.commissionableBaseAmount);
    row.excludedCommission = roundMoney(row.excludedCommission + lineGrossCommission(line));

    if (!seenReceivable.has(`${key}|${receivableKey}`)) {
      seenReceivable.add(`${key}|${receivableKey}`);
      row.receivedAmount = roundMoney(row.receivedAmount + line.receivedAmount);
    }

    map.set(key, row);
  }

  return [...map.values()].sort((a, b) => b.excludedCommission - a.excludedCommission);
}

export function detectDuplicateReceived(
  lines: CommissionReceiptPreviewLine[]
): DuplicateReceivedRow[] {
  const byReceivable = new Map<number, CommissionReceiptPreviewLine[]>();
  for (const line of lines) {
    const list = byReceivable.get(line.nomusReceivableId) ?? [];
    list.push(line);
    byReceivable.set(line.nomusReceivableId, list);
  }

  const duplicates: DuplicateReceivedRow[] = [];
  for (const [nomusReceivableId, group] of byReceivable) {
    if (group.length <= 1) continue;
    const receivedPerLine = group[0]?.receivedAmount ?? 0;
    const allSameReceived = group.every(
      (line) => roundMoney(line.receivedAmount) === roundMoney(receivedPerLine)
    );
    if (!allSameReceived || receivedPerLine <= 0) continue;

    const totalIfSummed = roundMoney(receivedPerLine * group.length);
    const excess = roundMoney(totalIfSummed - receivedPerLine);
    if (excess <= 0) continue;

    duplicates.push({
      nomusReceivableId,
      receivableNumber: group[0]?.receivableNumber ?? null,
      lineCount: group.length,
      receivedAmountPerLine: receivedPerLine,
      totalReceivedIfSummed: totalIfSummed,
      excessReceived: excess,
    });
  }

  return duplicates.sort((a, b) => b.excessReceived - a.excessReceived);
}

function toReceivableIssueRow(line: CommissionReceiptPreviewLine): ReceivableIssueRow {
  return {
    nomusReceivableId: line.nomusReceivableId,
    receivableNumber: line.receivableNumber,
    installmentNumber: line.installmentNumber,
    customerName: line.customerName,
    settlementDate: line.settlementDate,
    receivedAmount: line.receivedAmount,
    status: line.status,
    statusReason: line.statusReason ?? line.exclusionReason,
  };
}

function uniqueReceivableIssues(
  lines: CommissionReceiptPreviewLine[],
  predicate: (line: CommissionReceiptPreviewLine) => boolean
): ReceivableIssueRow[] {
  const seen = new Set<number>();
  const rows: ReceivableIssueRow[] = [];
  for (const line of lines) {
    if (!predicate(line) || seen.has(line.nomusReceivableId)) continue;
    seen.add(line.nomusReceivableId);
    rows.push(toReceivableIssueRow(line));
  }
  return rows;
}

const DIVERGENT_STATUSES = new Set([
  "NO_SALES_LINK",
  "NO_SCHEDULE",
  "NO_SELLER",
  "SELLER_UNRESOLVED",
  "NO_RULE",
  "STALE_SCHEDULE",
  "ERROR",
  "ZERO_AMOUNT",
]);

export function buildNomusReceiptReconciliationReport(input: {
  lines: CommissionReceiptPreviewLine[];
  nomusBase: number | null;
  nomusCommission: number | null;
}): NomusReceiptReconciliationReport {
  const commissionableLines = input.lines.filter((line) => line.status === "COMMISSIONABLE");
  const excludedLines = input.lines.filter((line) => line.status === "CUSTOMER_EXCLUDED");
  const groupCompanyLines = input.lines.filter((line) => line.status === "GROUP_COMPANY_EXCLUDED");
  const operationalLines = [...commissionableLines, ...excludedLines];

  const indusCostFinalBase = sumBaseByRuleLine(commissionableLines);
  const indusCostFinalCommission = sumCommissionByRuleLine(commissionableLines);

  const groupCompanyExcludedReceivables = uniqueReceivableIssues(
    input.lines,
    (line) => line.status === "GROUP_COMPANY_EXCLUDED"
  );
  const groupCompanyExcludedReceivedTotal = sumReceivedByUniqueReceivable(groupCompanyLines);
  const indusCostMarketReceivedTotal = sumReceivedByUniqueReceivable(
    input.lines.filter((line) => line.status !== "GROUP_COMPANY_EXCLUDED")
  );

  const excludedCustomers = buildExcludedCustomerRows(input.lines);
  const excludedBaseTotal = roundMoney(
    excludedCustomers.reduce((sum, row) => roundMoney(sum + row.excludedBase), 0)
  );
  const excludedCommissionTotal = roundMoney(
    excludedCustomers.reduce((sum, row) => roundMoney(sum + row.excludedCommission), 0)
  );

  const indusCostBaseBeforeExclusions = roundMoney(
    indusCostFinalBase + excludedBaseTotal
  );
  const indusCostCommissionBeforeExclusions = roundMoney(
    indusCostFinalCommission + excludedCommissionTotal
  );

  const uniqueReceivableIds = new Set(input.lines.map((line) => line.nomusReceivableId));

  return {
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
    indusCostBaseBeforeExclusions,
    indusCostCommissionBeforeExclusions,
    diffBaseBeforeExclusions:
      input.nomusBase != null
        ? roundMoney(indusCostBaseBeforeExclusions - input.nomusBase)
        : null,
    diffCommissionBeforeExclusions:
      input.nomusCommission != null
        ? roundMoney(indusCostCommissionBeforeExclusions - input.nomusCommission)
        : null,
    excludedCustomers,
    excludedBaseTotal,
    excludedCommissionTotal,
    indusCostFinalCommission,
    indusCostFinalBase,
    diffCommissionFinal:
      input.nomusCommission != null
        ? roundMoney(indusCostFinalCommission - input.nomusCommission)
        : null,
    diffBaseFinal:
      input.nomusBase != null
        ? roundMoney(indusCostMarketReceivedTotal - input.nomusBase)
        : null,
    divergentReceivableCodes: uniqueReceivableIssues(input.lines, (line) =>
      DIVERGENT_STATUSES.has(line.status)
    ),
    receivablesWithoutSchedule: uniqueReceivableIssues(
      input.lines,
      (line) => line.status === "NO_SCHEDULE"
    ),
    staleSchedules: uniqueReceivableIssues(
      input.lines,
      (line) => line.status === "STALE_SCHEDULE"
    ),
    duplicateReceived: detectDuplicateReceived(input.lines),
    uniqueReceivablesCount: uniqueReceivableIds.size,
    ruleLineCount: input.lines.length,
    groupCompanyExcludedReceivables,
    groupCompanyExcludedReceivedTotal,
    indusCostMarketReceivedTotal,
  };
}

export function formatNomusReconciliationCsvSummary(
  reconciliation: NomusReceiptReconciliationReport
): string[] {
  const rows = [
    "# nomus_reconciliation",
    `nomus_base,${reconciliation.nomusBase?.toFixed(2) ?? ""}`,
    `nomus_commission,${reconciliation.nomusCommission?.toFixed(2) ?? ""}`,
    `indus_base_before_exclusions,${reconciliation.indusCostBaseBeforeExclusions.toFixed(2)}`,
    `indus_commission_before_exclusions,${reconciliation.indusCostCommissionBeforeExclusions.toFixed(2)}`,
    `diff_base_before_exclusions,${reconciliation.diffBaseBeforeExclusions?.toFixed(2) ?? ""}`,
    `diff_commission_before_exclusions,${reconciliation.diffCommissionBeforeExclusions?.toFixed(2) ?? ""}`,
    `excluded_base_total,${reconciliation.excludedBaseTotal.toFixed(2)}`,
    `excluded_commission_total,${reconciliation.excludedCommissionTotal.toFixed(2)}`,
    `excluded_customers_count,${reconciliation.excludedCustomers.length}`,
    `indus_final_commission,${reconciliation.indusCostFinalCommission.toFixed(2)}`,
    `indus_final_base,${reconciliation.indusCostFinalBase.toFixed(2)}`,
    `diff_commission_final,${reconciliation.diffCommissionFinal?.toFixed(2) ?? ""}`,
    `diff_base_final,${reconciliation.diffBaseFinal?.toFixed(2) ?? ""}`,
    `divergent_receivables_count,${reconciliation.divergentReceivableCodes.length}`,
    `no_schedule_count,${reconciliation.receivablesWithoutSchedule.length}`,
    `stale_schedule_count,${reconciliation.staleSchedules.length}`,
    `duplicate_received_count,${reconciliation.duplicateReceived.length}`,
    `unique_receivables,${reconciliation.uniqueReceivablesCount}`,
    `rule_lines,${reconciliation.ruleLineCount}`,
    `group_company_excluded_count,${reconciliation.groupCompanyExcludedReceivables.length}`,
    `group_company_excluded_received,${reconciliation.groupCompanyExcludedReceivedTotal.toFixed(2)}`,
    `indus_market_received_total,${reconciliation.indusCostMarketReceivedTotal.toFixed(2)}`,
    "",
  ];

  if (reconciliation.excludedCustomers.length > 0) {
    rows.push(
      "# excluded_customers",
      "customerName,customerExternalId,lineCount,receivedAmount,excludedBase,excludedCommission,exclusionReason"
    );
    for (const row of reconciliation.excludedCustomers) {
      rows.push(
        [
          row.customerName ?? "",
          row.customerExternalId ?? "",
          row.lineCount,
          row.receivedAmount.toFixed(2),
          row.excludedBase.toFixed(2),
          row.excludedCommission.toFixed(2),
          row.exclusionReason ?? "",
        ].join(",")
      );
    }
    rows.push("");
  }

  if (reconciliation.divergentReceivableCodes.length > 0) {
    rows.push(
      "# divergent_receivables",
      "nomusReceivableId,receivableNumber,status,receivedAmount,statusReason"
    );
    for (const row of reconciliation.divergentReceivableCodes) {
      rows.push(
        [
          row.nomusReceivableId,
          row.receivableNumber ?? "",
          row.status,
          row.receivedAmount.toFixed(2),
          row.statusReason ?? "",
        ].join(",")
      );
    }
  }

  return rows;
}
