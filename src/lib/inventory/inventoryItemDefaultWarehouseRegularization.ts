/**
 * Regularização de `defaultWarehouseId` em itens ativos que controlam estoque e
 * ficaram sem almoxarifado padrão (cadastro pela ficha antes da política de
 * almoxarifado padrão — ver inventoryItemDefaultWarehousePolicy.ts).
 *
 * Regra pura (classificação) + executor com transação injetada. Nada aqui lê ou
 * escreve no banco diretamente: o CLI (scripts/regularizeInventoryItemDefaultWarehouse.ts)
 * carrega os snapshots, roda o dry-run e, só com confirmação explícita, aplica.
 *
 * Garantias:
 * - só grava `InventoryItem.defaultWarehouseId` (nunca saldo, movimento,
 *   sessão ou linha de conferência);
 * - idempotente: a escrita é CAS (`defaultWarehouseId IS NULL`) — repetir não
 *   duplica nem sobrescreve o que alguém já ajustou;
 * - o alvo vem do cadastro de setores STANDARD ativos (um setor para o tipo),
 *   nunca de um código fixo no código;
 * - cada item gravado recebe InventoryAuditLog com before/after e motivo;
 * - reversível: o relatório de apply guarda o que foi gravado e o modo revert
 *   desfaz só o que ainda está exatamente como foi gravado.
 */
import type { InventoryItemType } from "./inventoryTypes.js";
import {
  resolveItemDefaultWarehousePolicy,
  type StandardSectorWarehouseOption,
} from "./inventoryItemDefaultWarehousePolicy.js";

export const DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM =
  "REGULARIZE_INVENTORY_ITEM_DEFAULT_WAREHOUSE";
export const DEFAULT_WAREHOUSE_REGULARIZATION_AUDIT_ACTION =
  "SET_DEFAULT_WAREHOUSE_REGULARIZATION";
export const DEFAULT_WAREHOUSE_REGULARIZATION_REVERT_AUDIT_ACTION =
  "REVERT_DEFAULT_WAREHOUSE_REGULARIZATION";

/** Item ativo, controla estoque, sem almoxarifado padrão — com os vínculos que importam. */
export type RegularizationItemSnapshot = {
  id: string;
  code: string;
  description: string;
  itemType: InventoryItemType;
  status: string;
  controlsStock: boolean;
  materialId: string | null;
  productId: string | null;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
  createdAt: string | null;
  /** Almoxarifados com InventoryBalance do item (qualquer quantidade). */
  balanceWarehouseIds: string[];
  /** Almoxarifados com reserva ACTIVE do item. */
  activeReservationWarehouseIds: string[];
  /** Almoxarifados com bloqueio ACTIVE do item. */
  activeBlockWarehouseIds: string[];
};

export type RegularizationWarehouseSnapshot = {
  id: string;
  code: string;
  status: string;
  allowsMovements: boolean;
};

export type RegularizationClassification =
  | "ELIGIBLE"
  | "OFFICIAL_LINK"
  | "PRESENCE_TYPE"
  | "NO_SECTOR"
  | "AMBIGUOUS_SECTOR"
  | "CONFLICT_LINKED_ELSEWHERE"
  | "TARGET_WAREHOUSE_INVALID"
  | "NOT_SELECTED"
  | "NOT_IN_SCOPE";

export type RegularizationPlanLine = {
  itemId: string;
  code: string;
  description: string;
  itemType: InventoryItemType;
  createdAt: string | null;
  classification: RegularizationClassification;
  targetWarehouseId: string | null;
  targetWarehouseCode: string | null;
  sectorCode: string | null;
  /** Já tem saldo no almoxarifado alvo (entra na conferência de qualquer forma). */
  hasBalanceInTarget: boolean;
  reason: string;
};

export type RegularizationPlan = {
  generatedAt: string;
  filters: { itemTypes: InventoryItemType[] | null; codes: string[] | null };
  lines: RegularizationPlanLine[];
  /** Diagnóstico (§ auditoria): por tipo × classificação, sobre TODOS os itens sem padrão. */
  byItemType: Record<string, Partial<Record<RegularizationClassification, number>>>;
  eligibleCount: number;
};

/** Setor STANDARD ativo com o tipo que atende (a opção da política não carrega o tipo). */
export type RegularizationSectorSnapshot = StandardSectorWarehouseOption & {
  itemType: InventoryItemType;
};

export type RegularizationFilters = {
  itemTypes?: readonly InventoryItemType[] | null;
  codes?: readonly string[] | null;
};

function distinct<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function countByType(
  lines: readonly RegularizationPlanLine[]
): RegularizationPlan["byItemType"] {
  const out: RegularizationPlan["byItemType"] = {};
  for (const line of lines) {
    const bucket = (out[line.itemType] ??= {});
    bucket[line.classification] = (bucket[line.classification] ?? 0) + 1;
  }
  return out;
}

/**
 * Classifica cada item sem almoxarifado padrão. Itens fora de escopo (inativos,
 * sem controle de estoque, já com padrão) nunca deveriam chegar aqui — se chegam,
 * saem como NOT_IN_SCOPE e não são tocados.
 */
export function planDefaultWarehouseRegularization(input: {
  items: readonly RegularizationItemSnapshot[];
  activeStandardSectors: readonly RegularizationSectorSnapshot[];
  warehousesById: ReadonlyMap<string, RegularizationWarehouseSnapshot>;
  filters?: RegularizationFilters;
  now?: Date;
}): RegularizationPlan {
  const itemTypesFilter = input.filters?.itemTypes?.length ? new Set(input.filters.itemTypes) : null;
  const codesFilter = input.filters?.codes?.length
    ? new Set(input.filters.codes.map((code) => code.trim().toUpperCase()))
    : null;
  const sectorsByType = new Map<InventoryItemType, StandardSectorWarehouseOption[]>();
  for (const sector of input.activeStandardSectors) {
    const bucket = sectorsByType.get(sector.itemType) ?? [];
    bucket.push(sector);
    sectorsByType.set(sector.itemType, bucket);
  }
  const lines: RegularizationPlanLine[] = [];

  for (const item of input.items) {
    const base = {
      itemId: item.id,
      code: item.code,
      description: item.description,
      itemType: item.itemType,
      createdAt: item.createdAt,
      targetWarehouseId: null as string | null,
      targetWarehouseCode: null as string | null,
      sectorCode: null as string | null,
      hasBalanceInTarget: false,
    };
    const push = (classification: RegularizationClassification, reason: string, extra?: Partial<RegularizationPlanLine>) =>
      lines.push({ ...base, ...extra, classification, reason });

    if (item.status !== "ACTIVE" || !item.controlsStock || item.defaultWarehouseId) {
      push("NOT_IN_SCOPE", "Inativo, sem controle de estoque ou já com almoxarifado padrão.");
      continue;
    }
    if (item.itemType === "RAW_MATERIAL" || item.materialId) {
      push("OFFICIAL_LINK", "Escopo padrão é do vínculo com a MP oficial (não regularizar por aqui).");
      continue;
    }
    if (item.itemType === "COMPONENT" || item.itemType === "FINISHED_PRODUCT") {
      push("PRESENCE_TYPE", "Componentes/produtos acabados são conferidos por presença (saldo); sem padrão automático.");
      continue;
    }

    const policy = resolveItemDefaultWarehousePolicy(
      item.itemType,
      sectorsByType.get(item.itemType) ?? []
    );
    if (policy.mode === "FREE") {
      push("NO_SECTOR", "Tipo sem setor de conferência STANDARD ativo: cadastro em preparação ou tipo sem conferência pelo tablet.");
      continue;
    }
    if (policy.mode !== "SECTOR_FIXED" || !policy.defaultWarehouseId) {
      push(
        "AMBIGUOUS_SECTOR",
        `Mais de um setor de conferência para o tipo (${policy.options.map((o) => o.warehouseCode).join(", ")}): escolha manual.`
      );
      continue;
    }
    const option = policy.options[0];
    const target = input.warehousesById.get(option.warehouseId);
    const targetExtra = {
      targetWarehouseId: option.warehouseId,
      targetWarehouseCode: option.warehouseCode,
      sectorCode: option.sectorCode,
      hasBalanceInTarget: item.balanceWarehouseIds.includes(option.warehouseId),
    };
    if (!target || target.status !== "ACTIVE" || !target.allowsMovements) {
      push(
        "TARGET_WAREHOUSE_INVALID",
        `Almoxarifado do setor ${option.sectorCode} (${option.warehouseCode}) inexistente, inativo ou sem movimentações.`,
        targetExtra
      );
      continue;
    }
    const linkedElsewhere = distinct([
      ...item.balanceWarehouseIds,
      ...item.activeReservationWarehouseIds,
      ...item.activeBlockWarehouseIds,
    ]).filter((warehouseId) => warehouseId !== option.warehouseId);
    if (linkedElsewhere.length > 0) {
      push(
        "CONFLICT_LINKED_ELSEWHERE",
        `Saldo, reserva ou bloqueio em outro almoxarifado (${linkedElsewhere.length}): tratar manualmente.`,
        targetExtra
      );
      continue;
    }
    if (
      (itemTypesFilter && !itemTypesFilter.has(item.itemType)) ||
      (codesFilter && !codesFilter.has(item.code.trim().toUpperCase()))
    ) {
      push("NOT_SELECTED", "Elegível, mas fora dos filtros desta execução.", targetExtra);
      continue;
    }
    push(
      "ELIGIBLE",
      `Definir almoxarifado padrão = ${option.warehouseCode} (setor ${option.sectorCode}).`,
      targetExtra
    );
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    filters: {
      itemTypes: itemTypesFilter ? [...itemTypesFilter] : null,
      codes: codesFilter ? [...codesFilter] : null,
    },
    lines,
    byItemType: countByType(lines),
    eligibleCount: lines.filter((line) => line.classification === "ELIGIBLE").length,
  };
}

export type RegularizationActor = { id: string; name: string | null; isActive: boolean };

export type RegularizationApplyTx = {
  /**
   * CAS: grava `defaultWarehouseId = warehouseId` somente se ainda for NULL,
   * o item continuar ACTIVE e controlando estoque. Devolve true quando gravou.
   */
  setDefaultWarehouseIfUnset(itemId: string, warehouseId: string): Promise<boolean>;
  writeAudit(input: {
    entityId: string;
    action: string;
    beforeJson: unknown;
    afterJson: unknown;
    userId: string;
    userName: string | null;
    reason: string;
  }): Promise<void>;
};

export type RegularizationApplyLine = {
  itemId: string;
  code: string;
  itemType: InventoryItemType;
  targetWarehouseId: string;
  targetWarehouseCode: string;
  finalAction: "APPLIED" | "SKIPPED_ALREADY_SET";
};

export type RegularizationApplyResult = {
  appliedAt: string;
  actorUserId: string;
  applied: number;
  skippedAlreadySet: number;
  notEligible: number;
  lines: RegularizationApplyLine[];
};

export function assertRegularizationApplyRequest(input: {
  confirm: string | null;
  actorUserId: string | null;
}): void {
  if (input.confirm !== DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM) {
    throw new Error(
      `APPLY exige --confirm=${DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM}. Nada foi gravado.`
    );
  }
  if (
    !input.actorUserId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.actorUserId.trim()
    )
  ) {
    throw new Error("APPLY exige --actorUserId=<UUID>. Nada foi gravado.");
  }
}

/** Aplica só as linhas ELIGIBLE do plano, com CAS por item e auditoria por item. */
export async function executeDefaultWarehouseRegularization(input: {
  plan: RegularizationPlan;
  actor: RegularizationActor;
  tx: RegularizationApplyTx;
  now?: Date;
}): Promise<RegularizationApplyResult> {
  if (!input.actor.isActive) {
    throw new Error("Responsável inexistente ou inativo. Nada foi gravado.");
  }
  const appliedAt = (input.now ?? new Date()).toISOString();
  const lines: RegularizationApplyLine[] = [];
  let applied = 0;
  let skippedAlreadySet = 0;
  let notEligible = 0;

  for (const line of input.plan.lines) {
    if (line.classification !== "ELIGIBLE" || !line.targetWarehouseId || !line.targetWarehouseCode) {
      notEligible += 1;
      continue;
    }
    const wrote = await input.tx.setDefaultWarehouseIfUnset(line.itemId, line.targetWarehouseId);
    if (!wrote) {
      skippedAlreadySet += 1;
      lines.push({
        itemId: line.itemId,
        code: line.code,
        itemType: line.itemType,
        targetWarehouseId: line.targetWarehouseId,
        targetWarehouseCode: line.targetWarehouseCode,
        finalAction: "SKIPPED_ALREADY_SET",
      });
      continue;
    }
    await input.tx.writeAudit({
      entityId: line.itemId,
      action: DEFAULT_WAREHOUSE_REGULARIZATION_AUDIT_ACTION,
      beforeJson: { code: line.code, defaultWarehouseId: null },
      afterJson: { code: line.code, defaultWarehouseId: line.targetWarehouseId },
      userId: input.actor.id,
      userName: input.actor.name,
      reason: `Regularização: ${line.reason} Item sem almoxarifado padrão não entrava na conferência do setor.`,
    });
    applied += 1;
    lines.push({
      itemId: line.itemId,
      code: line.code,
      itemType: line.itemType,
      targetWarehouseId: line.targetWarehouseId,
      targetWarehouseCode: line.targetWarehouseCode,
      finalAction: "APPLIED",
    });
  }

  return { appliedAt, actorUserId: input.actor.id, applied, skippedAlreadySet, notEligible, lines };
}

export type RegularizationRevertTx = {
  /** CAS inverso: volta para NULL somente se ainda estiver exatamente no almoxarifado gravado. */
  clearDefaultWarehouseIfEquals(itemId: string, warehouseId: string): Promise<boolean>;
  writeAudit: RegularizationApplyTx["writeAudit"];
};

export type RegularizationRevertResult = {
  revertedAt: string;
  reverted: number;
  skippedChanged: number;
  lines: Array<{ itemId: string; code: string; finalAction: "REVERTED" | "SKIPPED_CHANGED" }>;
};

/** Desfaz um apply anterior a partir do seu relatório; só toca o que ainda está como foi gravado. */
export async function revertDefaultWarehouseRegularization(input: {
  applyResult: Pick<RegularizationApplyResult, "lines" | "appliedAt">;
  actor: RegularizationActor;
  tx: RegularizationRevertTx;
  now?: Date;
}): Promise<RegularizationRevertResult> {
  if (!input.actor.isActive) {
    throw new Error("Responsável inexistente ou inativo. Nada foi gravado.");
  }
  const lines: RegularizationRevertResult["lines"] = [];
  let reverted = 0;
  let skippedChanged = 0;
  for (const line of input.applyResult.lines) {
    if (line.finalAction !== "APPLIED") continue;
    const cleared = await input.tx.clearDefaultWarehouseIfEquals(line.itemId, line.targetWarehouseId);
    if (!cleared) {
      skippedChanged += 1;
      lines.push({ itemId: line.itemId, code: line.code, finalAction: "SKIPPED_CHANGED" });
      continue;
    }
    await input.tx.writeAudit({
      entityId: line.itemId,
      action: DEFAULT_WAREHOUSE_REGULARIZATION_REVERT_AUDIT_ACTION,
      beforeJson: { code: line.code, defaultWarehouseId: line.targetWarehouseId },
      afterJson: { code: line.code, defaultWarehouseId: null },
      userId: input.actor.id,
      userName: input.actor.name,
      reason: `Reversão da regularização aplicada em ${input.applyResult.appliedAt}.`,
    });
    reverted += 1;
    lines.push({ itemId: line.itemId, code: line.code, finalAction: "REVERTED" });
  }
  return { revertedAt: (input.now ?? new Date()).toISOString(), reverted, skippedChanged, lines };
}

/** Relatório legível do dry-run (console). */
export function formatRegularizationPlanReport(plan: RegularizationPlan): string {
  const out: string[] = [];
  out.push("=== REGULARIZAÇÃO DE ALMOXARIFADO PADRÃO — PRÉVIA (dry-run) ===");
  out.push(`Gerado em: ${plan.generatedAt}`);
  out.push(
    `Filtros: itemTypes=${plan.filters.itemTypes?.join(",") ?? "(todos)"} codes=${plan.filters.codes?.join(",") ?? "(todos)"}`
  );
  out.push("");
  out.push("Diagnóstico por tipo (itens ativos, controlam estoque, sem almoxarifado padrão):");
  for (const [itemType, counts] of Object.entries(plan.byItemType).sort()) {
    const parts = Object.entries(counts)
      .sort()
      .map(([classification, count]) => `${classification}=${count}`)
      .join("  ");
    out.push(`  ${itemType.padEnd(22)} ${parts}`);
  }
  out.push("");
  out.push(`Itens que SERIAM alterados (ELIGIBLE): ${plan.eligibleCount}`);
  for (const line of plan.lines.filter((l) => l.classification === "ELIGIBLE")) {
    out.push(
      `  ${line.code.padEnd(16)} ${line.itemType.padEnd(22)} → ${line.targetWarehouseCode} (setor ${line.sectorCode})${line.hasBalanceInTarget ? "  [já tem saldo]" : ""}  criado=${line.createdAt ?? "?"}`
    );
  }
  const others = plan.lines.filter(
    (l) => l.classification !== "ELIGIBLE" && l.classification !== "NOT_IN_SCOPE"
  );
  if (others.length > 0) {
    out.push("");
    out.push(`Itens NÃO alterados (${others.length}):`);
    for (const line of others) {
      out.push(`  ${line.code.padEnd(16)} ${line.itemType.padEnd(22)} ${line.classification}: ${line.reason}`);
    }
  }
  out.push("");
  out.push("Nenhum saldo, movimento, sessão ou linha de conferência é criado ou alterado.");
  return out.join("\n");
}
