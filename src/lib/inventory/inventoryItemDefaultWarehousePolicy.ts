/**
 * Política de almoxarifado padrão do InventoryItem — regra pura, sem I/O.
 *
 * O cadastro e a conferência do Collector precisam usar critérios compatíveis:
 * o motor STANDARD (collectorStandardSector.server.ts) só enxerga um item sem
 * saldo quando `defaultWarehouseId` é o almoxarifado do setor configurado para
 * o itemType (InventoryStockSector, strategy STANDARD, ACTIVE). Esta política
 * deriva, do mesmo cadastro de setores, qual almoxarifado um item pode (ou deve)
 * ter como padrão — nada fica fixo no código (nenhum código de almoxarifado).
 *
 * Modos:
 * - OFFICIAL_LINK  — RAW_MATERIAL: o escopo padrão é do vínculo com a MP oficial
 *                    (inventoryMaterialLinkService); este módulo não decide nada.
 * - PRESENCE       — COMPONENT / FINISHED_PRODUCT: fluxos legados por presença
 *                    (saldo). Almoxarifado padrão opcional e livre; nunca automático.
 * - SECTOR_FIXED   — exatamente um setor STANDARD ativo para o tipo: o padrão é
 *                    o almoxarifado desse setor; omitido → preenchido; diferente → recusado.
 * - SECTOR_CHOICE  — mais de um setor STANDARD ativo para o tipo: o padrão é
 *                    obrigatório e precisa ser o almoxarifado de um desses setores.
 * - FREE           — tipo sem setor STANDARD: opcional, qualquer almoxarifado ativo.
 */
import type { InventoryItemType } from "./inventoryTypes.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export const DEFAULT_WAREHOUSE_REQUIRED_FOR_SECTOR = "DEFAULT_WAREHOUSE_REQUIRED_FOR_SECTOR";
export const DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR =
  "DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR";
export const DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK =
  "DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK";

/** Tipos cujo escopo padrão é do vínculo oficial (Nomus / Suprimentos). */
const OFFICIAL_LINK_ITEM_TYPES: ReadonlySet<InventoryItemType> = new Set(["RAW_MATERIAL"]);
/** Tipos dos setores legados do Collector por presença (productId + saldo). */
const PRESENCE_ITEM_TYPES: ReadonlySet<InventoryItemType> = new Set([
  "COMPONENT",
  "FINISHED_PRODUCT",
]);

export type ItemDefaultWarehousePolicyMode =
  | "OFFICIAL_LINK"
  | "PRESENCE"
  | "SECTOR_FIXED"
  | "SECTOR_CHOICE"
  | "FREE";

/** Setor STANDARD ativo do tipo, com o almoxarifado que ele conta. */
export type StandardSectorWarehouseOption = {
  sectorId: string;
  sectorCode: string;
  sectorName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
};

export type ItemDefaultWarehousePolicy = {
  itemType: InventoryItemType;
  mode: ItemDefaultWarehousePolicyMode;
  /** Almoxarifados autorizados pelos setores (vazio em OFFICIAL_LINK / PRESENCE / FREE). */
  options: StandardSectorWarehouseOption[];
  /** Preenchido automaticamente quando o cliente não informa (só SECTOR_FIXED). */
  defaultWarehouseId: string | null;
  /** true quando o cliente não pode escolher outro almoxarifado. */
  locked: boolean;
  /** true quando o cadastro pode receber almoxarifado padrão por esta ficha. */
  editable: boolean;
};

export function resolveItemDefaultWarehousePolicy(
  itemType: InventoryItemType,
  activeStandardSectors: readonly StandardSectorWarehouseOption[]
): ItemDefaultWarehousePolicy {
  if (OFFICIAL_LINK_ITEM_TYPES.has(itemType)) {
    return {
      itemType,
      mode: "OFFICIAL_LINK",
      options: [],
      defaultWarehouseId: null,
      locked: true,
      editable: false,
    };
  }
  if (PRESENCE_ITEM_TYPES.has(itemType)) {
    return {
      itemType,
      mode: "PRESENCE",
      options: [],
      defaultWarehouseId: null,
      locked: false,
      editable: true,
    };
  }
  // Um setor por almoxarifado: dois setores no mesmo almoxarifado contam o mesmo lugar.
  const byWarehouse = new Map<string, StandardSectorWarehouseOption>();
  for (const sector of activeStandardSectors) {
    if (!byWarehouse.has(sector.warehouseId)) byWarehouse.set(sector.warehouseId, sector);
  }
  const options = [...byWarehouse.values()].sort((a, b) =>
    a.sectorCode.localeCompare(b.sectorCode, "pt-BR")
  );
  if (options.length === 0) {
    return { itemType, mode: "FREE", options, defaultWarehouseId: null, locked: false, editable: true };
  }
  if (options.length === 1) {
    return {
      itemType,
      mode: "SECTOR_FIXED",
      options,
      defaultWarehouseId: options[0].warehouseId,
      locked: true,
      editable: true,
    };
  }
  return {
    itemType,
    mode: "SECTOR_CHOICE",
    options,
    defaultWarehouseId: null,
    locked: false,
    editable: true,
  };
}

/**
 * Almoxarifado padrão efetivo segundo a política: devolve o id a gravar
 * (inclusive o preenchimento automático) ou lança InventoryValidationError.
 * Não consulta existência/status do almoxarifado — isso é do resolvedor server.
 */
export function applyItemDefaultWarehousePolicy(
  policy: ItemDefaultWarehousePolicy,
  requestedWarehouseId: string | null
): string | null {
  const requested = requestedWarehouseId?.trim() || null;
  switch (policy.mode) {
    case "OFFICIAL_LINK":
      if (requested) {
        throw new InventoryValidationError(
          "Matéria-prima: o almoxarifado padrão é definido no vínculo com a MP oficial.",
          DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK
        );
      }
      return null;
    case "PRESENCE":
    case "FREE":
      return requested;
    case "SECTOR_FIXED": {
      const fixed = policy.defaultWarehouseId;
      if (!requested) return fixed;
      if (requested !== fixed) {
        const option = policy.options[0];
        throw new InventoryValidationError(
          `Itens do tipo ${policy.itemType} são conferidos pelo setor ${option.sectorCode}: o almoxarifado padrão precisa ser ${option.warehouseCode}.`,
          DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR
        );
      }
      return requested;
    }
    case "SECTOR_CHOICE": {
      if (!requested) {
        throw new InventoryValidationError(
          `Itens do tipo ${policy.itemType} têm mais de um setor de conferência: informe o almoxarifado padrão (${policy.options
            .map((option) => option.warehouseCode)
            .join(", ")}).`,
          DEFAULT_WAREHOUSE_REQUIRED_FOR_SECTOR
        );
      }
      if (!policy.options.some((option) => option.warehouseId === requested)) {
        throw new InventoryValidationError(
          `O almoxarifado padrão precisa ser o de um setor de conferência do tipo ${policy.itemType} (${policy.options
            .map((option) => option.warehouseCode)
            .join(", ")}).`,
          DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR
        );
      }
      return requested;
    }
  }
}
