/**
 * Classificação fail-closed de saldo legado Material.quantity → INITIAL_BALANCE.
 *
 * Motor puro: não escreve banco, não chama Nomus, não inventa saldo.
 * Só o serviço canônico de movimento pode materializar o resultado.
 */
import { roundInventoryQuantity, safeInventoryNumber } from "./inventoryTypes.js";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";

export const LEGACY_MATERIAL_INITIAL_BALANCE_REASON =
  "Implantação de saldo legado após migração para Inventory";

export const LEGACY_MATERIAL_INITIAL_BALANCE_CONFIRM = "LEGACY_MATERIAL_INITIAL_BALANCE";

export const LEGACY_MATERIAL_BALANCE_CLASSIFICATIONS = [
  "ELIGIBLE",
  "ALREADY_CANONICAL",
  "ZERO_LEGACY",
  "NO_INVENTORY_LINK",
  "HAS_CANONICAL_MOVEMENT",
  "CONFLICTING_EVIDENCE",
  "MANUAL_REVIEW",
  "FAILED",
] as const;

export type LegacyMaterialBalanceClassification =
  (typeof LEGACY_MATERIAL_BALANCE_CLASSIFICATIONS)[number];

export const LEGACY_MATERIAL_BALANCE_REASONS = {
  MATERIAL_INACTIVE: "MATERIAL_INACTIVE",
  ITEM_INACTIVE: "ITEM_INACTIVE",
  MATERIAL_ID_MISMATCH: "MATERIAL_ID_MISMATCH",
  CONTROLS_STOCK_FALSE: "CONTROLS_STOCK_FALSE",
  UNIT_INCOMPATIBLE: "UNIT_INCOMPATIBLE",
  NO_CANONICAL_WAREHOUSE: "NO_CANONICAL_WAREHOUSE",
  WAREHOUSE_INACTIVE: "WAREHOUSE_INACTIVE",
  HAS_PHYSICAL_MOVEMENT: "HAS_PHYSICAL_MOVEMENT",
  CANONICAL_QTY_NOT_ZERO: "CANONICAL_QTY_NOT_ZERO",
  ACTIVE_INITIAL_BALANCE: "ACTIVE_INITIAL_BALANCE",
  LEGACY_QUANTITY_NOT_POSITIVE: "LEGACY_QUANTITY_NOT_POSITIVE",
  NO_LEGACY_CONFERENCE: "NO_LEGACY_CONFERENCE",
  REPORTED_QTY_MISMATCH: "REPORTED_QTY_MISMATCH",
  CONFERENCE_AFTER_INVENTORY: "CONFERENCE_AFTER_INVENTORY",
  COUNTED_AFTER_CONFERENCE: "COUNTED_AFTER_CONFERENCE",
  AMBIGUOUS_LINK: "AMBIGUOUS_LINK",
  LOCATION_REQUIRED: "LOCATION_REQUIRED",
  NO_INVENTORY_ITEM: "NO_INVENTORY_ITEM",
} as const;

export type LegacyMaterialBalanceReason =
  (typeof LEGACY_MATERIAL_BALANCE_REASONS)[keyof typeof LEGACY_MATERIAL_BALANCE_REASONS];

export type LegacyMaterialBalanceItemSnapshot = {
  id: string;
  status: string;
  materialId: string | null;
  controlsStock: boolean;
  controlsLocation: boolean;
  unit: string;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
  createdAt: Date;
  notes: string | null;
};

export type LegacyMaterialBalanceWarehouseSnapshot = {
  id: string;
  status: string;
  allowsMovements: boolean;
};

export type LegacyMaterialBalanceConferenceSnapshot = {
  id: string;
  reportedQuantity: number;
  recordedAt: Date;
  userId: string;
};

export type LegacyMaterialBalanceCandidateInput = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  materialStatus: string;
  materialQuantity: number;
  materialUnit: string;
  items: readonly LegacyMaterialBalanceItemSnapshot[];
  warehouse: LegacyMaterialBalanceWarehouseSnapshot | null;
  physicalQuantity: number;
  movementCount: number;
  hasActiveInitialBalance: boolean;
  latestConference: LegacyMaterialBalanceConferenceSnapshot | null;
  laterCountedEvidence: boolean;
};

export type LegacyMaterialBalanceClassificationResult = {
  materialId: string;
  code: string;
  description: string;
  classification: LegacyMaterialBalanceClassification;
  reason: LegacyMaterialBalanceReason | null;
  legacyQuantity: number;
  inventoryPhysicalQuantity: number;
  movementCount: number;
  latestLegacyConferenceId: string | null;
  latestReportedQuantity: number | null;
  inventoryItemId: string | null;
  warehouseId: string | null;
  locationId: string | null;
  conferenceRecordedAt: string | null;
  conferenceUserId: string | null;
  evidenceRef: string | null;
};

export type LegacyMaterialBalancePreviewSummary = {
  scanned: number;
  alreadyCanonical: number;
  eligible: number;
  manualReview: number;
  zeroLegacy: number;
  noInventoryLink: number;
  hasCanonicalMovement: number;
  conflictingEvidence: number;
  failed: number;
};

function qty(value: unknown): number {
  return roundInventoryQuantity(safeInventoryNumber(value) ?? 0);
}

function qtyEquals(a: unknown, b: unknown): boolean {
  return qty(a) === qty(b);
}

function activeItems(items: readonly LegacyMaterialBalanceItemSnapshot[]) {
  return items.filter((item) => (item.status ?? "").trim().toUpperCase() === "ACTIVE");
}

function classifyReason(
  input: LegacyMaterialBalanceCandidateInput
): Pick<
  LegacyMaterialBalanceClassificationResult,
  "classification" | "reason" | "inventoryItemId" | "warehouseId" | "locationId"
> {
  const active = activeItems(input.items);
  if (active.length === 0) {
    return {
      classification: "NO_INVENTORY_LINK",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.NO_INVENTORY_ITEM,
      inventoryItemId: null,
      warehouseId: null,
      locationId: null,
    };
  }
  if (active.length > 1) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.AMBIGUOUS_LINK,
      inventoryItemId: null,
      warehouseId: null,
      locationId: null,
    };
  }

  const item = active[0]!;
  const warehouseId = item.defaultWarehouseId;
  const locationId = item.controlsLocation ? item.defaultLocationId : null;

  if ((input.materialStatus ?? "").trim().toUpperCase() !== "ACTIVE") {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.MATERIAL_INACTIVE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if ((item.status ?? "").trim().toUpperCase() !== "ACTIVE") {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.ITEM_INACTIVE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (!item.materialId || item.materialId !== input.materialId) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.MATERIAL_ID_MISMATCH,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (item.controlsStock !== true) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.CONTROLS_STOCK_FALSE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (!unitsCompatible(input.materialUnit, item.unit)) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.UNIT_INCOMPATIBLE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (!warehouseId) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.NO_CANONICAL_WAREHOUSE,
      inventoryItemId: item.id,
      warehouseId: null,
      locationId,
    };
  }
  if (
    !input.warehouse ||
    input.warehouse.id !== warehouseId ||
    (input.warehouse.status ?? "").trim().toUpperCase() !== "ACTIVE" ||
    input.warehouse.allowsMovements === false
  ) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.WAREHOUSE_INACTIVE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (item.controlsLocation && !item.defaultLocationId) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.LOCATION_REQUIRED,
      inventoryItemId: item.id,
      warehouseId,
      locationId: null,
    };
  }

  if (input.hasActiveInitialBalance) {
    return {
      classification: "ALREADY_CANONICAL",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.ACTIVE_INITIAL_BALANCE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (input.movementCount > 0) {
    return {
      classification: "HAS_CANONICAL_MOVEMENT",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.HAS_PHYSICAL_MOVEMENT,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (qty(input.physicalQuantity) !== 0) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.CANONICAL_QTY_NOT_ZERO,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (qty(input.materialQuantity) <= 0) {
    return {
      classification: "ZERO_LEGACY",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.LEGACY_QUANTITY_NOT_POSITIVE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (!input.latestConference) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.NO_LEGACY_CONFERENCE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (!qtyEquals(input.latestConference.reportedQuantity, input.materialQuantity)) {
    return {
      classification: "MANUAL_REVIEW",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.REPORTED_QTY_MISMATCH,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (input.latestConference.recordedAt.getTime() > item.createdAt.getTime()) {
    return {
      classification: "CONFLICTING_EVIDENCE",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.CONFERENCE_AFTER_INVENTORY,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }
  if (input.laterCountedEvidence) {
    return {
      classification: "CONFLICTING_EVIDENCE",
      reason: LEGACY_MATERIAL_BALANCE_REASONS.COUNTED_AFTER_CONFERENCE,
      inventoryItemId: item.id,
      warehouseId,
      locationId,
    };
  }

  return {
    classification: "ELIGIBLE",
    reason: null,
    inventoryItemId: item.id,
    warehouseId,
    locationId,
  };
}

export function classifyLegacyMaterialBalance(
  input: LegacyMaterialBalanceCandidateInput
): LegacyMaterialBalanceClassificationResult {
  const classified = classifyReason(input);
  const conference = input.latestConference;
  return {
    materialId: input.materialId,
    code: input.materialCode,
    description: input.materialDescription,
    classification: classified.classification,
    reason: classified.reason,
    legacyQuantity: qty(input.materialQuantity),
    inventoryPhysicalQuantity: qty(input.physicalQuantity),
    movementCount: input.movementCount,
    latestLegacyConferenceId: conference?.id ?? null,
    latestReportedQuantity: conference ? qty(conference.reportedQuantity) : null,
    inventoryItemId: classified.inventoryItemId,
    warehouseId: classified.warehouseId,
    locationId: classified.locationId,
    conferenceRecordedAt: conference?.recordedAt.toISOString() ?? null,
    conferenceUserId: conference?.userId ?? null,
    evidenceRef: conference ? `MaterialStockConference:${conference.id}` : null,
  };
}

export function emptyLegacyMaterialBalancePreviewSummary(): LegacyMaterialBalancePreviewSummary {
  return {
    scanned: 0,
    alreadyCanonical: 0,
    eligible: 0,
    manualReview: 0,
    zeroLegacy: 0,
    noInventoryLink: 0,
    hasCanonicalMovement: 0,
    conflictingEvidence: 0,
    failed: 0,
  };
}

export function summarizeLegacyMaterialBalanceClassifications(
  rows: readonly Pick<LegacyMaterialBalanceClassificationResult, "classification">[]
): LegacyMaterialBalancePreviewSummary {
  const summary = emptyLegacyMaterialBalancePreviewSummary();
  summary.scanned = rows.length;
  for (const row of rows) {
    switch (row.classification) {
      case "ELIGIBLE":
        summary.eligible += 1;
        break;
      case "ALREADY_CANONICAL":
        summary.alreadyCanonical += 1;
        break;
      case "ZERO_LEGACY":
        summary.zeroLegacy += 1;
        break;
      case "NO_INVENTORY_LINK":
        summary.noInventoryLink += 1;
        break;
      case "HAS_CANONICAL_MOVEMENT":
        summary.hasCanonicalMovement += 1;
        summary.manualReview += 1;
        break;
      case "CONFLICTING_EVIDENCE":
        summary.conflictingEvidence += 1;
        summary.manualReview += 1;
        break;
      case "FAILED":
        summary.failed += 1;
        break;
      default:
        summary.manualReview += 1;
        break;
    }
  }
  return summary;
}

export function isLegacyMaterialBalanceEligible(
  row: Pick<LegacyMaterialBalanceClassificationResult, "classification">
): boolean {
  return row.classification === "ELIGIBLE";
}
