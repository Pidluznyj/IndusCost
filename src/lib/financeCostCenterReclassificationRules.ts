import type { Prisma } from "@prisma/client";
import { FINANCE_AP_ALLOCATION_AUDIT_ENTITY } from "@/src/lib/financeApAllocationShared.js";
import {
  FINANCE_CC_RECLASSIFICATION_AUDIT_ACTION,
  FINANCE_CC_RECLASSIFICATION_DEFAULT_RULE_NAME,
  type ReclassificationAllocationSource,
  type ReclassificationApField,
  type ReclassificationEvaluationInput,
  type ReclassificationEvaluationResult,
  type ReclassificationExample,
  type ReclassificationMatchMode,
  type ReclassificationPreviewResult,
  type ReclassificationRuleMatchFields,
  type ReclassificationRuleRecord,
} from "@/src/lib/financeCostCenterReclassificationShared.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceCostCenterReclassificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceCostCenterReclassificationError";
    this.code = code;
  }
}

export type ReclassificationUserContext = {
  userId: string | null;
  userName: string | null;
};

const DEFAULT_KEYWORDS = [
  "INVESTIMENTO CONSELHO KOPPETEL",
  "FINANCIAMENTO MARCIA",
  "FINANCIAMENTO MÁRCIA",
];

const DEFAULT_SOURCE_PARENT_NAMES = ["ADMINISTRATIVO", "CONTA ADMINISTRATIVA"];
const DEFAULT_EXCLUDE_PARENT_NAMES = ["FABRICACAO", "FABRICAÇÃO"];
const DEFAULT_AP_FIELDS: ReclassificationApField[] = ["description", "comments"];
const DEFAULT_APPLY_SOURCES: ReclassificationAllocationSource[] = ["AUTO_RULE", "BATCH"];

const TARGET_PARENT_NAME = "ADMINISTRATIVO";
const TARGET_CHILD_NAME = "INVESTIMENTO SOCIOS";

/** Normaliza texto para comparação contains (uppercase, sem acento, espaços colapsados). */
export function normalizeFinancialText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

function parseStringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function parseMatchFields(value: unknown): ReclassificationRuleMatchFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { apFields: DEFAULT_AP_FIELDS };
  }
  const raw = value as Record<string, unknown>;
  const apFields = parseStringArrayJson(raw.apFields).filter(
    (field): field is ReclassificationApField =>
      field === "description" || field === "comments"
  );
  return {
    apFields: apFields.length > 0 ? apFields : DEFAULT_AP_FIELDS,
    sourceParentNames: parseStringArrayJson(raw.sourceParentNames),
    excludeParentNames: parseStringArrayJson(raw.excludeParentNames),
  };
}

function serializeRule(row: {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  sourceCostCenterName: string | null;
  sourceParentName: string | null;
  targetCostCenterId: string;
  matchFields: unknown;
  keywords: unknown;
  matchMode: string;
  applyToSources: unknown;
  skipManual: boolean;
  notes: string | null;
}): ReclassificationRuleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priority: row.priority,
    isActive: row.isActive,
    sourceCostCenterName: row.sourceCostCenterName,
    sourceParentName: row.sourceParentName,
    targetCostCenterId: row.targetCostCenterId,
    matchFields: parseMatchFields(row.matchFields),
    keywords: parseStringArrayJson(row.keywords),
    matchMode: (row.matchMode === "CONTAINS_ALL" ? "CONTAINS_ALL" : "CONTAINS_ANY") as ReclassificationMatchMode,
    applyToSources: parseStringArrayJson(row.applyToSources).filter(
      (source): source is ReclassificationAllocationSource =>
        source === "AUTO_RULE" || source === "MANUAL" || source === "BATCH"
    ),
    skipManual: row.skipManual,
    notes: row.notes,
  };
}

function formatCostCenterLabel(name: string, parentName: string | null): string {
  return parentName ? `${parentName} / ${name}` : name;
}

async function findTargetInvestimentoSociosCostCenterId(): Promise<{
  id: string;
  label: string;
}> {
  const parent = await prisma.financialCostCenter.findFirst({
    where: {
      name: { equals: TARGET_PARENT_NAME, mode: "insensitive" },
      parentId: null,
    },
    select: { id: true, name: true },
  });
  if (!parent) {
    throw new FinanceCostCenterReclassificationError(
      "TARGET_PARENT_NOT_FOUND",
      `Centro de custo pai "${TARGET_PARENT_NAME}" não encontrado.`
    );
  }

  const child = await prisma.financialCostCenter.findFirst({
    where: {
      parentId: parent.id,
      name: { equals: TARGET_CHILD_NAME, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (!child) {
    throw new FinanceCostCenterReclassificationError(
      "TARGET_COST_CENTER_NOT_FOUND",
      `Subcentro "${TARGET_CHILD_NAME}" não encontrado sob "${TARGET_PARENT_NAME}".`
    );
  }

  return {
    id: child.id,
    label: formatCostCenterLabel(child.name, parent.name),
  };
}

function parentNameMatches(
  parentName: string | null,
  allowedNames: string[],
  excludeNames: string[]
): boolean {
  const normalizedParent = normalizeFinancialText(parentName);
  if (!normalizedParent) return false;

  for (const excluded of excludeNames) {
    if (normalizedParent === normalizeFinancialText(excluded)) return false;
  }

  if (allowedNames.length === 0) return true;
  return allowedNames.some((name) => normalizedParent === normalizeFinancialText(name));
}

function extractPayableSearchText(
  payable: ReclassificationEvaluationInput["payable"],
  apFields: ReclassificationApField[]
): string {
  const chunks: string[] = [];
  for (const field of apFields) {
    if (field === "description" && payable.description) chunks.push(payable.description);
    if (field === "comments" && payable.comments) chunks.push(payable.comments);
  }
  return normalizeFinancialText(chunks.join(" "));
}

function findMatchedKeyword(
  haystack: string,
  keywords: string[],
  matchMode: ReclassificationMatchMode
): string | null {
  const normalizedKeywords = keywords
    .map((keyword) => normalizeFinancialText(keyword))
    .filter(Boolean);
  if (normalizedKeywords.length === 0) return null;

  if (matchMode === "CONTAINS_ALL") {
    const allMatch = normalizedKeywords.every((keyword) => haystack.includes(keyword));
    return allMatch ? normalizedKeywords[0]! : null;
  }

  for (const keyword of normalizedKeywords) {
    if (haystack.includes(keyword)) return keyword;
  }
  return null;
}

export function evaluateReclassificationRuleForAllocation(
  input: ReclassificationEvaluationInput
): ReclassificationEvaluationResult {
  const { allocation, costCenter, payable, rule } = input;

  if (!rule.isActive) {
    return { applies: false, reason: "Regra inativa." };
  }

  if (rule.skipManual && (allocation.lockedManual || allocation.source === "MANUAL")) {
    return { applies: false, reason: "Classificação manual protegida." };
  }

  if (
    rule.applyToSources.length > 0 &&
    !rule.applyToSources.includes(allocation.source)
  ) {
    return { applies: false, reason: "Source da alocação não elegível." };
  }

  const allowedParents = [
    ...(rule.matchFields.sourceParentNames ?? []),
    ...(rule.sourceParentName ? [rule.sourceParentName] : []),
  ];
  const excludeParents = rule.matchFields.excludeParentNames ?? [];

  if (!parentNameMatches(costCenter.parentName, allowedParents, excludeParents)) {
    return { applies: false, reason: "Centro pai atual não elegível para a regra." };
  }

  if (
    rule.sourceCostCenterName &&
    normalizeFinancialText(costCenter.name) !==
      normalizeFinancialText(rule.sourceCostCenterName)
  ) {
    return { applies: false, reason: "Subcentro atual não elegível para a regra." };
  }

  if (allocation.costCenterId === rule.targetCostCenterId) {
    return { applies: false, reason: "Já está no centro de custo destino." };
  }

  const searchText = extractPayableSearchText(payable, rule.matchFields.apFields);
  const matchedKeyword = findMatchedKeyword(searchText, rule.keywords, rule.matchMode);
  if (!matchedKeyword) {
    return { applies: false, reason: "Nenhuma palavra-chave encontrada." };
  }

  return {
    applies: true,
    matchedKeyword,
    targetCostCenterId: rule.targetCostCenterId,
    targetCostCenterLabel: input.targetCostCenterLabel,
    ruleId: rule.id,
  };
}

export function payableMatchesAdministrativeKeywords(input: {
  description: string | null;
  comments: string | null;
  parentName: string | null;
  costCenterName: string;
  targetCostCenterId: string;
  currentCostCenterId: string;
  keywords?: string[];
}): {
  hasKeyword: boolean;
  inAdministrative: boolean;
  alreadyTarget: boolean;
  matchedKeyword: string | null;
} {
  const keywords = input.keywords ?? DEFAULT_KEYWORDS;
  const searchText = normalizeFinancialText(
    [input.description, input.comments].filter(Boolean).join(" ")
  );
  const matchedKeyword = findMatchedKeyword(searchText, keywords, "CONTAINS_ANY");
  const inAdministrative = parentNameMatches(
    input.parentName,
    DEFAULT_SOURCE_PARENT_NAMES,
    DEFAULT_EXCLUDE_PARENT_NAMES
  );
  return {
    hasKeyword: Boolean(matchedKeyword),
    inAdministrative,
    alreadyTarget: input.currentCostCenterId === input.targetCostCenterId,
    matchedKeyword,
  };
}

export async function ensureDefaultFinancialReclassificationRules(
  user?: ReclassificationUserContext
): Promise<{ created: boolean; ruleId: string; targetCostCenterLabel: string }> {
  const existing = await prisma.financialCostCenterReclassificationRule.findFirst({
    where: { name: FINANCE_CC_RECLASSIFICATION_DEFAULT_RULE_NAME },
    select: { id: true, targetCostCenterId: true },
  });

  const target = await findTargetInvestimentoSociosCostCenterId();

  if (existing) {
    return { created: false, ruleId: existing.id, targetCostCenterLabel: target.label };
  }

  const created = await prisma.financialCostCenterReclassificationRule.create({
    data: {
      name: FINANCE_CC_RECLASSIFICATION_DEFAULT_RULE_NAME,
      description:
        "Traduz medida Power BI: descrição AP com financiamento sócios reclassifica subcentro para INVESTIMENTO SOCIOS quando pai é ADMINISTRATIVO.",
      priority: 50,
      isActive: true,
      sourceParentName: TARGET_PARENT_NAME,
      targetCostCenterId: target.id,
      matchFields: {
        apFields: DEFAULT_AP_FIELDS,
        sourceParentNames: DEFAULT_SOURCE_PARENT_NAMES,
        excludeParentNames: DEFAULT_EXCLUDE_PARENT_NAMES,
      } satisfies ReclassificationRuleMatchFields as Prisma.InputJsonValue,
      keywords: DEFAULT_KEYWORDS,
      matchMode: "CONTAINS_ANY",
      applyToSources: DEFAULT_APPLY_SOURCES,
      skipManual: true,
      notes: "Seed idempotente — regra gerencial inicial.",
      createdByUserId: user?.userId ?? null,
      createdByName: user?.userName ?? "system",
    },
    select: { id: true },
  });

  return { created: true, ruleId: created.id, targetCostCenterLabel: target.label };
}

type LoadedAllocationContext = {
  allocation: {
    id: string;
    accountsPayableId: number;
    costCenterId: string;
    source: ReclassificationAllocationSource;
    lockedManual: boolean;
    notes: string | null;
  };
  costCenter: {
    id: string;
    name: string;
    parentName: string | null;
  };
  payable: {
    externalId: number;
    personName: string | null;
    description: string | null;
    comments: string | null;
  };
};

async function loadAllocationContexts(): Promise<LoadedAllocationContext[]> {
  const rows = await prisma.accountsPayableCostCenterAllocation.findMany({
    select: {
      id: true,
      accountsPayableId: true,
      costCenterId: true,
      source: true,
      lockedManual: true,
      notes: true,
      costCenter: {
        select: {
          id: true,
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  });

  const payableIds = [...new Set(rows.map((row) => row.accountsPayableId))];
  const payables =
    payableIds.length > 0
      ? await prisma.nomusAccountsPayable.findMany({
          where: { externalId: { in: payableIds } },
          select: {
            externalId: true,
            personName: true,
            description: true,
            comments: true,
          },
        })
      : [];
  const payableById = new Map(payables.map((row) => [row.externalId, row]));

  return rows.map((row) => {
    const payable = payableById.get(row.accountsPayableId);
    return {
      allocation: {
        id: row.id,
        accountsPayableId: row.accountsPayableId,
        costCenterId: row.costCenterId,
        source: row.source as ReclassificationAllocationSource,
        lockedManual: row.lockedManual,
        notes: row.notes,
      },
      costCenter: {
        id: row.costCenter.id,
        name: row.costCenter.name,
        parentName: row.costCenter.parent?.name ?? null,
      },
      payable: {
        externalId: row.accountsPayableId,
        personName: payable?.personName ?? null,
        description: payable?.description ?? null,
        comments: payable?.comments ?? null,
      },
    };
  });
}

async function loadActiveRules(): Promise<
  Array<{ rule: ReclassificationRuleRecord; targetLabel: string }>
> {
  const rows = await prisma.financialCostCenterReclassificationRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: {
      targetCostCenter: {
        select: {
          id: true,
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    rule: serializeRule(row),
    targetLabel: formatCostCenterLabel(
      row.targetCostCenter.name,
      row.targetCostCenter.parent?.name ?? null
    ),
  }));
}

function pickFirstMatchingRule(
  ctx: LoadedAllocationContext,
  rules: Array<{ rule: ReclassificationRuleRecord; targetLabel: string }>
): Extract<ReclassificationEvaluationResult, { applies: true }> | null {
  for (const entry of rules) {
    const result = evaluateReclassificationRuleForAllocation({
      allocation: ctx.allocation,
      costCenter: ctx.costCenter,
      payable: ctx.payable,
      rule: entry.rule,
      targetCostCenterLabel: entry.targetLabel,
    });
    if (result.applies) return result;
  }
  return null;
}

export async function previewAccountsPayableCostCenterReclassifications(): Promise<ReclassificationPreviewResult> {
  const [contexts, rules, defaultTarget] = await Promise.all([
    loadAllocationContexts(),
    loadActiveRules(),
    findTargetInvestimentoSociosCostCenterId().catch(() => null),
  ]);

  const examples: ReclassificationExample[] = [];
  let matched = 0;
  let alreadyTarget = 0;
  let skippedManual = 0;
  let skippedSource = 0;
  let skippedParent = 0;
  let skippedNoKeyword = 0;
  let skippedInactiveRule = 0;

  let titlesWithKeywords = 0;
  let inAdministrativeParent = 0;
  let alreadyInvestimentoSocios = 0;

  for (const ctx of contexts) {
    if (ctx.allocation.lockedManual || ctx.allocation.source === "MANUAL") {
      skippedManual += 1;
      continue;
    }

    if (defaultTarget) {
      const scan = payableMatchesAdministrativeKeywords({
        description: ctx.payable.description,
        comments: ctx.payable.comments,
        parentName: ctx.costCenter.parentName,
        costCenterName: ctx.costCenter.name,
        targetCostCenterId: defaultTarget.id,
        currentCostCenterId: ctx.allocation.costCenterId,
      });
      if (scan.hasKeyword) titlesWithKeywords += 1;
      if (scan.inAdministrative) inAdministrativeParent += 1;
      if (scan.alreadyTarget) alreadyInvestimentoSocios += 1;
    }

    if (rules.length === 0) {
      skippedInactiveRule += 1;
      continue;
    }

    const firstRule = rules[0]!.rule;
    if (
      firstRule.applyToSources.length > 0 &&
      !firstRule.applyToSources.includes(ctx.allocation.source)
    ) {
      skippedSource += 1;
    }

    const evaluation = pickFirstMatchingRule(ctx, rules);
    if (!evaluation) {
      const probe = evaluateReclassificationRuleForAllocation({
        allocation: ctx.allocation,
        costCenter: ctx.costCenter,
        payable: ctx.payable,
        rule: firstRule,
        targetCostCenterLabel: rules[0]!.targetLabel,
      });
      if (probe.applies === false) {
        if (probe.reason === "Centro pai atual não elegível para a regra.") skippedParent += 1;
        else if (probe.reason === "Nenhuma palavra-chave encontrada.") skippedNoKeyword += 1;
        else if (probe.reason === "Já está no centro de custo destino.") alreadyTarget += 1;
      }
      continue;
    }

    if (ctx.allocation.costCenterId === evaluation.targetCostCenterId) {
      alreadyTarget += 1;
      continue;
    }

    matched += 1;
    if (examples.length < 25) {
      examples.push({
        accountsPayableId: ctx.payable.externalId,
        personName: ctx.payable.personName,
        description: ctx.payable.description,
        comments: ctx.payable.comments,
        currentCostCenter: formatCostCenterLabel(
          ctx.costCenter.name,
          ctx.costCenter.parentName
        ),
        targetCostCenter: evaluation.targetCostCenterLabel,
        matchedKeyword: evaluation.matchedKeyword,
        ruleName: rules.find((entry) => entry.rule.id === evaluation.ruleId)?.rule.name ?? "",
      });
    }
  }

  return {
    dryRun: true,
    matched,
    updated: 0,
    skippedManual,
    alreadyTarget,
    skippedInactiveRule,
    skippedSource,
    skippedParent,
    skippedNoKeyword,
    targetCostCenter: defaultTarget?.label ?? null,
    keywordScan: {
      titlesWithKeywords,
      inAdministrativeParent,
      alreadyInvestimentoSocios,
      wouldReclassify: matched,
    },
    examples,
  };
}

export async function applyAccountsPayableCostCenterReclassifications(
  user: ReclassificationUserContext
): Promise<ReclassificationPreviewResult> {
  const preview = await previewAccountsPayableCostCenterReclassifications();
  if (preview.matched === 0) {
    return { ...preview, dryRun: false, updated: 0 };
  }

  const [contexts, rules] = await Promise.all([loadAllocationContexts(), loadActiveRules()]);
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const ctx of contexts) {
      const evaluation = pickFirstMatchingRule(ctx, rules);
      if (!evaluation?.applies) continue;

      const beforeLabel = formatCostCenterLabel(
        ctx.costCenter.name,
        ctx.costCenter.parentName
      );

      const updatedRow = await tx.accountsPayableCostCenterAllocation.update({
        where: { id: ctx.allocation.id },
        data: {
          costCenterId: evaluation.targetCostCenterId,
          notes: ctx.allocation.notes
            ? `${ctx.allocation.notes} | Reclassificado por regra (${evaluation.matchedKeyword})`
            : `Reclassificado por regra (${evaluation.matchedKeyword})`,
          updatedAt: new Date(),
        },
      });

      await tx.financialCostCenterAuditLog.create({
        data: {
          entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
          entityId: ctx.allocation.id,
          action: FINANCE_CC_RECLASSIFICATION_AUDIT_ACTION.RECLASSIFY_BY_RULE,
          beforeJson: {
            costCenterId: ctx.allocation.costCenterId,
            costCenterLabel: beforeLabel,
            source: ctx.allocation.source,
            lockedManual: ctx.allocation.lockedManual,
          },
          afterJson: {
            costCenterId: evaluation.targetCostCenterId,
            costCenterLabel: evaluation.targetCostCenterLabel,
            ruleId: evaluation.ruleId,
            matchedKeyword: evaluation.matchedKeyword,
          },
          userId: user.userId,
          userName: user.userName,
        },
      });

      void updatedRow;
      updated += 1;
    }
  });

  return {
    ...preview,
    dryRun: false,
    updated,
  };
}

export async function applyAccountsPayableCostCenterReclassificationsWithDryRun(input: {
  dryRun: boolean;
  user: ReclassificationUserContext;
}): Promise<ReclassificationPreviewResult> {
  if (input.dryRun) {
    return previewAccountsPayableCostCenterReclassifications();
  }
  return applyAccountsPayableCostCenterReclassifications(input.user);
}
