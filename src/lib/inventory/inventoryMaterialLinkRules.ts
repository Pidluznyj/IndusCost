/**
 * Regras puras do vínculo MP oficial → item de estoque (OP-08).
 */
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import { assertOfficialUnitMatchesMaterial } from "./inventoryLedgerProjection.js";

export type OfficialMaterialSnapshotInput = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string | null;
  status: string | null;
};

export type LinkOfficialMaterialInput = {
  materialId: string;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
  controlsStock: boolean;
  minimumStock: number | null;
  safetyStock: number | null;
  controlsLot: boolean;
  allowsReservation: boolean;
  allowsBlock: boolean;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
};

export function assertOfficialMaterialEligibleForStock(
  material: OfficialMaterialSnapshotInput | null | undefined
): OfficialMaterialSnapshotInput {
  if (!material) {
    throw new InventoryValidationError(
      "Matéria-prima oficial não encontrada.",
      "OFFICIAL_MATERIAL_NOT_FOUND"
    );
  }
  const status = (material.status ?? "ACTIVE").trim().toUpperCase();
  if (status && status !== "ACTIVE") {
    throw new InventoryValidationError(
      "Somente matérias-primas oficiais ativas podem ser vinculadas ao estoque.",
      "OFFICIAL_MATERIAL_INACTIVE"
    );
  }
  if (!material.code.trim() || !material.description.trim() || !material.unit.trim()) {
    throw new InventoryValidationError(
      "Cadastro oficial incompleto (código, descrição ou unidade).",
      "OFFICIAL_MATERIAL_INCOMPLETE"
    );
  }
  return material;
}

export function buildMaterialSnapshots(material: OfficialMaterialSnapshotInput) {
  return {
    materialId: material.id,
    materialCodeSnapshot: material.code.trim(),
    materialDescriptionSnapshot: material.description.trim(),
    materialUnitSnapshot: material.unit.trim(),
    materialCategorySnapshot: material.category?.trim() || null,
    code: material.code.trim(),
    description: material.description.trim(),
    unit: material.unit.trim(),
  };
}

export function assertNoActiveMaterialDuplicate(existingActiveId: string | null | undefined): void {
  if (existingActiveId) {
    throw new InventoryValidationError(
      "Esta matéria-prima já possui item ativo no estoque. Inative o vínculo existente antes de criar outro.",
      "MATERIAL_ALREADY_LINKED_ACTIVE"
    );
  }
}

export function assertDefaultLocationBelongsToWarehouse(
  locationWarehouseId: string | null | undefined,
  defaultWarehouseId: string | null,
  hasDefaultLocation: boolean
): void {
  if (!hasDefaultLocation) return;
  if (!defaultWarehouseId) {
    throw new InventoryValidationError(
      "Informe o almoxarifado padrão ao definir o local padrão.",
      "DEFAULT_WAREHOUSE_REQUIRED"
    );
  }
  if (locationWarehouseId !== defaultWarehouseId) {
    throw new InventoryValidationError(
      "O local padrão deve pertencer ao almoxarifado padrão.",
      "DEFAULT_LOCATION_WAREHOUSE_MISMATCH"
    );
  }
}

/** Garante unidade logística alinhada ao snapshot oficial. */
export function assertLinkedItemUnit(itemUnit: string, materialUnit: string): void {
  assertOfficialUnitMatchesMaterial(itemUnit, materialUnit);
}

export type ExistingInventoryItemLinkTarget = {
  id: string;
  itemType: string;
  unit: string;
  materialId: string | null;
};

/**
 * Vínculo de InventoryItem histórico existente → Material oficial.
 * Não cria item. Não troca Material em silêncio. Não adivinha por código/descrição.
 */
export function assertExistingInventoryItemCanLinkOfficialMaterial(
  item: ExistingInventoryItemLinkTarget | null | undefined,
  material: OfficialMaterialSnapshotInput | null | undefined,
  otherActiveItemId: string | null | undefined
): { idempotent: boolean; official: OfficialMaterialSnapshotInput } {
  if (!item) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }
  if (item.itemType !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Somente item do tipo matéria-prima pode receber vínculo à MP oficial.",
      "ITEM_NOT_RAW_MATERIAL"
    );
  }
  const official = assertOfficialMaterialEligibleForStock(material);
  if (item.materialId && item.materialId !== official.id) {
    throw new InventoryValidationError(
      "Este item já está vinculado a outra matéria-prima oficial. Troca silenciosa é recusada.",
      "ITEM_ALREADY_LINKED_TO_DIFFERENT_MATERIAL"
    );
  }
  if (!unitsCompatible(item.unit, official.unit)) {
    throw new InventoryValidationError(
      "Unidade do item logístico incompatível com a matéria-prima oficial.",
      "UNIT_MISMATCH"
    );
  }
  if (item.materialId === official.id) {
    return { idempotent: true, official };
  }
  const conflicting =
    otherActiveItemId && otherActiveItemId !== item.id ? otherActiveItemId : null;
  assertNoActiveMaterialDuplicate(conflicting);
  return { idempotent: false, official };
}
