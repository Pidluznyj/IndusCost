/**
 * Regras puras do vínculo MP oficial → item de estoque (OP-08).
 */
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
