import type { NomusOptionalPricingSelectionMode } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import type { NomusBomApplyPlan, NomusBomPlanAction } from "@/src/lib/nomusBomApplyPlan";
import {
  chooseEffectiveNomusList,
  normalizeComponentCode,
  normalizeSku,
  toNumberSafe,
  type NomusEffectiveBomLine,
  type NomusListSummary,
} from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  listDistinctParentCodesFromStage,
  loadNomusStageLinesForParent,
} from "@/src/lib/nomusBomComparisonLoad";

export type PricingOptionalStatus = "PENDING" | "RESOLVED" | "NO_OPTIONALS" | "STALE";

export type AggregatedOptionalItem = {
  componentCode: string;
  componentDescription?: string | null;
  plannedQuantity: number | null;
  nomusSourceLineIds: number[];
  isOptional: boolean;
  isAlternative: boolean;
};

export type OptionalPricingGroupStatus = "PENDING" | "RESOLVED" | "STALE";

export type OptionalPricingChoiceView = {
  id: string;
  componentCode: string;
  componentDescription?: string | null;
  plannedQuantity: number | null;
  nomusSourceLineIds: number[];
  isSelectedForPricing: boolean;
  isActive: boolean;
  isStale: boolean;
};

export type OptionalPricingGroupView = {
  id: string;
  groupName: string;
  selectionMode: NomusOptionalPricingSelectionMode;
  notes?: string | null;
  isActive: boolean;
  selectedNone: boolean;
  status: OptionalPricingGroupStatus;
  choices: OptionalPricingChoiceView[];
};

export type EffectiveNomusContext = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  selectedList: NomusListSummary | null;
  listaMateriaisId?: number | null;
  listaMateriaisNome?: string | null;
  requiredItems: AggregatedOptionalItem[];
  optionalItems: AggregatedOptionalItem[];
};

function isOptionalOrAlternative(line: NomusEffectiveBomLine): boolean {
  return line.opcional === true || line.alternativo === true;
}

function aggregateLinesByComponent(
  lines: NomusEffectiveBomLine[],
  filter: (line: NomusEffectiveBomLine) => boolean
): AggregatedOptionalItem[] {
  const map = new Map<string, AggregatedOptionalItem>();
  for (const line of lines) {
    if (!filter(line)) continue;
    const key = normalizeComponentCode(line.componentCode);
    const qty = line.quantity ?? 0;
    const existing = map.get(key);
    if (existing) {
      existing.plannedQuantity = (existing.plannedQuantity ?? 0) + qty;
      existing.nomusSourceLineIds.push(line.externalLineId);
      existing.isOptional = existing.isOptional || line.opcional === true;
      existing.isAlternative = existing.isAlternative || line.alternativo === true;
    } else {
      map.set(key, {
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        plannedQuantity: line.quantity,
        nomusSourceLineIds: [line.externalLineId],
        isOptional: line.opcional === true,
        isAlternative: line.alternativo === true,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
}

function lineIdsKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

function itemMatchesCurrent(
  choice: { componentCode: string; plannedQuantity: unknown; nomusSourceLineIds: unknown },
  current: AggregatedOptionalItem | undefined
): boolean {
  if (!current) return false;
  const choiceIds = Array.isArray(choice.nomusSourceLineIds)
    ? (choice.nomusSourceLineIds as number[])
    : [];
  if (lineIdsKey(choiceIds) !== lineIdsKey(current.nomusSourceLineIds)) return false;
  const choiceQty = toNumberSafe(choice.plannedQuantity);
  const currentQty = current.plannedQuantity;
  if (choiceQty == null && currentQty == null) return true;
  if (choiceQty == null || currentQty == null) return false;
  return Math.abs(choiceQty - currentQty) < 0.000001;
}

export async function getEffectiveNomusContext(parentCode: string): Promise<EffectiveNomusContext | null> {
  const trimmed = parentCode.trim();
  const stageLines = await loadNomusStageLinesForParent(trimmed);
  if (stageLines.length === 0) return null;

  const listSelection = chooseEffectiveNomusList(stageLines);
  const effective = listSelection.selectedLines;
  const comparison = await buildBomComparisonForParentCode(trimmed);

  const optionalItems = aggregateLinesByComponent(effective, isOptionalOrAlternative);
  const requiredItems = aggregateLinesByComponent(effective, (l) => !isOptionalOrAlternative(l));

  const parentDescription =
    comparison.parentDescription ??
    (
      await prisma.nomusBomComponentStage.findFirst({
        where: { parentCode: { equals: trimmed, mode: "insensitive" } },
        select: { parentDescription: true },
      })
    )?.parentDescription ??
    null;

  return {
    parentCode: comparison.parentCode || normalizeSku(trimmed),
    parentDescription,
    indusProductId: comparison.indusProductId ?? null,
    selectedList: listSelection.selectedList,
    listaMateriaisId: listSelection.selectedList?.listaMateriaisId ?? null,
    listaMateriaisNome: listSelection.selectedList?.listaMateriaisNome ?? null,
    requiredItems,
    optionalItems,
  };
}

export function resolveGroupStatus(
  group: {
    selectionMode: NomusOptionalPricingSelectionMode;
    selectedNone: boolean;
    choices: Array<{
      isActive: boolean;
      isSelectedForPricing: boolean;
      isStale: boolean;
    }>;
  }
): OptionalPricingGroupStatus {
  const activeChoices = group.choices.filter((c) => c.isActive);
  if (activeChoices.some((c) => c.isStale)) return "STALE";

  const selected = activeChoices.filter((c) => c.isSelectedForPricing);

  switch (group.selectionMode) {
    case "EXACTLY_ONE":
      if (group.selectedNone) return "RESOLVED";
      return selected.length === 1 ? "RESOLVED" : "PENDING";
    case "OPTIONAL_ONE":
      if (group.selectedNone) return "RESOLVED";
      return selected.length === 1 ? "RESOLVED" : "PENDING";
    case "MULTIPLE":
      if (group.selectedNone) return "RESOLVED";
      return selected.length >= 1 ? "RESOLVED" : "PENDING";
    default:
      return "PENDING";
  }
}

export function buildOptionalSelectionStatus(input: {
  optionalItems: AggregatedOptionalItem[];
  unassignedOptionalItems: AggregatedOptionalItem[];
  groups: OptionalPricingGroupView[];
}): PricingOptionalStatus {
  if (input.optionalItems.length === 0) return "NO_OPTIONALS";
  if (input.groups.some((g) => g.isActive && g.status === "STALE")) return "STALE";
  if (input.unassignedOptionalItems.length > 0) return "PENDING";
  const activeGroups = input.groups.filter((g) => g.isActive);
  if (activeGroups.some((g) => g.status === "PENDING")) return "PENDING";
  return "RESOLVED";
}

function buildChoiceViews(
  choices: Array<{
    id: string;
    componentCode: string;
    componentDescription: string | null;
    plannedQuantity: unknown;
    nomusSourceLineIds: unknown;
    isSelectedForPricing: boolean;
    isActive: boolean;
  }>,
  optionalByCode: Map<string, AggregatedOptionalItem>
): OptionalPricingChoiceView[] {
  return choices.map((c) => {
    const current = optionalByCode.get(normalizeComponentCode(c.componentCode));
    const isStale = !itemMatchesCurrent(c, current);
    return {
      id: c.id,
      componentCode: c.componentCode,
      componentDescription: c.componentDescription,
      plannedQuantity: toNumberSafe(c.plannedQuantity),
      nomusSourceLineIds: Array.isArray(c.nomusSourceLineIds)
        ? (c.nomusSourceLineIds as number[])
        : [],
      isSelectedForPricing: c.isSelectedForPricing,
      isActive: c.isActive,
      isStale,
    };
  });
}

export async function loadGroupsForParent(parentCode: string): Promise<OptionalPricingGroupView[]> {
  const ctx = await getEffectiveNomusContext(parentCode);
  if (!ctx) return [];

  const optionalByCode = new Map(
    ctx.optionalItems.map((i) => [normalizeComponentCode(i.componentCode), i])
  );

  const groups = await prisma.nomusOptionalPricingGroup.findMany({
    where: { parentCode: { equals: ctx.parentCode, mode: "insensitive" }, isActive: true },
    include: { choices: { where: { isActive: true }, orderBy: { componentCode: "asc" } } },
    orderBy: { groupName: "asc" },
  });

  return groups.map((g) => {
    const choiceViews = buildChoiceViews(g.choices, optionalByCode);
    const status = resolveGroupStatus({
      selectionMode: g.selectionMode,
      selectedNone: g.selectedNone,
      choices: choiceViews,
    });
    return {
      id: g.id,
      groupName: g.groupName,
      selectionMode: g.selectionMode,
      notes: g.notes,
      isActive: g.isActive,
      selectedNone: g.selectedNone,
      status,
      choices: choiceViews,
    };
  });
}

export function computeUnassignedOptionalItems(
  optionalItems: AggregatedOptionalItem[],
  groups: OptionalPricingGroupView[]
): AggregatedOptionalItem[] {
  const assigned = new Set<string>();
  for (const g of groups) {
    if (!g.isActive) continue;
    for (const c of g.choices) {
      if (c.isActive) assigned.add(normalizeComponentCode(c.componentCode));
    }
  }
  return optionalItems.filter((i) => !assigned.has(normalizeComponentCode(i.componentCode)));
}

export type OptionalPricingListRow = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  selectedList: NomusListSummary | null;
  optionalItemsCount: number;
  unassignedOptionalItemsCount: number;
  groupsCount: number;
  pendingGroupsCount: number;
  staleGroupsCount: number;
  pricingOptionalStatus: PricingOptionalStatus;
};

export async function listProductsWithOptionalNomusItems(filters: {
  search?: string;
  status?: PricingOptionalStatus;
  limit?: number;
  offset?: number;
}): Promise<{ generatedAt: string; total: number; rows: OptionalPricingListRow[] }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const parentCodes = await listDistinctParentCodesFromStage({
    limit: 5000,
    offset: 0,
    search: filters.search,
  });

  const rows: OptionalPricingListRow[] = [];

  for (const code of parentCodes) {
    const ctx = await getEffectiveNomusContext(code);
    if (!ctx || ctx.optionalItems.length === 0) continue;

    const groups = await loadGroupsForParent(ctx.parentCode);
    const unassigned = computeUnassignedOptionalItems(ctx.optionalItems, groups);
    const status = buildOptionalSelectionStatus({
      optionalItems: ctx.optionalItems,
      unassignedOptionalItems: unassigned,
      groups,
    });

    if (filters.status && filters.status !== status) continue;

    rows.push({
      parentCode: ctx.parentCode,
      parentDescription: ctx.parentDescription,
      indusProductId: ctx.indusProductId,
      selectedList: ctx.selectedList,
      optionalItemsCount: ctx.optionalItems.length,
      unassignedOptionalItemsCount: unassigned.length,
      groupsCount: groups.filter((g) => g.isActive).length,
      pendingGroupsCount: groups.filter((g) => g.isActive && g.status === "PENDING").length,
      staleGroupsCount: groups.filter((g) => g.isActive && g.status === "STALE").length,
      pricingOptionalStatus: status,
    });
  }

  rows.sort((a, b) => a.parentCode.localeCompare(b.parentCode, "pt-BR"));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  return { generatedAt: new Date().toISOString(), total, rows: page };
}

export async function getOptionalPricingSelectionDetail(parentCode: string) {
  const ctx = await getEffectiveNomusContext(parentCode);
  if (!ctx) {
    throw new Error("Produto não encontrado no stage Nomus.");
  }

  const groups = await loadGroupsForParent(ctx.parentCode);
  const unassignedOptionalItems = computeUnassignedOptionalItems(ctx.optionalItems, groups);
  const status = buildOptionalSelectionStatus({
    optionalItems: ctx.optionalItems,
    unassignedOptionalItems,
    groups,
  });

  const warnings: string[] = [];
  if (groups.some((g) => g.status === "STALE")) {
    warnings.push("Um ou mais grupos têm seleções desatualizadas em relação à lista Nomus efetiva.");
  }
  if (unassignedOptionalItems.length > 0) {
    warnings.push(
      `${unassignedOptionalItems.length} item(ns) opcional(is) ainda não pertence(m) a nenhum grupo ativo.`
    );
  }

  return {
    parentCode: ctx.parentCode,
    parentDescription: ctx.parentDescription,
    indusProductId: ctx.indusProductId,
    selectedList: ctx.selectedList,
    requiredNomusItems: ctx.requiredItems,
    unassignedOptionalItems,
    groups,
    status,
    warnings,
  };
}

async function assertParentInStage(parentCode: string): Promise<void> {
  const lines = await loadNomusStageLinesForParent(parentCode);
  if (lines.length === 0) {
    throw new Error("parentCode não encontrado no stage Nomus.");
  }
}

function validateComponentCodesInOptionalPool(
  componentCodes: string[],
  optionalItems: AggregatedOptionalItem[]
): AggregatedOptionalItem[] {
  const pool = new Map(optionalItems.map((i) => [normalizeComponentCode(i.componentCode), i]));
  const resolved: AggregatedOptionalItem[] = [];
  for (const code of componentCodes) {
    const item = pool.get(normalizeComponentCode(code));
    if (!item) {
      throw new Error(`Componente ${code} não é opcional/alternativo na lista Nomus efetiva.`);
    }
    resolved.push(item);
  }
  if (resolved.length === 0) {
    throw new Error("Informe ao menos um componentCode opcional.");
  }
  return resolved;
}

export async function createOptionalPricingGroup(input: {
  parentCode: string;
  groupName: string;
  selectionMode: NomusOptionalPricingSelectionMode;
  componentCodes: string[];
  notes?: string | null;
}) {
  await assertParentInStage(input.parentCode);
  const ctx = await getEffectiveNomusContext(input.parentCode);
  if (!ctx) throw new Error("Não foi possível carregar contexto Nomus.");

  const items = validateComponentCodesInOptionalPool(input.componentCodes, ctx.optionalItems);

  const group = await prisma.nomusOptionalPricingGroup.create({
    data: {
      parentCode: ctx.parentCode,
      parentProductId: ctx.indusProductId,
      listaMateriaisId: ctx.listaMateriaisId,
      listaMateriaisNome: ctx.listaMateriaisNome,
      groupName: input.groupName.trim(),
      selectionMode: input.selectionMode,
      notes: input.notes?.trim() || null,
      selectedNone: false,
      choices: {
        create: items.map((item) => ({
          parentCode: ctx.parentCode,
          componentCode: item.componentCode,
          componentDescription: item.componentDescription,
          plannedQuantity: item.plannedQuantity,
          nomusSourceLineIds: item.nomusSourceLineIds,
          isSelectedForPricing: false,
        })),
      },
    },
    include: { choices: true },
  });

  return getOptionalPricingSelectionDetail(ctx.parentCode);
}

export async function updateOptionalPricingGroup(
  groupId: string,
  input: {
    groupName?: string;
    selectionMode?: NomusOptionalPricingSelectionMode;
    notes?: string | null;
    isActive?: boolean;
  }
) {
  const existing = await prisma.nomusOptionalPricingGroup.findUnique({ where: { id: groupId } });
  if (!existing) throw new Error("Grupo não encontrado.");

  await prisma.nomusOptionalPricingGroup.update({
    where: { id: groupId },
    data: {
      groupName: input.groupName?.trim(),
      selectionMode: input.selectionMode,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
      isActive: input.isActive,
    },
  });

  return getOptionalPricingSelectionDetail(existing.parentCode);
}

export async function deactivateOptionalPricingGroup(groupId: string) {
  return updateOptionalPricingGroup(groupId, { isActive: false });
}

export async function setOptionalPricingSelection(
  groupId: string,
  input: {
    selectedChoiceId?: string;
    selectedChoiceIds?: string[];
    selectedNone?: boolean;
  }
) {
  const group = await prisma.nomusOptionalPricingGroup.findUnique({
    where: { id: groupId },
    include: { choices: { where: { isActive: true } } },
  });
  if (!group || !group.isActive) throw new Error("Grupo não encontrado ou inativo.");

  if (group.selectionMode === "EXACTLY_ONE" && input.selectedNone === true) {
    throw new Error("Modo 'Exatamente um' não permite 'não considerar nenhum'.");
  }

  await prisma.$transaction(async (tx) => {
    if (group.selectionMode === "EXACTLY_ONE") {
      if (!input.selectedChoiceId) throw new Error("Informe selectedChoiceId.");
      const valid = group.choices.some((c) => c.id === input.selectedChoiceId);
      if (!valid) throw new Error("Choice inválida para este grupo.");
      await tx.nomusOptionalPricingChoice.updateMany({
        where: { groupId },
        data: { isSelectedForPricing: false },
      });
      await tx.nomusOptionalPricingChoice.update({
        where: { id: input.selectedChoiceId },
        data: { isSelectedForPricing: true },
      });
      await tx.nomusOptionalPricingGroup.update({
        where: { id: groupId },
        data: { selectedNone: false },
      });
    } else if (group.selectionMode === "OPTIONAL_ONE") {
      if (input.selectedNone === true) {
        await tx.nomusOptionalPricingChoice.updateMany({
          where: { groupId },
          data: { isSelectedForPricing: false },
        });
        await tx.nomusOptionalPricingGroup.update({
          where: { id: groupId },
          data: { selectedNone: true },
        });
      } else {
        if (!input.selectedChoiceId) throw new Error("Informe selectedChoiceId ou selectedNone=true.");
        const valid = group.choices.some((c) => c.id === input.selectedChoiceId);
        if (!valid) throw new Error("Choice inválida para este grupo.");
        await tx.nomusOptionalPricingChoice.updateMany({
          where: { groupId },
          data: { isSelectedForPricing: false },
        });
        await tx.nomusOptionalPricingChoice.update({
          where: { id: input.selectedChoiceId },
          data: { isSelectedForPricing: true },
        });
        await tx.nomusOptionalPricingGroup.update({
          where: { id: groupId },
          data: { selectedNone: false },
        });
      }
    } else {
      // MULTIPLE
      if (input.selectedNone === true) {
        await tx.nomusOptionalPricingChoice.updateMany({
          where: { groupId },
          data: { isSelectedForPricing: false },
        });
        await tx.nomusOptionalPricingGroup.update({
          where: { id: groupId },
          data: { selectedNone: true },
        });
      } else {
        const ids = input.selectedChoiceIds ?? [];
        if (ids.length === 0) throw new Error("Informe selectedChoiceIds ou selectedNone=true.");
        const validSet = new Set(group.choices.map((c) => c.id));
        for (const id of ids) {
          if (!validSet.has(id)) throw new Error(`Choice inválida: ${id}`);
        }
        await tx.nomusOptionalPricingChoice.updateMany({
          where: { groupId },
          data: { isSelectedForPricing: false },
        });
        await tx.nomusOptionalPricingChoice.updateMany({
          where: { id: { in: ids } },
          data: { isSelectedForPricing: true },
        });
        await tx.nomusOptionalPricingGroup.update({
          where: { id: groupId },
          data: { selectedNone: false },
        });
      }
    }
  });

  return getOptionalPricingSelectionDetail(group.parentCode);
}

/** Mapa componentCode -> seleção persistida (para plano/diff). */
export async function getPersistedOptionalSelectionMap(
  parentCode: string
): Promise<Map<string, { groupName: string; isSelected: boolean; selectedNone: boolean }>> {
  const map = new Map<string, { groupName: string; isSelected: boolean; selectedNone: boolean }>();
  const groups = await prisma.nomusOptionalPricingGroup.findMany({
    where: { parentCode: { equals: parentCode.trim(), mode: "insensitive" }, isActive: true },
    include: { choices: { where: { isActive: true } } },
  });
  for (const g of groups) {
    if (g.selectedNone) {
      for (const c of g.choices) {
        map.set(normalizeComponentCode(c.componentCode), {
          groupName: g.groupName,
          isSelected: false,
          selectedNone: true,
        });
      }
    }
    for (const c of g.choices) {
      if (c.isSelectedForPricing) {
        map.set(normalizeComponentCode(c.componentCode), {
          groupName: g.groupName,
          isSelected: true,
          selectedNone: false,
        });
      }
    }
  }
  return map;
}

export async function getPricingOptionalStatusForParent(
  parentCode: string
): Promise<PricingOptionalStatus> {
  try {
    const detail = await getOptionalPricingSelectionDetail(parentCode);
    return detail.status;
  } catch {
    return "NO_OPTIONALS";
  }
}

export async function enrichNomusBomApplyPlanWithOptionalSelection(
  plan: NomusBomApplyPlan
): Promise<NomusBomApplyPlan> {
  let status: PricingOptionalStatus = "NO_OPTIONALS";
  try {
    status = await getPricingOptionalStatusForParent(plan.parentCode);
  } catch {
    status = "NO_OPTIONALS";
  }

  const selectionMap = await getPersistedOptionalSelectionMap(plan.parentCode);
  const actions: NomusBomPlanAction[] = plan.actions.map((action) => {
    if (
      action.type !== "OPTIONAL_SELECTION_REQUIRED" &&
      action.type !== "OPTIONAL_ITEM_NOT_AUTO_APPLIED"
    ) {
      return action;
    }
    const code = action.componentCode;
    if (!code) return action;
    const persisted = selectionMap.get(normalizeComponentCode(code));
    if (!persisted) return action;
    if (persisted.isSelected) {
      return {
        ...action,
        reason: `Seleção de precificação encontrada: componente ${code} selecionado no grupo "${persisted.groupName}". Não altera ProductBOM nem custo nesta fase.`,
      };
    }
    if (persisted.selectedNone) {
      return {
        ...action,
        reason: `Seleção de precificação: grupo "${persisted.groupName}" marcado como nenhum opcional para precificação. Não altera ProductBOM nem custo nesta fase.`,
      };
    }
    return action;
  });

  return { ...plan, actions, optionalPricingStatus: status };
}
