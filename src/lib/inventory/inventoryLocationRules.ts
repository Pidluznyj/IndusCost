/**
 * Regras puras de almoxarifados / locais internos (OP-07).
 * Sem Prisma — testável e reutilizável no frontend.
 */

import { InventoryValidationError } from "./inventoryTypes.js";

export const INVENTORY_LOCATION_TYPES = ["PHYSICAL", "QUARANTINE", "PRODUCTION"] as const;
export type InventoryLocationTypeCode = (typeof INVENTORY_LOCATION_TYPES)[number];

export type InventoryLocationHierarchyNode = {
  id: string;
  warehouseId: string;
  parentLocationId: string | null;
  status: "ACTIVE" | "INACTIVE";
  code: string;
  name: string;
};

export function normalizeLocationCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeLocationName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function assertValidLocationCode(code: string): string {
  const normalized = normalizeLocationCode(code);
  if (!normalized) {
    throw new InventoryValidationError("Código do local é obrigatório.", "LOCATION_CODE_REQUIRED");
  }
  if (normalized.length > 64) {
    throw new InventoryValidationError("Código do local é muito longo.", "LOCATION_CODE_TOO_LONG");
  }
  if (!/^[A-Z0-9][A-Z0-9._\-/]*$/i.test(normalized)) {
    throw new InventoryValidationError(
      "Código do local inválido. Use letras, números e . _ - /.",
      "LOCATION_CODE_INVALID"
    );
  }
  return normalized;
}

export function assertValidLocationName(name: string): string {
  const normalized = normalizeLocationName(name);
  if (!normalized) {
    throw new InventoryValidationError("Nome do local é obrigatório.", "LOCATION_NAME_REQUIRED");
  }
  if (normalized.length > 120) {
    throw new InventoryValidationError("Nome do local é muito longo.", "LOCATION_NAME_TOO_LONG");
  }
  return normalized;
}

export function parseInventoryLocationType(value: unknown): InventoryLocationTypeCode {
  const raw = String(value ?? "PHYSICAL").trim().toUpperCase();
  if (!INVENTORY_LOCATION_TYPES.includes(raw as InventoryLocationTypeCode)) {
    throw new InventoryValidationError("Tipo de local inválido.", "LOCATION_TYPE_INVALID");
  }
  return raw as InventoryLocationTypeCode;
}

export function assertParentHierarchy(
  locationId: string | null,
  warehouseId: string,
  parent: InventoryLocationHierarchyNode | null | undefined
): void {
  if (!parent) {
    if (locationId == null) return;
    return;
  }
  if (parent.warehouseId !== warehouseId) {
    throw new InventoryValidationError(
      "O local pai deve pertencer ao mesmo almoxarifado.",
      "LOCATION_PARENT_WAREHOUSE_MISMATCH"
    );
  }
  if (locationId && parent.id === locationId) {
    throw new InventoryValidationError(
      "Um local não pode ser pai de si mesmo.",
      "LOCATION_PARENT_SELF"
    );
  }
  if (parent.status !== "ACTIVE") {
    throw new InventoryValidationError(
      "O local pai precisa estar ativo.",
      "LOCATION_PARENT_INACTIVE"
    );
  }
}

/** Detecta ciclo na hierarquia (pai → … → filho). */
export function wouldCreateLocationCycle(
  locationId: string,
  newParentId: string | null,
  nodesById: ReadonlyMap<string, InventoryLocationHierarchyNode>
): boolean {
  if (!newParentId) return false;
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === locationId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = nodesById.get(cursor)?.parentLocationId ?? null;
  }
  return false;
}

export function assertNoLocationCycle(
  locationId: string,
  newParentId: string | null,
  nodesById: ReadonlyMap<string, InventoryLocationHierarchyNode>
): void {
  if (wouldCreateLocationCycle(locationId, newParentId, nodesById)) {
    throw new InventoryValidationError(
      "Hierarquia inválida: ciclo detectado entre locais.",
      "LOCATION_HIERARCHY_CYCLE"
    );
  }
}

export type LocationActiveLinkSummary = {
  hasPositiveBalance: boolean;
  hasActiveReservation: boolean;
  hasActiveBlock: boolean;
  hasActiveChildren: boolean;
  isReferencedByMovements: boolean;
};

/** Impede inativação indevida quando há vínculo operacional ativo. */
export function assertCanDeactivateLocation(links: LocationActiveLinkSummary): void {
  if (links.hasActiveChildren) {
    throw new InventoryValidationError(
      "Não é possível inativar: existem locais filhos ativos.",
      "LOCATION_HAS_ACTIVE_CHILDREN"
    );
  }
  if (links.hasPositiveBalance) {
    throw new InventoryValidationError(
      "Não é possível inativar: o local possui saldo ativo.",
      "LOCATION_HAS_BALANCE"
    );
  }
  if (links.hasActiveReservation) {
    throw new InventoryValidationError(
      "Não é possível inativar: o local possui reserva ativa.",
      "LOCATION_HAS_ACTIVE_RESERVATION"
    );
  }
  if (links.hasActiveBlock) {
    throw new InventoryValidationError(
      "Não é possível inativar: o local possui bloqueio ativo.",
      "LOCATION_HAS_ACTIVE_BLOCK"
    );
  }
}

export type WarehouseActiveLinkSummary = {
  hasPositiveBalance: boolean;
  hasActiveReservation: boolean;
  hasOpenCountSession: boolean;
  hasActiveLocationsWithStock: boolean;
};

export function assertCanDeactivateWarehouse(links: WarehouseActiveLinkSummary): void {
  if (links.hasPositiveBalance || links.hasActiveLocationsWithStock) {
    throw new InventoryValidationError(
      "Não é possível inativar: o almoxarifado possui saldo ativo.",
      "WAREHOUSE_HAS_BALANCE"
    );
  }
  if (links.hasActiveReservation) {
    throw new InventoryValidationError(
      "Não é possível inativar: o almoxarifado possui reserva ativa.",
      "WAREHOUSE_HAS_ACTIVE_RESERVATION"
    );
  }
  if (links.hasOpenCountSession) {
    throw new InventoryValidationError(
      "Não é possível inativar: há conferência aberta neste almoxarifado.",
      "WAREHOUSE_HAS_OPEN_COUNT"
    );
  }
}

/** Código duplicado no mesmo almoxarifado (após normalização). */
export function assertLocationCodeNotDuplicate(
  candidateCode: string,
  existingCodes: readonly string[]
): void {
  const normalized = normalizeLocationCode(candidateCode);
  if (existingCodes.some((code) => normalizeLocationCode(code) === normalized)) {
    throw new InventoryValidationError(
      "Já existe um local com este código neste almoxarifado.",
      "LOCATION_CODE_DUPLICATE"
    );
  }
}

export function formatLocationAddress(parts: {
  aisle?: string | null;
  shelf?: string | null;
  position?: string | null;
}): string | null {
  const bits = [parts.aisle, parts.shelf, parts.position]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  return bits.length ? bits.join(" / ") : null;
}
