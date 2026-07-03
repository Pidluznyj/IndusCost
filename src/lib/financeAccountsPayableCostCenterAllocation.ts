import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  accountsPayableMatchesCompany,
  accountsPayableMatchesFinancialSupplier,
  isManualLockedAllocation,
  validateSupplierRulePercentageTotal,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import { FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE,
  FINANCE_AP_ALLOCATION_AUDIT_ACTION,
  FINANCE_AP_ALLOCATION_AUDIT_ENTITY,
  FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
  FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE,
} from "@/src/lib/financeApAllocationShared.js";
import {
  isTitleRealAllocated,
  resolveTitleUnallocatedGap,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import { buildSupplierIdentityKey, extractSupplierFromAccountsPayable } from "@/src/lib/financeSupplierIdentity.js";
import {
  resolveBestClassificationMatch,
  type ClassificationApRow,
} from "@/src/lib/financeCostCenterClassificationRuleMatcher.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceApAllocationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceApAllocationError";
    this.code = code;
  }
}

export type ApAllocationTitleRow = {
  externalId: number;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  classification?: string | null;
  description?: string | null;
  comments?: string | null;
  documentNumber?: string | null;
  status?: boolean | null;
  rawPayload?: unknown;
  balancePayable?: number;
  amountPayable?: number;
  suspendPayment?: boolean | null;
  competenceDate?: Date | null;
  dueDate?: Date | null;
};

export type AllocationLineInput = {
  costCenterId: string;
  percentage: number;
  amount?: number | null;
  notes?: string | null;
};

export type ManualAllocationInput = {
  lines: AllocationLineInput[];
  lockedManual?: boolean;
  notes?: string | null;
};

export type ReclassificationInput = {
  lines: AllocationLineInput[];
  reason: string;
  lockedManual?: boolean;
};

export type AllocationRecord = {
  id: string;
  accountsPayableId: number;
  supplierId: string | null;
  costCenterId: string;
  amount: Prisma.Decimal | null;
  percentage: Prisma.Decimal;
  source: "AUTO_RULE" | "MANUAL" | "BATCH";
  confidence: Prisma.Decimal | null;
  lockedManual: boolean;
  ruleId: string | null;
  classificationRuleId: string | null;
  classificationRuleType: string | null;
  classificationRuleName: string | null;
  classificationRuleReason: string | null;
  notes: string | null;
};

export type SupplierRuleRecord = {
  id: string;
  supplierId: string;
  costCenterId: string;
  percentage: Prisma.Decimal;
  priority: number;
  autoApply: boolean;
  isActive: boolean;
  company: string | null;
};

export type ProposedAllocationLine = {
  costCenterId: string;
  percentage: number;
  amount: number;
  ruleId: string | null;
  classificationRuleId?: string | null;
  classificationRuleType?: string | null;
  classificationRuleName?: string | null;
  classificationRuleReason?: string | null;
  source: "AUTO_RULE" | "MANUAL" | "BATCH";
};

export type AllocationPreviewItem = {
  accountsPayableId: number;
  action: "create" | "replace" | "skip";
  skipReason: string | null;
  supplierId: string | null;
  supplierName: string | null;
  titleAmount: number;
  lines: ProposedAllocationLine[];
  existingAllocationIds: string[];
};

export type BatchAllocationPreviewPayload = {
  items: AllocationPreviewItem[];
  summary: {
    analyzed: number;
    wouldCreate: number;
    wouldReplace: number;
    skipped: number;
    skippedManualLocked: number;
    skippedNoRule: number;
    skippedClosedPeriod: number;
  };
  requiredConfirmationText: string;
  warnings: string[];
};

export type BatchAllocationApplyResult = {
  ok: true;
  appliedAt: string;
  created: number;
  replaced: number;
  skipped: number;
  summary: BatchAllocationPreviewPayload["summary"];
};

export type ClassificationSummaryPayload = {
  totalTitles: number;
  classifiedTitles: number;
  unclassifiedTitles: number;
  manualLockedTitles: number;
  totalAllocatedAmount: number;
  byCostCenter: Array<{
    costCenterId: string;
    costCenterCode: string;
    costCenterName: string;
    titlesCount: number;
    allocatedAmount: number;
  }>;
};

export type AllocationUserContext = {
  userId: string | null;
  userName: string | null;
};

export type BatchAllocationFilters = {
  externalIds?: number[];
  unclassifiedOnly?: boolean;
  companyName?: string;
  supplierId?: string;
  /** Quando true (padrão na listagem de centros de custo), considera só AP com saldo em aberto. */
  openOnly?: boolean;
};

export type FinanceApAllocationDeps = {
  loadAllSuppliers: () => Promise<SupplierWithAliases[]>;
  loadApById: (externalId: number) => Promise<ApAllocationTitleRow | null>;
  loadApRows: (filters: BatchAllocationFilters) => Promise<ApAllocationTitleRow[]>;
  loadAllocationsForPayable: (externalId: number) => Promise<AllocationRecord[]>;
  loadAllocationsForPayables: (externalIds: number[]) => Promise<AllocationRecord[]>;
  loadRulesForSupplier: (supplierId: string) => Promise<SupplierRuleRecord[]>;
  loadActiveClassificationRules?: () => Promise<
    Array<{
      id: string;
      name: string;
      ruleType: string;
      costCenterId: string;
      percentage: number;
      priority: number;
      autoApply: boolean;
      isActive: boolean;
      supplierId: string | null;
      nomusClassification: string | null;
      descriptionContains: string | null;
      documentContains: string | null;
      keywords: string[];
      financialNature: string | null;
      company: string | null;
      minAmount: number | null;
      maxAmount: number | null;
      titleStatus: string | null;
      accountsPayableId: number | null;
    }>
  >;
  loadCostCenterMeta: (
    id: string
  ) => Promise<{ id: string; code: string; name: string; status: string } | null>;
  getClosedThroughDate: () => Promise<Date | null>;
  replaceAllocationsForPayable: (
    externalId: number,
    lines: Array<{
      supplierId: string | null;
      costCenterId: string;
      amount: number;
      percentage: number;
      source: "AUTO_RULE" | "MANUAL" | "BATCH";
      ruleId: string | null;
      classificationRuleId?: string | null;
      classificationRuleType?: string | null;
      classificationRuleName?: string | null;
      classificationRuleReason?: string | null;
      lockedManual: boolean;
      notes: string | null;
      createdByUserId: string | null;
      createdByName: string | null;
    }>,
    removableAllocationIds: string[]
  ) => Promise<AllocationRecord[]>;
  createAuditLog: (data: {
    entityType: string;
    entityId: string;
    action: string;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    userId?: string | null;
    userName?: string | null;
  }) => Promise<void>;
  runInTransaction: <T>(fn: (deps: FinanceApAllocationDeps) => Promise<T>) => Promise<T>;
};

const AP_ALLOCATION_SELECT = {
  externalId: true,
  personId: true,
  personName: true,
  personCnpj: true,
  companyId: true,
  companyName: true,
  classification: true,
  description: true,
  comments: true,
  documentNumber: true,
  status: true,
  rawPayload: true,
  balancePayable: true,
  amountPayable: true,
  suspendPayment: true,
  competenceDate: true,
  dueDate: true,
} as const;

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return decimalFieldToNumber(value);
}

export function resolveTitleAllocationBaseAmount(ap: ApAllocationTitleRow): number {
  const balance = Math.abs(Number(ap.balancePayable ?? 0));
  const payable = Math.abs(Number(ap.amountPayable ?? 0));
  return roundMoney(balance > 0 ? balance : payable);
}

export function protectManualLockedAllocations(
  allocations: AllocationRecord[]
): AllocationRecord[] {
  return allocations.filter((allocation) => isManualLockedAllocation(allocation));
}

export function hasManualLockedAllocation(allocations: AllocationRecord[]): boolean {
  return protectManualLockedAllocations(allocations).length > 0;
}

export function validateAllocationTotals(
  lines: Array<{ percentage: number; amount: number }>,
  titleAmount: number
): void {
  const percentageTotal = lines.reduce((sum, line) => sum + line.percentage, 0);
  if (Math.abs(percentageTotal - 100) > FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE) {
    throw new FinanceApAllocationError(
      "INVALID_PERCENTAGE_TOTAL",
      `Rateio deve somar 100% (atual: ${percentageTotal.toFixed(2)}%).`
    );
  }

  const amountTotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const expected = roundMoney(titleAmount);
  if (Math.abs(amountTotal - expected) > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
    throw new FinanceApAllocationError(
      "INVALID_AMOUNT_TOTAL",
      `Soma dos valores alocados (${amountTotal.toFixed(2)}) deve igualar o título (${expected.toFixed(2)}).`
    );
  }

  for (const line of lines) {
    if (!Number.isFinite(line.percentage) || line.percentage <= 0) {
      throw new FinanceApAllocationError("INVALID_PERCENTAGE", "percentage inválido.");
    }
    if (!Number.isFinite(line.amount) || line.amount < 0) {
      throw new FinanceApAllocationError("INVALID_AMOUNT", "amount inválido.");
    }
  }
}

export function splitAmountByPercentages(
  titleAmount: number,
  percentages: number[]
): number[] {
  if (percentages.length === 0) return [];
  const total = roundMoney(titleAmount);
  const amounts = percentages.map((pct) => roundMoney((total * pct) / 100));
  const sumExceptLast = amounts.slice(0, -1).reduce((sum, value) => sum + value, 0);
  amounts[amounts.length - 1] = roundMoney(total - sumExceptLast);
  return amounts;
}

export function resolveSupplierForAccountsPayable(
  ap: ApAllocationTitleRow,
  suppliers: SupplierWithAliases[]
): SupplierWithAliases | null {
  for (const supplier of suppliers) {
    if (supplier.status !== "ACTIVE") continue;
    if (accountsPayableMatchesFinancialSupplier(ap, supplier)) return supplier;
  }
  return null;
}

export function resolveCostCenterRulesForSupplier(
  supplierId: string,
  ap: ApAllocationTitleRow,
  rules: SupplierRuleRecord[],
  options?: { requireAutoApply?: boolean }
): SupplierRuleRecord[] {
  const requireAutoApply = options?.requireAutoApply !== false;
  const active = rules.filter(
    (rule) =>
      rule.supplierId === supplierId &&
      rule.isActive &&
      (!requireAutoApply || rule.autoApply) &&
      accountsPayableMatchesCompany(ap, rule.company)
  );
  if (active.length === 0) return [];

  const maxPriority = Math.max(...active.map((rule) => rule.priority));
  const selected = active.filter((rule) => rule.priority === maxPriority);
  validateSupplierRulePercentageTotal(
    selected.map((rule) => ({ percentage: decimalToNumber(rule.percentage) }))
  );
  return selected;
}

export function isTitleInClosedPeriod(
  ap: ApAllocationTitleRow,
  closedThroughDate: Date | null
): boolean {
  if (!closedThroughDate) return false;
  const competence = ap.competenceDate ?? ap.dueDate;
  if (!competence) return false;
  const closed = new Date(
    closedThroughDate.getFullYear(),
    closedThroughDate.getMonth(),
    closedThroughDate.getDate()
  );
  const comp = new Date(competence.getFullYear(), competence.getMonth(), competence.getDate());
  return comp.getTime() <= closed.getTime();
}

function mapApToClassificationRow(ap: ApAllocationTitleRow): ClassificationApRow {
  return {
    externalId: ap.externalId,
    personId: ap.personId,
    personName: ap.personName,
    personCnpj: ap.personCnpj,
    companyId: ap.companyId,
    companyName: ap.companyName,
    classification: ap.classification,
    description: ap.description,
    comments: ap.comments,
    documentNumber: ap.documentNumber,
    status: ap.status,
    balancePayable: ap.balancePayable,
    amountPayable: ap.amountPayable,
    rawPayload: ap.rawPayload,
  };
}

function buildLinesFromMatch(
  match: NonNullable<ReturnType<typeof resolveBestClassificationMatch>>,
  titleAmount: number
): ProposedAllocationLine[] {
  const amounts = splitAmountByPercentages(titleAmount, [match.percentage]);
  return [
    {
      costCenterId: match.costCenterId,
      percentage: match.percentage,
      amount: amounts[0]!,
      ruleId: match.kind === "SUPPLIER" ? match.ruleId : null,
      classificationRuleId: match.kind === "CLASSIFICATION" ? match.ruleId : null,
      classificationRuleType: match.kind === "CLASSIFICATION" ? match.ruleType : null,
      classificationRuleName: match.ruleName,
      classificationRuleReason: match.reason,
      source: "AUTO_RULE" as const,
    },
  ];
}

function buildLinesFromRules(
  rules: SupplierRuleRecord[],
  titleAmount: number
): ProposedAllocationLine[] {
  const percentages = rules.map((rule) => decimalToNumber(rule.percentage));
  const amounts = splitAmountByPercentages(titleAmount, percentages);
  return rules.map((rule, index) => ({
    costCenterId: rule.costCenterId,
    percentage: percentages[index]!,
    amount: amounts[index]!,
    ruleId: rule.id,
    source: "AUTO_RULE" as const,
  }));
}

function buildLinesFromManualInput(
  input: ManualAllocationInput,
  titleAmount: number
): ProposedAllocationLine[] {
  const percentages = input.lines.map((line) => line.percentage);
  const amounts =
    input.lines.some((line) => line.amount != null)
      ? input.lines.map((line) => roundMoney(line.amount ?? 0))
      : splitAmountByPercentages(titleAmount, percentages);

  const lines = input.lines.map((line, index) => ({
    costCenterId: line.costCenterId,
    percentage: line.percentage,
    amount: amounts[index]!,
    ruleId: null,
    source: "MANUAL" as const,
  }));
  validateAllocationTotals(lines, titleAmount);
  return lines;
}

function serializeAllocation(allocation: AllocationRecord): Prisma.InputJsonValue {
  return {
    id: allocation.id,
    accountsPayableId: allocation.accountsPayableId,
    costCenterId: allocation.costCenterId,
    percentage: decimalToNumber(allocation.percentage),
    amount: decimalToNumber(allocation.amount),
    source: allocation.source,
    lockedManual: allocation.lockedManual,
  };
}

async function buildPreviewForTitle(
  deps: FinanceApAllocationDeps,
  ap: ApAllocationTitleRow,
  suppliers: SupplierWithAliases[],
  options?: { requireAutoApply?: boolean }
): Promise<AllocationPreviewItem> {
  const existing = await deps.loadAllocationsForPayable(ap.externalId);
  const titleAmount = resolveTitleAllocationBaseAmount(ap);
  const closedThroughDate = await deps.getClosedThroughDate();

  if (hasManualLockedAllocation(existing)) {
    return {
      accountsPayableId: ap.externalId,
      action: "skip",
      skipReason: "MANUAL_LOCKED",
      supplierId: existing[0]?.supplierId ?? null,
      supplierName: null,
      titleAmount,
      lines: [],
      existingAllocationIds: existing.map((row) => row.id),
    };
  }

  if (isTitleInClosedPeriod(ap, closedThroughDate)) {
    return {
      accountsPayableId: ap.externalId,
      action: "skip",
      skipReason: "CLOSED_PERIOD",
      supplierId: null,
      supplierName: null,
      titleAmount,
      lines: [],
      existingAllocationIds: existing.map((row) => row.id),
    };
  }

  const supplier = resolveSupplierForAccountsPayable(ap, suppliers);
  const classificationRules = deps.loadActiveClassificationRules
    ? await deps.loadActiveClassificationRules()
    : [];
  const supplierRules = supplier
    ? (await deps.loadRulesForSupplier(supplier.id)).map((rule) => ({
        id: rule.id,
        supplierId: rule.supplierId,
        costCenterId: rule.costCenterId,
        percentage: decimalToNumber(rule.percentage),
        priority: rule.priority,
        autoApply: rule.autoApply,
        isActive: rule.isActive,
        company: rule.company,
      }))
    : [];

  const match = resolveBestClassificationMatch({
    ap: mapApToClassificationRow(ap),
    supplier,
    supplierRules,
    classificationRules,
    requireAutoApply: options?.requireAutoApply,
  });

  if (!match) {
    return {
      accountsPayableId: ap.externalId,
      action: "skip",
      skipReason: supplier ? "NO_RULE" : "NO_SUPPLIER",
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.displayName ?? null,
      titleAmount,
      lines: [],
      existingAllocationIds: existing.map((row) => row.id),
    };
  }

  const lines = buildLinesFromMatch(match, titleAmount);
  validateAllocationTotals(lines, titleAmount);

  return {
    accountsPayableId: ap.externalId,
    action: existing.length > 0 ? "replace" : "create",
    skipReason: null,
    supplierId: match.supplierId,
    supplierName: supplier?.displayName ?? null,
    titleAmount,
    lines,
    existingAllocationIds: existing
      .filter((row) => !isManualLockedAllocation(row))
      .map((row) => row.id),
  };
}

export async function previewAccountsPayableAllocation(
  deps: FinanceApAllocationDeps,
  externalId: number
): Promise<AllocationPreviewItem> {
  const ap = await deps.loadApById(externalId);
  if (!ap) {
    throw new FinanceApAllocationError("AP_NOT_FOUND", "Título AP não encontrado.");
  }
  const suppliers = await deps.loadAllSuppliers();
  return buildPreviewForTitle(deps, ap, suppliers);
}

export async function previewBatchAccountsPayableAllocation(
  deps: FinanceApAllocationDeps,
  filters: BatchAllocationFilters
): Promise<BatchAllocationPreviewPayload> {
  const apRows = await deps.loadApRows(filters);
  const suppliers = await deps.loadAllSuppliers();
  const items: AllocationPreviewItem[] = [];

  for (const ap of apRows) {
    items.push(await buildPreviewForTitle(deps, ap, suppliers, { requireAutoApply: true }));
  }

  const summary = {
    analyzed: items.length,
    wouldCreate: items.filter((item) => item.action === "create").length,
    wouldReplace: items.filter((item) => item.action === "replace").length,
    skipped: items.filter((item) => item.action === "skip").length,
    skippedManualLocked: items.filter((item) => item.skipReason === "MANUAL_LOCKED").length,
    skippedNoRule: items.filter((item) => item.skipReason === "NO_RULE").length,
    skippedClosedPeriod: items.filter((item) => item.skipReason === "CLOSED_PERIOD").length,
  };

  return {
    items,
    summary,
    requiredConfirmationText: FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
    warnings: [],
  };
}

export function assertFinanceApAllocationBatchConfirmation(confirmation: unknown): void {
  const text = typeof confirmation === "string" ? confirmation.trim() : "";
  if (text !== FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT) {
    throw new FinanceApAllocationError(
      "INVALID_CONFIRMATION",
      `Confirmação inválida — envie confirmationText exatamente igual a: "${FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT}".`
    );
  }
}

async function persistAllocationsForTitle(
  deps: FinanceApAllocationDeps,
  ap: ApAllocationTitleRow,
  lines: ProposedAllocationLine[],
  user: AllocationUserContext,
  options: {
    source: "AUTO_RULE" | "MANUAL" | "BATCH";
    lockedManual: boolean;
    supplierId: string | null;
    notes?: string | null;
    allowReplaceManualLocked?: boolean;
  }
): Promise<AllocationRecord[]> {
  const existing = await deps.loadAllocationsForPayable(ap.externalId);
  if (!options.allowReplaceManualLocked && hasManualLockedAllocation(existing)) {
    throw new FinanceApAllocationError(
      "MANUAL_LOCKED",
      "Título possui classificação manual bloqueada."
    );
  }

  const titleAmount = resolveTitleAllocationBaseAmount(ap);
  validateAllocationTotals(lines, titleAmount);

  const removableIds = options.allowReplaceManualLocked
    ? existing.map((row) => row.id)
    : existing.filter((row) => !isManualLockedAllocation(row)).map((row) => row.id);

  const created = await deps.replaceAllocationsForPayable(
    ap.externalId,
    lines.map((line) => ({
      supplierId: options.supplierId,
      costCenterId: line.costCenterId,
      amount: line.amount,
      percentage: line.percentage,
      source: options.source,
      ruleId: line.ruleId,
      classificationRuleId: line.classificationRuleId ?? null,
      classificationRuleType: line.classificationRuleType ?? null,
      classificationRuleName: line.classificationRuleName ?? null,
      classificationRuleReason: line.classificationRuleReason ?? null,
      lockedManual: options.lockedManual,
      notes: options.notes ?? null,
      createdByUserId: user.userId,
      createdByName: user.userName,
    })),
    removableIds
  );

  for (const removedId of removableIds) {
    const removed = existing.find((row) => row.id === removedId);
    if (removed) {
      await deps.createAuditLog({
        entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
        entityId: removedId,
        action: FINANCE_AP_ALLOCATION_AUDIT_ACTION.DELETE,
        beforeJson: serializeAllocation(removed),
        userId: user.userId,
        userName: user.userName,
      });
    }
  }

  for (const allocation of created) {
    await deps.createAuditLog({
      entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
      entityId: allocation.id,
      action: FINANCE_AP_ALLOCATION_AUDIT_ACTION.CREATE,
      afterJson: serializeAllocation(allocation),
      userId: user.userId,
      userName: user.userName,
    });
  }

  return created;
}

async function buildReclassificationAuditSnapshot(
  deps: FinanceApAllocationDeps,
  ap: ApAllocationTitleRow,
  existing: AllocationRecord[],
  supplier: Awaited<ReturnType<typeof resolveSupplierForAccountsPayable>>
): Promise<Prisma.InputJsonValue> {
  const allocations = await Promise.all(
    existing.map(async (allocation) => {
      const meta = await deps.loadCostCenterMeta(allocation.costCenterId);
      return {
        allocationId: allocation.id,
        costCenterId: allocation.costCenterId,
        costCenterCode: meta?.code ?? allocation.costCenterId,
        costCenterName: meta?.name ?? allocation.costCenterId,
        percentage: decimalToNumber(allocation.percentage),
        amount: decimalToNumber(allocation.amount) || null,
        source: allocation.source,
        lockedManual: allocation.lockedManual,
      };
    })
  );
  return {
    accountsPayableId: ap.externalId,
    documentNumber: ap.documentNumber,
    description: ap.description,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.displayName ?? ap.personName,
    titleAmount: resolveTitleAllocationBaseAmount(ap),
    allocations,
  };
}

async function buildReclassificationAfterSnapshot(
  deps: FinanceApAllocationDeps,
  ap: ApAllocationTitleRow,
  created: AllocationRecord[],
  input: ReclassificationInput,
  supplier: Awaited<ReturnType<typeof resolveSupplierForAccountsPayable>>
): Promise<Prisma.InputJsonValue> {
  const allocations = await Promise.all(
    created.map(async (allocation) => {
      const meta = await deps.loadCostCenterMeta(allocation.costCenterId);
      return {
        allocationId: allocation.id,
        costCenterId: allocation.costCenterId,
        costCenterCode: meta?.code ?? allocation.costCenterId,
        costCenterName: meta?.name ?? allocation.costCenterId,
        percentage: decimalToNumber(allocation.percentage),
        amount: decimalToNumber(allocation.amount) || null,
        source: allocation.source,
        lockedManual: allocation.lockedManual,
      };
    })
  );
  return {
    accountsPayableId: ap.externalId,
    documentNumber: ap.documentNumber,
    description: ap.description,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.displayName ?? ap.personName,
    titleAmount: resolveTitleAllocationBaseAmount(ap),
    reason: input.reason.trim(),
    origin: "MANUAL_RECLASSIFICATION",
    allocations,
  };
}

export async function reclassifyAccountsPayableAllocation(
  deps: FinanceApAllocationDeps,
  externalId: number,
  input: ReclassificationInput,
  user: AllocationUserContext
): Promise<{ items: AllocationRecord[] }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new FinanceApAllocationError("MISSING_REASON", "Motivo da reclassificação é obrigatório.");
  }

  const ap = await deps.loadApById(externalId);
  if (!ap) throw new FinanceApAllocationError("AP_NOT_FOUND", "Título AP não encontrado.");

  const closedThroughDate = await deps.getClosedThroughDate();
  if (isTitleInClosedPeriod(ap, closedThroughDate)) {
    throw new FinanceApAllocationError(
      "CLOSED_PERIOD",
      "Título em período fechado não pode ser reclassificado."
    );
  }

  const suppliers = await deps.loadAllSuppliers();
  const supplier = resolveSupplierForAccountsPayable(ap, suppliers);
  const existing = await deps.loadAllocationsForPayable(externalId);
  const beforeSnapshot = await buildReclassificationAuditSnapshot(deps, ap, existing, supplier);
  const lines = buildLinesFromManualInput(
    { lines: input.lines, lockedManual: input.lockedManual !== false },
    resolveTitleAllocationBaseAmount(ap)
  );

  for (const line of lines) {
    const cc = await deps.loadCostCenterMeta(line.costCenterId);
    if (!cc || cc.status !== "ACTIVE") {
      throw new FinanceApAllocationError(
        "INACTIVE_COST_CENTER",
        "Centro de custo inválido ou inativo."
      );
    }
  }

  const created = await deps.runInTransaction(async (txDeps) => {
    const rows = await persistAllocationsForTitle(txDeps, ap, lines, user, {
      source: "MANUAL",
      lockedManual: input.lockedManual !== false,
      supplierId: supplier?.id ?? null,
      notes: reason,
      allowReplaceManualLocked: true,
    });

    await txDeps.createAuditLog({
      entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
      entityId: String(ap.externalId),
      action: FINANCE_AP_ALLOCATION_AUDIT_ACTION.MANUAL_RECLASSIFICATION,
      beforeJson: beforeSnapshot,
      afterJson: await buildReclassificationAfterSnapshot(deps, ap, rows, input, supplier),
      userId: user.userId,
      userName: user.userName,
    });

    return rows;
  });

  return { items: created };
}

export async function applyAccountsPayableAllocation(
  deps: FinanceApAllocationDeps,
  externalId: number,
  input: ManualAllocationInput,
  user: AllocationUserContext
): Promise<{ items: AllocationRecord[] }> {
  const ap = await deps.loadApById(externalId);
  if (!ap) throw new FinanceApAllocationError("AP_NOT_FOUND", "Título AP não encontrado.");

  const closedThroughDate = await deps.getClosedThroughDate();
  if (isTitleInClosedPeriod(ap, closedThroughDate)) {
    throw new FinanceApAllocationError(
      "CLOSED_PERIOD",
      "Título em período fechado não pode ser classificado."
    );
  }

  const suppliers = await deps.loadAllSuppliers();
  const supplier = resolveSupplierForAccountsPayable(ap, suppliers);
  const lines = buildLinesFromManualInput(input, resolveTitleAllocationBaseAmount(ap));

  for (const line of lines) {
    const cc = await deps.loadCostCenterMeta(line.costCenterId);
    if (!cc || cc.status !== "ACTIVE") {
      throw new FinanceApAllocationError(
        "INACTIVE_COST_CENTER",
        "Centro de custo inválido ou inativo."
      );
    }
  }

  const created = await deps.runInTransaction(async (txDeps) =>
    persistAllocationsForTitle(txDeps, ap, lines, user, {
      source: "MANUAL",
      lockedManual: input.lockedManual !== false,
      supplierId: supplier?.id ?? null,
      notes: input.notes ?? null,
    })
  );

  return { items: created };
}

export async function applyBatchAccountsPayableAllocation(
  deps: FinanceApAllocationDeps,
  filters: BatchAllocationFilters,
  confirmationText: string,
  user: AllocationUserContext
): Promise<BatchAllocationApplyResult> {
  assertFinanceApAllocationBatchConfirmation(confirmationText);

  const preview = await previewBatchAccountsPayableAllocation(deps, filters);
  const applicable = preview.items.filter(
    (item) => item.action === "create" || item.action === "replace"
  );

  const result = await deps.runInTransaction(async (txDeps) => {
    let created = 0;
    let replaced = 0;

    for (const item of applicable) {
      const ap = await txDeps.loadApById(item.accountsPayableId);
      if (!ap) continue;
      const rows = await persistAllocationsForTitle(txDeps, ap, item.lines, user, {
        source: "BATCH",
        lockedManual: false,
        supplierId: item.supplierId,
      });
      if (item.action === "create") created += 1;
      if (item.action === "replace") replaced += 1;
      if (rows.length === 0) {
        throw new FinanceApAllocationError(
          "PARTIAL_APPLY_ABORTED",
          "Falha ao aplicar classificação — transação revertida."
        );
      }
    }

    await txDeps.createAuditLog({
      entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.BATCH_RUN,
      entityId: `batch-${Date.now()}`,
      action: FINANCE_AP_ALLOCATION_AUDIT_ACTION.BATCH_APPLY,
      afterJson: {
        created,
        replaced,
        skipped: preview.summary.skipped,
        filters,
      },
      userId: user.userId,
      userName: user.userName,
    });

    return { created, replaced };
  });

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    created: result.created,
    replaced: result.replaced,
    skipped: preview.summary.skipped,
    summary: preview.summary,
  };
}

export async function buildClassificationSummary(
  deps: FinanceApAllocationDeps
): Promise<ClassificationSummaryPayload> {
  const apRows = await deps.loadApRows({});
  const allocations = await deps.loadAllocationsForPayables(apRows.map((row) => row.externalId));

  const byPayable = new Map<number, AllocationRecord[]>();
  for (const allocation of allocations) {
    const list = byPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    byPayable.set(allocation.accountsPayableId, list);
  }

  let classifiedTitles = 0;
  let unclassifiedTitles = 0;
  let manualLockedTitles = 0;
  let totalAllocatedAmount = 0;
  const byCostCenter = new Map<
    string,
    { titlesCount: number; allocatedAmount: number; code: string; name: string }
  >();

  for (const ap of apRows) {
    const rows = byPayable.get(ap.externalId) ?? [];
    if (rows.length === 0) {
      unclassifiedTitles += 1;
      continue;
    }

    const pct = roundMoney(rows.reduce((sum, row) => sum + decimalToNumber(row.percentage), 0));
    if (Math.abs(pct - 100) > FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE) {
      unclassifiedTitles += 1;
      continue;
    }

    classifiedTitles += 1;
    if (hasManualLockedAllocation(rows)) manualLockedTitles += 1;

    for (const row of rows) {
      const amount = decimalToNumber(row.amount);
      totalAllocatedAmount += amount;
      const meta = await deps.loadCostCenterMeta(row.costCenterId);
      const current = byCostCenter.get(row.costCenterId) ?? {
        titlesCount: 0,
        allocatedAmount: 0,
        code: meta?.code ?? row.costCenterId,
        name: meta?.name ?? row.costCenterId,
      };
      current.titlesCount += 1;
      current.allocatedAmount = roundMoney(current.allocatedAmount + amount);
      byCostCenter.set(row.costCenterId, current);
    }
  }

  return {
    totalTitles: apRows.length,
    classifiedTitles,
    unclassifiedTitles,
    manualLockedTitles,
    totalAllocatedAmount: roundMoney(totalAllocatedAmount),
    byCostCenter: [...byCostCenter.entries()].map(([costCenterId, value]) => ({
      costCenterId,
      costCenterCode: value.code,
      costCenterName: value.name,
      titlesCount: value.titlesCount,
      allocatedAmount: value.allocatedAmount,
    })),
  };
}

/** Motivo real pelo qual um título AP segue sem classificação completa. */
export type UnclassifiedCause =
  | "MANUAL_LOCKED"
  | "PARTIAL_ALLOCATION"
  | "NO_SUPPLIER"
  | "SUPPLIER_NO_RULE"
  | "RULE_NOT_APPLIED";

export const UNCLASSIFIED_CAUSES: UnclassifiedCause[] = [
  "MANUAL_LOCKED",
  "PARTIAL_ALLOCATION",
  "NO_SUPPLIER",
  "SUPPLIER_NO_RULE",
  "RULE_NOT_APPLIED",
];

export type UnclassifiedItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
  personDocument: string | null;
  identityKey: string;
  cause: UnclassifiedCause;
  supplierId: string | null;
  supplierName: string | null;
};

export type UnclassifiedListPayload = {
  items: UnclassifiedItem[];
  causeSummary: Record<UnclassifiedCause, number>;
};

/**
 * Determina a causa real da não-classificação (função pura, testável).
 * Ordem de prioridade: manual bloqueado → rateio parcial → sem fornecedor →
 * fornecedor sem regra ativa → fornecedor com regra ativa mas alocação não aplicada.
 */
export function resolveUnclassifiedCause(input: {
  hasManualLocked: boolean;
  allocationPercentageTotal: number;
  hasSupplier: boolean;
  hasActiveAutoApplyRule: boolean;
  hasActiveRule: boolean;
}): UnclassifiedCause {
  if (input.hasManualLocked) return "MANUAL_LOCKED";
  if (input.allocationPercentageTotal > FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE) {
    return "PARTIAL_ALLOCATION";
  }
  if (!input.hasSupplier) return "NO_SUPPLIER";
  if (!input.hasActiveRule || !input.hasActiveAutoApplyRule) return "SUPPLIER_NO_RULE";
  return "RULE_NOT_APPLIED";
}

export async function listUnclassifiedAccountsPayable(
  deps: FinanceApAllocationDeps,
  filters: BatchAllocationFilters
): Promise<UnclassifiedListPayload> {
  const effectiveFilters: BatchAllocationFilters = {
    ...filters,
    openOnly: filters.openOnly === true,
  };
  const apRows = await deps.loadApRows(effectiveFilters);
  const allocations = await deps.loadAllocationsForPayables(apRows.map((row) => row.externalId));
  const byPayable = new Map<number, AllocationRecord[]>();
  for (const allocation of allocations) {
    const list = byPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    byPayable.set(allocation.accountsPayableId, list);
  }

  const suppliers = await deps.loadAllSuppliers();
  const rulesBySupplier = new Map<string, SupplierRuleRecord[]>();
  const loadRules = async (supplierId: string): Promise<SupplierRuleRecord[]> => {
    const cached = rulesBySupplier.get(supplierId);
    if (cached) return cached;
    const rows = await deps.loadRulesForSupplier(supplierId);
    rulesBySupplier.set(supplierId, rows);
    return rows;
  };

  const causeSummary: Record<UnclassifiedCause, number> = {
    MANUAL_LOCKED: 0,
    PARTIAL_ALLOCATION: 0,
    NO_SUPPLIER: 0,
    SUPPLIER_NO_RULE: 0,
    RULE_NOT_APPLIED: 0,
  };

  const items: UnclassifiedItem[] = [];

  for (const ap of apRows) {
    const rows = byPayable.get(ap.externalId) ?? [];
    const baseAmount = resolveTitleAllocationBaseAmount(ap);
    const pctTotal = rows.reduce((sum, row) => sum + decimalToNumber(row.percentage), 0);
    const unallocatedGap = resolveTitleUnallocatedGap(rows, baseAmount);
    if (isTitleRealAllocated(rows, baseAmount)) continue;

    const supplier = resolveSupplierForAccountsPayable(ap, suppliers);
    let hasActiveRule = false;
    let hasActiveAutoApplyRule = false;
    if (supplier) {
      const rules = (await loadRules(supplier.id)).filter(
        (r) => r.isActive && accountsPayableMatchesCompany(ap, r.company)
      );
      hasActiveRule = rules.length > 0;
      hasActiveAutoApplyRule = rules.some((r) => r.autoApply);
    }

    const cause = resolveUnclassifiedCause({
      hasManualLocked: hasManualLockedAllocation(rows),
      allocationPercentageTotal: pctTotal,
      hasSupplier: Boolean(supplier),
      hasActiveAutoApplyRule,
      hasActiveRule,
    });
    causeSummary[cause] += 1;

    const extracted = extractSupplierFromAccountsPayable(ap);
    items.push({
      externalId: ap.externalId,
      titleAmount: unallocatedGap,
      companyName: ap.companyName ?? null,
      personName: ap.personName ?? null,
      personDocument: ap.personCnpj ?? null,
      identityKey: buildSupplierIdentityKey(extracted, ap.externalId),
      cause,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.displayName ?? null,
    });
  }

  return { items, causeSummary };
}

function mapApRow(row: {
  externalId: number;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  companyId: number | null;
  companyName: string | null;
  classification: string | null;
  description: string | null;
  comments: string | null;
  documentNumber: string | null;
  status: boolean | null;
  rawPayload: unknown;
  balancePayable: Prisma.Decimal | null;
  amountPayable: Prisma.Decimal | null;
  suspendPayment: boolean | null;
  competenceDate: Date | null;
  dueDate: Date | null;
}): ApAllocationTitleRow {
  return {
    externalId: row.externalId,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    companyId: row.companyId,
    companyName: row.companyName,
    classification: row.classification,
    description: row.description,
    comments: row.comments,
    documentNumber: row.documentNumber,
    status: row.status,
    rawPayload: row.rawPayload,
    balancePayable: decimalFieldToNumber(row.balancePayable),
    amountPayable: decimalFieldToNumber(row.amountPayable),
    suspendPayment: row.suspendPayment,
    competenceDate: row.competenceDate,
    dueDate: row.dueDate,
  };
}

function createPrismaFinanceApAllocationDeps(
  db: Pick<
    typeof prisma,
    | "financialSupplier"
    | "nomusAccountsPayable"
    | "accountsPayableCostCenterAllocation"
    | "supplierCostCenterRule"
    | "financialCostCenterClassificationRule"
    | "financialCostCenter"
    | "financialCostCenterAuditLog"
  >
): FinanceApAllocationDeps {
  const base: FinanceApAllocationDeps = {
    loadAllSuppliers: async () =>
      db.financialSupplier.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          displayName: true,
          status: true,
          normalizedDocument: true,
          normalizedName: true,
          aliases: {
            select: {
              externalSupplierId: true,
              normalizedDocument: true,
              normalizedName: true,
            },
          },
        },
      }),
    loadApById: async (externalId) => {
      const row = await db.nomusAccountsPayable.findUnique({
        where: { externalId },
        select: AP_ALLOCATION_SELECT,
      });
      return row ? mapApRow(row) : null;
    },
    loadApRows: async (filters) => {
      const where: Prisma.NomusAccountsPayableWhereInput = {};
      if (filters.externalIds?.length) where.externalId = { in: filters.externalIds };
      if (filters.companyName) where.companyName = filters.companyName;
      const rows = await db.nomusAccountsPayable.findMany({
        where,
        select: AP_ALLOCATION_SELECT,
        orderBy: { externalId: "asc" },
      });
      let mapped = rows.map(mapApRow);
      if (filters.supplierId) {
        const suppliers = await base.loadAllSuppliers();
        const supplier = suppliers.find((item) => item.id === filters.supplierId) ?? null;
        if (supplier) {
          mapped = mapped.filter((ap) => accountsPayableMatchesFinancialSupplier(ap, supplier));
        } else {
          mapped = [];
        }
      }
      if (filters.openOnly) {
        mapped = mapped.filter(
          (ap) => (ap.balancePayable ?? 0) > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE
        );
      }
      if (filters.unclassifiedOnly) {
        const unclassified = await listUnclassifiedAccountsPayable(base, {});
        const ids = new Set(unclassified.items.map((item) => item.externalId));
        mapped = mapped.filter((ap) => ids.has(ap.externalId));
      }
      return mapped;
    },
    loadAllocationsForPayable: async (externalId) =>
      db.accountsPayableCostCenterAllocation.findMany({
        where: { accountsPayableId: externalId },
      }),
    loadAllocationsForPayables: async (externalIds) => {
      if (externalIds.length === 0) return [];
      return db.accountsPayableCostCenterAllocation.findMany({
        where: { accountsPayableId: { in: externalIds } },
      });
    },
    loadRulesForSupplier: async (supplierId) =>
      db.supplierCostCenterRule.findMany({
        where: { supplierId, isActive: true },
      }),
    loadActiveClassificationRules: async () => {
      const rows = await db.financialCostCenterClassificationRule.findMany({
        where: { isActive: true },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        ruleType: row.ruleType,
        costCenterId: row.costCenterId,
        percentage: decimalToNumber(row.percentage),
        priority: row.priority,
        autoApply: row.autoApply,
        isActive: row.isActive,
        supplierId: row.supplierId,
        nomusClassification: row.nomusClassification,
        descriptionContains: row.descriptionContains,
        documentContains: row.documentContains,
        keywords: Array.isArray(row.keywords)
          ? row.keywords.filter((item): item is string => typeof item === "string")
          : [],
        financialNature: row.financialNature,
        company: row.company,
        minAmount: row.minAmount != null ? decimalToNumber(row.minAmount) : null,
        maxAmount: row.maxAmount != null ? decimalToNumber(row.maxAmount) : null,
        titleStatus: row.titleStatus,
        accountsPayableId: row.accountsPayableId,
      }));
    },
    loadCostCenterMeta: async (id) =>
      db.financialCostCenter.findUnique({
        where: { id },
        select: { id: true, code: true, name: true, status: true },
      }),
    getClosedThroughDate: async () => null,
    replaceAllocationsForPayable: async (externalId, lines, removableAllocationIds) => {
      if (removableAllocationIds.length > 0) {
        await db.accountsPayableCostCenterAllocation.deleteMany({
          where: { id: { in: removableAllocationIds } },
        });
      }
      const created: AllocationRecord[] = [];
      for (const line of lines) {
        const row = await db.accountsPayableCostCenterAllocation.create({
          data: {
            accountsPayableId: externalId,
            supplierId: line.supplierId,
            costCenterId: line.costCenterId,
            amount: new Prisma.Decimal(line.amount),
            percentage: new Prisma.Decimal(line.percentage),
            source: line.source,
            ruleId: line.ruleId,
            classificationRuleId: line.classificationRuleId ?? null,
            classificationRuleType: line.classificationRuleType ?? null,
            classificationRuleName: line.classificationRuleName ?? null,
            classificationRuleReason: line.classificationRuleReason ?? null,
            lockedManual: line.lockedManual,
            notes: line.notes,
            createdByUserId: line.createdByUserId,
            createdByName: line.createdByName,
          },
        });
        created.push(row);
      }
      return created;
    },
    createAuditLog: async (data) => {
      await db.financialCostCenterAuditLog.create({ data });
    },
    runInTransaction: async (fn) => fn(base),
  };
  return base;
}

export function createDefaultFinanceApAllocationDeps(): FinanceApAllocationDeps {
  const base = createPrismaFinanceApAllocationDeps(prisma);
  return {
    ...base,
    runInTransaction: async (fn) =>
      prisma.$transaction(async (tx) => fn(createPrismaFinanceApAllocationDeps(tx))),
  };
}

export async function previewAccountsPayableAllocationDefault(
  externalId: number
): Promise<AllocationPreviewItem> {
  return previewAccountsPayableAllocation(createDefaultFinanceApAllocationDeps(), externalId);
}

export async function previewBatchAccountsPayableAllocationDefault(
  filters: BatchAllocationFilters
): Promise<BatchAllocationPreviewPayload> {
  return previewBatchAccountsPayableAllocation(createDefaultFinanceApAllocationDeps(), filters);
}

export async function applyAccountsPayableAllocationDefault(
  externalId: number,
  input: ManualAllocationInput,
  user: AllocationUserContext
) {
  return applyAccountsPayableAllocation(createDefaultFinanceApAllocationDeps(), externalId, input, user);
}

export async function reclassifyAccountsPayableAllocationDefault(
  externalId: number,
  input: ReclassificationInput,
  user: AllocationUserContext
) {
  return reclassifyAccountsPayableAllocation(
    createDefaultFinanceApAllocationDeps(),
    externalId,
    input,
    user
  );
}

export async function applyBatchAccountsPayableAllocationDefault(
  filters: BatchAllocationFilters,
  confirmationText: string,
  user: AllocationUserContext
) {
  return applyBatchAccountsPayableAllocation(
    createDefaultFinanceApAllocationDeps(),
    filters,
    confirmationText,
    user
  );
}

export async function buildClassificationSummaryDefault(): Promise<ClassificationSummaryPayload> {
  return buildClassificationSummary(createDefaultFinanceApAllocationDeps());
}

export async function listUnclassifiedAccountsPayableDefault(filters: BatchAllocationFilters) {
  return listUnclassifiedAccountsPayable(createDefaultFinanceApAllocationDeps(), filters);
}

export function parseManualAllocationBody(body: unknown): ManualAllocationInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceApAllocationError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.lines) || record.lines.length === 0) {
    throw new FinanceApAllocationError("MISSING_LINES", "lines é obrigatório.");
  }
  const lines: AllocationLineInput[] = record.lines.map((line, index) => {
    if (line == null || typeof line !== "object" || Array.isArray(line)) {
      throw new FinanceApAllocationError("INVALID_LINE", `Linha ${index + 1} inválida.`);
    }
    const row = line as Record<string, unknown>;
    const costCenterId = typeof row.costCenterId === "string" ? row.costCenterId.trim() : "";
    if (!costCenterId) {
      throw new FinanceApAllocationError("MISSING_COST_CENTER", "costCenterId é obrigatório.");
    }
    const percentage = Number(row.percentage);
    if (!Number.isFinite(percentage)) {
      throw new FinanceApAllocationError("INVALID_PERCENTAGE", "percentage inválido.");
    }
    const amount = row.amount == null ? null : Number(row.amount);
    if (amount != null && !Number.isFinite(amount)) {
      throw new FinanceApAllocationError("INVALID_AMOUNT", "amount inválido.");
    }
    return {
      costCenterId,
      percentage,
      amount,
      notes: typeof row.notes === "string" ? row.notes : null,
    };
  });
  return {
    lines,
    lockedManual: record.lockedManual === false ? false : true,
    notes: typeof record.notes === "string" ? record.notes : null,
  };
}

export function parseReclassificationBody(body: unknown): ReclassificationInput {
  const manual = parseManualAllocationBody(body);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceApAllocationError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason) {
    throw new FinanceApAllocationError("MISSING_REASON", "Motivo da reclassificação é obrigatório.");
  }
  return {
    lines: manual.lines,
    reason,
    lockedManual: manual.lockedManual,
  };
}

export function parseBatchAllocationFiltersBody(body: unknown): BatchAllocationFilters {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceApAllocationError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  const filters: BatchAllocationFilters = {};
  if (Array.isArray(record.externalIds)) {
    filters.externalIds = record.externalIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }
  if (record.unclassifiedOnly === true) filters.unclassifiedOnly = true;
  if (typeof record.companyName === "string" && record.companyName.trim()) {
    filters.companyName = record.companyName.trim();
  }
  if (typeof record.supplierId === "string" && record.supplierId.trim()) {
    filters.supplierId = record.supplierId.trim();
  }
  if (record.openOnly === false || record.openOnly === "false") {
    filters.openOnly = false;
  } else if (record.openOnly === true || record.openOnly === "true") {
    filters.openOnly = true;
  }
  return filters;
}

export function parseBatchAllocationApplyBody(body: unknown): {
  filters: BatchAllocationFilters;
  confirmationText: string;
} {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceApAllocationError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  const confirmationText =
    typeof record.confirmationText === "string" ? record.confirmationText : "";
  return {
    filters: parseBatchAllocationFiltersBody(record.filters ?? record),
    confirmationText,
  };
}

export { extractSupplierFromAccountsPayable };
