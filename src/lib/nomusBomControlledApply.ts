import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeComponentCode, normalizeSku, toNumberSafe } from "@/src/lib/nomusBomComparison";
import { buildNomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";
import {
  loadIndusBomLinesForProduct,
  resolveNomusComponentCodes,
} from "@/src/lib/nomusBomComparisonLoad";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import type { EffectivePricingBomLine } from "@/src/lib/nomusEffectivePricingBomTypes";
import { buildNomusEffectiveBomCostImpact } from "@/src/lib/nomusEffectiveBomCostImpact";
import { listReviewDecisionsForParentCode } from "@/src/lib/nomusBomReviewDecision";
import { prisma } from "@/src/lib/prisma";
import type {
  ControlledApplyAction,
  ControlledApplyBomSummary,
  ControlledApplyComponentKind,
  ControlledApplyPreview,
  ControlledApplyResult,
  ControlledApplyRiskLevel,
} from "@/src/lib/nomusBomControlledApplyTypes";

const BLOCKED_EFFECTIVE_STATUSES = new Set([
  "NO_NOMUS_BOM",
  "PENDING_OPTIONAL_SELECTION",
  "STALE_OPTIONAL_SELECTION",
  "BLOCKED_UNRESOLVED_COMPONENTS",
  "PENDING_LOCAL_REVIEW",
]);

const REMOVAL_SOURCES = new Set([
  "LOCAL_ONLY_EXCLUDED_BY_REVIEW",
  "LOCAL_ONLY_DUPLICATED_BY_NOMUS",
  "NOMUS_OPTIONAL_NOT_SELECTED",
  "NOMUS_ALTERNATIVE_NOT_SELECTED",
]);

type CurrentBomRow = {
  id: string;
  productId: string;
  materialId: string | null;
  childProductId: string | null;
  quantity: number | null;
  lossPercentage: number | null;
  notes: string | null;
  componentCode: string;
  componentKind: ControlledApplyComponentKind;
  componentDescription: string | null;
};

type DesiredTarget = {
  componentCode: string;
  componentDescription: string | null;
  componentKind: ControlledApplyComponentKind;
  materialId: string | null;
  childProductId: string | null;
  productBomLineId: string | null;
  quantity: number;
  effectiveLine: EffectivePricingBomLine;
};

function confirmationTextFor(parentCode: string): string {
  return `APLICAR BOM ${normalizeSku(parentCode)}`;
}

function stableHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function bomTargetKey(target: {
  materialId?: string | null;
  childProductId?: string | null;
  productBomLineId?: string | null;
}): string | null {
  if (target.productBomLineId) return `local:${target.productBomLineId}`;
  if (target.materialId) return `m:${target.materialId}`;
  if (target.childProductId) return `c:${target.childProductId}`;
  return null;
}

function componentKindFromResolution(
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE",
  isLocal: boolean
): ControlledApplyComponentKind {
  if (isLocal) return "Local";
  if (resolvedKind === "MATERIAL") return "Material";
  if (resolvedKind === "PRODUCT") return "Produto";
  return "Desconhecido";
}

function riskForAction(
  actionType: ControlledApplyAction["actionType"]
): ControlledApplyRiskLevel {
  switch (actionType) {
    case "REMOVE_PRODUCT_BOM_LINE":
      return "HIGH";
    case "UPDATE_PRODUCT_BOM_QUANTITY":
      return "MEDIUM";
    case "CREATE_PRODUCT_BOM_LINE":
      return "MEDIUM";
    case "BLOCKED":
    case "SKIP_UNRESOLVED":
      return "BLOCKED";
    default:
      return "LOW";
  }
}

async function loadCurrentProductBomRows(productId: string, productSku: string): Promise<CurrentBomRow[]> {
  const rows = await prisma.productBOM.findMany({
    where: { productId },
    include: {
      Material: { select: { code: true, description: true } },
      ChildProduct: { select: { sku: true, name: true } },
    },
    orderBy: { id: "asc" },
  });

  return rows.map((row) => {
    if (row.materialId && row.Material) {
      return {
        id: row.id,
        productId: row.productId,
        materialId: row.materialId,
        childProductId: null,
        quantity: toNumberSafe(row.quantity),
        lossPercentage: toNumberSafe(row.lossPercentage),
        notes: row.notes,
        componentCode: row.Material.code,
        componentKind: "Material",
        componentDescription: row.Material.description,
      };
    }
    if (row.childProductId && row.ChildProduct) {
      return {
        id: row.id,
        productId: row.productId,
        materialId: null,
        childProductId: row.childProductId,
        quantity: toNumberSafe(row.quantity),
        lossPercentage: toNumberSafe(row.lossPercentage),
        notes: row.notes,
        componentCode: row.ChildProduct.sku,
        componentKind: "Produto",
        componentDescription: row.ChildProduct.name,
      };
    }
    return {
      id: row.id,
      productId: row.productId,
      materialId: row.materialId,
      childProductId: row.childProductId,
      quantity: toNumberSafe(row.quantity),
      lossPercentage: toNumberSafe(row.lossPercentage),
      notes: row.notes,
      componentCode: `UNKNOWN:${row.id}`,
      componentKind: "Desconhecido",
      componentDescription: null,
    };
  });
}

function summarizeBom(rows: CurrentBomRow[]): ControlledApplyBomSummary {
  return {
    lineCount: rows.length,
    materialLines: rows.filter((r) => r.materialId).length,
    childProductLines: rows.filter((r) => r.childProductId).length,
  };
}

function serializeBomRow(row: CurrentBomRow) {
  return {
    id: row.id,
    componentCode: row.componentCode,
    componentKind: row.componentKind,
    materialId: row.materialId,
    childProductId: row.childProductId,
    quantity: row.quantity,
    lossPercentage: row.lossPercentage,
    notes: row.notes,
  };
}

async function hasBomCycle(parentId: string, childProductId: string): Promise<boolean> {
  const children = await prisma.productBOM.findMany({
    where: { productId: childProductId },
    select: { childProductId: true },
  });
  for (const child of children) {
    if (!child.childProductId) continue;
    if (child.childProductId === parentId) return true;
    if (await hasBomCycle(parentId, child.childProductId)) return true;
  }
  return false;
}

async function buildDesiredTargets(
  effectiveLines: EffectivePricingBomLine[]
): Promise<{ targets: DesiredTarget[]; unresolved: EffectivePricingBomLine[] }> {
  const included = effectiveLines.filter((l) => l.includedForPricing);
  const codes = included
    .filter((l) => !l.productBomLineId)
    .map((l) => l.componentCode);
  const resolved = await resolveNomusComponentCodes(codes);
  const resolvedByCode = new Map(
    resolved.map((r) => [normalizeComponentCode(r.componentCode), r])
  );

  const targets: DesiredTarget[] = [];
  const unresolved: EffectivePricingBomLine[] = [];

  for (const line of included) {
    const qty = line.quantity;
    if (qty == null || !Number.isFinite(qty) || qty < 0) {
      unresolved.push(line);
      continue;
    }

    if (line.productBomLineId) {
      targets.push({
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        componentKind: "Local",
        materialId: null,
        childProductId: null,
        productBomLineId: line.productBomLineId,
        quantity: qty,
        effectiveLine: line,
      });
      continue;
    }

    const res = resolvedByCode.get(normalizeComponentCode(line.componentCode));
    if (!res || res.resolvedKind === "NONE") {
      unresolved.push(line);
      continue;
    }
    if (res.resolvedKind === "BOTH") {
      unresolved.push(line);
      continue;
    }

    targets.push({
      componentCode: line.componentCode,
      componentDescription: line.componentDescription ?? null,
      componentKind: componentKindFromResolution(res.resolvedKind, false),
      materialId: res.materialId ?? null,
      childProductId: res.productId ?? null,
      productBomLineId: null,
      quantity: qty,
      effectiveLine: line,
    });
  }

  return { targets, unresolved };
}

function buildRemovalKeys(
  effectiveBom: Awaited<ReturnType<typeof buildEffectivePricingBomForParentCode>>,
  currentRows: CurrentBomRow[]
): Set<string> {
  const removeKeys = new Set<string>();
  const removeCodes = new Set<string>();

  for (const line of [...effectiveBom.excludedLines, ...effectiveBom.reviewLines]) {
    if (!REMOVAL_SOURCES.has(line.source)) continue;
    if (line.productBomLineId) {
      removeKeys.add(`local:${line.productBomLineId}`);
    }
    removeCodes.add(normalizeComponentCode(line.componentCode));
  }

  for (const row of currentRows) {
    const code = normalizeComponentCode(row.componentCode);
    if (!removeCodes.has(code)) continue;
    const key =
      bomTargetKey({
        materialId: row.materialId,
        childProductId: row.childProductId,
        productBomLineId: row.id,
      }) ?? `code:${code}`;
    removeKeys.add(key);
  }

  return removeKeys;
}

function buildActions(
  currentRows: CurrentBomRow[],
  targets: DesiredTarget[],
  unresolved: EffectivePricingBomLine[],
  removalKeys: Set<string>
): ControlledApplyAction[] {
  const actions: ControlledApplyAction[] = [];

  for (const line of unresolved) {
    actions.push({
      actionType: "SKIP_UNRESOLVED",
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      componentKind: "Desconhecido",
      currentQuantity: null,
      effectiveQuantity: line.quantity,
      reason: "Componente incluído na BOM efetiva sem Material ou Produto resolvido no IndusCost.",
      riskLevel: "BLOCKED",
      reviewDecisionType: line.reviewDecisionType ?? null,
    });
  }

  const desiredByKey = new Map<string, DesiredTarget>();
  for (const target of targets) {
    const key = bomTargetKey(target);
    if (key) desiredByKey.set(key, target);
  }

  const matchedCurrentIds = new Set<string>();

  for (const target of targets) {
    const key = bomTargetKey(target);
    if (!key) continue;

    let current: CurrentBomRow | undefined;
    if (target.productBomLineId) {
      current = currentRows.find((r) => r.id === target.productBomLineId);
    } else {
      current = currentRows.find((r) => {
        const rowKey = bomTargetKey({
          materialId: r.materialId,
          childProductId: r.childProductId,
          productBomLineId: null,
        });
        return rowKey === key;
      });
    }

    if (!current) {
      actions.push({
        actionType: "CREATE_PRODUCT_BOM_LINE",
        componentCode: target.componentCode,
        componentDescription: target.componentDescription,
        componentKind: target.componentKind,
        currentQuantity: null,
        effectiveQuantity: target.quantity,
        reason: "Linha da BOM efetiva ainda não existe na ProductBOM.",
        riskLevel: riskForAction("CREATE_PRODUCT_BOM_LINE"),
        reviewDecisionType: target.effectiveLine.reviewDecisionType ?? null,
        relatedNomusComponentCode: target.effectiveLine.relatedNomusComponentCode ?? null,
      });
      continue;
    }

    matchedCurrentIds.add(current.id);
    const currentQty = current.quantity ?? 0;
    if (Math.abs(currentQty - target.quantity) < 1e-9) {
      actions.push({
        actionType: "KEEP_PRODUCT_BOM_LINE",
        componentCode: target.componentCode,
        componentDescription: target.componentDescription ?? current.componentDescription,
        componentKind: target.componentKind,
        currentQuantity: currentQty,
        effectiveQuantity: target.quantity,
        productBomLineId: current.id,
        reason: "Quantidade já coincide com a BOM efetiva.",
        riskLevel: "LOW",
        reviewDecisionType: target.effectiveLine.reviewDecisionType ?? null,
      });
    } else {
      actions.push({
        actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
        componentCode: target.componentCode,
        componentDescription: target.componentDescription ?? current.componentDescription,
        componentKind: target.componentKind,
        currentQuantity: currentQty,
        effectiveQuantity: target.quantity,
        productBomLineId: current.id,
        reason: "Atualizar quantidade para refletir a BOM efetiva.",
        riskLevel: riskForAction("UPDATE_PRODUCT_BOM_QUANTITY"),
        reviewDecisionType: target.effectiveLine.reviewDecisionType ?? null,
      });
    }
  }

  for (const row of currentRows) {
    if (matchedCurrentIds.has(row.id)) continue;
    const key =
      bomTargetKey({
        materialId: row.materialId,
        childProductId: row.childProductId,
        productBomLineId: row.id,
      }) ?? `code:${normalizeComponentCode(row.componentCode)}`;

    if (!removalKeys.has(key) && !removalKeys.has(`local:${row.id}`)) {
      actions.push({
        actionType: "KEEP_PRODUCT_BOM_LINE",
        componentCode: row.componentCode,
        componentDescription: row.componentDescription,
        componentKind: row.componentKind,
        currentQuantity: row.quantity,
        effectiveQuantity: row.quantity,
        productBomLineId: row.id,
        reason: "Linha mantida (sem decisão de exclusão/duplicidade aplicável).",
        riskLevel: "LOW",
      });
      continue;
    }

    actions.push({
      actionType: "REMOVE_PRODUCT_BOM_LINE",
      componentCode: row.componentCode,
      componentDescription: row.componentDescription,
      componentKind: row.componentKind,
      currentQuantity: row.quantity,
      effectiveQuantity: null,
      productBomLineId: row.id,
      reason: "Remover da ProductBOM conforme BOM efetiva e decisões de revisão.",
      riskLevel: riskForAction("REMOVE_PRODUCT_BOM_LINE"),
    });
  }

  actions.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  return actions;
}

function buildPlanHash(input: {
  parentCode: string;
  effectiveBomHash: string;
  actions: ControlledApplyAction[];
  optionalPricingStatus: string;
  decisions: { componentCode: string; decision: string }[];
}): string {
  const payload = {
    parentCode: normalizeSku(input.parentCode),
    effectiveBomHash: input.effectiveBomHash,
    optionalPricingStatus: input.optionalPricingStatus,
    decisions: input.decisions
      .map((d) => ({
        componentCode: normalizeComponentCode(d.componentCode),
        decision: d.decision,
      }))
      .sort((a, b) => a.componentCode.localeCompare(b.componentCode)),
    actions: input.actions.map((a) => ({
      actionType: a.actionType,
      componentCode: normalizeComponentCode(a.componentCode),
      productBomLineId: a.productBomLineId ?? null,
      effectiveQuantity: a.effectiveQuantity,
    })),
  };
  return stableHash(payload);
}

function buildEffectiveBomHash(
  parentCode: string,
  lines: EffectivePricingBomLine[]
): string {
  const payload = lines
    .map((l) => ({
      code: normalizeComponentCode(l.componentCode),
      qty: l.quantity,
      included: l.includedForPricing,
      source: l.source,
      decision: l.decision,
      productBomLineId: l.productBomLineId ?? null,
      review: l.reviewDecisionType ?? null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
  return stableHash({ parentCode: normalizeSku(parentCode), lines: payload });
}

async function collectGates(input: {
  parentCode: string;
  productId: string | null;
  effectiveBom: Awaited<ReturnType<typeof buildEffectivePricingBomForParentCode>>;
  actions: ControlledApplyAction[];
  dryPlanBlocked: boolean;
  costUnresolvedCount: number;
}): Promise<{ blockingReasons: string[]; warnings: string[] }> {
  const blocking: string[] = [];
  const warnings: string[] = [...(input.effectiveBom.warnings ?? [])];

  if (!input.productId) {
    blocking.push("Produto não cadastrado no IndusCost para este código pai.");
  }

  if (input.effectiveBom.status === "NO_NOMUS_BOM") {
    blocking.push("Não há BOM Nomus em stage para este produto.");
  }

  if (BLOCKED_EFFECTIVE_STATUSES.has(input.effectiveBom.status)) {
    blocking.push(`BOM efetiva bloqueada ou incompleta (status: ${input.effectiveBom.status}).`);
  }

  const opt = input.effectiveBom.optionalPricingStatus;
  if (opt !== "RESOLVED" && opt !== "NO_OPTIONALS") {
    blocking.push("Opcionais de precificação ainda não estão resolvidos.");
  }

  if ((input.effectiveBom.summary?.localReviewPendingCount ?? 0) > 0) {
    blocking.push("Existem itens locais (somente IndusCost) pendentes de decisão.");
  }

  const { decisions } = await listReviewDecisionsForParentCode(input.parentCode);
  const activeEngineering = decisions.filter((d) => d.decision === "NEEDS_ENGINEERING_REVIEW");
  if (activeEngineering.length > 0) {
    blocking.push("Há itens marcados como NEEDS_ENGINEERING_REVIEW.");
  }

  if (input.actions.some((a) => a.actionType === "SKIP_UNRESOLVED")) {
    blocking.push(
      "Há componentes incluídos na BOM efetiva sem Material ou Produto resolvido no IndusCost."
    );
  }

  if (input.actions.some((a) => a.actionType === "BLOCKED")) {
    blocking.push("O plano contém ações bloqueadas.");
  }

  if (input.costUnresolvedCount > 0) {
    blocking.push("Há custo não resolvido relevante no impacto da BOM efetiva.");
  }

  if (input.dryPlanBlocked) {
    blocking.push("O plano dry-run de aplicação contém ações bloqueadas.");
  }

  return { blockingReasons: blocking, warnings };
}

export async function buildControlledApplyPreview(
  parentCode: string
): Promise<ControlledApplyPreview> {
  const trimmed = parentCode.trim();
  const sku = normalizeSku(trimmed);

  const product = await prisma.product.findFirst({
    where: { OR: [{ sku }, { sku: trimmed }] },
    select: { id: true, sku: true },
  });

  const effectiveBom = await buildEffectivePricingBomForParentCode(trimmed, {
    recursive: false,
    maxDepth: 10,
  });

  const dryReport = await buildNomusBomApplyPlansReport({
    parentCode: trimmed,
    limit: 1,
    offset: 0,
  });
  const dryPlan = dryReport.plans[0];
  const dryPlanBlocked =
    Boolean(dryPlan?.isBlocked) || (dryPlan?.summary?.blockedActions ?? 0) > 0;

  const costImpact = product
    ? await buildNomusEffectiveBomCostImpact(
        trimmed,
        { recursive: false, maxDepth: 10 },
        null
      )
    : null;

  const costUnresolvedCount =
    costImpact?.includedLines?.filter(
      (l) => l.resolvedAs === "UNRESOLVED" || l.totalCost == null
    ).length ?? 0;

  const productId = product?.id ?? effectiveBom.indusProductId ?? null;
  const currentRows = productId
    ? await loadCurrentProductBomRows(productId, product?.sku ?? sku)
    : [];

  const allEffectiveLines = [
    ...effectiveBom.directLines,
    ...effectiveBom.excludedLines,
    ...effectiveBom.reviewLines,
  ];
  const effectiveBomHash = buildEffectiveBomHash(trimmed, allEffectiveLines);

  const { targets, unresolved } = await buildDesiredTargets(effectiveBom.directLines);
  const removalKeys = buildRemovalKeys(effectiveBom, currentRows);
  const actions = buildActions(currentRows, targets, unresolved, removalKeys);

  const { decisions } = await listReviewDecisionsForParentCode(trimmed);
  const planHash = buildPlanHash({
    parentCode: trimmed,
    effectiveBomHash,
    actions,
    optionalPricingStatus: effectiveBom.optionalPricingStatus,
    decisions: decisions.map((d) => ({
      componentCode: d.componentCode,
      decision: d.decision,
    })),
  });

  const { blockingReasons, warnings } = await collectGates({
    parentCode: trimmed,
    productId,
    effectiveBom,
    actions,
    dryPlanBlocked,
    costUnresolvedCount,
  });

  const canApply = blockingReasons.length === 0;

  const afterRowsPreview = [...currentRows];
  for (const action of actions) {
    if (action.actionType === "REMOVE_PRODUCT_BOM_LINE" && action.productBomLineId) {
      const idx = afterRowsPreview.findIndex((r) => r.id === action.productBomLineId);
      if (idx >= 0) afterRowsPreview.splice(idx, 1);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    parentCode: trimmed,
    productId,
    canApply,
    blockingReasons,
    warnings,
    planHash,
    effectiveBomHash,
    confirmationRequiredText: confirmationTextFor(trimmed),
    beforeSummary: summarizeBom(currentRows),
    afterSummary: summarizeBom(afterRowsPreview),
    actions,
    costImpactSummary: costImpact
      ? {
          status: costImpact.status,
          currentTotalCost: costImpact.currentCost?.totalCost ?? null,
          effectiveTotalCost: costImpact.effectiveNomusCost?.totalCost ?? null,
          deltaTotalCost: costImpact.delta?.totalCost ?? null,
          deltaTotalCostPct: costImpact.delta?.totalCostPct ?? null,
          unresolvedCostLines: costUnresolvedCount,
        }
      : null,
    effectiveBomStatus: effectiveBom.status,
    optionalPricingStatus: effectiveBom.optionalPricingStatus,
  };
}

export async function applyEffectiveBomToProductBom(input: {
  parentCode: string;
  planHash: string;
  confirmationText: string;
  approvedBy?: string;
}): Promise<ControlledApplyResult> {
  const trimmed = input.parentCode.trim();
  const preview = await buildControlledApplyPreview(trimmed);

  if (!preview.productId) {
    throw new Error("Produto não encontrado no IndusCost.");
  }

  if (!preview.canApply) {
    throw new Error(
      preview.blockingReasons.join(" ") || "Aplicação bloqueada pelos gates de segurança."
    );
  }

  if (preview.planHash !== input.planHash.trim()) {
    throw new Error("Plano desatualizado. Atualize BOM e custo antes de aplicar.");
  }

  const expectedConfirmation = confirmationTextFor(trimmed);
  if (input.confirmationText.trim() !== expectedConfirmation) {
    throw new Error(`Confirmação inválida. Digite exatamente: ${expectedConfirmation}`);
  }

  const productId = preview.productId;
  const beforeRows = await loadCurrentProductBomRows(productId, normalizeSku(trimmed));
  const beforeBomJson = beforeRows.map(serializeBomRow);

  const { targets, unresolved } = await buildDesiredTargets(
    (await buildEffectivePricingBomForParentCode(trimmed, { recursive: false })).directLines
  );
  if (unresolved.length > 0) {
    throw new Error("Plano desatualizado. Atualize BOM e custo antes de aplicar.");
  }

  const effectiveBom = await buildEffectivePricingBomForParentCode(trimmed, { recursive: false });
  const removalKeys = buildRemovalKeys(effectiveBom, beforeRows);
  const actions = buildActions(beforeRows, targets, [], removalKeys);

  const applyRunId = await prisma.$transaction(async (tx) => {
    const run = await tx.nomusBomApplyRun.create({
      data: {
        parentCode: trimmed,
        productId,
        status: "PREVIEWED",
        planHash: preview.planHash,
        effectiveBomHash: preview.effectiveBomHash,
        approvedBy: input.approvedBy?.trim() || null,
        confirmationText: input.confirmationText.trim(),
        beforeBomJson,
        summaryJson: { actionsPlanned: actions.length },
        warningsJson: preview.warnings,
      },
    });

    const currentById = new Map(beforeRows.map((r) => [r.id, r]));
    const appliedActions: ControlledApplyAction[] = [];

    for (const action of actions) {
      if (
        action.actionType === "KEEP_PRODUCT_BOM_LINE" ||
        action.actionType === "SKIP_UNRESOLVED" ||
        action.actionType === "BLOCKED"
      ) {
        await tx.nomusBomApplyRunLine.create({
          data: {
            runId: run.id,
            actionType: action.actionType,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            productBomLineId: action.productBomLineId,
            beforeJson: action.productBomLineId
              ? serializeBomRow(currentById.get(action.productBomLineId)!)
              : undefined,
            afterJson: action.productBomLineId
              ? serializeBomRow(currentById.get(action.productBomLineId)!)
              : undefined,
            status: "SKIPPED",
            reason: action.reason,
          },
        });
        appliedActions.push(action);
        continue;
      }

      if (action.actionType === "REMOVE_PRODUCT_BOM_LINE" && action.productBomLineId) {
        const before = currentById.get(action.productBomLineId);
        await tx.productBOM.delete({ where: { id: action.productBomLineId } });
        await tx.nomusBomApplyRunLine.create({
          data: {
            runId: run.id,
            actionType: action.actionType,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            productBomLineId: action.productBomLineId,
            beforeJson: before ? serializeBomRow(before) : undefined,
            afterJson: Prisma.JsonNull,
            status: "APPLIED",
            reason: action.reason,
          },
        });
        appliedActions.push(action);
        continue;
      }

      if (action.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" && action.productBomLineId) {
        const before = currentById.get(action.productBomLineId);
        const updated = await tx.productBOM.update({
          where: { id: action.productBomLineId },
          data: { quantity: action.effectiveQuantity ?? 0 },
        });
        await tx.nomusBomApplyRunLine.create({
          data: {
            runId: run.id,
            actionType: action.actionType,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            productBomLineId: action.productBomLineId,
            beforeJson: before ? serializeBomRow(before) : undefined,
            afterJson: {
              id: updated.id,
              quantity: toNumberSafe(updated.quantity),
            },
            status: "APPLIED",
            reason: action.reason,
          },
        });
        appliedActions.push(action);
        continue;
      }

      if (action.actionType === "CREATE_PRODUCT_BOM_LINE") {
        const target = targets.find(
          (t) => normalizeComponentCode(t.componentCode) === normalizeComponentCode(action.componentCode)
        );
        if (!target) {
          throw new Error(`Alvo não encontrado para criar linha ${action.componentCode}.`);
        }

        if (target.childProductId) {
          const cycle = await hasBomCycle(productId, target.childProductId);
          if (cycle) {
            throw new Error(`Ciclo de BOM detectado ao incluir produto filho ${target.componentCode}.`);
          }
        }

        const existingLoss =
          beforeRows.find(
            (r) =>
              (target.materialId && r.materialId === target.materialId) ||
              (target.childProductId && r.childProductId === target.childProductId)
          )?.lossPercentage ?? 0;

        const created = await tx.productBOM.create({
          data: {
            productId,
            materialId: target.materialId,
            childProductId: target.childProductId,
            quantity: target.quantity,
            lossPercentage: existingLoss,
          },
        });

        await tx.nomusBomApplyRunLine.create({
          data: {
            runId: run.id,
            actionType: action.actionType,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            productBomLineId: created.id,
            beforeJson: Prisma.JsonNull,
            afterJson: {
              id: created.id,
              materialId: created.materialId,
              childProductId: created.childProductId,
              quantity: toNumberSafe(created.quantity),
            },
            status: "APPLIED",
            reason: action.reason,
          },
        });
        appliedActions.push(action);
      }
    }

    const afterRows = await loadCurrentProductBomRows(productId, normalizeSku(trimmed));
    const afterBomJson = afterRows.map(serializeBomRow);

    const summary = {
      created: appliedActions.filter((a) => a.actionType === "CREATE_PRODUCT_BOM_LINE").length,
      updated: appliedActions.filter((a) => a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY").length,
      kept: appliedActions.filter((a) => a.actionType === "KEEP_PRODUCT_BOM_LINE").length,
      removed: appliedActions.filter((a) => a.actionType === "REMOVE_PRODUCT_BOM_LINE").length,
      skipped: appliedActions.filter((a) => a.actionType === "SKIP_UNRESOLVED").length,
      blocked: appliedActions.filter((a) => a.actionType === "BLOCKED").length,
    };

    await tx.nomusBomApplyRun.update({
      where: { id: run.id },
      data: {
        status: "APPLIED",
        afterBomJson,
        summaryJson: summary,
        appliedAt: new Date(),
      },
    });

    return run.id;
  });

  const afterRows = await loadCurrentProductBomRows(productId, normalizeSku(trimmed));

  return {
    applied: true,
    applyRunId,
    parentCode: trimmed,
    productId,
    summary: {
      created: preview.actions.filter((a) => a.actionType === "CREATE_PRODUCT_BOM_LINE").length,
      updated: preview.actions.filter((a) => a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY").length,
      kept: preview.actions.filter((a) => a.actionType === "KEEP_PRODUCT_BOM_LINE").length,
      removed: preview.actions.filter((a) => a.actionType === "REMOVE_PRODUCT_BOM_LINE").length,
      skipped: preview.actions.filter((a) => a.actionType === "SKIP_UNRESOLVED").length,
      blocked: preview.actions.filter((a) => a.actionType === "BLOCKED").length,
    },
    beforeBom: beforeBomJson,
    afterBom: afterRows.map(serializeBomRow),
    actionsApplied: preview.actions,
  };
}
