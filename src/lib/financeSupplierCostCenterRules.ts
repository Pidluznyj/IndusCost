import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import { isAccountsPayableOpen } from "@/src/lib/financeAccountsPayableOperational.js";
import {
  extractSupplierFromAccountsPayable,
  normalizeSupplierDocument,
  normalizeSupplierName,
  type AccountsPayableSupplierRecord,
} from "@/src/lib/financeSupplierIdentity.js";
import {
  FINANCE_SUPPLIER_RULE_AUDIT_ACTION,
  FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
  FINANCE_SUPPLIER_RULE_PERCENTAGE_TOLERANCE,
} from "@/src/lib/financeSupplierRuleAuditShared.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceSupplierCostCenterRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceSupplierCostCenterRuleError";
    this.code = code;
  }
}

export type SupplierCostCenterRuleDto = {
  id: string;
  supplierId: string;
  costCenterId: string;
  percentage: number;
  priority: number;
  autoApply: boolean;
  isActive: boolean;
  company: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierCostCenterRuleLineInput = {
  costCenterId: string;
  percentage: number;
  notes?: string | null;
};

export type SupplierCostCenterRuleBatchInput = {
  supplierId: string;
  company?: string | null;
  priority?: number;
  autoApply?: boolean;
  replaceExisting?: boolean;
  rules: SupplierCostCenterRuleLineInput[];
};

export type SupplierCostCenterRuleUpdateInput = {
  percentage?: number;
  priority?: number;
  autoApply?: boolean;
  company?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type SupplierCostCenterRuleListQuery = {
  supplierId?: string;
  company?: string;
  isActive?: boolean;
  costCenterId?: string;
};

export type SupplierCostCenterRulePreviewInput = {
  supplierId: string;
  company?: string | null;
  priority?: number;
  autoApply?: boolean;
  rules: SupplierCostCenterRuleLineInput[];
};

export type SupplierCostCenterRulePreviewCostCenter = {
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  percentage: number;
};

export type SupplierCostCenterRulePreviewPayload = {
  supplier: {
    id: string;
    displayName: string;
    status: string;
  };
  company: string | null;
  priority: number;
  autoApply: boolean;
  costCenters: SupplierCostCenterRulePreviewCostCenter[];
  openTitlesCount: number;
  openAmount: number;
  historicalTitlesCount: number;
  historicalAmount: number;
  manualLockedTitlesCount: number;
  wouldOverwriteCount: number;
  wouldApplyCount: number;
  warnings: string[];
};

export type FinanceSupplierCostCenterRuleUserContext = {
  userId: string | null;
  userName: string | null;
};

export type SupplierWithAliases = {
  id: string;
  displayName: string;
  status: string;
  normalizedDocument: string | null;
  normalizedName: string | null;
  aliases: Array<{
    externalSupplierId: number | null;
    normalizedDocument: string | null;
    normalizedName: string | null;
  }>;
};

export type ApRulePreviewRow = AccountsPayableSupplierRecord & {
  companyName?: string | null;
  balancePayable?: number;
  amountPayable?: number;
  suspendPayment?: boolean | null;
};

export type AllocationPreviewRow = {
  accountsPayableId: number;
  lockedManual: boolean;
  source: string;
};

export type SupplierCostCenterRuleRecord = {
  id: string;
  supplierId: string;
  costCenterId: string;
  percentage: Prisma.Decimal;
  priority: number;
  autoApply: boolean;
  isActive: boolean;
  company: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FinanceSupplierCostCenterRulesDeps = {
  listRules: (query: SupplierCostCenterRuleListQuery) => Promise<SupplierCostCenterRuleRecord[]>;
  findRuleById: (id: string) => Promise<SupplierCostCenterRuleRecord | null>;
  listActiveRulesForScope: (
    supplierId: string,
    company: string | null,
    priority?: number
  ) => Promise<SupplierCostCenterRuleRecord[]>;
  findSupplier: (id: string) => Promise<SupplierWithAliases | null>;
  findCostCenter: (id: string) => Promise<{ id: string; code: string; name: string; status: string } | null>;
  createRules: (
    rows: Array<{
      supplierId: string;
      costCenterId: string;
      percentage: number;
      priority: number;
      autoApply: boolean;
      company: string | null;
      notes: string | null;
      createdByUserId: string | null;
      createdByName: string | null;
    }>
  ) => Promise<SupplierCostCenterRuleRecord[]>;
  updateRule: (
    id: string,
    data: Partial<{
      percentage: number;
      priority: number;
      autoApply: boolean;
      company: string | null;
      notes: string | null;
      isActive: boolean;
    }>
  ) => Promise<SupplierCostCenterRuleRecord>;
  deactivateRules: (ids: string[]) => Promise<void>;
  loadApRows: () => Promise<ApRulePreviewRow[]>;
  loadAllocationsForPayableIds: (ids: number[]) => Promise<AllocationPreviewRow[]>;
  createAuditLog: (data: {
    entityType: string;
    entityId: string;
    action: string;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    userId?: string | null;
    userName?: string | null;
  }) => Promise<void>;
};

function normalizeCompany(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

function decimalToNumber(value: Prisma.Decimal | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return decimalFieldToNumber(value);
}

export function serializeSupplierCostCenterRule(
  row: SupplierCostCenterRuleRecord
): SupplierCostCenterRuleDto {
  const percentage = decimalToNumber(row.percentage);
  return {
    id: row.id,
    supplierId: row.supplierId,
    costCenterId: row.costCenterId,
    percentage,
    priority: row.priority,
    autoApply: row.autoApply,
    isActive: row.isActive,
    company: row.company ?? null,
    notes: row.notes ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function validateSupplierRulePercentageTotal(
  rules: Array<Pick<SupplierCostCenterRuleLineInput, "percentage">>
): void {
  const total = rules.reduce((sum, rule) => sum + Number(rule.percentage ?? 0), 0);
  if (Math.abs(total - 100) > FINANCE_SUPPLIER_RULE_PERCENTAGE_TOLERANCE) {
    throw new FinanceSupplierCostCenterRuleError(
      "INVALID_PERCENTAGE_TOTAL",
      `Rateio deve somar 100% (atual: ${total.toFixed(2)}%).`
    );
  }
}

export function assertNoDuplicateCostCentersInBatch(
  rules: SupplierCostCenterRuleLineInput[]
): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const id = rule.costCenterId.trim();
    if (!id) {
      throw new FinanceSupplierCostCenterRuleError(
        "MISSING_COST_CENTER",
        "costCenterId é obrigatório em cada linha do rateio."
      );
    }
    if (seen.has(id)) {
      throw new FinanceSupplierCostCenterRuleError(
        "DUPLICATE_COST_CENTER_IN_BATCH",
        "Não é permitido repetir o mesmo centro de custo no rateio."
      );
    }
    seen.add(id);
  }
}

export function accountsPayableMatchesFinancialSupplier(
  ap: ApRulePreviewRow,
  supplier: SupplierWithAliases
): boolean {
  const extracted = extractSupplierFromAccountsPayable(ap);

  if (extracted.externalSupplierId != null) {
    if (supplier.aliases.some((alias) => alias.externalSupplierId === extracted.externalSupplierId)) {
      return true;
    }
  }
  if (extracted.normalizedDocument) {
    if (supplier.normalizedDocument === extracted.normalizedDocument) return true;
    if (supplier.aliases.some((alias) => alias.normalizedDocument === extracted.normalizedDocument)) {
      return true;
    }
  }
  if (extracted.normalizedName) {
    if (supplier.normalizedName === extracted.normalizedName) return true;
    if (supplier.aliases.some((alias) => alias.normalizedName === extracted.normalizedName)) {
      return true;
    }
  }
  return false;
}

export function accountsPayableMatchesCompany(
  ap: ApRulePreviewRow,
  company: string | null
): boolean {
  if (!company) return true;
  const apCompany = (ap.companyName ?? "").trim();
  return apCompany.localeCompare(company, "pt-BR", { sensitivity: "accent" }) === 0;
}

export function isManualLockedAllocation(allocation: AllocationPreviewRow): boolean {
  return allocation.lockedManual === true || allocation.source === "MANUAL";
}

export function parseSupplierCostCenterRuleBatchBody(body: unknown): SupplierCostCenterRuleBatchInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceSupplierCostCenterRuleError("INVALID_BODY", "Payload inválido.");
  }
  const payload = body as Record<string, unknown>;
  const supplierId = typeof payload.supplierId === "string" ? payload.supplierId.trim() : "";
  if (!supplierId) {
    throw new FinanceSupplierCostCenterRuleError("MISSING_SUPPLIER", "supplierId é obrigatório.");
  }

  const rawRules = payload.rules;
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new FinanceSupplierCostCenterRuleError(
      "MISSING_RULES",
      "Informe ao menos uma linha em rules."
    );
  }

  const rules: SupplierCostCenterRuleLineInput[] = rawRules.map((item, index) => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw new FinanceSupplierCostCenterRuleError(
        "INVALID_RULE_LINE",
        `Linha ${index + 1} de rules inválida.`
      );
    }
    const row = item as Record<string, unknown>;
    const costCenterId = typeof row.costCenterId === "string" ? row.costCenterId.trim() : "";
    const percentage = Number(row.percentage);
    if (!costCenterId) {
      throw new FinanceSupplierCostCenterRuleError(
        "MISSING_COST_CENTER",
        `Linha ${index + 1}: costCenterId é obrigatório.`
      );
    }
    if (!Number.isFinite(percentage) || percentage <= 0) {
      throw new FinanceSupplierCostCenterRuleError(
        "INVALID_PERCENTAGE",
        `Linha ${index + 1}: percentage deve ser maior que zero.`
      );
    }
    return {
      costCenterId,
      percentage,
      notes: typeof row.notes === "string" ? row.notes.trim() || null : null,
    };
  });

  return {
    supplierId,
    company: normalizeCompany(typeof payload.company === "string" ? payload.company : null),
    priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 100,
    autoApply: payload.autoApply !== false,
    replaceExisting: payload.replaceExisting === true,
    rules,
  };
}

export function parseSupplierCostCenterRulePreviewBody(
  body: unknown
): SupplierCostCenterRulePreviewInput {
  const batch = parseSupplierCostCenterRuleBatchBody(body);
  return {
    supplierId: batch.supplierId,
    company: batch.company ?? null,
    priority: batch.priority ?? 100,
    autoApply: batch.autoApply ?? true,
    rules: batch.rules,
  };
}

export function parseSupplierCostCenterRuleUpdateBody(
  body: unknown
): SupplierCostCenterRuleUpdateInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceSupplierCostCenterRuleError("INVALID_BODY", "Payload inválido.");
  }
  const payload = body as Record<string, unknown>;
  const input: SupplierCostCenterRuleUpdateInput = {};
  if (payload.percentage !== undefined) {
    const percentage = Number(payload.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0) {
      throw new FinanceSupplierCostCenterRuleError(
        "INVALID_PERCENTAGE",
        "percentage deve ser maior que zero."
      );
    }
    input.percentage = percentage;
  }
  if (payload.priority !== undefined) {
    const priority = Number(payload.priority);
    if (!Number.isFinite(priority)) {
      throw new FinanceSupplierCostCenterRuleError("INVALID_PRIORITY", "priority inválido.");
    }
    input.priority = priority;
  }
  if (payload.autoApply !== undefined) input.autoApply = Boolean(payload.autoApply);
  if (payload.company !== undefined) {
    input.company = normalizeCompany(typeof payload.company === "string" ? payload.company : null);
  }
  if (payload.notes !== undefined) {
    input.notes = typeof payload.notes === "string" ? payload.notes.trim() || null : null;
  }
  if (payload.isActive !== undefined) input.isActive = Boolean(payload.isActive);
  return input;
}

async function assertSupplierIsActive(
  deps: FinanceSupplierCostCenterRulesDeps,
  supplierId: string
): Promise<SupplierWithAliases> {
  const supplier = await deps.findSupplier(supplierId);
  if (!supplier) {
    throw new FinanceSupplierCostCenterRuleError("SUPPLIER_NOT_FOUND", "Fornecedor não encontrado.");
  }
  if (supplier.status !== "ACTIVE") {
    throw new FinanceSupplierCostCenterRuleError(
      "INACTIVE_SUPPLIER",
      "Regra ativa exige fornecedor com status ACTIVE."
    );
  }
  return supplier;
}

async function assertCostCenterIsActive(
  deps: FinanceSupplierCostCenterRulesDeps,
  costCenterId: string
): Promise<{ id: string; code: string; name: string; status: string }> {
  const costCenter = await deps.findCostCenter(costCenterId);
  if (!costCenter) {
    throw new FinanceSupplierCostCenterRuleError(
      "COST_CENTER_NOT_FOUND",
      "Centro de custo não encontrado."
    );
  }
  if (costCenter.status !== "ACTIVE") {
    throw new FinanceSupplierCostCenterRuleError(
      "INACTIVE_COST_CENTER",
      "Regra ativa exige centro de custo com status ACTIVE."
    );
  }
  return costCenter;
}

async function assertNoPriorityConflict(
  deps: FinanceSupplierCostCenterRulesDeps,
  supplierId: string,
  company: string | null,
  priority: number,
  replaceExisting: boolean
): Promise<void> {
  const existing = await deps.listActiveRulesForScope(supplierId, company, priority);
  if (existing.length === 0) return;
  if (replaceExisting) return;
  throw new FinanceSupplierCostCenterRuleError(
    "CONFLICTING_PRIORITY",
    `Já existem regras ativas para este fornecedor/empresa com prioridade ${priority}. Use replaceExisting=true para substituir.`
  );
}

export async function listSupplierCostCenterRules(
  deps: FinanceSupplierCostCenterRulesDeps,
  query: SupplierCostCenterRuleListQuery = {}
): Promise<{ items: SupplierCostCenterRuleDto[] }> {
  const rows = await deps.listRules(query);
  return { items: rows.map(serializeSupplierCostCenterRule) };
}

export async function createSupplierCostCenterRulesBatch(
  deps: FinanceSupplierCostCenterRulesDeps,
  input: SupplierCostCenterRuleBatchInput,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<{ items: SupplierCostCenterRuleDto[] }> {
  await assertSupplierIsActive(deps, input.supplierId);
  assertNoDuplicateCostCentersInBatch(input.rules);
  validateSupplierRulePercentageTotal(input.rules);

  const company = normalizeCompany(input.company);
  const priority = input.priority ?? 100;
  await assertNoPriorityConflict(
    deps,
    input.supplierId,
    company,
    priority,
    input.replaceExisting === true
  );

  for (const line of input.rules) {
    await assertCostCenterIsActive(deps, line.costCenterId);
  }

  if (input.replaceExisting) {
    const existing = await deps.listActiveRulesForScope(input.supplierId, company, priority);
    if (existing.length > 0) {
      await deps.deactivateRules(existing.map((rule) => rule.id));
      for (const rule of existing) {
        await deps.createAuditLog({
          entityType: FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
          entityId: rule.id,
          action: FINANCE_SUPPLIER_RULE_AUDIT_ACTION.DEACTIVATE,
          beforeJson: serializeSupplierCostCenterRule(rule),
          userId: user.userId,
          userName: user.userName,
        });
      }
    }
  }

  const created = await deps.createRules(
    input.rules.map((line) => ({
      supplierId: input.supplierId,
      costCenterId: line.costCenterId,
      percentage: line.percentage,
      priority,
      autoApply: input.autoApply !== false,
      company,
      notes: line.notes ?? null,
      createdByUserId: user.userId,
      createdByName: user.userName,
    }))
  );

  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
    entityId: `batch-${input.supplierId}-${Date.now()}`,
    action: FINANCE_SUPPLIER_RULE_AUDIT_ACTION.BATCH_CREATE,
    afterJson: {
      supplierId: input.supplierId,
      company,
      priority,
      rules: created.map(serializeSupplierCostCenterRule),
    },
    userId: user.userId,
    userName: user.userName,
  });

  for (const rule of created) {
    await deps.createAuditLog({
      entityType: FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
      entityId: rule.id,
      action: FINANCE_SUPPLIER_RULE_AUDIT_ACTION.CREATE,
      afterJson: serializeSupplierCostCenterRule(rule),
      userId: user.userId,
      userName: user.userName,
    });
  }

  return { items: created.map(serializeSupplierCostCenterRule) };
}

export async function updateSupplierCostCenterRule(
  deps: FinanceSupplierCostCenterRulesDeps,
  id: string,
  input: SupplierCostCenterRuleUpdateInput,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<SupplierCostCenterRuleDto> {
  const current = await deps.findRuleById(id);
  if (!current) {
    throw new FinanceSupplierCostCenterRuleError("NOT_FOUND", "Regra não encontrada.");
  }

  const before = serializeSupplierCostCenterRule(current);
  const nextActive = input.isActive ?? current.isActive;

  if (nextActive) {
    await assertSupplierIsActive(deps, current.supplierId);
    await assertCostCenterIsActive(deps, current.costCenterId);
  }

  const nextPercentage = input.percentage ?? decimalToNumber(current.percentage);
  const nextCompany = input.company !== undefined ? input.company : current.company;
  const nextPriority = input.priority ?? current.priority;

  if (nextActive) {
    const siblings = (await deps.listActiveRulesForScope(current.supplierId, nextCompany, nextPriority))
      .filter((rule) => rule.id !== id);
    const lines = [
      ...siblings.map((rule) => ({ percentage: decimalToNumber(rule.percentage) })),
      { percentage: nextPercentage },
    ];
    validateSupplierRulePercentageTotal(lines);
  }

  const updated = await deps.updateRule(id, {
    percentage: input.percentage,
    priority: input.priority,
    autoApply: input.autoApply,
    company: input.company,
    notes: input.notes,
    isActive: input.isActive,
  });

  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
    entityId: id,
    action: FINANCE_SUPPLIER_RULE_AUDIT_ACTION.UPDATE,
    beforeJson: before,
    afterJson: serializeSupplierCostCenterRule(updated),
    userId: user.userId,
    userName: user.userName,
  });

  return serializeSupplierCostCenterRule(updated);
}

export async function deactivateSupplierCostCenterRule(
  deps: FinanceSupplierCostCenterRulesDeps,
  id: string,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<SupplierCostCenterRuleDto> {
  const current = await deps.findRuleById(id);
  if (!current) {
    throw new FinanceSupplierCostCenterRuleError("NOT_FOUND", "Regra não encontrada.");
  }
  if (!current.isActive) {
    return serializeSupplierCostCenterRule(current);
  }

  const before = serializeSupplierCostCenterRule(current);
  const updated = await deps.updateRule(id, { isActive: false });

  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_RULE_AUDIT_ENTITY,
    entityId: id,
    action: FINANCE_SUPPLIER_RULE_AUDIT_ACTION.DEACTIVATE,
    beforeJson: before,
    afterJson: serializeSupplierCostCenterRule(updated),
    userId: user.userId,
    userName: user.userName,
  });

  return serializeSupplierCostCenterRule(updated);
}

export async function previewSupplierCostCenterRuleImpact(
  deps: FinanceSupplierCostCenterRulesDeps,
  input: SupplierCostCenterRulePreviewInput
): Promise<SupplierCostCenterRulePreviewPayload> {
  const supplier = await assertSupplierIsActive(deps, input.supplierId);
  assertNoDuplicateCostCentersInBatch(input.rules);
  validateSupplierRulePercentageTotal(input.rules);

  const company = normalizeCompany(input.company);
  const warnings: string[] = [];

  const costCenters: SupplierCostCenterRulePreviewCostCenter[] = [];
  for (const line of input.rules) {
    const cc = await assertCostCenterIsActive(deps, line.costCenterId);
    costCenters.push({
      costCenterId: cc.id,
      costCenterCode: cc.code,
      costCenterName: cc.name,
      percentage: line.percentage,
    });
  }

  const apRows = await deps.loadApRows();
  const matched = apRows.filter(
    (row) =>
      accountsPayableMatchesFinancialSupplier(row, supplier) &&
      accountsPayableMatchesCompany(row, company)
  );

  const payableIds = matched.map((row) => row.externalId);
  const allocations = await deps.loadAllocationsForPayableIds(payableIds);
  const allocationsByPayable = new Map<number, AllocationPreviewRow[]>();
  for (const allocation of allocations) {
    const list = allocationsByPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    allocationsByPayable.set(allocation.accountsPayableId, list);
  }

  let openTitlesCount = 0;
  let openAmount = 0;
  let historicalTitlesCount = 0;
  let historicalAmount = 0;
  let manualLockedTitlesCount = 0;
  let wouldOverwriteCount = 0;
  let wouldApplyCount = 0;

  for (const row of matched) {
    const balance = Math.abs(Number(row.balancePayable ?? 0));
    const amount = Math.abs(Number(row.amountPayable ?? balance));
    const open = isAccountsPayableOpen({
      balancePayable: row.balancePayable,
      suspendPayment: row.suspendPayment,
    });

    if (open) {
      openTitlesCount += 1;
      openAmount += balance > 0 ? balance : amount;
    } else {
      historicalTitlesCount += 1;
      historicalAmount += amount;
    }

    const rowAllocations = allocationsByPayable.get(row.externalId) ?? [];
    const hasManualLock = rowAllocations.some(isManualLockedAllocation);
    if (hasManualLock) {
      manualLockedTitlesCount += 1;
      warnings.push(`MANUAL_LOCKED:${row.externalId}`);
      continue;
    }

    if (rowAllocations.length > 0) {
      wouldOverwriteCount += 1;
    } else {
      wouldApplyCount += 1;
    }
  }

  if (matched.length === 0) {
    warnings.push("NO_MATCHING_AP_TITLES");
  }
  if (manualLockedTitlesCount > 0) {
    warnings.push(`MANUAL_LOCKED_COUNT:${manualLockedTitlesCount}`);
  }

  return {
    supplier: {
      id: supplier.id,
      displayName: supplier.displayName,
      status: supplier.status,
    },
    company,
    priority: input.priority ?? 100,
    autoApply: input.autoApply !== false,
    costCenters,
    openTitlesCount,
    openAmount: roundMoney(openAmount),
    historicalTitlesCount,
    historicalAmount: roundMoney(historicalAmount),
    manualLockedTitlesCount,
    wouldOverwriteCount,
    wouldApplyCount,
    warnings,
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

const AP_RULE_PREVIEW_SELECT = {
  externalId: true,
  personId: true,
  personName: true,
  personCnpj: true,
  companyId: true,
  companyName: true,
  rawPayload: true,
  balancePayable: true,
  amountPayable: true,
  suspendPayment: true,
} as const;

export function createDefaultFinanceSupplierCostCenterRulesDeps(): FinanceSupplierCostCenterRulesDeps {
  return {
    listRules: async (query) => {
      const where: Prisma.SupplierCostCenterRuleWhereInput = {};
      if (query.supplierId) where.supplierId = query.supplierId;
      if (query.company) where.company = query.company;
      if (query.costCenterId) where.costCenterId = query.costCenterId;
      if (query.isActive !== undefined) where.isActive = query.isActive;
      return prisma.supplierCostCenterRule.findMany({
        where,
        orderBy: [{ supplierId: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      });
    },
    findRuleById: async (id) => prisma.supplierCostCenterRule.findUnique({ where: { id } }),
    listActiveRulesForScope: async (supplierId, company, priority) =>
      prisma.supplierCostCenterRule.findMany({
        where: {
          supplierId,
          isActive: true,
          company,
          ...(priority != null ? { priority } : {}),
        },
      }),
    findSupplier: async (id) =>
      prisma.financialSupplier.findUnique({
        where: { id },
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
    findCostCenter: async (id) =>
      prisma.financialCostCenter.findUnique({
        where: { id },
        select: { id: true, code: true, name: true, status: true },
      }),
    createRules: async (rows) => {
      const created: SupplierCostCenterRuleRecord[] = [];
      for (const row of rows) {
        const item = await prisma.supplierCostCenterRule.create({
          data: {
            supplierId: row.supplierId,
            costCenterId: row.costCenterId,
            percentage: new Prisma.Decimal(row.percentage),
            priority: row.priority,
            autoApply: row.autoApply,
            isActive: true,
            company: row.company,
            notes: row.notes,
            createdByUserId: row.createdByUserId,
            createdByName: row.createdByName,
          },
        });
        created.push(item);
      }
      return created;
    },
    updateRule: async (id, data) =>
      prisma.supplierCostCenterRule.update({
        where: { id },
        data: {
          percentage: data.percentage != null ? new Prisma.Decimal(data.percentage) : undefined,
          priority: data.priority,
          autoApply: data.autoApply,
          company: data.company,
          notes: data.notes,
          isActive: data.isActive,
        },
      }),
    deactivateRules: async (ids) => {
      await prisma.supplierCostCenterRule.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false },
      });
    },
    loadApRows: async () => {
      const rows = await prisma.nomusAccountsPayable.findMany({
        select: AP_RULE_PREVIEW_SELECT,
        orderBy: { externalId: "asc" },
      });
      return rows.map((row) => ({
        externalId: row.externalId,
        personId: row.personId,
        personName: row.personName,
        personCnpj: row.personCnpj,
        companyId: row.companyId,
        companyName: row.companyName,
        rawPayload: row.rawPayload,
        balancePayable: decimalFieldToNumber(row.balancePayable),
        amountPayable: decimalFieldToNumber(row.amountPayable),
        suspendPayment: row.suspendPayment,
      }));
    },
    loadAllocationsForPayableIds: async (ids) => {
      if (ids.length === 0) return [];
      const rows = await prisma.accountsPayableCostCenterAllocation.findMany({
        where: { accountsPayableId: { in: ids } },
        select: { accountsPayableId: true, lockedManual: true, source: true },
      });
      return rows.map((row) => ({
        accountsPayableId: row.accountsPayableId,
        lockedManual: row.lockedManual,
        source: row.source,
      }));
    },
    createAuditLog: async (data) => {
      await prisma.financialCostCenterAuditLog.create({ data });
    },
  };
}

export async function listSupplierCostCenterRulesDefault(
  query?: SupplierCostCenterRuleListQuery
): Promise<{ items: SupplierCostCenterRuleDto[] }> {
  return listSupplierCostCenterRules(createDefaultFinanceSupplierCostCenterRulesDeps(), query);
}

export async function createSupplierCostCenterRulesBatchDefault(
  input: SupplierCostCenterRuleBatchInput,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<{ items: SupplierCostCenterRuleDto[] }> {
  return createSupplierCostCenterRulesBatch(
    createDefaultFinanceSupplierCostCenterRulesDeps(),
    input,
    user
  );
}

export async function updateSupplierCostCenterRuleDefault(
  id: string,
  input: SupplierCostCenterRuleUpdateInput,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<SupplierCostCenterRuleDto> {
  return updateSupplierCostCenterRule(
    createDefaultFinanceSupplierCostCenterRulesDeps(),
    id,
    input,
    user
  );
}

export async function deactivateSupplierCostCenterRuleDefault(
  id: string,
  user: FinanceSupplierCostCenterRuleUserContext
): Promise<SupplierCostCenterRuleDto> {
  return deactivateSupplierCostCenterRule(
    createDefaultFinanceSupplierCostCenterRulesDeps(),
    id,
    user
  );
}

export async function previewSupplierCostCenterRuleImpactDefault(
  input: SupplierCostCenterRulePreviewInput
): Promise<SupplierCostCenterRulePreviewPayload> {
  return previewSupplierCostCenterRuleImpact(
    createDefaultFinanceSupplierCostCenterRulesDeps(),
    input
  );
}

// Re-export helpers used in tests for supplier document/name normalization paths
export { normalizeSupplierDocument, normalizeSupplierName };
