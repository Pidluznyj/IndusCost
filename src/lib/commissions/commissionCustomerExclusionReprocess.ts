import { isPaidCommissionStatus } from "./commission-calculation-hash.js";
import {
  buildCustomerExclusionIdentity,
  exclusionRulesTargetSameCustomer,
  normalizeCustomerNameForExclusion,
  type CustomerExclusionRuleSnapshot,
} from "./commissionCustomerExclusion.js";
import {
  applyCustomerExclusionToCommission,
  parseCustomerExclusionFromMetadata,
  resolveCustomerExclusionForSale,
} from "./commissionCustomerExclusionApply.js";
import { buildMonthKey } from "./commissionMonthlyPayable.js";
import { roundMoney } from "./commission-money.js";
import { isInactiveCommissionRecordStatus } from "./commission-record-status.js";

export const MONTHLY_CLOSING_PERSISTENCE_WARNING =
  "Não existe fechamento mensal persistido; revise lotes de pagamento (CommissionPaymentBatch) antes de aplicar.";

export type ExclusionReprocessDateRange = {
  from: Date;
  to: Date;
  label: string;
};

export type ExclusionReprocessCustomerFilter = {
  customerName?: string | null;
  customerExternalId?: number | null;
};

export type ExclusionReprocessScheduleInput = {
  id: string;
  nomusReceivableId: number | null;
  dueDate: Date | null;
  /** Baixa administrativa do CR — sinal de movimento, não de competência. */
  settlementDate: Date | null;
  /** Data real do recebimento — define o mês afetado pela liberação. */
  receiptDate?: Date | null;
  commissionExpectedAmount: number;
  commissionReleasedAmount: number;
  receivedAmount: number | null;
};

export type ExclusionReprocessRecordInput = {
  recordId: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  customerExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  status: string;
  originStage: string;
  baseAmount: number;
  ratePercent: number;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  confirmedAt: Date | null;
  calculatedAt: Date;
  metadataJson: unknown;
  schedules: ExclusionReprocessScheduleInput[];
};

export type ExclusionImpactLine = {
  recordId: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableIds: number[];
  customerName: string | null;
  sellerId: string;
  sellerName: string;
  status: string;
  referenceDate: string;
  referenceDateKind: "nfe" | "order";
  settlementMonthKeys: string[];
  dueMonthKeys: string[];
  baseAmount: number;
  currentRatePercent: number;
  currentCommissionAmount: number;
  currentReleasedAmount: number;
  currentPaidAmount: number;
  afterRatePercent: number;
  afterCommissionAmount: number;
  afterReleasedAmount: number;
  commissionDiff: number;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
  alreadyExcluded: boolean;
  paidBlocked: boolean;
  titleCategory: "settled" | "open" | "future" | "forecast";
  wouldChange: boolean;
};

export type ExclusionImpactMonthBucket = {
  monthKey: string;
  lineCount: number;
  currentCommission: number;
  afterCommission: number;
  commissionDiff: number;
  currentReleased: number;
  afterReleased: number;
};

export type ExclusionImpactSellerBucket = {
  sellerId: string;
  sellerName: string;
  lineCount: number;
  currentCommission: number;
  afterCommission: number;
  commissionDiff: number;
};

export type ExclusionImpactPreview = {
  dryRun: true;
  customerFilter: ExclusionReprocessCustomerFilter;
  dateRange: ExclusionReprocessDateRange;
  ruleIds: string[];
  warnings: string[];
  ordersAffected: number;
  nfesAffected: number;
  receivablesAffected: number;
  sellersAffected: number;
  lines: ExclusionImpactLine[];
  totals: {
    currentCommission: number;
    afterCommission: number;
    commissionDiff: number;
    currentReleased: number;
    afterReleased: number;
    paidBlockedCount: number;
    wouldChangeCount: number;
  };
  bySettlementMonth: ExclusionImpactMonthBucket[];
  byReferenceMonth: ExclusionImpactMonthBucket[];
  bySeller: ExclusionImpactSellerBucket[];
  closedMonths: string[];
};

export type ClosedPaymentBatchMonth = {
  monthKey: string;
  sellerId: string;
  batchId: string;
  batchStatus: "APPROVED" | "PAID";
};

export type ExclusionReprocessApplyLineResult = {
  recordId: string;
  orderCode: string | null;
  applied: boolean;
  skippedReason: string | null;
};

export type ExclusionReprocessApplyResult = {
  dryRun: boolean;
  runId: string | null;
  ruleId: string;
  dateRange: ExclusionReprocessDateRange;
  warnings: string[];
  blockers: string[];
  safe: boolean;
  preview: ExclusionImpactPreview;
  applied: ExclusionReprocessApplyLineResult[];
  auditIssuesCreated: number;
};

export function parseExclusionReprocessDateRange(input: {
  from?: string | null;
  to?: string | null;
}): ExclusionReprocessDateRange {
  const fromRaw = input.from?.trim();
  const toRaw = input.to?.trim();
  if (!fromRaw || !toRaw) {
    throw new Error("Informe --from=YYYY-MM-DD e --to=YYYY-MM-DD.");
  }
  const from = new Date(`${fromRaw}T00:00:00`);
  const to = new Date(`${toRaw}T23:59:59.999`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Datas inválidas em --from ou --to. Use YYYY-MM-DD.");
  }
  if (from.getTime() > to.getTime()) {
    throw new Error("--from não pode ser posterior a --to.");
  }
  return { from, to, label: `${fromRaw} a ${toRaw}` };
}

export function parseExclusionReprocessCustomerFilter(input: {
  customer?: string | null;
  customerExternalId?: string | null;
}): ExclusionReprocessCustomerFilter {
  const customerName = input.customer?.trim() || null;
  const externalRaw = input.customerExternalId?.trim();
  const customerExternalId =
    externalRaw != null && externalRaw.length > 0 ? Number(externalRaw) : null;
  if (customerExternalId != null && !Number.isFinite(customerExternalId)) {
    throw new Error("--customerExternalId inválido.");
  }
  if (!customerName && customerExternalId == null) {
    throw new Error("Informe --customer e/ou --customerExternalId.");
  }
  return { customerName, customerExternalId };
}

export type ExclusionReprocessMode = "dry-run" | "apply";

export function parseExclusionReprocessMode(flags: {
  apply?: boolean;
  dryRun?: boolean;
}): ExclusionReprocessMode {
  if (flags.apply && flags.dryRun) {
    throw new Error("Use apenas um modo: --dry-run ou --apply.");
  }
  return flags.apply ? "apply" : "dry-run";
}

export function resolveRecordEligibilityReferenceDate(record: {
  confirmedAt: Date | null;
  nomusNfeId: number | null;
  originStage: string;
  calculatedAt: Date;
  metadataJson: unknown;
}): { date: Date; kind: "nfe" | "order" } {
  if (record.confirmedAt) {
    return { date: record.confirmedAt, kind: "nfe" };
  }
  if (record.nomusNfeId != null && record.confirmedAt) {
    return { date: record.confirmedAt, kind: "nfe" };
  }
  const meta =
    record.metadataJson && typeof record.metadataJson === "object"
      ? (record.metadataJson as Record<string, unknown>)
      : null;
  const issueDateRaw = meta?.orderIssueDate ?? meta?.issueDate;
  if (typeof issueDateRaw === "string" && issueDateRaw.trim()) {
    const parsed = new Date(issueDateRaw);
    if (!Number.isNaN(parsed.getTime())) {
      return { date: parsed, kind: "order" };
    }
  }
  return { date: record.calculatedAt, kind: "order" };
}

export function recordMatchesCustomerFilter(
  record: Pick<ExclusionReprocessRecordInput, "customerExternalId" | "customerName">,
  filter: ExclusionReprocessCustomerFilter
): boolean {
  if (
    filter.customerExternalId != null &&
    record.customerExternalId === filter.customerExternalId
  ) {
    return true;
  }
  if (filter.customerName) {
    const target = normalizeCustomerNameForExclusion(filter.customerName);
    const recordName = normalizeCustomerNameForExclusion(record.customerName);
    if (target && recordName === target) return true;
    if (
      record.customerName?.toLowerCase().includes(filter.customerName.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export function ruleMatchesCustomerFilter(
  rule: CustomerExclusionRuleSnapshot,
  filter: ExclusionReprocessCustomerFilter
): boolean {
  const identity = buildCustomerExclusionIdentity({
    customerId: rule.customerId,
    customerExternalId: rule.customerExternalId,
    customerNameSnapshot: rule.customerNameSnapshot,
  });
  const filterIdentity = buildCustomerExclusionIdentity({
    customerExternalId: filter.customerExternalId,
    customerNameSnapshot: filter.customerName ?? "",
  });
  return exclusionRulesTargetSameCustomer(identity, filterIdentity);
}

function referenceDateInRange(date: Date, range: ExclusionReprocessDateRange): boolean {
  const t = date.getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

function monthKeyFromDate(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return buildMonthKey(value.getUTCFullYear(), value.getUTCMonth() + 1);
}

function uniqueMonthKeys(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v != null))].sort();
}

function resolveTitleCategory(
  schedules: ExclusionReprocessScheduleInput[],
  now: Date
): ExclusionImpactLine["titleCategory"] {
  if (schedules.length === 0) return "forecast";
  const nowMs = now.getTime();
  let hasSettled = false;
  let hasOpen = false;
  let hasFuture = false;
  for (const schedule of schedules) {
    const received = schedule.receivedAmount ?? 0;
    if (schedule.settlementDate || received > 0) {
      hasSettled = true;
      continue;
    }
    const dueMs = schedule.dueDate?.getTime() ?? null;
    if (dueMs != null && dueMs < nowMs) {
      hasOpen = true;
    } else {
      hasFuture = true;
    }
  }
  if (hasSettled) return "settled";
  if (hasOpen) return "open";
  if (hasFuture) return "future";
  return "forecast";
}

export function simulateExclusionImpactLine(input: {
  record: ExclusionReprocessRecordInput;
  rules: CustomerExclusionRuleSnapshot[];
  dateRange: ExclusionReprocessDateRange;
  paidBlockAutoChange: boolean;
  now?: Date;
}): ExclusionImpactLine | null {
  const { record, rules, dateRange } = input;
  if (isInactiveCommissionRecordStatus(record.status)) return null;

  const { date: referenceDate, kind } = resolveRecordEligibilityReferenceDate(record);
  if (!referenceDateInRange(referenceDate, dateRange)) return null;

  const exclusion = resolveCustomerExclusionForSale({
    customerExternalId: record.customerExternalId,
    customerName: record.customerName,
    referenceDate,
    rules,
  });
  if (!exclusion) return null;

  const meta = parseCustomerExclusionFromMetadata(record.metadataJson);
  const applied = applyCustomerExclusionToCommission({
    exclusion,
    ratePercent: meta.originalRatePercent ?? record.ratePercent,
    commissionAmount: meta.originalCommissionAmount ?? record.commissionAmount,
  });

  const commissionDiff = roundMoney(applied.commissionAmount - record.commissionAmount);
  const afterReleased = applied.excluded ? 0 : record.releasedAmount;
  const paidBlocked =
    input.paidBlockAutoChange && isPaidCommissionStatus(record.status);

  // Mês afetado pela liberação = mês do RECEBIMENTO real (nunca o da baixa).
  const settlementMonthKeys = uniqueMonthKeys(
    record.schedules.map((s) => monthKeyFromDate(s.receiptDate ?? null))
  );
  const dueMonthKeys = uniqueMonthKeys(
    record.schedules.map((s) => monthKeyFromDate(s.dueDate))
  );

  return {
    recordId: record.recordId,
    orderCode: record.orderCode,
    nfeNumber: record.nfeNumber,
    nomusReceivableIds: [
      ...new Set(
        record.schedules
          .map((s) => s.nomusReceivableId)
          .filter((id): id is number => id != null)
      ),
    ],
    customerName: record.customerName,
    sellerId: record.commissionPersonId,
    sellerName: record.commissionPersonName,
    status: record.status,
    referenceDate: referenceDate.toISOString().slice(0, 10),
    referenceDateKind: kind,
    settlementMonthKeys,
    dueMonthKeys,
    baseAmount: record.baseAmount,
    currentRatePercent: record.ratePercent,
    currentCommissionAmount: record.commissionAmount,
    currentReleasedAmount: record.releasedAmount,
    currentPaidAmount: record.paidAmount,
    afterRatePercent: applied.ratePercent,
    afterCommissionAmount: applied.commissionAmount,
    afterReleasedAmount: afterReleased,
    commissionDiff,
    exclusionRuleId: exclusion.rule.id,
    exclusionReason: exclusion.reason,
    alreadyExcluded: meta.customerExcluded && record.commissionAmount === 0,
    paidBlocked,
    titleCategory: resolveTitleCategory(record.schedules, input.now ?? new Date()),
    wouldChange: !paidBlocked && Math.abs(commissionDiff) >= 0.005,
  };
}

function pushMonthBucket(
  map: Map<string, ExclusionImpactMonthBucket>,
  monthKey: string,
  line: ExclusionImpactLine
): void {
  const bucket = map.get(monthKey) ?? {
    monthKey,
    lineCount: 0,
    currentCommission: 0,
    afterCommission: 0,
    commissionDiff: 0,
    currentReleased: 0,
    afterReleased: 0,
  };
  bucket.lineCount += 1;
  bucket.currentCommission = roundMoney(bucket.currentCommission + line.currentCommissionAmount);
  bucket.afterCommission = roundMoney(bucket.afterCommission + line.afterCommissionAmount);
  bucket.commissionDiff = roundMoney(bucket.commissionDiff + line.commissionDiff);
  bucket.currentReleased = roundMoney(bucket.currentReleased + line.currentReleasedAmount);
  bucket.afterReleased = roundMoney(bucket.afterReleased + line.afterReleasedAmount);
  map.set(monthKey, bucket);
}

function aggregateMonthBuckets(
  lines: ExclusionImpactLine[],
  pickMonthKeys: (line: ExclusionImpactLine) => string[]
): ExclusionImpactMonthBucket[] {
  const map = new Map<string, ExclusionImpactMonthBucket>();
  for (const line of lines) {
    const keys = pickMonthKeys(line);
    if (keys.length === 0) {
      pushMonthBucket(map, "sem_mes", line);
      continue;
    }
    for (const key of keys) {
      pushMonthBucket(map, key, line);
    }
  }
  return [...map.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export function buildExclusionImpactPreview(input: {
  customerFilter: ExclusionReprocessCustomerFilter;
  dateRange: ExclusionReprocessDateRange;
  rules: CustomerExclusionRuleSnapshot[];
  records: ExclusionReprocessRecordInput[];
  paidBlockAutoChange: boolean;
  closedMonths?: ClosedPaymentBatchMonth[];
}): ExclusionImpactPreview {
  const applicableRules = input.rules.filter((rule) =>
    ruleMatchesCustomerFilter(rule, input.customerFilter)
  );
  const warnings: string[] = [MONTHLY_CLOSING_PERSISTENCE_WARNING];

  const lines: ExclusionImpactLine[] = [];
  for (const record of input.records) {
    if (!recordMatchesCustomerFilter(record, input.customerFilter)) continue;
    const line = simulateExclusionImpactLine({
      record,
      rules: applicableRules.length > 0 ? applicableRules : input.rules,
      dateRange: input.dateRange,
      paidBlockAutoChange: input.paidBlockAutoChange,
    });
    if (line) lines.push(line);
  }

  const orderSet = new Set(lines.map((l) => l.orderCode).filter(Boolean));
  const nfeSet = new Set(lines.map((l) => l.nfeNumber).filter(Boolean));
  const receivableSet = new Set(lines.flatMap((l) => l.nomusReceivableIds));
  const sellerMap = new Map<string, ExclusionImpactSellerBucket>();

  let currentCommission = 0;
  let afterCommission = 0;
  let currentReleased = 0;
  let afterReleased = 0;
  let paidBlockedCount = 0;
  let wouldChangeCount = 0;

  for (const line of lines) {
    currentCommission = roundMoney(currentCommission + line.currentCommissionAmount);
    afterCommission = roundMoney(afterCommission + line.afterCommissionAmount);
    currentReleased = roundMoney(currentReleased + line.currentReleasedAmount);
    afterReleased = roundMoney(afterReleased + line.afterReleasedAmount);
    if (line.paidBlocked) paidBlockedCount += 1;
    if (line.wouldChange) wouldChangeCount += 1;

    const seller = sellerMap.get(line.sellerId) ?? {
      sellerId: line.sellerId,
      sellerName: line.sellerName,
      lineCount: 0,
      currentCommission: 0,
      afterCommission: 0,
      commissionDiff: 0,
    };
    seller.lineCount += 1;
    seller.currentCommission = roundMoney(
      seller.currentCommission + line.currentCommissionAmount
    );
    seller.afterCommission = roundMoney(seller.afterCommission + line.afterCommissionAmount);
    seller.commissionDiff = roundMoney(seller.commissionDiff + line.commissionDiff);
    sellerMap.set(line.sellerId, seller);
  }

  const closedMonths = [
    ...new Set((input.closedMonths ?? []).map((m) => m.monthKey)),
  ].sort();

  if (closedMonths.length > 0) {
    warnings.push(
      `Meses com lote APPROVED/PAID detectados: ${closedMonths.join(", ")}. Use --skip-closed-months para bloquear apply nesses meses.`
    );
  }

  return {
    dryRun: true,
    customerFilter: input.customerFilter,
    dateRange: input.dateRange,
    ruleIds: (applicableRules.length > 0 ? applicableRules : input.rules).map((r) => r.id),
    warnings,
    ordersAffected: orderSet.size,
    nfesAffected: nfeSet.size,
    receivablesAffected: receivableSet.size,
    sellersAffected: sellerMap.size,
    lines,
    totals: {
      currentCommission,
      afterCommission,
      commissionDiff: roundMoney(afterCommission - currentCommission),
      currentReleased,
      afterReleased,
      paidBlockedCount,
      wouldChangeCount,
    },
    bySettlementMonth: aggregateMonthBuckets(lines, (line) => line.settlementMonthKeys),
    byReferenceMonth: aggregateMonthBuckets(lines, (line) => [
      line.referenceDate.slice(0, 7),
    ]),
    bySeller: [...sellerMap.values()].sort((a, b) =>
      a.sellerName.localeCompare(b.sellerName)
    ),
    closedMonths,
  };
}

export function evaluateExclusionReprocessSafety(input: {
  preview: ExclusionImpactPreview;
  mode: ExclusionReprocessMode;
  skipClosedMonths: boolean;
  closedMonths: ClosedPaymentBatchMonth[];
  ruleId: string;
}): { safe: boolean; blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings = [...input.preview.warnings];

  if (input.preview.lines.length === 0) {
    blockers.push("Nenhum registro elegível para reprocessamento no período informado.");
  }

  if (input.preview.totals.paidBlockedCount > 0) {
    blockers.push(
      `${input.preview.totals.paidBlockedCount} registro(s) pagos bloqueados para alteração automática.`
    );
  }

  if (input.preview.totals.wouldChangeCount === 0 && input.preview.lines.length > 0) {
    warnings.push("Todos os registros elegíveis já refletem comissão zerada — nada a aplicar.");
  }

  const closedMonthKeys = new Set(input.closedMonths.map((m) => m.monthKey));
  const affectedClosedLines = input.preview.lines.filter(
    (line) =>
      line.wouldChange &&
      line.settlementMonthKeys.some((key) => closedMonthKeys.has(key))
  );

  if (input.skipClosedMonths && affectedClosedLines.length > 0) {
    blockers.push(
      `${affectedClosedLines.length} registro(s) em mês(es) com lote APPROVED/PAID (${[...closedMonthKeys].join(", ")}).`
    );
  } else if (affectedClosedLines.length > 0) {
    warnings.push(
      `${affectedClosedLines.length} registro(s) tocam meses com lote APPROVED/PAID — revise antes de aplicar.`
    );
  }

  const wrongRuleLines = input.preview.lines.filter(
    (line) => line.exclusionRuleId != null && line.exclusionRuleId !== input.ruleId
  );
  if (wrongRuleLines.length > 0) {
    blockers.push(
      `${wrongRuleLines.length} registro(s) seriam afetados por regra diferente de --rule-id.`
    );
  }

  if (input.mode === "dry-run") {
    return { safe: blockers.length === 0, blockers, warnings };
  }

  return { safe: blockers.length === 0, blockers, warnings };
}

export function buildExclusionImpactCsv(preview: ExclusionImpactPreview): string {
  const header =
    "pedido,nf,cliente,vendedor,status,referencia,tipo_referencia,base_atual,comissao_atual,comissao_apos,diferenca,liberado_atual,liberado_apos,regra_id,motivo,ja_excluido,bloqueado_pago,categoria_titulo,cr_ids";
  const lines = preview.lines.map((line) =>
    [
      line.orderCode ?? "",
      line.nfeNumber ?? "",
      line.customerName ?? "",
      line.sellerName,
      line.status,
      line.referenceDate,
      line.referenceDateKind,
      line.baseAmount.toFixed(2),
      line.currentCommissionAmount.toFixed(2),
      line.afterCommissionAmount.toFixed(2),
      line.commissionDiff.toFixed(2),
      line.currentReleasedAmount.toFixed(2),
      line.afterReleasedAmount.toFixed(2),
      line.exclusionRuleId ?? "",
      line.exclusionReason ?? "",
      line.alreadyExcluded ? "sim" : "nao",
      line.paidBlocked ? "sim" : "nao",
      line.titleCategory,
      line.nomusReceivableIds.join("|"),
    ]
      .map((value) => {
        const s = String(value);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}
