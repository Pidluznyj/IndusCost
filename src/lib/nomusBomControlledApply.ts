import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeComponentCode, normalizeSku, toNumberSafe } from "@/src/lib/nomusBomComparison";
import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import { buildBomComparisonForParentCode } from "@/src/lib/nomusBomComparisonLoad";
import { buildNomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
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
  ControlledApplyBlockingCode,
  ControlledApplyBlockingDetail,
  ControlledApplyBomSummary,
  ControlledApplyComponentKind,
  ControlledApplyPreview,
  ControlledApplyResolutionMode,
  ControlledApplyResult,
  ControlledApplyRiskLevel,
} from "@/src/lib/nomusBomControlledApplyTypes";
import type { EffectivePricingBomResult } from "@/src/lib/nomusEffectivePricingBomTypes";

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

const LOCAL_INCLUDED_SOURCES = new Set([
  "LOCAL_ONLY_INCLUDED_BY_REVIEW",
]);

const BLOCKING_SUMMARY: Record<ControlledApplyBlockingCode, string> = {
  NO_PRODUCT: "Produto não cadastrado no IndusCost para este código pai.",
  NO_NOMUS_BOM: "Não há BOM Nomus em stage para este produto.",
  EFFECTIVE_BOM_BLOCKED: "BOM efetiva bloqueada ou incompleta.",
  OPTIONAL_PENDING: "Opcionais de precificação ainda não estão resolvidos.",
  LOCAL_REVIEW_PENDING: "Existem itens locais (somente IndusCost) pendentes de decisão.",
  NEEDS_ENGINEERING_REVIEW: "Há itens locais aguardando revisão de engenharia.",
  UNRESOLVED_INCLUDED_COMPONENT:
    "Há componentes incluídos na BOM efetiva sem resolução aplicável (Material/Produto/linha local).",
  BLOCKED_ACTION: "O plano contém ações bloqueadas.",
  COST_UNRESOLVED: "Há custo não resolvido em linhas incluídas na BOM efetiva.",
  DRY_PLAN_BLOCKED: "O plano dry-run de aplicação contém ações bloqueadas.",
  AMBIGUOUS_DUPLICATE_PRODUCT_BOM_LINE:
    "Há múltiplas linhas IndusCost para o mesmo componente sem regra automática segura.",
};

function isLocalIncludedLine(line: EffectivePricingBomLine): boolean {
  if (!line.includedForPricing) return false;
  if (line.productBomLineId && line.productBomLineId !== "unknown") return true;
  return LOCAL_INCLUDED_SOURCES.has(line.source);
}

function resolveLocalProductBomLineId(
  line: EffectivePricingBomLine,
  currentRows: CurrentBomRow[]
): string | null {
  if (line.productBomLineId && line.productBomLineId !== "unknown") {
    const byId = currentRows.find((r) => r.id === line.productBomLineId);
    if (byId) return byId.id;
  }
  const byCode = currentRows.find(
    (r) => normalizeComponentCode(r.componentCode) === normalizeComponentCode(line.componentCode)
  );
  return byCode?.id ?? null;
}

function pushBlockingDetail(
  details: ControlledApplyBlockingDetail[],
  detail: ControlledApplyBlockingDetail
): void {
  const key = `${detail.code}|${detail.componentCode ?? ""}|${detail.reason}`;
  if (details.some((d) => `${d.code}|${d.componentCode ?? ""}|${d.reason}` === key)) return;
  details.push(detail);
}

function summarizeBlocking(details: ControlledApplyBlockingDetail[]): string[] {
  const codes = new Set(details.map((d) => d.code));
  return [...codes].map((code) => BLOCKING_SUMMARY[code]);
}

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
    case "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES":
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

function rowsForComponentCode(componentCode: string, currentRows: CurrentBomRow[]): CurrentBomRow[] {
  const codeKey = normalizeComponentCode(componentCode);
  return currentRows.filter((r) => normalizeComponentCode(r.componentCode) === codeKey);
}

function sumRowQuantities(rows: CurrentBomRow[]): number {
  return rows.reduce((acc, r) => acc + (r.quantity ?? 0), 0);
}

function pickCanonicalRow(rows: CurrentBomRow[]): CurrentBomRow {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id))[0];
}

type DuplicateIndusResolution =
  | {
      kind: "consolidate";
      keep: CurrentBomRow;
      remove: CurrentBomRow[];
      mode: ControlledApplyResolutionMode;
      totalQty: number;
    }
  | { kind: "ambiguous"; materialRows: CurrentBomRow[]; productRows: CurrentBomRow[] }
  | { kind: "single"; row: CurrentBomRow }
  | { kind: "none" };

function resolveDuplicateIndusRows(
  target: DesiredTarget,
  currentRows: CurrentBomRow[]
): DuplicateIndusResolution {
  const codeRows = rowsForComponentCode(target.componentCode, currentRows);
  const materialRows = codeRows.filter((r) => r.materialId);
  const productRows = codeRows.filter((r) => r.childProductId);

  if (codeRows.length === 0) {
    return { kind: "none" };
  }

  if (materialRows.length > 0 && productRows.length > 0) {
    if (target.materialId) {
      const keepPool = materialRows.filter((r) => r.materialId === target.materialId);
      if (keepPool.length === 0) {
        return { kind: "ambiguous", materialRows, productRows };
      }
      const keep = pickCanonicalRow(keepPool);
      const remove = codeRows.filter((r) => r.id !== keep.id);
      return {
        kind: "consolidate",
        keep,
        remove,
        mode: "PREFER_MATERIAL_FROM_EFFECTIVE",
        totalQty: sumRowQuantities(codeRows),
      };
    }
    if (target.childProductId) {
      const keepPool = productRows.filter((r) => r.childProductId === target.childProductId);
      if (keepPool.length === 0) {
        return { kind: "ambiguous", materialRows, productRows };
      }
      const keep = pickCanonicalRow(keepPool);
      const remove = codeRows.filter((r) => r.id !== keep.id);
      return {
        kind: "consolidate",
        keep,
        remove,
        mode: "PREFER_PRODUCT_FROM_EFFECTIVE",
        totalQty: sumRowQuantities(codeRows),
      };
    }
    return { kind: "ambiguous", materialRows, productRows };
  }

  if (target.productBomLineId) {
    const local = codeRows.find((r) => r.id === target.productBomLineId);
    if (local && codeRows.length > 1) {
      const keep = local;
      const remove = codeRows.filter((r) => r.id !== keep.id);
      return {
        kind: "consolidate",
        keep,
        remove,
        mode: "SAME_CHILD_PRODUCT",
        totalQty: sumRowQuantities(codeRows),
      };
    }
    if (local) return { kind: "single", row: local };
  }

  if (productRows.length > 1) {
    const childIds = new Set(productRows.map((r) => r.childProductId).filter(Boolean));
    if (childIds.size !== 1) {
      return { kind: "ambiguous", materialRows, productRows };
    }
    const keep = pickCanonicalRow(productRows);
    const remove = productRows.filter((r) => r.id !== keep.id);
    return {
      kind: "consolidate",
      keep,
      remove,
      mode: "SAME_CHILD_PRODUCT",
      totalQty: sumRowQuantities(productRows),
    };
  }

  if (materialRows.length > 1) {
    const matIds = new Set(materialRows.map((r) => r.materialId).filter(Boolean));
    if (matIds.size !== 1) {
      return { kind: "ambiguous", materialRows, productRows };
    }
    const keep = pickCanonicalRow(materialRows);
    const remove = materialRows.filter((r) => r.id !== keep.id);
    return {
      kind: "consolidate",
      keep,
      remove,
      mode: "SAME_MATERIAL",
      totalQty: sumRowQuantities(materialRows),
    };
  }

  const row =
    codeRows.find((r) => {
      if (target.materialId) return r.materialId === target.materialId;
      if (target.childProductId) return r.childProductId === target.childProductId;
      return true;
    }) ?? codeRows[0];

  return { kind: "single", row };
}

function controlledApplyHandlesComponent(actions: ControlledApplyAction[], componentCode: string): boolean {
  const key = normalizeComponentCode(componentCode);
  return actions.some((a) => {
    if (normalizeComponentCode(a.componentCode) !== key) return false;
    return (
      a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES" ||
      a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" ||
      a.actionType === "CREATE_PRODUCT_BOM_LINE" ||
      a.actionType === "REMOVE_PRODUCT_BOM_LINE"
    );
  });
}

function shouldBlockFromDryPlan(input: {
  dryPlan: NomusBomApplyPlan | undefined;
  actions: ControlledApplyAction[];
  comparisonLines: BomComparisonResult["lines"];
}): ControlledApplyBlockingDetail[] {
  const details: ControlledApplyBlockingDetail[] = [];
  const plan = input.dryPlan;
  if (!plan) return details;

  const planBlocked =
    Boolean(plan.isBlocked) || (plan.summary?.blockedActions ?? 0) > 0;
  if (!planBlocked) return details;

  const blockedDry = plan.actions.filter((a) => a.type === "BLOCKED");

  for (const dryAction of blockedDry) {
    const code = dryAction.componentCode?.trim();
    if (code && controlledApplyHandlesComponent(input.actions, code)) {
      continue;
    }
    if (code) {
      pushBlockingDetail(details, {
        code: "DRY_PLAN_BLOCKED",
        componentCode: code,
        componentDescription: dryAction.componentDescription ?? null,
        reason:
          dryAction.blockedReason ??
          dryAction.reason ??
          `Plano dry-run bloqueou ${code}.`,
        suggestedFix:
          "Revise a comparação Nomus x IndusCost e resolva duplicidade/quantidade deste componente.",
      });
      continue;
    }
  }

  const globalBlocked = blockedDry.filter((a) => !a.componentCode?.trim());
  if (globalBlocked.length === 0) return details;

  const qtyDiffLines = input.comparisonLines.filter((l) => l.status === "QUANTITY_DIFF");
  const unhandledQtyDiff = qtyDiffLines.filter(
    (l) => !controlledApplyHandlesComponent(input.actions, l.componentCode)
  );

  const hasUnhandledBlockedAction = input.actions.some((a) => a.actionType === "BLOCKED");
  const hasUnhandledAmbiguous = input.actions.some(
    (a) =>
      a.actionType === "BLOCKED" &&
      a.reason.includes("Produto e Material") &&
      !controlledApplyHandlesComponent(input.actions, a.componentCode)
  );

  if (unhandledQtyDiff.length === 0 && !hasUnhandledBlockedAction && !hasUnhandledAmbiguous) {
    return details;
  }

  for (const line of unhandledQtyDiff) {
    pushBlockingDetail(details, {
      code: "DRY_PLAN_BLOCKED",
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      reason: `Diferença de quantidade (${line.indusQuantity} IndusCost vs ${line.nomusQuantity} Nomus) sem plano controlado de consolidação.`,
      suggestedFix:
        line.hasDuplicateIndusLines
          ? "Corrija duplicidade na ProductBOM ou use a ação de consolidação sugerida na aplicação controlada."
          : "Revise quantidade na comparação antes de aplicar.",
    });
  }

  if (details.length === 0 && globalBlocked.length > 0) {
    const first = globalBlocked[0];
    pushBlockingDetail(details, {
      code: "DRY_PLAN_BLOCKED",
      reason: first.blockedReason ?? first.reason ?? BLOCKING_SUMMARY.DRY_PLAN_BLOCKED,
      suggestedFix:
        "Aba Plano dry-run: resolva classificação REVIEW_QUANTITY_DIFF ou outros bloqueios estruturais.",
    });
  }

  return details;
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
  effectiveLines: EffectivePricingBomLine[],
  currentRows: CurrentBomRow[]
): Promise<{ targets: DesiredTarget[]; unresolved: EffectivePricingBomLine[] }> {
  const included = effectiveLines.filter((l) => l.includedForPricing);
  const nomusCodes = included.filter((l) => !isLocalIncludedLine(l)).map((l) => l.componentCode);
  const resolved = await resolveNomusComponentCodes(nomusCodes);
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

    if (isLocalIncludedLine(line)) {
      const bomLineId = resolveLocalProductBomLineId(line, currentRows);
      if (!bomLineId) {
        unresolved.push(line);
        continue;
      }
      targets.push({
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        componentKind: "Local",
        materialId: null,
        childProductId: null,
        productBomLineId: bomLineId,
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

    let materialId: string | null = null;
    let childProductId: string | null = null;
    let resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE" = res.resolvedKind;

    if (res.resolvedKind === "BOTH") {
      if (res.materialId) {
        materialId = res.materialId;
        resolvedKind = "MATERIAL";
      } else if (res.productId) {
        childProductId = res.productId;
        resolvedKind = "PRODUCT";
      } else {
        unresolved.push(line);
        continue;
      }
    } else if (res.resolvedKind === "MATERIAL") {
      materialId = res.materialId ?? null;
    } else if (res.resolvedKind === "PRODUCT") {
      childProductId = res.productId ?? null;
    }

    targets.push({
      componentCode: line.componentCode,
      componentDescription: line.componentDescription ?? null,
      componentKind: componentKindFromResolution(resolvedKind, false),
      materialId,
      childProductId,
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
    const isLocal = isLocalIncludedLine(line);
    actions.push({
      actionType: "SKIP_UNRESOLVED",
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      componentKind: isLocal ? "Local" : "Desconhecido",
      currentQuantity: null,
      effectiveQuantity: line.quantity,
      reason: isLocal
        ? "Componente local incluído na BOM efetiva, mas sem linha correspondente na ProductBOM atual."
        : "Componente Nomus incluído na BOM efetiva sem Material ou Produto cadastrado no IndusCost.",
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
    const resolution = resolveDuplicateIndusRows(target, currentRows);

    if (resolution.kind === "ambiguous") {
      actions.push({
        actionType: "BLOCKED",
        componentCode: target.componentCode,
        componentDescription: target.componentDescription,
        componentKind: target.componentKind,
        currentQuantity: sumRowQuantities([
          ...resolution.materialRows,
          ...resolution.productRows,
        ]),
        effectiveQuantity: target.quantity,
        duplicateBomLineIds: [
          ...resolution.materialRows.map((r) => r.id),
          ...resolution.productRows.map((r) => r.id),
        ],
        reason:
          `Componente ${target.componentCode} aparece como Produto e Material na ProductBOM. Defina qual cadastro deve permanecer antes de aplicar.`,
        riskLevel: "BLOCKED",
        reviewDecisionType: target.effectiveLine.reviewDecisionType ?? null,
      });
      for (const row of [...resolution.materialRows, ...resolution.productRows]) {
        matchedCurrentIds.add(row.id);
      }
      continue;
    }

    if (resolution.kind === "none") {
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

    if (resolution.kind === "consolidate") {
      for (const row of [resolution.keep, ...resolution.remove]) {
        matchedCurrentIds.add(row.id);
      }
      const removeIds = resolution.remove.map((r) => r.id);
      const reason =
        resolution.remove.length > 0
          ? `Consolidar ${resolution.remove.length + 1} linha(s) IndusCost duplicada(s): soma atual ${resolution.totalQty}, alvo BOM efetiva ${target.quantity}.`
          : "Atualizar quantidade para refletir a BOM efetiva.";

      actions.push({
        actionType: "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
        componentCode: target.componentCode,
        componentDescription:
          target.componentDescription ?? resolution.keep.componentDescription,
        componentKind: target.componentKind,
        currentQuantity: resolution.keep.quantity,
        currentQuantityTotal: resolution.totalQty,
        effectiveQuantity: target.quantity,
        productBomLineId: resolution.keep.id,
        duplicateBomLineIds: [resolution.keep.id, ...removeIds],
        keepBomLineId: resolution.keep.id,
        removeBomLineIds: removeIds,
        resolutionMode: resolution.mode,
        reason,
        riskLevel: riskForAction("CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"),
        reviewDecisionType: target.effectiveLine.reviewDecisionType ?? null,
      });
      continue;
    }

    const current = resolution.row;
    matchedCurrentIds.add(current.id);
    const codeRows = rowsForComponentCode(target.componentCode, currentRows);
    for (const extra of codeRows) {
      if (extra.id !== current.id) matchedCurrentIds.add(extra.id);
    }

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

  const actionOrder: Record<ControlledApplyAction["actionType"], number> = {
    CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES: 0,
    CREATE_PRODUCT_BOM_LINE: 1,
    UPDATE_PRODUCT_BOM_QUANTITY: 2,
    REMOVE_PRODUCT_BOM_LINE: 3,
    KEEP_PRODUCT_BOM_LINE: 4,
    BLOCKED: 5,
    SKIP_UNRESOLVED: 6,
  };

  actions.sort((a, b) => {
    const orderDiff = actionOrder[a.actionType] - actionOrder[b.actionType];
    if (orderDiff !== 0) return orderDiff;
    return a.componentCode.localeCompare(b.componentCode, "pt-BR");
  });
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
      keepBomLineId: a.keepBomLineId ?? null,
      removeBomLineIds: a.removeBomLineIds ?? [],
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

function collectApplyGates(input: {
  productId: string | null;
  effectiveBom: EffectivePricingBomResult;
  actions: ControlledApplyAction[];
  dryPlan: NomusBomApplyPlan | undefined;
  comparisonLines: BomComparisonResult["lines"];
  costImpact: Awaited<ReturnType<typeof buildNomusEffectiveBomCostImpact>> | null;
}): { blockingReasons: string[]; blockingDetails: ControlledApplyBlockingDetail[]; warnings: string[] } {
  const details: ControlledApplyBlockingDetail[] = [];
  const warnings: string[] = [...(input.effectiveBom.warnings ?? [])];

  if (!input.productId) {
    pushBlockingDetail(details, {
      code: "NO_PRODUCT",
      reason: BLOCKING_SUMMARY.NO_PRODUCT,
      suggestedFix: "Cadastre o produto no IndusCost com o mesmo SKU/parentCode.",
    });
  }

  if (input.effectiveBom.status === "NO_NOMUS_BOM") {
    pushBlockingDetail(details, {
      code: "NO_NOMUS_BOM",
      reason: BLOCKING_SUMMARY.NO_NOMUS_BOM,
      suggestedFix: "Execute o sync da BOM Nomus para este parentCode.",
    });
  }

  if (BLOCKED_EFFECTIVE_STATUSES.has(input.effectiveBom.status)) {
    pushBlockingDetail(details, {
      code: "EFFECTIVE_BOM_BLOCKED",
      reason: `${BLOCKING_SUMMARY.EFFECTIVE_BOM_BLOCKED} (status: ${input.effectiveBom.status})`,
      suggestedFix: "Resolva opcionais e revisões locais na aba Pendências antes de aplicar.",
    });
  }

  const opt = input.effectiveBom.optionalPricingStatus;
  if (opt !== "RESOLVED" && opt !== "NO_OPTIONALS") {
    pushBlockingDetail(details, {
      code: "OPTIONAL_PENDING",
      reason: BLOCKING_SUMMARY.OPTIONAL_PENDING,
      suggestedFix: "Aba Pendências → Opcionais de precificação: selecione os grupos deste produto.",
    });
  }

  if (input.effectiveBom.status === "PENDING_LOCAL_REVIEW") {
    const pendingLocals = (input.effectiveBom.localReviewCatalog ?? []).filter(
      (c) => !c.savedDecision || c.savedDecision.decision === "PENDING"
    );
    for (const item of pendingLocals) {
      pushBlockingDetail(details, {
        code: "LOCAL_REVIEW_PENDING",
        componentCode: item.componentCode,
        componentDescription: item.componentDescription,
        source: "LOCAL_ONLY_INDUS_REVIEW",
        decisionType: "PENDING",
        reason: `Item local ${item.componentCode} sem decisão de revisão.`,
        suggestedFix: "Pendências → Itens locais: defina a decisão (incluir, excluir, duplicado, etc.).",
      });
    }
    if (pendingLocals.length === 0) {
      pushBlockingDetail(details, {
        code: "LOCAL_REVIEW_PENDING",
        reason: BLOCKING_SUMMARY.LOCAL_REVIEW_PENDING,
        suggestedFix: "Pendências → Itens locais: revise itens ONLY_IN_INDUSCOST pendentes.",
      });
    }
  }

  const includedCodes = new Set(
    input.effectiveBom.directLines
      .filter((l) => l.includedForPricing)
      .map((l) => normalizeComponentCode(l.componentCode))
  );

  for (const line of input.effectiveBom.directLines) {
    if (!line.includedForPricing) continue;
    if (
      line.reviewDecisionType !== "NEEDS_ENGINEERING_REVIEW" &&
      line.source !== "LOCAL_ONLY_ENGINEERING_REVIEW"
    ) {
      continue;
    }
    pushBlockingDetail(details, {
      code: "NEEDS_ENGINEERING_REVIEW",
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      source: line.source,
      decisionType: line.reviewDecisionType ?? "NEEDS_ENGINEERING_REVIEW",
      reason: line.reason,
      suggestedFix:
        "Pendências → Itens locais: altere NEEDS_ENGINEERING_REVIEW para decisão aplicável.",
    });
  }

  for (const item of input.effectiveBom.localReviewCatalog ?? []) {
    if (item.placement !== "engineering_review") continue;
    if (!includedCodes.has(normalizeComponentCode(item.componentCode))) {
      warnings.push(
        `${item.componentCode}: aguarda revisão de engenharia (fora da BOM efetiva incluída — não bloqueia aplicação).`
      );
      continue;
    }
    const decision = item.savedDecision?.decision ?? "NEEDS_ENGINEERING_REVIEW";
    pushBlockingDetail(details, {
      code: "NEEDS_ENGINEERING_REVIEW",
      componentCode: item.componentCode,
      componentDescription: item.componentDescription,
      source: "LOCAL_ONLY_ENGINEERING_REVIEW",
      decisionType: decision,
      reason: `${item.componentCode} incluído na BOM efetiva e aguarda revisão de engenharia (${decision}).`,
      suggestedFix:
        "Pendências → Itens locais: altere a decisão ou resolva duplicidade/absorção antes de aplicar.",
    });
  }

  for (const action of input.actions) {
    if (action.actionType === "SKIP_UNRESOLVED") {
      pushBlockingDetail(details, {
        code: "UNRESOLVED_INCLUDED_COMPONENT",
        componentCode: action.componentCode,
        componentDescription: action.componentDescription,
        source: action.componentKind === "Local" ? "LOCAL_ONLY_INCLUDED_BY_REVIEW" : "NOMUS_INCLUDED",
        decisionType: action.reviewDecisionType ?? undefined,
        reason: action.reason,
        suggestedFix:
          action.componentKind === "Local"
            ? "Confirme que a linha existe na ProductBOM ou ajuste a decisão local em Pendências."
            : "Cadastre Material ou Produto com o mesmo código do componente Nomus.",
      });
    }
    if (action.actionType === "BLOCKED") {
      const isAmbiguous = action.reason.includes("Produto e Material");
      pushBlockingDetail(details, {
        code: isAmbiguous ? "AMBIGUOUS_DUPLICATE_PRODUCT_BOM_LINE" : "BLOCKED_ACTION",
        componentCode: action.componentCode,
        componentDescription: action.componentDescription,
        reason: action.reason,
        suggestedFix: isAmbiguous
          ? "Corrija duplicidade no cadastro da BOM ou defina regra Product/Material antes de aplicar."
          : "Revise a BOM efetiva e o plano dry-run antes de aplicar.",
      });
    }
  }

  for (const line of input.comparisonLines) {
    if (!line.hasDuplicateIndusLines || line.status !== "QUANTITY_DIFF") continue;
    const hasConsolidate = input.actions.some(
      (a) =>
        a.componentCode === line.componentCode &&
        a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"
    );
    if (!hasConsolidate && !input.actions.some((a) => a.componentCode === line.componentCode && a.actionType === "BLOCKED")) {
      warnings.push(
        `${line.componentCode}: IndusCost tem ${line.indusLineCount} linha(s) (total ${line.indusQuantity}) vs Nomus ${line.nomusQuantity} — verifique aplicação controlada.`
      );
    }
  }

  const unresolvedCostLines =
    input.costImpact?.includedLines?.filter(
      (l) => l.resolvedAs === "UNRESOLVED" || l.totalCost == null
    ) ?? [];

  for (const line of unresolvedCostLines) {
    pushBlockingDetail(details, {
      code: "COST_UNRESOLVED",
      componentCode: line.componentCode,
      componentDescription: line.description,
      source: line.source,
      reason: `Custo não resolvido para ${line.componentCode} na BOM efetiva incluída.`,
      suggestedFix: "Aba Impacto de custo: cadastre custo do material/produto ou revise a linha.",
    });
  }

  for (const dryDetail of shouldBlockFromDryPlan({
    dryPlan: input.dryPlan,
    actions: input.actions,
    comparisonLines: input.comparisonLines,
  })) {
    pushBlockingDetail(details, dryDetail);
  }

  return {
    blockingReasons: summarizeBlocking(details),
    blockingDetails: details,
    warnings,
  };
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

  const comparison = await buildBomComparisonForParentCode(trimmed);

  const costImpact = product
    ? await buildNomusEffectiveBomCostImpact(
        trimmed,
        { recursive: false, maxDepth: 10 },
        null
      )
    : null;

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

  const { targets, unresolved } = await buildDesiredTargets(
    effectiveBom.directLines,
    currentRows
  );
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

  const { blockingReasons, blockingDetails, warnings } = collectApplyGates({
    productId,
    effectiveBom,
    actions,
    dryPlan,
    comparisonLines: comparison.lines,
    costImpact,
  });

  const canApply = blockingDetails.length === 0;

  const afterRowsPreview = [...currentRows];
  for (const action of actions) {
    if (action.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES" && action.keepBomLineId) {
      for (const removeId of action.removeBomLineIds ?? []) {
        const idx = afterRowsPreview.findIndex((r) => r.id === removeId);
        if (idx >= 0) afterRowsPreview.splice(idx, 1);
      }
      const keep = afterRowsPreview.find((r) => r.id === action.keepBomLineId);
      if (keep && action.effectiveQuantity != null) {
        keep.quantity = action.effectiveQuantity;
      }
    }
    if (action.actionType === "REMOVE_PRODUCT_BOM_LINE" && action.productBomLineId) {
      const idx = afterRowsPreview.findIndex((r) => r.id === action.productBomLineId);
      if (idx >= 0) afterRowsPreview.splice(idx, 1);
    }
    if (action.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" && action.productBomLineId) {
      const row = afterRowsPreview.find((r) => r.id === action.productBomLineId);
      if (row && action.effectiveQuantity != null) row.quantity = action.effectiveQuantity;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    parentCode: trimmed,
    productId,
    canApply,
    blockingReasons,
    blockingDetails,
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
          unresolvedCostLines:
            costImpact.includedLines?.filter(
              (l) => l.resolvedAs === "UNRESOLVED" || l.totalCost == null
            ).length ?? 0,
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
    (await buildEffectivePricingBomForParentCode(trimmed, { recursive: false })).directLines,
    beforeRows
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

      if (
        action.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES" &&
        action.keepBomLineId
      ) {
        const before = currentById.get(action.keepBomLineId);
        const updated = await tx.productBOM.update({
          where: { id: action.keepBomLineId },
          data: { quantity: action.effectiveQuantity ?? 0 },
        });
        await tx.nomusBomApplyRunLine.create({
          data: {
            runId: run.id,
            actionType: action.actionType,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            productBomLineId: action.keepBomLineId,
            beforeJson: before ? serializeBomRow(before) : undefined,
            afterJson: {
              id: updated.id,
              quantity: toNumberSafe(updated.quantity),
              consolidatedFrom: action.removeBomLineIds ?? [],
            },
            status: "APPLIED",
            reason: action.reason,
          },
        });
        appliedActions.push(action);

        for (const removeId of action.removeBomLineIds ?? []) {
          const beforeRemove = currentById.get(removeId);
          await tx.productBOM.delete({ where: { id: removeId } });
          await tx.nomusBomApplyRunLine.create({
            data: {
              runId: run.id,
              actionType: "REMOVE_PRODUCT_BOM_LINE",
              componentCode: action.componentCode,
              componentDescription: action.componentDescription,
              productBomLineId: removeId,
              beforeJson: beforeRemove ? serializeBomRow(beforeRemove) : undefined,
              afterJson: Prisma.JsonNull,
              status: "APPLIED",
              reason: `Removida linha duplicada durante consolidação de ${action.componentCode}.`,
            },
          });
        }
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
      updated:
        appliedActions.filter(
          (a) =>
            a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" ||
            a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"
        ).length,
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

  const summary = {
    created: preview.actions.filter((a) => a.actionType === "CREATE_PRODUCT_BOM_LINE").length,
    updated:
      preview.actions.filter(
        (a) =>
          a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY" ||
          a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"
      ).length,
    kept: preview.actions.filter((a) => a.actionType === "KEEP_PRODUCT_BOM_LINE").length,
    removed: preview.actions.filter((a) => a.actionType === "REMOVE_PRODUCT_BOM_LINE").length,
    skipped: preview.actions.filter((a) => a.actionType === "SKIP_UNRESOLVED").length,
    blocked: preview.actions.filter((a) => a.actionType === "BLOCKED").length,
  };

  const totalMutations = summary.created + summary.updated + summary.removed;
  const resultStatus: "APPLIED" | "NO_CHANGES" =
    totalMutations === 0 ? "NO_CHANGES" : "APPLIED";
  const message =
    resultStatus === "NO_CHANGES"
      ? "Nenhuma alteração necessária. A ProductBOM já reflete a BOM efetiva."
      : `BOM efetiva aplicada com sucesso (${summary.created} criação(ões), ${summary.updated} atualização(ões), ${summary.removed} remoção(ões)).`;

  return {
    applied: resultStatus === "APPLIED",
    resultStatus,
    message,
    applyRunId,
    parentCode: trimmed,
    productId,
    summary,
    beforeBom: beforeBomJson,
    afterBom: afterRows.map(serializeBomRow),
    actionsApplied: preview.actions,
  };
}
