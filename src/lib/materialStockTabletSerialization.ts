/**
 * Serialização enxuta para tablet — sem Prisma client, sem custos.
 */
import {
  isStockLevelConfigured,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";
import {
  resolveMaterialStockStatus,
  type MaterialStockStatus,
} from "./materialStockLevelRules.js";
import type {
  MaterialStockTabletListItem,
  MaterialStockTabletResponsible,
} from "./materialStockTabletTypes.js";

export type MaterialStockTabletDbRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: unknown;
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
  lastStockConferenceAt: Date | string | null;
  lastStockConferenceUserId: string | null;
  stockConferenceVersion: number | null;
  updatedAt: Date | string | null;
};

function decOrNull(value: unknown): number | null {
  if (!isStockLevelConfigured(value)) return null;
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function computeStockStatusForTabletRow(
  row: Pick<
    MaterialStockTabletDbRow,
    "quantity" | "contingencyQuantity" | "minimumQuantity" | "recommendedQuantity"
  >
): MaterialStockStatus {
  return resolveMaterialStockStatus({
    currentQuantity: row.quantity,
    contingencyQuantity: row.contingencyQuantity,
    minimumQuantity: row.minimumQuantity,
    recommendedQuantity: row.recommendedQuantity,
  });
}

/** Campos proibidos no payload do operador. */
export const MATERIAL_STOCK_TABLET_FORBIDDEN_KEYS = [
  "currentCost",
  "averageCost",
  "standardCost",
  "freight",
  "standardLoss",
  "conversionFactor",
  "calculations",
  "supplier",
  "MaterialPriceHistory",
  "MaterialMarketQuote",
  "ProductBOM",
] as const;

export function serializeMaterialStockTabletListItem(
  row: MaterialStockTabletDbRow,
  responsibleByUserId: Map<string, string>
): MaterialStockTabletListItem {
  const userId = row.lastStockConferenceUserId;
  let lastStockConferenceUser: MaterialStockTabletResponsible | null = null;
  if (userId) {
    lastStockConferenceUser = {
      id: userId,
      name: responsibleByUserId.get(userId) ?? userId,
    };
  }

  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    currentQuantity: roundMaterialStockQuantity(row.quantity) || 0,
    contingencyQuantity: decOrNull(row.contingencyQuantity),
    minimumQuantity: decOrNull(row.minimumQuantity),
    recommendedQuantity: decOrNull(row.recommendedQuantity),
    stockStatus: computeStockStatusForTabletRow(row),
    lastStockConferenceAt: toIso(row.lastStockConferenceAt),
    lastStockConferenceUser,
    stockConferenceVersion:
      Number.isFinite(Number(row.stockConferenceVersion)) &&
      Number(row.stockConferenceVersion) >= 1
        ? Number(row.stockConferenceVersion)
        : 1,
    updatedAt: toIso(row.updatedAt),
  };
}

export function assertNoCostLeakInTabletItem(item: Record<string, unknown>): string[] {
  const leaks: string[] = [];
  for (const key of MATERIAL_STOCK_TABLET_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      leaks.push(key);
    }
  }
  return leaks;
}
