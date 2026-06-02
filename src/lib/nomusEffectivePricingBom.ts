import {
  aggregateNomusLineFlags,
  chooseEffectiveNomusList,
  normalizeComponentCode,
  normalizeSku,
  type NomusAggregatedLineFlags,
  type NomusEffectiveBomLine,
  type NomusListSummary,
} from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  loadNomusStageLinesForParent,
  resolveNomusComponentCodes,
} from "@/src/lib/nomusBomComparisonLoad";
import { detectOperationalItem } from "@/src/lib/nomusBomClassification";
import {
  buildOptionalSelectionStatus,
  computeUnassignedOptionalItems,
  getEffectiveNomusContext,
  loadGroupsForParent,
  type AggregatedOptionalItem,
  type OptionalPricingGroupView,
  type PricingOptionalStatus,
} from "@/src/lib/nomusOptionalPricingSelection";
import type { PreferredAlternativeSet } from "@/src/lib/nomusPreferredAlternativeLink";
import {
  applyReviewDecisionsToEffectiveBom,
  listReviewDecisionsForParentCode,
  parseProductBomLineIdFromLine,
} from "@/src/lib/nomusBomReviewDecision";
import { buildNomusUniverseCodeSet, type NomusUniverseCodeSet } from "@/src/lib/nomusBomUniverse";
import { prisma } from "@/src/lib/prisma";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  EffectivePricingBomSource,
  EffectivePricingBomStatus,
  EffectivePricingBomSummary,
  EffectivePricingBomTreeNode,
  LocalReviewCatalogItem,
} from "@/src/lib/nomusEffectivePricingBomTypes";

export type {
  EffectivePricingBomDecision,
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  EffectivePricingBomSource,
  EffectivePricingBomStatus,
  EffectivePricingBomSummary,
  EffectivePricingBomTreeNode,
  LocalReviewCatalogItem,
  NomusBomReviewDecisionType,
  ReviewDecisionView,
} from "@/src/lib/nomusEffectivePricingBomTypes";

const DEFAULT_MAX_DEPTH = 10;

type ComponentResolution =
  | { kind: "required" }
  | { kind: "operational" }
  | { kind: "unassigned" }
  | { kind: "group_pending"; group: OptionalPricingGroupView }
  | { kind: "group_stale"; group: OptionalPricingGroupView }
  | {
      kind: "optional_resolved";
      group: OptionalPricingGroupView;
      choiceId: string;
      selected: boolean;
      selectedNone: boolean;
    }
  | {
      kind: "exclusive_set_resolved";
      set: PreferredAlternativeSet;
      selected: boolean;
      brokenLink?: boolean;
    };

function applyPreferredAlternativeExclusiveResolution(
  map: Map<string, ComponentResolution>,
  sets: PreferredAlternativeSet[],
  groups: OptionalPricingGroupView[]
): void {
  for (const set of sets) {
    const prefKey = set.preferredComponentCode
      ? normalizeComponentCode(set.preferredComponentCode)
      : "";
    const allKeys = [
      prefKey,
      ...set.alternativeComponentCodes.map((c) => normalizeComponentCode(c)),
    ].filter(Boolean);

    const coveringGroup = groups.find(
      (g) =>
        g.isActive &&
        g.choices.some(
          (c) => c.isActive && allKeys.includes(normalizeComponentCode(c.componentCode))
        )
    );

    if (coveringGroup) {
      if (coveringGroup.selectedNone) {
        for (const key of allKeys) {
          const choice = coveringGroup.choices.find(
            (c) => c.isActive && normalizeComponentCode(c.componentCode) === key
          );
          map.set(key, {
            kind: "optional_resolved",
            group: coveringGroup,
            choiceId: choice?.id ?? "",
            selected: false,
            selectedNone: true,
          });
        }
        continue;
      }

      const selectedChoices = coveringGroup.choices.filter(
        (c) => c.isActive && c.isSelectedForPricing
      );
      const selectedKey =
        selectedChoices.length === 1
          ? normalizeComponentCode(selectedChoices[0]!.componentCode)
          : null;

      if (selectedKey && selectedChoices[0]?.isStale) {
        map.set(selectedKey, { kind: "group_stale", group: coveringGroup });
        for (const key of allKeys) {
          if (key !== selectedKey) {
            map.set(key, {
              kind: "optional_resolved",
              group: coveringGroup,
              choiceId: "",
              selected: false,
              selectedNone: false,
            });
          }
        }
        continue;
      }

      if (selectedKey && !set.preferredInSnapshot && selectedKey !== prefKey) {
        map.set(selectedKey, { kind: "group_stale", group: coveringGroup });
        for (const key of allKeys) {
          if (key !== selectedKey) {
            map.set(key, {
              kind: "optional_resolved",
              group: coveringGroup,
              choiceId: "",
              selected: false,
              selectedNone: false,
            });
          }
        }
        continue;
      }

      if (selectedKey) {
        for (const key of allKeys) {
          const choice = coveringGroup.choices.find(
            (c) => c.isActive && normalizeComponentCode(c.componentCode) === key
          );
          map.set(key, {
            kind: "optional_resolved",
            group: coveringGroup,
            choiceId: choice?.id ?? "",
            selected: key === selectedKey,
            selectedNone: false,
          });
        }
      }
      continue;
    }

    if (!set.preferredInSnapshot) {
      for (const key of allKeys) {
        map.set(key, {
          kind: "exclusive_set_resolved",
          set,
          selected: false,
          brokenLink: true,
        });
      }
      continue;
    }

    for (const key of allKeys) {
      map.set(key, {
        kind: "exclusive_set_resolved",
        set,
        selected: key === prefKey,
      });
    }
  }
}

function flagsForItem(
  item: AggregatedOptionalItem,
  lineByExternalId: Map<number, NomusEffectiveBomLine>
): NomusAggregatedLineFlags {
  const raw = item.nomusSourceLineIds
    .map((id) => lineByExternalId.get(id))
    .filter((l): l is NomusEffectiveBomLine => l != null);
  return aggregateNomusLineFlags(raw);
}

export function buildComponentResolutionMap(
  optionalItems: AggregatedOptionalItem[],
  groups: OptionalPricingGroupView[],
  unassigned: AggregatedOptionalItem[],
  preferredAlternativeSets: PreferredAlternativeSet[] = []
): Map<string, ComponentResolution> {
  const map = new Map<string, ComponentResolution>();

  for (const item of unassigned) {
    map.set(normalizeComponentCode(item.componentCode), { kind: "unassigned" });
  }

  for (const group of groups) {
    if (!group.isActive) continue;
    for (const choice of group.choices) {
      if (!choice.isActive) continue;
      const key = normalizeComponentCode(choice.componentCode);
      const selectedNone = group.selectedNone;

      if (selectedNone) {
        map.set(key, {
          kind: "optional_resolved",
          group,
          choiceId: choice.id,
          selected: false,
          selectedNone: true,
        });
        continue;
      }

      if (choice.isStale && choice.isSelectedForPricing) {
        map.set(key, { kind: "group_stale", group });
        continue;
      }

      if (group.status === "PENDING") {
        map.set(key, { kind: "group_pending", group });
        continue;
      }

      if (group.status === "STALE" && choice.isSelectedForPricing) {
        map.set(key, { kind: "group_stale", group });
        continue;
      }

      const selected = choice.isSelectedForPricing;
      map.set(key, {
        kind: "optional_resolved",
        group,
        choiceId: choice.id,
        selected: selected && !selectedNone,
        selectedNone,
      });
    }
  }

  for (const item of optionalItems) {
    const key = normalizeComponentCode(item.componentCode);
    if (!map.has(key)) {
      map.set(key, { kind: "unassigned" });
    }
  }

  applyPreferredAlternativeExclusiveResolution(map, preferredAlternativeSets, groups);

  return map;
}

function selectedSource(
  item: AggregatedOptionalItem,
  selected: boolean
): EffectivePricingBomSource {
  if (item.isAlternative) {
    return selected ? "NOMUS_ALTERNATIVE_SELECTED" : "NOMUS_ALTERNATIVE_NOT_SELECTED";
  }
  return selected ? "NOMUS_OPTIONAL_SELECTED" : "NOMUS_OPTIONAL_NOT_SELECTED";
}

function buildLineFromRequired(
  item: AggregatedOptionalItem,
  flags: NomusAggregatedLineFlags
): EffectivePricingBomLine {
  return {
    componentCode: item.componentCode,
    componentDescription: item.componentDescription,
    quantity: item.plannedQuantity,
    source: "NOMUS_REQUIRED",
    decision: "INCLUDE",
    includedForPricing: true,
    reason: "Item obrigatório da lista Nomus efetiva.",
    flags,
    nomusSourceLineIds: item.nomusSourceLineIds,
  };
}

function buildLineFromOperational(
  item: AggregatedOptionalItem,
  flags: NomusAggregatedLineFlags
): EffectivePricingBomLine {
  return {
    componentCode: item.componentCode,
    componentDescription: item.componentDescription,
    quantity: item.plannedQuantity,
    source: "OPERATIONAL_IGNORED",
    decision: "REVIEW",
    includedForPricing: false,
    reason: "Item operacional/local. Revisar roteiro/processo.",
    flags,
    nomusSourceLineIds: item.nomusSourceLineIds,
  };
}

function buildLineFromOptional(
  item: AggregatedOptionalItem,
  flags: NomusAggregatedLineFlags,
  resolution: ComponentResolution
): EffectivePricingBomLine {
  const base = {
    componentCode: item.componentCode,
    componentDescription: item.componentDescription,
    quantity: item.plannedQuantity,
    flags,
    nomusSourceLineIds: item.nomusSourceLineIds,
  };

  switch (resolution.kind) {
    case "unassigned":
      return {
        ...base,
        source: "NOMUS_OPTIONAL_NOT_SELECTED",
        decision: "BLOCKED",
        includedForPricing: false,
        reason: "Opcional sem grupo de precificação.",
      };
    case "group_pending":
      return {
        ...base,
        source: "NOMUS_OPTIONAL_NOT_SELECTED",
        decision: "BLOCKED",
        includedForPricing: false,
        reason: "Grupo de opcional sem seleção salva.",
        groupId: resolution.group.id,
        groupName: resolution.group.groupName,
      };
    case "group_stale":
      return {
        ...base,
        source: "NOMUS_OPTIONAL_NOT_SELECTED",
        decision: "BLOCKED",
        includedForPricing: false,
        reason: "Grupo desatualizado em relação à BOM Nomus atual.",
        groupId: resolution.group.id,
        groupName: resolution.group.groupName,
      };
    case "optional_resolved": {
      const { group, choiceId, selected, selectedNone } = resolution;
      if (selectedNone) {
        return {
          ...base,
          source: "NOMUS_OPTIONAL_SELECTED_NONE",
          decision: "EXCLUDE",
          includedForPricing: false,
          reason: `Grupo "${group.groupName}" marcado como nenhum opcional para precificação.`,
          groupId: group.id,
          groupName: group.groupName,
          selectedChoiceId: choiceId,
          resolution: "EXCLUDED_BY_OPTIONAL_SELECTION_NONE",
        };
      }
      if (selected) {
        return {
          ...base,
          source: selectedSource(item, true),
          decision: "INCLUDE",
          includedForPricing: true,
          reason: `Selecionado para precificação no grupo "${group.groupName}".`,
          groupId: group.id,
          groupName: group.groupName,
          selectedChoiceId: choiceId,
          resolution: "selected",
        };
      }
      return {
        ...base,
        source: selectedSource(item, false),
        decision: "EXCLUDE",
        includedForPricing: false,
        reason: `Opcional não selecionado no grupo "${group.groupName}".`,
        groupId: group.id,
        groupName: group.groupName,
        selectedChoiceId: choiceId,
        resolution: "EXCLUDED_OPTIONAL_NOT_SELECTED",
      };
    }
    case "exclusive_set_resolved": {
      const { selected, set, brokenLink } = resolution;
      if (brokenLink) {
        return {
          ...base,
          source: "NOMUS_OPTIONAL_NOT_SELECTED",
          decision: "BLOCKED",
          includedForPricing: false,
          reason: `Alternativa vinculada ao preferencial ${set.preferredComponentCode || set.preferredExternalLineId}, mas o preferencial não está na lista Nomus atual.`,
        };
      }
      if (selected) {
        return {
          ...base,
          source: item.isAlternative
            ? "NOMUS_ALTERNATIVE_SELECTED"
            : item.isPreferred
              ? "NOMUS_REQUIRED"
              : selectedSource(item, true),
          decision: "INCLUDE",
          includedForPricing: true,
          reason: item.isPreferred
            ? "Preferencial Nomus (padrão) do conjunto alternativo/preferencial."
            : "Selecionado no conjunto alternativo/preferencial vinculado.",
          resolution: "selected",
        };
      }
      return {
        ...base,
        source: item.isAlternative
          ? "NOMUS_ALTERNATIVE_NOT_SELECTED"
          : "NOMUS_OPTIONAL_NOT_SELECTED",
        decision: "EXCLUDE",
        includedForPricing: false,
        reason: item.isPreferred
          ? "Preferencial suprimido — outra opção do conjunto vinculado está ativa."
          : "Alternativa não selecionada no conjunto vinculado.",
        resolution: "EXCLUDED_OPTIONAL_NOT_SELECTED",
      };
    }
    default:
      return {
        ...base,
        source: "NOMUS_OPTIONAL_NOT_SELECTED",
        decision: "BLOCKED",
        includedForPricing: false,
        reason: "Opcional sem grupo de precificação.",
      };
  }
}

function buildLocalOnlyReviewLine(
  componentCode: string,
  componentDescription: string | null | undefined,
  quantity: number | null | undefined,
  bomLineId: string
): EffectivePricingBomLine {
  return {
    componentCode,
    componentDescription,
    quantity: quantity ?? null,
    source: "LOCAL_ONLY_INDUS_REVIEW",
    decision: "REVIEW",
    includedForPricing: false,
    reason:
      "Item na ProductBOM do IndusCost, não encontrado na BOM Nomus efetiva atual deste produto. Defina a decisão (manter, excluir, duplicado, etc.).",
    flags: {
      hasOptionalNomusLines: false,
      hasAlternativeNomusLines: false,
      hasPreferredNomusLines: false,
      hasShipmentItemNomusLines: false,
    },
    nomusSourceLineIds: [],
    productBomLineId: bomLineId,
    resolution: `indus_bom:${bomLineId}`,
  };
}

function computeSummary(
  directLines: EffectivePricingBomLine[],
  excludedLines: EffectivePricingBomLine[],
  reviewLines: EffectivePricingBomLine[],
  recursiveNodesCount: number,
  unresolvedComponentsCount: number
): EffectivePricingBomSummary {
  const included = directLines.filter((l) => l.includedForPricing);
  const blocked = [...directLines, ...excludedLines, ...reviewLines].filter(
    (l) => l.decision === "BLOCKED"
  );
  const optionalSelected = included.filter(
    (l) =>
      l.source === "NOMUS_OPTIONAL_SELECTED" || l.source === "NOMUS_ALTERNATIVE_SELECTED"
  );
  const optionalExcluded = excludedLines.filter(
    (l) =>
      l.source === "NOMUS_OPTIONAL_NOT_SELECTED" ||
      l.source === "NOMUS_ALTERNATIVE_NOT_SELECTED" ||
      l.source === "NOMUS_OPTIONAL_SELECTED_NONE"
  );

  return {
    includedLinesCount: included.length,
    excludedLinesCount: excludedLines.length,
    reviewLinesCount: reviewLines.length,
    blockedLinesCount: blocked.length,
    requiredIncludedCount: included.filter((l) => l.source === "NOMUS_REQUIRED").length,
    optionalSelectedCount: optionalSelected.length,
    optionalExcludedCount: optionalExcluded.length,
    unresolvedComponentsCount,
    recursiveNodesCount,
    localReviewPendingCount: 0,
    localReviewResolvedCount: 0,
    localIncludedByReviewCount: 0,
    localExcludedByReviewCount: 0,
    operationalRoutingReviewCount: 0,
  };
}

function computeOverallStatus(
  optionalPricingStatus: PricingOptionalStatus,
  hasNomusBom: boolean,
  hasBlockedOptional: boolean,
  unresolvedCount: number
): EffectivePricingBomStatus {
  if (!hasNomusBom) return "NO_NOMUS_BOM";
  if (optionalPricingStatus === "STALE") return "STALE_OPTIONAL_SELECTION";
  if (optionalPricingStatus === "PENDING" || hasBlockedOptional) {
    return "PENDING_OPTIONAL_SELECTION";
  }
  if (unresolvedCount > 0) return "BLOCKED_UNRESOLVED_COMPONENTS";
  return "READY_FOR_PRICING_PREVIEW";
}

async function hasNomusBomForParent(parentCode: string): Promise<boolean> {
  const lines = await loadNomusStageLinesForParent(parentCode);
  return lines.length > 0;
}

async function buildRecursiveTree(
  parentCode: string,
  options: { maxDepth: number; cache: Map<string, EffectivePricingBomResult> }
): Promise<{ tree: EffectivePricingBomTreeNode[]; unresolvedCount: number; nodeCount: number }> {
  const bom = await getOrBuildCached(parentCode, options.cache, {
    recursive: false,
    maxDepth: options.maxDepth,
  });

  const included = bom.directLines.filter((l) => l.includedForPricing);
  const roots: EffectivePricingBomTreeNode[] = [];
  let unresolvedCount = 0;
  let nodeCount = 0;

  const visited = new Set<string>();

  async function expand(
    nodeParent: string,
    line: EffectivePricingBomLine,
    level: number,
    multiplier: number
  ): Promise<EffectivePricingBomTreeNode> {
    nodeCount += 1;
    const code = line.componentCode;
    const directQty = line.quantity;
    const accumulated =
      directQty != null ? directQty * multiplier : multiplier === 1 ? null : multiplier;

    const resolved = await resolveNomusComponentCodes([code]);
    const res = resolved[0];
    let resolution: EffectivePricingBomTreeNode["resolution"];
    if (res?.resolvedKind === "PRODUCT") resolution = "PRODUCT";
    else if (res?.resolvedKind === "MATERIAL") resolution = "MATERIAL";
    else if (res?.resolvedKind === "BOTH") resolution = "BOTH";
    else resolution = undefined;

    const children: EffectivePricingBomTreeNode[] = [];
    const visitKey = `${normalizeSku(nodeParent)}>${normalizeComponentCode(code)}`;
    const hasChildBom = await hasNomusBomForParent(code);

    if (level < options.maxDepth && hasChildBom && !visited.has(visitKey)) {
      visited.add(visitKey);
      const childBom = await getOrBuildCached(code, options.cache, {
        recursive: false,
        maxDepth: options.maxDepth,
      });
      const childIncluded = childBom.directLines.filter((l) => l.includedForPricing);
      const childMult = accumulated ?? directQty ?? 1;
      for (const childLine of childIncluded) {
        const childNode = await expand(code, childLine, level + 1, childMult);
        children.push(childNode);
      }
      visited.delete(visitKey);
    } else if (!hasChildBom && res?.resolvedKind === "NONE") {
      resolution = "UNRESOLVED_COMPONENT";
      unresolvedCount += 1;
    }

    return {
      level,
      parentCode: nodeParent,
      componentCode: code,
      description: line.componentDescription ?? null,
      directQuantity: directQty,
      accumulatedQuantity: accumulated,
      includedForPricing: line.includedForPricing,
      decision: line.decision,
      source: line.source,
      children,
      resolution,
    };
  }

  for (const line of included) {
    roots.push(await expand(parentCode, line, 0, 1));
  }

  return { tree: roots, unresolvedCount, nodeCount };
}

async function getOrBuildCached(
  parentCode: string,
  cache: Map<string, EffectivePricingBomResult>,
  options: { recursive: boolean; maxDepth: number }
): Promise<EffectivePricingBomResult> {
  const key = normalizeSku(parentCode);
  const cached = cache.get(key);
  if (cached) return cached;
  const built = await buildEffectivePricingBomForParentCode(parentCode, {
    recursive: options.recursive,
    maxDepth: options.maxDepth,
    _cache: cache,
  });
  cache.set(key, built);
  return built;
}

export async function buildEffectivePricingBomForParentCode(
  parentCode: string,
  options?: {
    recursive?: boolean;
    maxDepth?: number;
    _cache?: Map<string, EffectivePricingBomResult>;
    nomusUniverse?: NomusUniverseCodeSet;
  }
): Promise<EffectivePricingBomResult> {
  const trimmed = parentCode.trim();
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const cache = options?._cache;

  const stageLines = await loadNomusStageLinesForParent(trimmed);
  if (stageLines.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      parentCode: normalizeSku(trimmed),
      optionalPricingStatus: "NO_OPTIONALS",
      status: "NO_NOMUS_BOM",
      selectedList: null,
      summary: computeSummary([], [], [], 0, 0),
      directLines: [],
      excludedLines: [],
      reviewLines: [],
      localReviewCatalog: [],
      warnings: ["Produto não encontrado no stage Nomus (NomusBomComponentStage)."],
    };
  }

  const ctx = await getEffectiveNomusContext(trimmed);
  if (!ctx) {
    return {
      generatedAt: new Date().toISOString(),
      parentCode: normalizeSku(trimmed),
      optionalPricingStatus: "NO_OPTIONALS",
      status: "NO_NOMUS_BOM",
      selectedList: null,
      summary: computeSummary([], [], [], 0, 0),
      directLines: [],
      excludedLines: [],
      reviewLines: [],
      localReviewCatalog: [],
      warnings: ["Não foi possível montar contexto Nomus efetivo."],
    };
  }

  const groups = await loadGroupsForParent(ctx.parentCode);
  const unassigned = computeUnassignedOptionalItems(ctx.optionalItems, groups);
  const optionalPricingStatus = buildOptionalSelectionStatus({
    optionalItems: ctx.optionalItems,
    unassignedOptionalItems: unassigned,
    groups,
    preferredAlternativeSets: ctx.preferredAlternativeSets,
  });

  const listSelection = chooseEffectiveNomusList(stageLines);
  const lineByExternalId = new Map<number, NomusEffectiveBomLine>();
  for (const line of listSelection.selectedLines) {
    lineByExternalId.set(line.externalLineId, line);
  }

  const resolutionMap = buildComponentResolutionMap(
    ctx.optionalItems,
    groups,
    unassigned,
    ctx.preferredAlternativeSets
  );

  const directLines: EffectivePricingBomLine[] = [];
  const excludedLines: EffectivePricingBomLine[] = [];
  const reviewLines: EffectivePricingBomLine[] = [];
  const warnings: string[] = [];

  if (listSelection.ambiguous) {
    warnings.push("Múltiplas listas Nomus candidatas; foi aplicada a regra de lista efetiva padrão.");
  }

  for (const item of ctx.requiredItems) {
    const flags = flagsForItem(item, lineByExternalId);
    if (detectOperationalItem(item.componentCode, item.componentDescription)) {
      const line = buildLineFromOperational(item, flags);
      excludedLines.push(line);
    } else {
      directLines.push(buildLineFromRequired(item, flags));
    }
  }

  let hasBlockedOptional = false;

  for (const item of ctx.optionalItems) {
    const flags = flagsForItem(item, lineByExternalId);
    const key = normalizeComponentCode(item.componentCode);
    const resolution = resolutionMap.get(key) ?? { kind: "unassigned" as const };

    if (detectOperationalItem(item.componentCode, item.componentDescription)) {
      excludedLines.push(buildLineFromOperational(item, flags));
      continue;
    }

    const line = buildLineFromOptional(item, flags, resolution);
    if (line.decision === "BLOCKED") hasBlockedOptional = true;

    if (line.includedForPricing) {
      directLines.push(line);
    } else if (line.decision === "REVIEW") {
      reviewLines.push(line);
    } else {
      excludedLines.push(line);
    }
  }

  const comparison = await buildBomComparisonForParentCode(ctx.parentCode);
  const rawLocalReviewLines: EffectivePricingBomLine[] = [];
  const lineComponentKinds = new Map<string, "PRODUCT" | "MATERIAL" | "UNKNOWN">();
  for (const cmpLine of comparison.lines) {
    if (cmpLine.status !== "ONLY_IN_INDUSCOST") continue;
    const indusQty = cmpLine.indusQuantity ?? null;
    const bomLineId = cmpLine.indusBomLineIds[0] ?? "unknown";
    const indusKind =
      cmpLine.indusLines.find((l) => l.componentKind)?.componentKind ?? "UNKNOWN";
    if (bomLineId !== "unknown") {
      lineComponentKinds.set(bomLineId, indusKind);
    }
    rawLocalReviewLines.push(
      buildLocalOnlyReviewLine(
        cmpLine.componentCode,
        cmpLine.componentDescription,
        indusQty,
        bomLineId
      )
    );
  }

  directLines.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  excludedLines.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
  reviewLines.sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));

  let recursiveTree: EffectivePricingBomTreeNode[] | undefined;
  let unresolvedCount = 0;
  let recursiveNodesCount = 0;

  if (options?.recursive) {
    const bomCache = cache ?? new Map<string, EffectivePricingBomResult>();
    if (!cache) {
      bomCache.set(normalizeSku(ctx.parentCode), {
        generatedAt: new Date().toISOString(),
        parentCode: ctx.parentCode,
        parentDescription: ctx.parentDescription,
        indusProductId: ctx.indusProductId,
        selectedList: ctx.selectedList,
        optionalPricingStatus,
        status: "READY_FOR_PRICING_PREVIEW",
        summary: computeSummary(directLines, excludedLines, reviewLines, 0, 0),
        directLines,
        excludedLines,
        reviewLines,
        localReviewCatalog: [],
        warnings,
      });
    }
    const expanded = await buildRecursiveTree(ctx.parentCode, { maxDepth, cache: bomCache });
    recursiveTree = expanded.tree;
    unresolvedCount = expanded.unresolvedCount;
    recursiveNodesCount = expanded.nodeCount;
  }

  const summary = computeSummary(
    directLines,
    excludedLines,
    reviewLines,
    recursiveNodesCount,
    unresolvedCount
  );

  const status = computeOverallStatus(
    optionalPricingStatus,
    true,
    hasBlockedOptional,
    unresolvedCount
  );

  if (optionalPricingStatus === "PENDING") {
    warnings.push("Há opcionais pendentes de agrupamento ou seleção para precificação.");
  }
  if (optionalPricingStatus === "STALE") {
    warnings.push("Há grupos de opcionais desatualizados em relação à BOM Nomus atual.");
  }
  if (status === "READY_FOR_PRICING_PREVIEW") {
    warnings.push(
      "BOM efetiva pronta para visualização. Não altera ProductBOM, custo ou preço oficial."
    );
  }

  let result: EffectivePricingBomResult = {
    generatedAt: new Date().toISOString(),
    parentCode: ctx.parentCode,
    parentDescription: ctx.parentDescription,
    indusProductId: ctx.indusProductId,
    selectedList: ctx.selectedList,
    optionalPricingStatus,
    status,
    summary,
    directLines,
    excludedLines,
    reviewLines,
    localReviewCatalog: [],
    recursiveTree,
    warnings,
  };

  const { decisions } = await listReviewDecisionsForParentCode(ctx.parentCode);

  const bomLineIds = rawLocalReviewLines
    .map((line) => parseProductBomLineIdFromLine(line))
    .filter((id): id is string => !!id && id !== "unknown");

  const localRowFlags = new Map<string, { localException: boolean }>();
  if (bomLineIds.length > 0) {
    const bomRows = await prisma.productBOM.findMany({
      where: { id: { in: bomLineIds } },
      select: { id: true, localException: true },
    });
    for (const row of bomRows) {
      localRowFlags.set(row.id, { localException: row.localException });
    }
  }

  const nomusUniverse = options?.nomusUniverse ?? (await buildNomusUniverseCodeSet());

  result = applyReviewDecisionsToEffectiveBom(result, decisions, rawLocalReviewLines, {
    nomusUniverse,
    localRowFlags,
    lineComponentKinds,
  });

  return result;
}
