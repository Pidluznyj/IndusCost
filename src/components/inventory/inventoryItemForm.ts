/**
 * Formulário e validação de item — frontend puro (sem Prisma).
 */
import type { InventoryItemRow, InventoryItemStatus, InventoryItemType } from "@/src/types/inventory";

export type InventoryItemFormState = {
  code: string;
  description: string;
  itemType: InventoryItemType | "";
  unit: string;
  status: InventoryItemStatus;
  family: string;
  group: string;
  controlsLot: boolean;
  controlsExpiration: boolean;
  controlsLocation: boolean;
  controlsQuality: boolean;
  minimumStock: string;
  maximumStock: string;
  reorderPoint: string;
  preferredSupplierName: string;
  averageCost: string;
  lastKnownCost: string;
  nomusProductCode: string;
  notes: string;
  /** Escopo padrão — a política do tipo (server) pode preencher e travar o almoxarifado. */
  defaultWarehouseId: string;
  defaultLocationId: string;
};

export type InventoryItemFormErrors = Partial<Record<keyof InventoryItemFormState, string>>;

export function createEmptyInventoryItemForm(
  defaults?: Partial<InventoryItemFormState>
): InventoryItemFormState {
  return {
    code: "",
    description: "",
    itemType: "",
    unit: "UN",
    status: "ACTIVE",
    family: "",
    group: "",
    controlsLot: false,
    controlsExpiration: false,
    controlsLocation: false,
    controlsQuality: false,
    minimumStock: "",
    maximumStock: "",
    reorderPoint: "",
    preferredSupplierName: "",
    averageCost: "",
    lastKnownCost: "",
    nomusProductCode: "",
    notes: "",
    defaultWarehouseId: "",
    defaultLocationId: "",
    ...defaults,
  };
}

export function inventoryItemFormFromRow(row: InventoryItemRow): InventoryItemFormState {
  return {
    code: row.code,
    description: row.description,
    itemType: row.itemType,
    unit: row.unit,
    status: row.status,
    family: row.family ?? "",
    group: row.group ?? "",
    controlsLot: row.controlsLot,
    controlsExpiration: row.controlsExpiration,
    controlsLocation: row.controlsLocation,
    controlsQuality: row.controlsQuality,
    minimumStock: row.minimumStock != null ? String(row.minimumStock) : "",
    maximumStock: row.maximumStock != null ? String(row.maximumStock) : "",
    reorderPoint: row.reorderPoint != null ? String(row.reorderPoint) : "",
    preferredSupplierName: row.preferredSupplierName ?? "",
    averageCost: row.averageCost != null ? String(row.averageCost) : "",
    lastKnownCost: row.lastKnownCost != null ? String(row.lastKnownCost) : "",
    nomusProductCode: row.nomusProductCode ?? "",
    notes: row.notes ?? "",
    defaultWarehouseId: row.defaultWarehouseId ?? "",
    defaultLocationId: row.defaultLocationId ?? "",
  };
}

function parseOptionalNonNegative(value: string, field: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n < 0) throw new Error(`${field} deve ser maior ou igual a zero.`);
  return n;
}

export function validateInventoryItemForm(form: InventoryItemFormState): InventoryItemFormErrors {
  const errors: InventoryItemFormErrors = {};
  if (!form.code.trim()) errors.code = "Código é obrigatório.";
  if (!form.description.trim()) errors.description = "Descrição é obrigatória.";
  if (!form.itemType) errors.itemType = "Tipo do item é obrigatório.";
  if (!form.unit.trim()) errors.unit = "Unidade é obrigatória.";
  if (form.defaultLocationId.trim() && !form.defaultWarehouseId.trim()) {
    errors.defaultLocationId = "Informe o almoxarifado padrão ao definir o endereço padrão.";
  }

  try {
    parseOptionalNonNegative(form.minimumStock, "Estoque mínimo");
    parseOptionalNonNegative(form.maximumStock, "Estoque máximo");
    parseOptionalNonNegative(form.reorderPoint, "Ponto de reposição");
    parseOptionalNonNegative(form.averageCost, "Custo médio");
    parseOptionalNonNegative(form.lastKnownCost, "Último custo");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Valor numérico inválido.";
    if (msg.includes("mínimo")) errors.minimumStock = msg;
    else if (msg.includes("máximo")) errors.maximumStock = msg;
    else if (msg.includes("reposição")) errors.reorderPoint = msg;
    else if (msg.includes("médio")) errors.averageCost = msg;
    else if (msg.includes("Último")) errors.lastKnownCost = msg;
  }

  return errors;
}

export function isInventoryItemFormValid(form: InventoryItemFormState): boolean {
  return Object.keys(validateInventoryItemForm(form)).length === 0;
}

export function inventoryItemFormToPayload(form: InventoryItemFormState) {
  const minimumStock = parseOptionalNonNegative(form.minimumStock, "Estoque mínimo");
  const maximumStock = parseOptionalNonNegative(form.maximumStock, "Estoque máximo");
  const reorderPoint = parseOptionalNonNegative(form.reorderPoint, "Ponto de reposição");
  const averageCost = parseOptionalNonNegative(form.averageCost, "Custo médio");
  const lastKnownCost = parseOptionalNonNegative(form.lastKnownCost, "Último custo");

  return {
    code: form.code.trim(),
    description: form.description.trim(),
    itemType: form.itemType as InventoryItemType,
    unit: form.unit.trim(),
    status: form.status,
    family: form.family.trim() || null,
    group: form.group.trim() || null,
    controlsLot: form.controlsLot,
    controlsExpiration: form.controlsExpiration,
    controlsLocation: form.controlsLocation,
    controlsQuality: form.controlsQuality,
    minimumStock,
    maximumStock,
    reorderPoint,
    preferredSupplierName: form.preferredSupplierName.trim() || null,
    averageCost,
    lastKnownCost,
    nomusProductCode: form.nomusProductCode.trim() || null,
    notes: form.notes.trim() || null,
    defaultWarehouseId: form.defaultWarehouseId.trim() || null,
    defaultLocationId: form.defaultLocationId.trim() || null,
  };
}

/** Espelho do contrato GET /api/inventory/items/default-warehouse-policy. */
export type InventoryItemDefaultWarehousePolicyDto = {
  itemType: string;
  mode: "OFFICIAL_LINK" | "PRESENCE" | "SECTOR_FIXED" | "SECTOR_CHOICE" | "FREE";
  options: {
    sectorId: string;
    sectorCode: string;
    sectorName: string;
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
  }[];
  defaultWarehouseId: string | null;
  locked: boolean;
  editable: boolean;
};

/**
 * Aplica a política ao formulário: SECTOR_FIXED preenche (e o campo fica travado);
 * SECTOR_CHOICE limpa um almoxarifado fora das opções; OFFICIAL_LINK limpa tudo.
 * Endereço só sobrevive se o almoxarifado não mudou.
 */
export function applyDefaultWarehousePolicyToForm(
  form: InventoryItemFormState,
  policy: InventoryItemDefaultWarehousePolicyDto
): InventoryItemFormState {
  let warehouseId = form.defaultWarehouseId;
  if (policy.mode === "SECTOR_FIXED") {
    warehouseId = policy.defaultWarehouseId ?? "";
  } else if (policy.mode === "SECTOR_CHOICE") {
    if (warehouseId && !policy.options.some((o) => o.warehouseId === warehouseId)) warehouseId = "";
  } else if (policy.mode === "OFFICIAL_LINK") {
    warehouseId = "";
  }
  if (warehouseId === form.defaultWarehouseId) return form;
  return { ...form, defaultWarehouseId: warehouseId, defaultLocationId: "" };
}

/** Texto de apoio do campo "Almoxarifado padrão" conforme a política. */
export function describeDefaultWarehousePolicy(
  policy: InventoryItemDefaultWarehousePolicyDto | null
): string | null {
  if (!policy) return null;
  switch (policy.mode) {
    case "SECTOR_FIXED": {
      const o = policy.options[0];
      return `Definido pelo setor de conferência ${o.sectorCode}: itens deste tipo são contados no almoxarifado ${o.warehouseCode}.`;
    }
    case "SECTOR_CHOICE":
      return `Este tipo tem mais de um setor de conferência: escolha o almoxarifado (${policy.options
        .map((o) => o.warehouseCode)
        .join(", ")}).`;
    case "OFFICIAL_LINK":
      return "Matéria-prima: o almoxarifado padrão é definido no vínculo com a MP oficial.";
    case "PRESENCE":
      return "Opcional. Componentes e produtos acabados são conferidos pelos almoxarifados onde têm saldo.";
    case "FREE":
      return "Opcional. Sem setor de conferência configurado para este tipo: o item só entra na conferência do tablet quando tiver almoxarifado padrão ou saldo.";
  }
}

/** Garante que payload de item nunca inclui campos de saldo. */
export const INVENTORY_BALANCE_FIELD_KEYS = [
  "physicalQuantity",
  "reservedQuantity",
  "blockedQuantity",
  "quarantineQuantity",
  "availableQuantity",
  "balance",
  "saldo",
] as const;

export function assertNoBalanceFieldsInPayload(payload: Record<string, unknown>): void {
  for (const key of INVENTORY_BALANCE_FIELD_KEYS) {
    if (key in payload) {
      throw new Error(`Campo de saldo não permitido no cadastro: ${key}`);
    }
  }
}
