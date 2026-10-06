/**
 * Resolução de setor do Stock Collector.
 *
 * Legado (MP/CP/PA) é resolvido primeiro e SEM banco, pelo contrato fixo de
 * collectorSectorContract — nunca depende de InventoryStockSector.
 * Só o que não é legado consulta InventoryStockSector, e só strategy=STANDARD
 * é aceito. Tudo o mais falha fechado: setor inexistente/inativo, almoxarifado
 * inexistente/inativo, strategy não suportada, STANDARD sem itemType e prefixo
 * de sessão inválido ou reservado ao legado.
 *
 * O cliente manda apenas o slug; quem decide a strategy é o servidor.
 */
import type { InventoryItemType, Prisma } from "@prisma/client";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  COLLECTOR_INVALID_SECTOR,
  COLLECTOR_SECTORS,
  normalizeCollectorSectorInput,
  parseCollectorSector,
  type CollectorSectorCode,
} from "./collectorSectorContract.js";
import {
  COLLECTOR_LEGACY_SESSION_CODE_PREFIXES,
  COLLECTOR_SECTOR_ITEM_TYPE,
  COLLECTOR_SESSION_CODE_PREFIX_RE,
} from "./collectorSessionCompatibility.server.js";

export const COLLECTOR_SECTOR_INACTIVE = "COLLECTOR_SECTOR_INACTIVE";
export const COLLECTOR_SECTOR_WAREHOUSE_INACTIVE = "COLLECTOR_SECTOR_WAREHOUSE_INACTIVE";
export const COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED = "COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED";
export const COLLECTOR_SECTOR_MISCONFIGURED = "COLLECTOR_SECTOR_MISCONFIGURED";
export const COLLECTOR_COUNTING_DENIED = "COLLECTOR_COUNTING_DENIED";
export const COLLECTOR_WITHDRAWAL_DENIED = "COLLECTOR_WITHDRAWAL_DENIED";

export type CollectorSectorCapabilities = {
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
};

export type CollectorLegacySectorRef = {
  kind: "LEGACY";
  code: CollectorSectorCode;
  label: string;
  slug: string;
  sessionCodePrefix: string;
  itemType: InventoryItemType;
  capabilities: CollectorSectorCapabilities;
};

export type CollectorStandardSectorRef = {
  kind: "STANDARD";
  strategy: "STANDARD";
  sectorId: string;
  code: string;
  name: string;
  /** Mesmo valor de name — rótulo exibido, simétrico ao setor legado. */
  label: string;
  slug: string;
  itemType: InventoryItemType;
  sessionCodePrefix: string;
  warehouseId: string;
  warehouse: { id: string; code: string; name: string; status: "ACTIVE" };
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  capabilities: CollectorSectorCapabilities;
};

export type CollectorSectorRef = CollectorLegacySectorRef | CollectorStandardSectorRef;

export function isCollectorStandardSectorRef(
  ref: CollectorSectorRef
): ref is CollectorStandardSectorRef {
  return ref.kind === "STANDARD";
}

export function isCollectorLegacySectorRef(
  ref: CollectorSectorRef
): ref is CollectorLegacySectorRef {
  return ref.kind === "LEGACY";
}

export function toLegacyCollectorSectorRef(code: CollectorSectorCode): CollectorLegacySectorRef {
  const meta = COLLECTOR_SECTORS[code];
  return {
    kind: "LEGACY",
    code,
    label: meta.label,
    slug: meta.slug,
    sessionCodePrefix: meta.sessionCodePrefix,
    itemType: COLLECTOR_SECTOR_ITEM_TYPE[code],
    // Espelha o comportamento atual: os três contam; só Matéria-prima retira.
    capabilities: { allowsCounting: true, allowsWithdrawal: code === "RAW_MATERIAL" },
  };
}

/**
 * Parse legado síncrono (sem DB). null se não for MP/CP/PA.
 * parseCollectorSector segue intacto para os callers legados.
 */
export function tryParseLegacyCollectorSector(raw: unknown): CollectorLegacySectorRef | null {
  try {
    return toLegacyCollectorSectorRef(parseCollectorSector(raw));
  } catch (e: unknown) {
    if (e instanceof InventoryValidationError && e.code === COLLECTOR_INVALID_SECTOR) {
      return null;
    }
    throw e;
  }
}

type SectorResolveDb = Pick<Prisma.TransactionClient, "inventoryStockSector">;

const SECTOR_INCLUDE = {
  warehouse: { select: { id: true, code: true, name: true, status: true } },
} as const;

type StandardSectorRow = {
  id: string;
  code: string;
  name: string;
  slug: string;
  status: string;
  strategy: string;
  itemType: InventoryItemType | null;
  sessionCodePrefix: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  warehouseId: string;
  warehouse: { id: string; code: string; name: string; status: string } | null;
};

function unsupportedSector(): InventoryValidationError {
  return new InventoryValidationError("Setor de contagem não suportado.", COLLECTOR_INVALID_SECTOR);
}

/** Linha de InventoryStockSector → ref STANDARD, ou erro explícito (fail closed). */
export function toStandardCollectorSectorRef(row: StandardSectorRow): CollectorStandardSectorRef {
  if (row.status !== "ACTIVE") {
    throw new InventoryValidationError("Setor de estoque inativo.", COLLECTOR_SECTOR_INACTIVE);
  }
  if (row.strategy !== "STANDARD") {
    throw new InventoryValidationError(
      "Estratégia do setor não suportada pelo Collector.",
      COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED
    );
  }
  if (!row.itemType) {
    throw new InventoryValidationError(
      "Setor sem tipo de item configurado.",
      COLLECTOR_SECTOR_MISCONFIGURED
    );
  }
  const sessionCodePrefix = String(row.sessionCodePrefix ?? "").trim().toUpperCase();
  if (
    !COLLECTOR_SESSION_CODE_PREFIX_RE.test(sessionCodePrefix) ||
    COLLECTOR_LEGACY_SESSION_CODE_PREFIXES.has(sessionCodePrefix)
  ) {
    throw new InventoryValidationError(
      "Setor com prefixo de conferência inválido.",
      COLLECTOR_SECTOR_MISCONFIGURED
    );
  }
  if (!row.warehouse || row.warehouse.id !== row.warehouseId) {
    throw new InventoryValidationError(
      "Almoxarifado do setor não encontrado.",
      COLLECTOR_SECTOR_WAREHOUSE_INACTIVE
    );
  }
  if (row.warehouse.status !== "ACTIVE") {
    throw new InventoryValidationError(
      "Almoxarifado do setor está inativo.",
      COLLECTOR_SECTOR_WAREHOUSE_INACTIVE
    );
  }
  const capabilities = {
    allowsCounting: row.allowsCounting === true,
    allowsWithdrawal: row.allowsWithdrawal === true,
  };
  return {
    kind: "STANDARD",
    strategy: "STANDARD",
    sectorId: row.id,
    code: row.code,
    name: row.name,
    label: row.name,
    slug: row.slug,
    itemType: row.itemType,
    sessionCodePrefix,
    warehouseId: row.warehouseId,
    warehouse: {
      id: row.warehouse.id,
      code: row.warehouse.code,
      name: row.warehouse.name,
      status: "ACTIVE",
    },
    ...capabilities,
    capabilities,
  };
}

/** Resolve setor STANDARD exclusivamente pelo slug do deep-link. */
export async function resolveStandardCollectorSector(
  db: SectorResolveDb,
  slugRaw: unknown
): Promise<CollectorStandardSectorRef> {
  const slug = normalizeCollectorSectorInput(slugRaw);
  if (!slug) {
    throw new InventoryValidationError("Setor obrigatório.", COLLECTOR_INVALID_SECTOR);
  }
  // Slug/código legado nunca cai no STANDARD.
  if (tryParseLegacyCollectorSector(slug)) throw unsupportedSector();
  const row = await db.inventoryStockSector.findUnique({
    where: { slug },
    include: SECTOR_INCLUDE,
  });
  if (!row) throw unsupportedSector();
  return toStandardCollectorSectorRef(row);
}

/**
 * Resolve o setor informado pelo cliente: legado primeiro (sem DB); senão
 * InventoryStockSector pelo slug. Uma consulta, no máximo.
 */
export async function resolveCollectorSectorRef(
  db: SectorResolveDb,
  raw: unknown
): Promise<CollectorSectorRef> {
  const legacy = tryParseLegacyCollectorSector(raw);
  if (legacy) return legacy;
  return resolveStandardCollectorSector(db, raw);
}

export function assertCollectorCountingAllowed(ref: CollectorSectorRef): void {
  if (!ref.capabilities.allowsCounting) {
    throw new InventoryValidationError(
      "Este setor não permite contagem.",
      COLLECTOR_COUNTING_DENIED
    );
  }
}

export function assertCollectorWithdrawalAllowed(ref: CollectorSectorRef): void {
  if (!ref.capabilities.allowsWithdrawal) {
    throw new InventoryValidationError(
      "Este setor não permite retirada.",
      COLLECTOR_WITHDRAWAL_DENIED
    );
  }
}

export function collectorSectorRefLabel(ref: CollectorSectorRef): string {
  return ref.label;
}
