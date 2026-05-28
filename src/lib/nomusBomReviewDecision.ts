import type { NomusBomReviewDecisionType as PrismaReviewDecisionType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku, toNumberSafe } from "@/src/lib/nomusBomComparison";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  LocalReviewCatalogItem,
  NomusBomReviewDecisionType,
  ReviewDecisionView,
} from "@/src/lib/nomusEffectivePricingBomTypes";
import { isLocalAssemblyComponentCode } from "@/src/lib/nomusEffectivePricingBomTypes";
import {
  AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON,
  isAutoRemovableObsoleteLocalLine,
  type NomusUniverseCodeSet,
} from "@/src/lib/nomusBomUniverse";

export type {
  LocalReviewCatalogItem,
  NomusBomReviewDecisionType,
  ReviewDecisionView,
} from "@/src/lib/nomusEffectivePricingBomTypes";

export {
  REVIEW_DECISION_BADGE,
  REVIEW_DECISION_LABELS,
} from "@/src/lib/nomusEffectivePricingBomTypes";

const DECISION_REQUIRES_RELATED: NomusBomReviewDecisionType = "DUPLICATED_BY_NOMUS_COMPONENT";

function rowToView(row: {
  id: string;
  parentCode: string;
  parentProductId: string | null;
  productBomLineId: string | null;
  componentCode: string;
  componentDescription: string | null;
  quantitySnapshot: unknown;
  decision: NomusBomReviewDecisionType;
  includeForPricing: boolean;
  relatedNomusComponentCode: string | null;
  reason: string | null;
  notes: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}): ReviewDecisionView {
  return {
    id: row.id,
    parentCode: row.parentCode,
    parentProductId: row.parentProductId,
    productBomLineId: row.productBomLineId,
    componentCode: row.componentCode,
    componentDescription: row.componentDescription,
    quantitySnapshot: toNumberSafe(row.quantitySnapshot),
    decision: row.decision,
    includeForPricing: row.includeForPricing,
    relatedNomusComponentCode: row.relatedNomusComponentCode,
    reason: row.reason,
    notes: row.notes,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

export function parseProductBomLineIdFromLine(line: EffectivePricingBomLine): string | null {
  if (line.productBomLineId) return line.productBomLineId;
  if (line.resolution?.startsWith("indus_bom:")) {
    return line.resolution.slice("indus_bom:".length);
  }
  return null;
}

/** Regra provisória: montagem 800.xx no ProductBOM entra como componente local incluído. */
export function inferDefaultLocalReviewDecision(
  componentCode: string
): NomusBomReviewDecisionType | null {
  if (isLocalAssemblyComponentCode(componentCode)) {
    return "INCLUDE_AS_LOCAL_EXCEPTION";
  }
  return null;
}

export type AutoObsoleteLocalContext = {
  nomusUniverse: NomusUniverseCodeSet;
  localRowFlags?: ReadonlyMap<string, { localException: boolean }>;
};

function syntheticReviewDecision(
  parentCode: string,
  base: EffectivePricingBomLine,
  bomLineId: string,
  decision: NomusBomReviewDecisionType,
  reason?: string
): ReviewDecisionView {
  return {
    id: "",
    parentCode,
    parentProductId: null,
    productBomLineId: bomLineId,
    componentCode: base.componentCode,
    componentDescription: base.componentDescription ?? null,
    quantitySnapshot: base.quantity,
    decision,
    includeForPricing: decision === "INCLUDE_AS_LOCAL_EXCEPTION",
    relatedNomusComponentCode: null,
    reason:
      reason ??
      "Regra padrão: montagem 800.xx como componente local na precificação.",
    notes: null,
    decidedBy: null,
    decidedAt: null,
  };
}

function syntheticAutoObsoleteReviewDecision(
  parentCode: string,
  base: EffectivePricingBomLine,
  bomLineId: string
): ReviewDecisionView {
  return syntheticReviewDecision(
    parentCode,
    base,
    bomLineId,
    "EXCLUDE_FROM_PRICING",
    AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON
  );
}

function effectiveReviewDecision(
  saved: ReviewDecisionView | undefined,
  parentCode: string,
  base: EffectivePricingBomLine,
  bomLineId: string,
  autoObsoleteContext?: AutoObsoleteLocalContext
): ReviewDecisionView | null {
  if (saved && saved.decision !== "PENDING") return saved;

  const inferred = inferDefaultLocalReviewDecision(base.componentCode);
  if (inferred) return syntheticReviewDecision(parentCode, base, bomLineId, inferred);

  if (autoObsoleteContext) {
    const localException = autoObsoleteContext.localRowFlags?.get(bomLineId)?.localException;
    if (
      isAutoRemovableObsoleteLocalLine({
        componentCode: base.componentCode,
        componentDescription: base.componentDescription,
        localException,
        nomusUniverse: autoObsoleteContext.nomusUniverse,
      })
    ) {
      return syntheticAutoObsoleteReviewDecision(parentCode, base, bomLineId);
    }
  }

  if (saved) return saved;
  return null;
}

function matchDecision(
  decisions: ReviewDecisionView[],
  parentCode: string,
  componentCode: string,
  productBomLineId: string | null
): ReviewDecisionView | undefined {
  const parentKey = normalizeSku(parentCode);
  const codeKey = normalizeComponentCode(componentCode);

  if (productBomLineId) {
    const byLine = decisions.find((d) => d.productBomLineId === productBomLineId);
    if (byLine) return byLine;
  }

  return decisions.find(
    (d) =>
      normalizeSku(d.parentCode) === parentKey &&
      normalizeComponentCode(d.componentCode) === codeKey
  );
}

export function validateReviewDecisionInput(input: {
  decision: NomusBomReviewDecisionType;
  includeForPricing?: boolean;
  relatedNomusComponentCode?: string | null;
}): { includeForPricing: boolean } {
  if (input.decision === "INCLUDE_AS_LOCAL_EXCEPTION") {
    return { includeForPricing: true };
  }
  if (input.decision === "PENDING") {
    return { includeForPricing: false };
  }
  if (input.includeForPricing === true) {
    throw new Error("includeForPricing só pode ser true para INCLUDE_AS_LOCAL_EXCEPTION.");
  }
  if (
    input.decision === DECISION_REQUIRES_RELATED &&
    !input.relatedNomusComponentCode?.trim()
  ) {
    throw new Error("Informe relatedNomusComponentCode para decisão de duplicado/absorvido.");
  }
  return { includeForPricing: false };
}

export async function listReviewDecisionsForParentCode(
  parentCode: string
): Promise<{ generatedAt: string; parentCode: string; decisions: ReviewDecisionView[] }> {
  const trimmed = parentCode.trim();
  const rows = await prisma.nomusBomReviewDecision.findMany({
    where: {
      isActive: true,
      parentCode: { equals: trimmed, mode: "insensitive" },
    },
    orderBy: [{ componentCode: "asc" }, { updatedAt: "desc" }],
  });

  return {
    generatedAt: new Date().toISOString(),
    parentCode: normalizeSku(trimmed),
    decisions: rows.map(rowToView),
  };
}

export type SaveReviewDecisionInput = {
  parentCode: string;
  parentProductId?: string | null;
  productBomLineId?: string | null;
  componentCode: string;
  componentDescription?: string | null;
  quantitySnapshot?: number | null;
  decision: NomusBomReviewDecisionType;
  includeForPricing?: boolean;
  relatedNomusComponentCode?: string | null;
  reason?: string | null;
  notes?: string | null;
};

export async function saveReviewDecision(
  input: SaveReviewDecisionInput,
  decidedBy?: string | null
): Promise<ReviewDecisionView> {
  const parentCode = input.parentCode.trim();
  const componentCode = input.componentCode.trim();
  if (!parentCode || !componentCode) {
    throw new Error("parentCode e componentCode são obrigatórios.");
  }

  const { includeForPricing } = validateReviewDecisionInput({
    decision: input.decision,
    includeForPricing: input.includeForPricing,
    relatedNomusComponentCode: input.relatedNomusComponentCode,
  });

  const productBomLineId = input.productBomLineId?.trim() || null;
  const parentKey = normalizeSku(parentCode);

  const existing = await prisma.nomusBomReviewDecision.findFirst({
    where: {
      isActive: true,
      parentCode: { equals: parentKey, mode: "insensitive" },
      ...(productBomLineId
        ? { productBomLineId }
        : {
            componentCode: { equals: componentCode, mode: "insensitive" },
            productBomLineId: null,
          }),
    },
    orderBy: { updatedAt: "desc" },
  });

  const data = {
    parentCode: parentKey,
    parentProductId: input.parentProductId?.trim() || null,
    productBomLineId,
    componentCode,
    componentDescription: input.componentDescription?.trim() || null,
    quantitySnapshot: input.quantitySnapshot ?? null,
    decision: input.decision as PrismaReviewDecisionType,
    includeForPricing,
    relatedNomusComponentCode: input.relatedNomusComponentCode?.trim() || null,
    reason: input.reason?.trim() || null,
    notes: input.notes?.trim() || null,
    decidedBy: decidedBy ?? null,
    decidedAt: input.decision === "PENDING" ? null : new Date(),
    isActive: true,
  };

  if (existing) {
    const updated = await prisma.nomusBomReviewDecision.update({
      where: { id: existing.id },
      data,
    });
    return rowToView(updated);
  }

  const created = await prisma.nomusBomReviewDecision.create({ data });
  return rowToView(created);
}

export async function clearReviewDecision(input: {
  parentCode: string;
  productBomLineId?: string | null;
  componentCode?: string | null;
}): Promise<void> {
  const parentCode = input.parentCode.trim();
  if (!parentCode) throw new Error("parentCode é obrigatório.");

  const productBomLineId = input.productBomLineId?.trim();
  const componentCode = input.componentCode?.trim();
  if (!productBomLineId && !componentCode) {
    throw new Error("Informe productBomLineId ou componentCode.");
  }

  await prisma.nomusBomReviewDecision.updateMany({
    where: {
      isActive: true,
      parentCode: { equals: parentCode, mode: "insensitive" },
      ...(productBomLineId ? { productBomLineId } : {}),
      ...(componentCode
        ? { componentCode: { equals: componentCode, mode: "insensitive" } }
        : {}),
    },
    data: { isActive: false },
  });
}

function applyDecisionToLine(
  base: EffectivePricingBomLine,
  saved: ReviewDecisionView | null
): {
  line: EffectivePricingBomLine;
  bucket: "review" | "direct" | "excluded" | "engineering_review";
} {
  const decision = saved?.decision ?? "PENDING";
  const notesSuffix = saved?.notes ? ` Observação: ${saved.notes}` : "";
  const relatedSuffix = saved?.relatedNomusComponentCode
    ? ` Componente Nomus relacionado: ${saved.relatedNomusComponentCode}.`
    : "";

  const emptyFlags = base.flags;

  switch (decision) {
    case "INCLUDE_AS_LOCAL_EXCEPTION":
      return {
        bucket: "direct",
        line: {
          ...base,
          source: "LOCAL_ONLY_INCLUDED_BY_REVIEW",
          decision: "INCLUDE",
          includedForPricing: true,
          reason: `Incluído na BOM efetiva como componente local (exceção na precificação).${notesSuffix}`,
          reviewDecisionId: saved?.id,
          reviewDecisionType: decision,
          relatedNomusComponentCode: saved?.relatedNomusComponentCode ?? undefined,
        },
      };
    case "EXCLUDE_FROM_PRICING": {
      const isAutoObsolete = saved?.reason === AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON && !saved.id;
      return {
        bucket: "excluded",
        line: {
          ...base,
          source: isAutoObsolete ? "LOCAL_ONLY_OBSOLETE_NOMUS" : "LOCAL_ONLY_EXCLUDED_BY_REVIEW",
          decision: "EXCLUDE",
          includedForPricing: false,
          reason: isAutoObsolete
            ? `${AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON}${notesSuffix}`
            : `Excluído da precificação por decisão do usuário.${notesSuffix}`,
          reviewDecisionId: saved?.id,
          reviewDecisionType: decision,
        },
      };
    }
    case "DUPLICATED_BY_NOMUS_COMPONENT":
      return {
        bucket: "excluded",
        line: {
          ...base,
          source: "LOCAL_ONLY_DUPLICATED_BY_NOMUS",
          decision: "EXCLUDE",
          includedForPricing: false,
          reason: `Item local considerado duplicado/absorvido por componente Nomus.${relatedSuffix}${notesSuffix}`,
          reviewDecisionId: saved?.id,
          reviewDecisionType: decision,
          relatedNomusComponentCode: saved?.relatedNomusComponentCode ?? undefined,
        },
      };
    case "OPERATIONAL_ROUTING_COST":
      return {
        bucket: "excluded",
        line: {
          ...base,
          source: "OPERATIONAL_ROUTING_COST",
          decision: "EXCLUDE",
          includedForPricing: false,
          reason: `Tratar como custo de roteiro/processo, não como item de BOM material.${notesSuffix}`,
          reviewDecisionId: saved?.id,
          reviewDecisionType: decision,
        },
      };
    case "NEEDS_ENGINEERING_REVIEW":
      return {
        bucket: "engineering_review",
        line: {
          ...base,
          source: "LOCAL_ONLY_ENGINEERING_REVIEW",
          decision: "REVIEW",
          includedForPricing: false,
          reason: `Pendente de revisão de engenharia.${notesSuffix}`,
          reviewDecisionId: saved?.id,
          reviewDecisionType: decision,
        },
      };
    case "PENDING":
    default:
      return {
        bucket: "review",
        line: {
          ...base,
          source: "LOCAL_ONLY_INDUS_REVIEW",
          decision: "REVIEW",
          includedForPricing: false,
          reason:
            "Linha presente apenas no IndusCost (ProductBOM). Aguardando decisão do usuário.",
          reviewDecisionId: saved?.id,
          reviewDecisionType: "PENDING",
        },
      };
  }
}

function isLocalReviewDerivedLine(line: EffectivePricingBomLine): boolean {
  return (
    line.source.startsWith("LOCAL_ONLY_") || line.source === "OPERATIONAL_ROUTING_COST"
  );
}

export function applyReviewDecisionsToEffectiveBom(
  result: EffectivePricingBomResult,
  decisions: ReviewDecisionView[],
  rawLocalLines: EffectivePricingBomLine[],
  autoObsoleteContext?: AutoObsoleteLocalContext
): EffectivePricingBomResult {
  const nonLocalDirect = result.directLines.filter((l) => !isLocalReviewDerivedLine(l));
  const nonLocalExcluded = result.excludedLines.filter((l) => !isLocalReviewDerivedLine(l));
  const nonLocalReview = result.reviewLines.filter((l) => !isLocalReviewDerivedLine(l));

  const newDirect = [...nonLocalDirect];
  const newExcluded = [...nonLocalExcluded];
  const newReview = [...nonLocalReview];
  const catalog: LocalReviewCatalogItem[] = [];

  for (const base of rawLocalLines) {
    const bomLineId = parseProductBomLineIdFromLine(base) ?? "unknown";
    const saved = matchDecision(decisions, result.parentCode, base.componentCode, bomLineId);
    const effective = effectiveReviewDecision(
      saved,
      result.parentCode,
      base,
      bomLineId,
      autoObsoleteContext
    );
    const { line, bucket } = applyDecisionToLine(base, effective);

    let placement: LocalReviewCatalogItem["placement"];
    if (bucket === "direct") placement = "included";
    else if (bucket === "excluded") placement = "excluded";
    else if (bucket === "engineering_review") placement = "engineering_review";
    else placement = "pending_review";

    catalog.push({
      componentCode: base.componentCode,
      componentDescription: base.componentDescription ?? null,
      quantity: base.quantity,
      productBomLineId: bomLineId,
      savedDecision: effective,
      placement,
    });

    if (bucket === "direct") newDirect.push(line);
    else if (bucket === "excluded") newExcluded.push(line);
    else newReview.push(line);
  }

  newDirect.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  newExcluded.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  newReview.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  catalog.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));

  const localReviewPendingCount = catalog.filter(
    (c) => !c.savedDecision || c.savedDecision.decision === "PENDING"
  ).length;
  const localReviewResolvedCount = catalog.filter(
    (c) => c.savedDecision && c.savedDecision.decision !== "PENDING"
  ).length;
  const localIncludedByReviewCount = newDirect.filter(
    (l) => l.source === "LOCAL_ONLY_INCLUDED_BY_REVIEW"
  ).length;
  const localExcludedByReviewCount = newExcluded.filter((l) =>
    [
      "LOCAL_ONLY_EXCLUDED_BY_REVIEW",
      "LOCAL_ONLY_OBSOLETE_NOMUS",
      "LOCAL_ONLY_DUPLICATED_BY_NOMUS",
      "OPERATIONAL_ROUTING_COST",
    ].includes(l.source)
  ).length;
  const operationalRoutingReviewCount = newExcluded.filter(
    (l) => l.source === "OPERATIONAL_ROUTING_COST"
  ).length;

  const warnings = [...result.warnings];
  if (localReviewPendingCount > 0) {
    warnings.push(
      `${localReviewPendingCount} item(ns) local(is) sem decisão de revisão na BOM efetiva.`
    );
  }
  if (catalog.some((c) => c.savedDecision?.decision === "NEEDS_ENGINEERING_REVIEW")) {
    warnings.push("Há itens locais aguardando revisão de engenharia.");
  }

  let status = result.status;
  if (result.status === "READY_FOR_PRICING_PREVIEW" || result.status === "READY_WITH_LOCAL_REVIEW") {
    if (localReviewPendingCount > 0) {
      status = "PENDING_LOCAL_REVIEW";
    } else if (
      catalog.some((c) => c.savedDecision?.decision === "NEEDS_ENGINEERING_REVIEW") ||
      localReviewResolvedCount > 0
    ) {
      status = "READY_WITH_LOCAL_REVIEW";
    } else {
      status = "READY_FOR_PRICING_PREVIEW";
    }
  } else if (localReviewPendingCount > 0 && result.status !== "NO_NOMUS_BOM") {
    if (
      result.status !== "PENDING_OPTIONAL_SELECTION" &&
      result.status !== "STALE_OPTIONAL_SELECTION" &&
      result.status !== "BLOCKED_UNRESOLVED_COMPONENTS"
    ) {
      status = "PENDING_LOCAL_REVIEW";
    }
  }

  return {
    ...result,
    status,
    directLines: newDirect,
    excludedLines: newExcluded,
    reviewLines: newReview,
    localReviewCatalog: catalog,
    summary: {
      ...result.summary,
      localReviewPendingCount,
      localReviewResolvedCount,
      localIncludedByReviewCount,
      localExcludedByReviewCount,
      operationalRoutingReviewCount,
      includedLinesCount: newDirect.filter((l) => l.includedForPricing).length,
      excludedLinesCount: newExcluded.length,
      reviewLinesCount: newReview.length,
    },
    warnings,
  };
}
