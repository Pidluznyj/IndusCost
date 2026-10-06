/**
 * Domínio puro de InventoryStockSector — sem Prisma.
 * Normalização e regras usadas pelo service e pelos testes.
 */
import { COLLECTOR_SECTORS } from "./collector/collectorSectorContract.js";
import {
  INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES,
  INVENTORY_ITEM_TYPES,
  InventoryValidationError,
  type InventoryItemType,
} from "./inventoryTypes.js";

export const INVENTORY_STOCK_SECTOR_STRATEGIES = [
  "STANDARD",
  "RAW_MATERIAL",
  "PRODUCT",
] as const;

export type InventoryStockSectorStrategyCode =
  (typeof INVENTORY_STOCK_SECTOR_STRATEGIES)[number];

export const INVENTORY_STOCK_SECTOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type InventoryStockSectorStatusCode =
  (typeof INVENTORY_STOCK_SECTOR_STATUSES)[number];

/** Nesta entrega o CRUD administrativo só cria/edita STANDARD. */
export const INVENTORY_STOCK_SECTOR_USER_STRATEGIES = ["STANDARD"] as const;

export const STOCK_SECTOR_NOT_FOUND = "STOCK_SECTOR_NOT_FOUND";
export const STOCK_SECTOR_CODE_DUPLICATE = "STOCK_SECTOR_CODE_DUPLICATE";
export const STOCK_SECTOR_SLUG_DUPLICATE = "STOCK_SECTOR_SLUG_DUPLICATE";
export const STOCK_SECTOR_PREFIX_DUPLICATE = "STOCK_SECTOR_PREFIX_DUPLICATE";
export const STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE = "STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE";
export const STOCK_SECTOR_WAREHOUSE_INACTIVE = "STOCK_SECTOR_WAREHOUSE_INACTIVE";
export const STOCK_SECTOR_STRATEGY_NOT_ALLOWED = "STOCK_SECTOR_STRATEGY_NOT_ALLOWED";
export const STOCK_SECTOR_ITEM_TYPE_REQUIRED = "STOCK_SECTOR_ITEM_TYPE_REQUIRED";
export const STOCK_SECTOR_LEGACY_RESERVED = "STOCK_SECTOR_LEGACY_RESERVED";
export const STOCK_SECTOR_COST_CENTER_REQUIRED = "STOCK_SECTOR_COST_CENTER_REQUIRED";
export const STOCK_SECTOR_COST_CENTER_INVALID = "STOCK_SECTOR_COST_CENTER_INVALID";
export const STOCK_SECTOR_HAS_ACTIVE_SESSION = "STOCK_SECTOR_HAS_ACTIVE_SESSION";

/**
 * itemTypes dos setores legados do Collector (MP/CP/PA). Têm fluxo próprio
 * (cold-start, materialId, productId) e nunca viram setor STANDARD.
 */
export const STOCK_SECTOR_LEGACY_ITEM_TYPES: ReadonlySet<InventoryItemType> = new Set([
  "RAW_MATERIAL",
  "COMPONENT",
  "FINISHED_PRODUCT",
]);

/** itemTypes que um setor STANDARD pode atender. */
export const INVENTORY_STOCK_SECTOR_STANDARD_ITEM_TYPES: readonly InventoryItemType[] =
  INVENTORY_ITEM_TYPES.filter((type) => !STOCK_SECTOR_LEGACY_ITEM_TYPES.has(type));

/**
 * O motor de movimentos exige centro de custo nas saídas destes tipos — inclusive
 * no ajuste negativo de contagem. O setor precisa então de um centro de custo padrão.
 */
export function stockSectorRequiresCostCenter(
  itemType: InventoryItemType | null | undefined
): boolean {
  return itemType != null && INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES.has(itemType);
}

export function assertStockSectorCostCenter(
  itemType: InventoryItemType | null | undefined,
  defaultCostCenterId: string | null | undefined
): void {
  if (stockSectorRequiresCostCenter(itemType) && !defaultCostCenterId) {
    throw new InventoryValidationError(
      "Este tipo de item exige centro de custo nas saídas: informe o centro de custo padrão do setor.",
      STOCK_SECTOR_COST_CENTER_REQUIRED
    );
  }
}

const LEGACY_PREFIXES = new Set<string>(
  Object.values(COLLECTOR_SECTORS).map((s) => s.sessionCodePrefix.toUpperCase())
);
const LEGACY_CODES = new Set<string>(Object.keys(COLLECTOR_SECTORS));
const LEGACY_SLUGS = new Set<string>(Object.values(COLLECTOR_SECTORS).map((s) => s.slug));

/** Código: uppercase, underscores, alfanumérico; sem espaços. */
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Slug URL-safe lowercase. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Prefixo de sessão Collector: 2 a 4 letras A–Z (ex.: AD, ADM). */
const PREFIX_RE = /^[A-Z]{2,4}$/;

export function normalizeStockSectorCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

export function normalizeStockSectorSlug(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeStockSectorPrefix(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function assertValidStockSectorCode(code: string): string {
  if (!CODE_RE.test(code)) {
    throw new InventoryValidationError(
      "code inválido: use letras/números/underscore, começando por letra (ex.: ADMINISTRATIVO).",
      "INVALID_STOCK_SECTOR_CODE"
    );
  }
  if (LEGACY_CODES.has(code)) {
    throw new InventoryValidationError(
      "code reservado aos setores legados do Collector.",
      STOCK_SECTOR_LEGACY_RESERVED
    );
  }
  return code;
}

export function assertValidStockSectorSlug(slug: string): string {
  if (!slug || !SLUG_RE.test(slug) || slug.length > 80) {
    throw new InventoryValidationError(
      "slug inválido: use lowercase URL-safe (ex.: administrativo).",
      "INVALID_STOCK_SECTOR_SLUG"
    );
  }
  if (LEGACY_SLUGS.has(slug)) {
    throw new InventoryValidationError(
      "slug reservado aos setores legados do Collector.",
      STOCK_SECTOR_LEGACY_RESERVED
    );
  }
  return slug;
}

export function assertValidStockSectorPrefix(prefix: string): string {
  if (!PREFIX_RE.test(prefix)) {
    throw new InventoryValidationError(
      "sessionCodePrefix deve ter de 2 a 4 letras maiúsculas (ex.: ADM).",
      "INVALID_STOCK_SECTOR_PREFIX"
    );
  }
  if (LEGACY_PREFIXES.has(prefix)) {
    throw new InventoryValidationError(
      "sessionCodePrefix reservado aos setores legados (MP/CP/PA).",
      STOCK_SECTOR_LEGACY_RESERVED
    );
  }
  return prefix;
}

export function assertValidStockSectorItemType(raw: unknown): InventoryItemType {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(value)) {
    throw new InventoryValidationError("itemType inválido.", "INVALID_ITEM_TYPE");
  }
  if (STOCK_SECTOR_LEGACY_ITEM_TYPES.has(value as InventoryItemType)) {
    throw new InventoryValidationError(
      "Matéria-prima, Componentes e Produto acabado têm fluxo próprio no Collector e não podem virar setor configurável.",
      STOCK_SECTOR_LEGACY_RESERVED
    );
  }
  return value as InventoryItemType;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** null / "" → sem centro de custo; qualquer outra coisa precisa ser UUID. */
export function normalizeStockSectorCostCenterId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!UUID_RE.test(value)) {
    throw new InventoryValidationError(
      "Centro de custo inválido.",
      STOCK_SECTOR_COST_CENTER_INVALID
    );
  }
  return value;
}

export function assertUserAllowedStrategy(
  strategy: string
): InventoryStockSectorStrategyCode {
  if (!(INVENTORY_STOCK_SECTOR_STRATEGIES as readonly string[]).includes(strategy)) {
    throw new InventoryValidationError("strategy inválida.", "INVALID_STOCK_SECTOR_STRATEGY");
  }
  if (!(INVENTORY_STOCK_SECTOR_USER_STRATEGIES as readonly string[]).includes(strategy)) {
    throw new InventoryValidationError(
      "Nesta entrega só é permitido cadastrar setores com strategy=STANDARD.",
      STOCK_SECTOR_STRATEGY_NOT_ALLOWED
    );
  }
  return strategy as InventoryStockSectorStrategyCode;
}

export function assertStandardRequiresItemType(
  strategy: InventoryStockSectorStrategyCode,
  itemType: InventoryItemType | null | undefined
): InventoryItemType {
  if (strategy === "STANDARD" && !itemType) {
    throw new InventoryValidationError(
      "itemType é obrigatório para strategy=STANDARD.",
      STOCK_SECTOR_ITEM_TYPE_REQUIRED
    );
  }
  if (!itemType) {
    throw new InventoryValidationError(
      "itemType é obrigatório.",
      STOCK_SECTOR_ITEM_TYPE_REQUIRED
    );
  }
  return itemType;
}

export type NormalizedCreateStockSectorInput = {
  code: string;
  name: string;
  slug: string;
  warehouseId: string;
  strategy: InventoryStockSectorStrategyCode;
  itemType: InventoryItemType;
  sessionCodePrefix: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  status: InventoryStockSectorStatusCode;
  defaultCostCenterId: string | null;
};

export function normalizeCreateStockSectorFields(
  input: {
    code: unknown;
    name: unknown;
    slug: unknown;
    warehouseId: unknown;
    strategy?: unknown;
    itemType: unknown;
    sessionCodePrefix: unknown;
    allowsCounting?: unknown;
    allowsWithdrawal?: unknown;
    status?: unknown;
    defaultCostCenterId?: unknown;
  },
  /** true quando o almoxarifado será criado junto com o setor (ainda sem id). */
  opts: { warehouseCreatedWithSector?: boolean } = {}
): NormalizedCreateStockSectorInput {
  const code = assertValidStockSectorCode(normalizeStockSectorCode(input.code));
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new InventoryValidationError("name é obrigatório.", "FIELD_REQUIRED");
  }
  const slug = assertValidStockSectorSlug(normalizeStockSectorSlug(input.slug));
  const warehouseId = opts.warehouseCreatedWithSector
    ? ""
    : String(input.warehouseId ?? "").trim();
  if (!warehouseId && !opts.warehouseCreatedWithSector) {
    throw new InventoryValidationError("warehouseId é obrigatório.", "FIELD_REQUIRED");
  }
  const strategy = assertUserAllowedStrategy(
    String(input.strategy ?? "STANDARD").trim().toUpperCase() || "STANDARD"
  );
  const itemType = assertStandardRequiresItemType(
    strategy,
    assertValidStockSectorItemType(input.itemType)
  );
  const sessionCodePrefix = assertValidStockSectorPrefix(
    normalizeStockSectorPrefix(input.sessionCodePrefix)
  );
  const statusRaw = String(input.status ?? "ACTIVE").trim().toUpperCase();
  if (!(INVENTORY_STOCK_SECTOR_STATUSES as readonly string[]).includes(statusRaw)) {
    throw new InventoryValidationError("status inválido.", "INVALID_STATUS");
  }
  const defaultCostCenterId = normalizeStockSectorCostCenterId(input.defaultCostCenterId);
  assertStockSectorCostCenter(itemType, defaultCostCenterId);
  return {
    defaultCostCenterId,
    code,
    name,
    slug,
    warehouseId,
    strategy,
    itemType,
    sessionCodePrefix,
    allowsCounting: !(input.allowsCounting === false || input.allowsCounting === "false"),
    allowsWithdrawal: input.allowsWithdrawal === true || input.allowsWithdrawal === "true",
    status: statusRaw as InventoryStockSectorStatusCode,
  };
}
