/**
 * Parse de payloads HTTP de InventoryStockSector — sem Prisma.
 */
import { InventoryValidationError } from "./inventoryTypes.js";
import {
  parseCreateInventoryWarehouseBody,
  type CreateInventoryWarehouseInput,
} from "./inventoryValidation.js";
import {
  normalizeStockSectorCostCenterId,
  normalizeCreateStockSectorFields,
  normalizeStockSectorCode,
  normalizeStockSectorPrefix,
  normalizeStockSectorSlug,
  assertUserAllowedStrategy,
  assertValidStockSectorCode,
  assertValidStockSectorItemType,
  assertValidStockSectorPrefix,
  assertValidStockSectorSlug,
  INVENTORY_STOCK_SECTOR_STATUSES,
  type InventoryStockSectorStatusCode,
  type NormalizedCreateStockSectorInput,
} from "./inventoryStockSectorDomain.js";

function asRecord(body: unknown): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

export function parseCreateInventoryStockSectorBody(
  body: unknown
): NormalizedCreateStockSectorInput {
  const data = asRecord(body);
  return normalizeCreateStockSectorFields({
    code: data.code,
    name: data.name,
    slug: data.slug,
    warehouseId: data.warehouseId,
    strategy: data.strategy,
    itemType: data.itemType,
    sessionCodePrefix: data.sessionCodePrefix,
    allowsCounting: data.allowsCounting,
    allowsWithdrawal: data.allowsWithdrawal,
    status: data.status,
    defaultCostCenterId: data.defaultCostCenterId,
  });
}

/** true quando o corpo pede para criar o almoxarifado junto com o setor. */
export function hasNewWarehouseInStockSectorBody(body: unknown): boolean {
  const value = asRecord(body).newWarehouse;
  return value != null && typeof value === "object";
}

export type CreateStockSectorWithWarehouseInput = {
  sector: NormalizedCreateStockSectorInput;
  newWarehouse: CreateInventoryWarehouseInput;
};

/**
 * Setor + almoxarifado novo na mesma operação. O almoxarifado passa pelo parser
 * canônico de InventoryWarehouse e nasce sempre ACTIVE e aceitando movimentações
 * (um setor só pode apontar para almoxarifado ativo). warehouseId do corpo é
 * recusado: ou existente, ou novo — nunca os dois.
 */
export function parseCreateInventoryStockSectorWithWarehouseBody(
  body: unknown
): CreateStockSectorWithWarehouseInput {
  const data = asRecord(body);
  if (String(data.warehouseId ?? "").trim()) {
    throw new InventoryValidationError(
      "Informe um almoxarifado existente OU os dados de um novo, não os dois.",
      "STOCK_SECTOR_WAREHOUSE_AMBIGUOUS"
    );
  }
  const rawWarehouse = asRecord(data.newWarehouse);
  const newWarehouse = parseCreateInventoryWarehouseBody({
    code: String(rawWarehouse.code ?? "").trim().toUpperCase(),
    name: rawWarehouse.name,
    description: rawWarehouse.description,
    status: "ACTIVE",
    allowsMovements: true,
  });
  const sector = normalizeCreateStockSectorFields(
    {
      code: data.code,
      name: data.name,
      slug: data.slug,
      warehouseId: "",
      strategy: data.strategy,
      itemType: data.itemType,
      sessionCodePrefix: data.sessionCodePrefix,
      allowsCounting: data.allowsCounting,
      allowsWithdrawal: data.allowsWithdrawal,
      status: data.status,
      defaultCostCenterId: data.defaultCostCenterId,
    },
    { warehouseCreatedWithSector: true }
  );
  return { sector, newWarehouse };
}

export type UpdateInventoryStockSectorPatch = {
  name?: string;
  slug?: string;
  warehouseId?: string;
  strategy?: NormalizedCreateStockSectorInput["strategy"];
  itemType?: NormalizedCreateStockSectorInput["itemType"];
  sessionCodePrefix?: string;
  allowsCounting?: boolean;
  allowsWithdrawal?: boolean;
  status?: InventoryStockSectorStatusCode;
  /** null limpa o centro de custo (recusado no service se o itemType o exige). */
  defaultCostCenterId?: string | null;
};

export function parseUpdateInventoryStockSectorBody(
  body: unknown
): UpdateInventoryStockSectorPatch {
  const data = asRecord(body);
  const out: UpdateInventoryStockSectorPatch = {};

  if (data.code !== undefined) {
    throw new InventoryValidationError(
      "code não pode ser alterado após a criação.",
      "STOCK_SECTOR_CODE_IMMUTABLE"
    );
  }
  if (data.name !== undefined) {
    const name = String(data.name ?? "").trim();
    if (!name) throw new InventoryValidationError("name é obrigatório.", "FIELD_REQUIRED");
    out.name = name;
  }
  if (data.slug !== undefined) {
    out.slug = assertValidStockSectorSlug(normalizeStockSectorSlug(data.slug));
  }
  if (data.warehouseId !== undefined) {
    const warehouseId = String(data.warehouseId ?? "").trim();
    if (!warehouseId) {
      throw new InventoryValidationError("warehouseId é obrigatório.", "FIELD_REQUIRED");
    }
    out.warehouseId = warehouseId;
  }
  if (data.strategy !== undefined) {
    out.strategy = assertUserAllowedStrategy(
      String(data.strategy ?? "").trim().toUpperCase()
    );
  }
  if (data.itemType !== undefined) {
    out.itemType = assertValidStockSectorItemType(data.itemType);
  }
  if (data.sessionCodePrefix !== undefined) {
    out.sessionCodePrefix = assertValidStockSectorPrefix(
      normalizeStockSectorPrefix(data.sessionCodePrefix)
    );
  }
  if (data.allowsCounting !== undefined) {
    out.allowsCounting = !(data.allowsCounting === false || data.allowsCounting === "false");
  }
  if (data.allowsWithdrawal !== undefined) {
    out.allowsWithdrawal =
      data.allowsWithdrawal === true || data.allowsWithdrawal === "true";
  }
  if (data.status !== undefined) {
    const status = String(data.status ?? "").trim().toUpperCase();
    if (!(INVENTORY_STOCK_SECTOR_STATUSES as readonly string[]).includes(status)) {
      throw new InventoryValidationError("status inválido.", "INVALID_STATUS");
    }
    out.status = status as InventoryStockSectorStatusCode;
  }
  if (data.defaultCostCenterId !== undefined) {
    out.defaultCostCenterId = normalizeStockSectorCostCenterId(data.defaultCostCenterId);
  }

  if (Object.keys(out).length === 0) {
    throw new InventoryValidationError("Nenhum campo para atualizar.", "EMPTY_PATCH");
  }
  return out;
}

export function parseInventoryStockSectorStatusBody(
  body: unknown
): InventoryStockSectorStatusCode {
  const data = asRecord(body);
  const status = String(data.status ?? "").trim().toUpperCase();
  if (!(INVENTORY_STOCK_SECTOR_STATUSES as readonly string[]).includes(status)) {
    throw new InventoryValidationError("status inválido.", "INVALID_STATUS");
  }
  return status as InventoryStockSectorStatusCode;
}

/** Reexport para testes de code normalizado em isolation. */
export { assertValidStockSectorCode, normalizeStockSectorCode };
