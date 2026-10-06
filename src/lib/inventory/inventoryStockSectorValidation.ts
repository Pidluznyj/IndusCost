/**
 * Parse de payloads HTTP de InventoryStockSector — sem Prisma.
 */
import { InventoryValidationError } from "./inventoryTypes.js";
import {
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
  });
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
