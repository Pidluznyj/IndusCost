import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  evaluateClassificationRuleCandidate,
  resolveBestClassificationMatch,
  type ClassificationApRow,
  type ClassificationRuleCandidate,
  type ResolvedClassificationMatch,
} from "@/src/lib/financeCostCenterClassificationRuleMatcher.js";
import {
  FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT,
  FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION,
  FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
  FINANCE_CLASSIFICATION_RULE_TYPES,
  FINANCE_ESTORNOS_COST_CENTER_CODE,
  FINANCE_ESTORNOS_COST_CENTER_NAME,
  FINANCE_ESTORNOS_KEYWORDS,
  FINANCE_ESTORNOS_RULE_NAME,
  type ClassificationRuleApplyResult,
  type ClassificationRuleDto,
  type ClassificationRulePreviewPayload,
  type FinancialCostCenterClassificationRuleType,
} from "@/src/lib/financeCostCenterClassificationRulesShared.js";
import {
  hasManualLockedAllocation,
  isTitleInClosedPeriod,
  resolveSupplierForAccountsPayable,
  resolveTitleAllocationBaseAmount,
  splitAmountByPercentages,
  type ApAllocationTitleRow,
  type FinanceApAllocationDeps,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import { FINANCE_AP_ALLOCATION_AUDIT_ACTION, FINANCE_AP_ALLOCATION_AUDIT_ENTITY } from "@/src/lib/financeApAllocationShared.js";
import type { SupplierWithAliases } from "@/src/lib/financeSupplierCostCenterRules.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceClassificationRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceClassificationRuleError";
    this.code = code;
  }
}

export type ClassificationRuleInput = {
  name: string;
  ruleType: FinancialCostCenterClassificationRuleType;
  costCenterId: string;
  percentage?: number;
  priority?: number;
  isActive?: boolean;
  autoApply?: boolean;
  supplierId?: string | null;
  nomusClassification?: string | null;
  descriptionContains?: string | null;
  documentContains?: string | null;
  keywords?: string[];
  financialNature?: string | null;
  company?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  titleStatus?: string | null;
  accountsPayableId?: number | null;
  notes?: string | null;
};

export type ClassificationRuleListQuery = {
  ruleType?: FinancialCostCenterClassificationRuleType;
  isActive?: boolean;
  costCenterId?: string;
  supplierId?: string;
};

export type FinanceClassificationRuleUserContext = {
  userId: string | null;
  userName: string | null;
};

const AP_RULE_SELECT = {
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
  competenceDate: true,
  dueDate: true,
} as const;

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function mapRuleRecord(row: {
  id: string;
  name: string;
  ruleType: FinancialCostCenterClassificationRuleType;
  costCenterId: string;
  percentage: Prisma.Decimal;
  priority: number;
  isActive: boolean;
  autoApply: boolean;
  supplierId: string | null;
  nomusClassification: string | null;
  descriptionContains: string | null;
  documentContains: string | null;
  keywords: unknown;
  financialNature: string | null;
  company: string | null;
  minAmount: Prisma.Decimal | null;
  maxAmount: Prisma.Decimal | null;
  titleStatus: string | null;
  accountsPayableId: number | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  costCenter?: { code: string; name: string } | null;
  supplier?: { displayName: string } | null;
}): ClassificationRuleDto {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.ruleType,
    costCenterId: row.costCenterId,
    percentage: decimalFieldToNumber(row.percentage),
    priority: row.priority,
    isActive: row.isActive,
    autoApply: row.autoApply,
    supplierId: row.supplierId,
    nomusClassification: row.nomusClassification,
    descriptionContains: row.descriptionContains,
    documentContains: row.documentContains,
    keywords: parseKeywords(row.keywords),
    financialNature: row.financialNature,
    company: row.company,
    minAmount: row.minAmount != null ? decimalFieldToNumber(row.minAmount) : null,
    maxAmount: row.maxAmount != null ? decimalFieldToNumber(row.maxAmount) : null,
    titleStatus: row.titleStatus,
    accountsPayableId: row.accountsPayableId,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    costCenterCode: row.costCenter?.code ?? null,
    costCenterName: row.costCenter?.name ?? null,
    supplierName: row.supplier?.displayName ?? null,
  };
}

function mapApToClassificationRow(row: ApAllocationTitleRow): ClassificationApRow {
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
    balancePayable: row.balancePayable,
    amountPayable: row.amountPayable,
    rawPayload: row.rawPayload,
  };
}

function mapCandidate(rule: ClassificationRuleDto): ClassificationRuleCandidate {
  return {
    id: rule.id,
    name: rule.name,
    ruleType: rule.ruleType,
    costCenterId: rule.costCenterId,
    percentage: rule.percentage,
    priority: rule.priority,
    autoApply: rule.autoApply,
    isActive: rule.isActive,
    supplierId: rule.supplierId,
    nomusClassification: rule.nomusClassification,
    descriptionContains: rule.descriptionContains,
    documentContains: rule.documentContains,
    keywords: rule.keywords,
    financialNature: rule.financialNature,
    company: rule.company,
    minAmount: rule.minAmount,
    maxAmount: rule.maxAmount,
    titleStatus: rule.titleStatus,
    accountsPayableId: rule.accountsPayableId,
  };
}

function validateRuleInput(input: ClassificationRuleInput): void {
  if (!input.name?.trim()) {
    throw new FinanceClassificationRuleError("MISSING_NAME", "Nome da regra é obrigatório.");
  }
  if (!input.costCenterId?.trim()) {
    throw new FinanceClassificationRuleError("MISSING_COST_CENTER", "Centro de custo é obrigatório.");
  }
  const validTypes = FINANCE_CLASSIFICATION_RULE_TYPES.map((row) => row.value);
  if (!validTypes.includes(input.ruleType)) {
    throw new FinanceClassificationRuleError("INVALID_RULE_TYPE", "Tipo de regra inválido.");
  }
  const pct = input.percentage ?? 100;
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new FinanceClassificationRuleError("INVALID_PERCENTAGE", "Percentual inválido.");
  }

  switch (input.ruleType) {
    case "NOMUS_CLASSIFICATION":
      if (!input.nomusClassification?.trim()) {
        throw new FinanceClassificationRuleError(
          "MISSING_NOMUS_CLASSIFICATION",
          "Classificação Nomus é obrigatória para este tipo."
        );
      }
      break;
    case "DESCRIPTION_CONTAINS":
      if (!input.descriptionContains?.trim()) {
        throw new FinanceClassificationRuleError(
          "MISSING_DESCRIPTION",
          "Texto de descrição é obrigatório para este tipo."
        );
      }
      break;
    case "DOCUMENT_CONTAINS":
      if (!input.documentContains?.trim()) {
        throw new FinanceClassificationRuleError(
          "MISSING_DOCUMENT",
          "Texto de documento é obrigatório para este tipo."
        );
      }
      break;
    case "KEYWORDS":
      if (!input.keywords?.length) {
        throw new FinanceClassificationRuleError(
          "MISSING_KEYWORDS",
          "Informe ao menos uma palavra-chave."
        );
      }
      break;
    case "FINANCIAL_NATURE":
      if (!input.financialNature?.trim()) {
        throw new FinanceClassificationRuleError(
          "MISSING_NATURE",
          "Natureza financeira é obrigatória para este tipo."
        );
      }
      break;
    case "MANUAL":
      if (input.accountsPayableId == null || !Number.isFinite(input.accountsPayableId)) {
        throw new FinanceClassificationRuleError(
          "MISSING_AP_ID",
          "ID do título AP é obrigatório para regra manual."
        );
      }
      break;
    case "COMPOSITE":
      if (
        !input.supplierId &&
        !input.descriptionContains?.trim() &&
        !input.nomusClassification?.trim() &&
        !input.keywords?.length
      ) {
        throw new FinanceClassificationRuleError(
          "MISSING_COMPOSITE_CRITERIA",
          "Regra composta exige fornecedor e/ou critério adicional."
        );
      }
      break;
    case "SUPPLIER":
      if (!input.supplierId?.trim()) {
        throw new FinanceClassificationRuleError(
          "MISSING_SUPPLIER",
          "Fornecedor é obrigatório para regra por fornecedor neste cadastro."
        );
      }
      break;
    default:
      break;
  }
}

export function parseClassificationRuleBody(body: unknown): ClassificationRuleInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceClassificationRuleError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  const ruleType = typeof record.ruleType === "string" ? record.ruleType.trim() : "";
  return {
    name: typeof record.name === "string" ? record.name.trim() : "",
    ruleType: ruleType as FinancialCostCenterClassificationRuleType,
    costCenterId: typeof record.costCenterId === "string" ? record.costCenterId.trim() : "",
    percentage: record.percentage == null ? 100 : Number(record.percentage),
    priority: record.priority == null ? 100 : Number(record.priority),
    isActive: record.isActive === false ? false : true,
    autoApply: record.autoApply === true,
    supplierId:
      typeof record.supplierId === "string" && record.supplierId.trim()
        ? record.supplierId.trim()
        : null,
    nomusClassification:
      typeof record.nomusClassification === "string" ? record.nomusClassification.trim() : null,
    descriptionContains:
      typeof record.descriptionContains === "string" ? record.descriptionContains.trim() : null,
    documentContains:
      typeof record.documentContains === "string" ? record.documentContains.trim() : null,
    keywords: parseKeywords(record.keywords),
    financialNature:
      typeof record.financialNature === "string" ? record.financialNature.trim() : null,
    company: typeof record.company === "string" ? record.company.trim() : null,
    minAmount: record.minAmount == null ? null : Number(record.minAmount),
    maxAmount: record.maxAmount == null ? null : Number(record.maxAmount),
    titleStatus: typeof record.titleStatus === "string" ? record.titleStatus.trim() : null,
    accountsPayableId:
      record.accountsPayableId == null ? null : Number(record.accountsPayableId),
    notes: typeof record.notes === "string" ? record.notes : null,
  };
}

export async function ensureEstornosClassificationDefaults(): Promise<void> {
  const parent = await prisma.financialCostCenter.findFirst({
    where: {
      OR: [{ code: "CC_ADMINISTRATIVO" }, { name: { equals: "ADMINISTRATIVO", mode: "insensitive" } }],
    },
    select: { id: true },
  });

  let costCenter = await prisma.financialCostCenter.findUnique({
    where: { code: FINANCE_ESTORNOS_COST_CENTER_CODE },
    select: { id: true },
  });

  if (!costCenter) {
    costCenter = await prisma.financialCostCenter.create({
      data: {
        code: FINANCE_ESTORNOS_COST_CENTER_CODE,
        name: FINANCE_ESTORNOS_COST_CENTER_NAME,
        parentId: parent?.id ?? null,
        status: "ACTIVE",
        description: "Estornos, ressarcimentos e devoluções a clientes.",
      },
      select: { id: true },
    });
  }

  const existingRule = await prisma.financialCostCenterClassificationRule.findFirst({
    where: { name: FINANCE_ESTORNOS_RULE_NAME },
    select: { id: true },
  });
  if (existingRule) return;

  await prisma.financialCostCenterClassificationRule.create({
    data: {
      name: FINANCE_ESTORNOS_RULE_NAME,
      ruleType: "KEYWORDS",
      costCenterId: costCenter.id,
      percentage: new Prisma.Decimal(100),
      priority: 200,
      isActive: true,
      autoApply: false,
      keywords: [...FINANCE_ESTORNOS_KEYWORDS],
      notes:
        "Classifica estornos/ressarcimentos por palavras-chave. Use preview antes de aplicar.",
    },
  });
}

export async function listClassificationRulesDefault(
  query: ClassificationRuleListQuery = {}
): Promise<{ items: ClassificationRuleDto[] }> {
  await ensureEstornosClassificationDefaults();
  const rows = await prisma.financialCostCenterClassificationRule.findMany({
    where: {
      ...(query.ruleType ? { ruleType: query.ruleType } : {}),
      ...(query.isActive != null ? { isActive: query.isActive } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    },
    include: {
      costCenter: { select: { code: true, name: true } },
      supplier: { select: { displayName: true } },
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  return { items: rows.map(mapRuleRecord) };
}

export async function createClassificationRuleDefault(
  input: ClassificationRuleInput,
  user: FinanceClassificationRuleUserContext
): Promise<ClassificationRuleDto> {
  validateRuleInput(input);
  const center = await prisma.financialCostCenter.findUnique({
    where: { id: input.costCenterId },
    select: { id: true, status: true },
  });
  if (!center || center.status !== "ACTIVE") {
    throw new FinanceClassificationRuleError("INVALID_COST_CENTER", "Centro de custo inválido ou inativo.");
  }

  const row = await prisma.financialCostCenterClassificationRule.create({
    data: {
      name: input.name.trim(),
      ruleType: input.ruleType,
      costCenterId: input.costCenterId,
      percentage: new Prisma.Decimal(input.percentage ?? 100),
      priority: input.priority ?? 100,
      isActive: input.isActive !== false,
      autoApply: input.autoApply === true,
      supplierId: input.supplierId ?? null,
      nomusClassification: input.nomusClassification ?? null,
      descriptionContains: input.descriptionContains ?? null,
      documentContains: input.documentContains ?? null,
      keywords: input.keywords ?? [],
      financialNature: input.financialNature ?? null,
      company: input.company ?? null,
      minAmount: input.minAmount != null ? new Prisma.Decimal(input.minAmount) : null,
      maxAmount: input.maxAmount != null ? new Prisma.Decimal(input.maxAmount) : null,
      titleStatus: input.titleStatus ?? null,
      accountsPayableId: input.accountsPayableId ?? null,
      notes: input.notes ?? null,
      createdByUserId: user.userId,
      createdByName: user.userName,
    },
    include: {
      costCenter: { select: { code: true, name: true } },
      supplier: { select: { displayName: true } },
    },
  });

  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
      entityId: row.id,
      action: FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.CREATE,
      afterJson: mapRuleRecord(row) as unknown as Prisma.InputJsonValue,
      userId: user.userId,
      userName: user.userName,
    },
  });

  return mapRuleRecord(row);
}

export async function updateClassificationRuleDefault(
  id: string,
  input: Partial<ClassificationRuleInput>,
  user: FinanceClassificationRuleUserContext
): Promise<ClassificationRuleDto> {
  const existing = await prisma.financialCostCenterClassificationRule.findUnique({ where: { id } });
  if (!existing) {
    throw new FinanceClassificationRuleError("NOT_FOUND", "Regra não encontrada.");
  }
  const merged: ClassificationRuleInput = {
    name: input.name ?? existing.name,
    ruleType: input.ruleType ?? existing.ruleType,
    costCenterId: input.costCenterId ?? existing.costCenterId,
    percentage: input.percentage ?? decimalFieldToNumber(existing.percentage),
    priority: input.priority ?? existing.priority,
    isActive: input.isActive ?? existing.isActive,
    autoApply: input.autoApply ?? existing.autoApply,
    supplierId: input.supplierId !== undefined ? input.supplierId : existing.supplierId,
    nomusClassification:
      input.nomusClassification !== undefined
        ? input.nomusClassification
        : existing.nomusClassification,
    descriptionContains:
      input.descriptionContains !== undefined
        ? input.descriptionContains
        : existing.descriptionContains,
    documentContains:
      input.documentContains !== undefined ? input.documentContains : existing.documentContains,
    keywords: input.keywords ?? parseKeywords(existing.keywords),
    financialNature:
      input.financialNature !== undefined ? input.financialNature : existing.financialNature,
    company: input.company !== undefined ? input.company : existing.company,
    minAmount:
      input.minAmount !== undefined
        ? input.minAmount
        : existing.minAmount != null
          ? decimalFieldToNumber(existing.minAmount)
          : null,
    maxAmount:
      input.maxAmount !== undefined
        ? input.maxAmount
        : existing.maxAmount != null
          ? decimalFieldToNumber(existing.maxAmount)
          : null,
    titleStatus: input.titleStatus !== undefined ? input.titleStatus : existing.titleStatus,
    accountsPayableId:
      input.accountsPayableId !== undefined ? input.accountsPayableId : existing.accountsPayableId,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  };
  validateRuleInput(merged);

  const row = await prisma.financialCostCenterClassificationRule.update({
    where: { id },
    data: {
      name: merged.name.trim(),
      ruleType: merged.ruleType,
      costCenterId: merged.costCenterId,
      percentage: new Prisma.Decimal(merged.percentage ?? 100),
      priority: merged.priority ?? 100,
      isActive: merged.isActive !== false,
      autoApply: merged.autoApply === true,
      supplierId: merged.supplierId ?? null,
      nomusClassification: merged.nomusClassification ?? null,
      descriptionContains: merged.descriptionContains ?? null,
      documentContains: merged.documentContains ?? null,
      keywords: merged.keywords ?? [],
      financialNature: merged.financialNature ?? null,
      company: merged.company ?? null,
      minAmount: merged.minAmount != null ? new Prisma.Decimal(merged.minAmount) : null,
      maxAmount: merged.maxAmount != null ? new Prisma.Decimal(merged.maxAmount) : null,
      titleStatus: merged.titleStatus ?? null,
      accountsPayableId: merged.accountsPayableId ?? null,
      notes: merged.notes ?? null,
    },
    include: {
      costCenter: { select: { code: true, name: true } },
      supplier: { select: { displayName: true } },
    },
  });

  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
      entityId: row.id,
      action: FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.UPDATE,
      beforeJson: mapRuleRecord(existing) as unknown as Prisma.InputJsonValue,
      afterJson: mapRuleRecord(row) as unknown as Prisma.InputJsonValue,
      userId: user.userId,
      userName: user.userName,
    },
  });

  return mapRuleRecord(row);
}

export async function deactivateClassificationRuleDefault(
  id: string,
  user: FinanceClassificationRuleUserContext
): Promise<void> {
  const existing = await prisma.financialCostCenterClassificationRule.findUnique({ where: { id } });
  if (!existing) {
    throw new FinanceClassificationRuleError("NOT_FOUND", "Regra não encontrada.");
  }
  const row = await prisma.financialCostCenterClassificationRule.update({
    where: { id },
    data: { isActive: false },
    include: {
      costCenter: { select: { code: true, name: true } },
      supplier: { select: { displayName: true } },
    },
  });
  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
      entityId: id,
      action: FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.DEACTIVATE,
      beforeJson: mapRuleRecord(existing) as unknown as Prisma.InputJsonValue,
      afterJson: mapRuleRecord(row) as unknown as Prisma.InputJsonValue,
      userId: user.userId,
      userName: user.userName,
    },
  });
}

async function loadPreviewContext() {
  const [apRows, suppliers, classificationRules, supplierRules] = await Promise.all([
    prisma.nomusAccountsPayable.findMany({
      select: AP_RULE_SELECT,
      orderBy: { externalId: "asc" },
    }),
    prisma.financialSupplier.findMany({
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
    prisma.financialCostCenterClassificationRule.findMany({
      where: { isActive: true },
    }),
    prisma.supplierCostCenterRule.findMany({ where: { isActive: true } }),
  ]);

  const classificationCandidates = classificationRules.map((row) =>
    mapCandidate(mapRuleRecord(row))
  );

  return {
    apRows: apRows.map((row) => ({
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
      competenceDate: row.competenceDate,
      dueDate: row.dueDate,
    })),
    suppliers,
    classificationCandidates,
    supplierRules: supplierRules.map((row) => ({
      id: row.id,
      supplierId: row.supplierId,
      costCenterId: row.costCenterId,
      percentage: decimalFieldToNumber(row.percentage),
      priority: row.priority,
      autoApply: row.autoApply,
      isActive: row.isActive,
      company: row.company,
    })),
  };
}

function ruleWouldWin(
  ap: ClassificationApRow,
  supplier: SupplierWithAliases | null,
  targetRule: ClassificationRuleDto,
  context: Awaited<ReturnType<typeof loadPreviewContext>>
): ResolvedClassificationMatch | null {
  const candidate = mapCandidate(targetRule);
  const evaluation = evaluateClassificationRuleCandidate(ap, candidate, supplier, {
    requireAutoApply: false,
  });
  if (!evaluation.matches) return null;

  const best = resolveBestClassificationMatch({
    ap,
    supplier,
    supplierRules: context.supplierRules,
    classificationRules: context.classificationCandidates,
    requireAutoApply: false,
  });
  if (!best) return null;
  if (best.kind === "CLASSIFICATION" && best.ruleId === targetRule.id) return best;
  return null;
}

async function previewClassificationRuleWithRule(
  rule: ClassificationRuleDto
): Promise<ClassificationRulePreviewPayload> {
  const context = await loadPreviewContext();
  const allocations = await prisma.accountsPayableCostCenterAllocation.findMany({
    select: { accountsPayableId: true, lockedManual: true },
  });
  const lockedIds = new Set(
    allocations.filter((row) => row.lockedManual).map((row) => row.accountsPayableId)
  );
  const allocatedIds = new Set(allocations.map((row) => row.accountsPayableId));

  let matchedTitlesCount = 0;
  let matchedAmount = 0;
  let wouldApplyCount = 0;
  let wouldApplyAmount = 0;
  let manualLockedCount = 0;
  let wouldOverwriteCount = 0;
  let closedPeriodCount = 0;
  const sampleTitles: ClassificationRulePreviewPayload["sampleTitles"] = [];

  for (const ap of context.apRows) {
    const supplier = resolveSupplierForAccountsPayable(ap, context.suppliers);
    const evaluation = evaluateClassificationRuleCandidate(
      mapApToClassificationRow(ap),
      mapCandidate(rule),
      supplier,
      { requireAutoApply: false }
    );
    if (!evaluation.matches) continue;

    const amount = resolveTitleAllocationBaseAmount(ap);
    matchedTitlesCount += 1;
    matchedAmount += amount;

    if (lockedIds.has(ap.externalId)) {
      manualLockedCount += 1;
      continue;
    }
    if (isTitleInClosedPeriod(ap, null)) {
      closedPeriodCount += 1;
    }

    const winner = ruleWouldWin(mapApToClassificationRow(ap), supplier, rule, context);
    if (!winner) continue;

    const action = allocatedIds.has(ap.externalId) ? "replace" : "create";
    if (action === "replace") wouldOverwriteCount += 1;
    wouldApplyCount += 1;
    wouldApplyAmount += amount;

    if (sampleTitles.length < 25) {
      sampleTitles.push({
        accountsPayableId: ap.externalId,
        personName: ap.personName ?? null,
        description: ap.description ?? null,
        amount,
        matchReason: winner.reason,
        action,
      });
    }
  }

  return {
    rule,
    matchedTitlesCount,
    matchedAmount: Math.round(matchedAmount * 100) / 100,
    wouldApplyCount,
    wouldApplyAmount: Math.round(wouldApplyAmount * 100) / 100,
    manualLockedCount,
    wouldOverwriteCount,
    closedPeriodCount,
    warnings:
      manualLockedCount > 0
        ? [`${manualLockedCount} título(s) com alocação manual bloqueada serão ignorados.`]
        : [],
    sampleTitles,
    requiredConfirmationText: FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT,
  };
}

export async function previewClassificationRuleDefault(
  ruleOrId: string
): Promise<ClassificationRulePreviewPayload> {
  const payload = await listClassificationRulesDefault();
  const rule = payload.items.find((row) => row.id === ruleOrId);
  if (!rule) {
    throw new FinanceClassificationRuleError("NOT_FOUND", "Regra não encontrada.");
  }
  return previewClassificationRuleWithRule(rule);
}

export function assertClassificationRuleApplyConfirmation(confirmation: unknown): void {
  const text = typeof confirmation === "string" ? confirmation.trim() : "";
  if (text !== FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT) {
    throw new FinanceClassificationRuleError(
      "INVALID_CONFIRMATION",
      `Confirmação inválida — envie confirmationText exatamente igual a: "${FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT}".`
    );
  }
}

export async function applyClassificationRuleDefault(
  ruleId: string,
  confirmationText: string,
  user: FinanceClassificationRuleUserContext,
  deps: FinanceApAllocationDeps
): Promise<ClassificationRuleApplyResult> {
  assertClassificationRuleApplyConfirmation(confirmationText);
  const payload = await listClassificationRulesDefault();
  const rule = payload.items.find((row) => row.id === ruleId);
  if (!rule || !rule.isActive) {
    throw new FinanceClassificationRuleError("NOT_FOUND", "Regra não encontrada ou inativa.");
  }

  const preview = await previewClassificationRuleDefault(ruleId);
  const context = await loadPreviewContext();

  const toApply: Array<{ ap: ApAllocationTitleRow; match: ResolvedClassificationMatch }> = [];
  for (const ap of context.apRows) {
    const supplier = resolveSupplierForAccountsPayable(ap, context.suppliers);
    const winner = ruleWouldWin(mapApToClassificationRow(ap), supplier, rule, context);
    if (!winner) continue;
    const existing = await deps.loadAllocationsForPayable(ap.externalId);
    if (hasManualLockedAllocation(existing)) continue;
    toApply.push({ ap, match: winner });
  }

  let appliedCount = 0;
  let appliedAmount = 0;

  for (const item of toApply) {
    const titleAmount = resolveTitleAllocationBaseAmount(item.ap);
    const amounts = splitAmountByPercentages(titleAmount, [item.match.percentage]);
    const existing = await deps.loadAllocationsForPayable(item.ap.externalId);
    const removableIds = existing.filter((row) => !row.lockedManual).map((row) => row.id);

    const beforeCenterId = existing[0]?.costCenterId ?? null;
    const created = await deps.replaceAllocationsForPayable(
      item.ap.externalId,
      [
        {
          supplierId: item.match.supplierId,
          costCenterId: item.match.costCenterId,
          amount: amounts[0]!,
          percentage: item.match.percentage,
          source: "AUTO_RULE",
          ruleId: item.match.kind === "SUPPLIER" ? item.match.ruleId : null,
          classificationRuleId: item.match.kind === "CLASSIFICATION" ? item.match.ruleId : null,
          classificationRuleType:
            item.match.kind === "CLASSIFICATION" ? item.match.ruleType : null,
          classificationRuleName: item.match.ruleName,
          classificationRuleReason: item.match.reason,
          lockedManual: false,
          notes: rule.notes,
          createdByUserId: user.userId,
          createdByName: user.userName,
        },
      ],
      removableIds
    );

    appliedCount += 1;
    appliedAmount += titleAmount;

    await prisma.financialCostCenterAuditLog.create({
      data: {
        entityType: FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
        entityId: ruleId,
        action: FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.APPLY,
        beforeJson: {
          accountsPayableId: item.ap.externalId,
          previousCostCenterId: beforeCenterId,
          filtersUsed: { ruleId, ruleType: rule.ruleType, ruleName: rule.name },
        },
        afterJson: {
          accountsPayableId: item.ap.externalId,
          newCostCenterId: item.match.costCenterId,
          affectedAmount: titleAmount,
          allocations: created.map((row) => row.id),
          ruleReason: item.match.reason,
        },
        userId: user.userId,
        userName: user.userName,
      },
    });

    for (const allocation of created) {
      await deps.createAuditLog({
        entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
        entityId: allocation.id,
        action: FINANCE_AP_ALLOCATION_AUDIT_ACTION.CREATE,
        afterJson: {
          accountsPayableId: item.ap.externalId,
          costCenterId: allocation.costCenterId,
          classificationRuleId: ruleId,
          classificationRuleName: rule.name,
        },
        userId: user.userId,
        userName: user.userName,
      });
    }
  }

  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY,
      entityId: ruleId,
      action: FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.APPLY,
      afterJson: {
        appliedCount,
        appliedAmount: Math.round(appliedAmount * 100) / 100,
        skippedCount: preview.matchedTitlesCount - appliedCount,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        reason: rule.notes,
      },
      userId: user.userId,
      userName: user.userName,
    },
  });

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    ruleId,
    appliedCount,
    appliedAmount: Math.round(appliedAmount * 100) / 100,
    skippedCount: preview.matchedTitlesCount - appliedCount,
  };
}

export async function applyClassificationRuleWithDefaultDeps(
  ruleId: string,
  confirmationText: string,
  user: FinanceClassificationRuleUserContext
): Promise<ClassificationRuleApplyResult> {
  const { createDefaultFinanceApAllocationDeps } = await import(
    "@/src/lib/financeAccountsPayableCostCenterAllocation.js"
  );
  return applyClassificationRuleDefault(
    ruleId,
    confirmationText,
    user,
    createDefaultFinanceApAllocationDeps()
  );
}

export async function previewClassificationRuleFromBodyDefault(
  input: ClassificationRuleInput
): Promise<ClassificationRulePreviewPayload> {
  validateRuleInput(input);
  const draftRule: ClassificationRuleDto = {
    id: "__draft__",
    name: input.name.trim(),
    ruleType: input.ruleType,
    costCenterId: input.costCenterId,
    percentage: input.percentage ?? 100,
    priority: input.priority ?? 100,
    isActive: input.isActive !== false,
    autoApply: input.autoApply === true,
    supplierId: input.supplierId ?? null,
    nomusClassification: input.nomusClassification ?? null,
    descriptionContains: input.descriptionContains ?? null,
    documentContains: input.documentContains ?? null,
    keywords: input.keywords ?? [],
    financialNature: input.financialNature ?? null,
    company: input.company ?? null,
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    titleStatus: input.titleStatus ?? null,
    accountsPayableId: input.accountsPayableId ?? null,
    notes: input.notes ?? null,
    createdByUserId: null,
    createdByName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return previewClassificationRuleWithRule(draftRule);
}
