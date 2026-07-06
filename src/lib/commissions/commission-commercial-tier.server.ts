/**
 * Carrega faixas comerciais publicadas (Formação de Preço) para enquadramento de comissão.
 */
import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "../financeCivilDate.js";
import { decimalToNumber } from "./commission-money.js";
import {
  COMMERCIAL_PRICE_TIER_CODES,
  type CommercialPriceTierRow,
} from "./commission-commercial-tier.js";

export type CommercialTierLoadResult =
  | { ok: true; tiers: CommercialPriceTierRow[] }
  | { ok: false; code: "NO_COMMERCIAL_PRICE_TABLE"; missingCodes: string[] };

export class CommercialTierCache {
  private readonly cache = new Map<string, CommercialTierLoadResult>();

  constructor(private readonly db: PrismaClient) {}

  private cacheKey(productId: string, referenceDate: Date): string {
    return `${productId}|${toCivilDateKey(referenceDate) ?? referenceDate.toISOString().slice(0, 10)}`;
  }

  async get(productId: string, referenceDate: Date): Promise<CommercialTierLoadResult> {
    const key = this.cacheKey(productId, referenceDate);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const loaded = await loadCommercialPriceTiersForProduct(this.db, productId, referenceDate);
    this.cache.set(key, loaded);
    return loaded;
  }
}

export async function loadCommercialPriceTiersForProduct(
  db: Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem">,
  productId: string,
  referenceDate: Date
): Promise<CommercialTierLoadResult> {
  const tables = await db.priceTable.findMany({
    where: { code: { in: [...COMMERCIAL_PRICE_TIER_CODES] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });

  const tableByCode = new Map(tables.map((t) => [t.code, t]));
  const missingCodes = COMMERCIAL_PRICE_TIER_CODES.filter((code) => !tableByCode.has(code));
  if (missingCodes.length > 0) {
    return { ok: false, code: "NO_COMMERCIAL_PRICE_TABLE", missingCodes: [...missingCodes] };
  }

  const tiers: CommercialPriceTierRow[] = [];

  for (const code of COMMERCIAL_PRICE_TIER_CODES) {
    const table = tableByCode.get(code)!;
    const publishedVersion = await db.priceTableVersion.findFirst({
      where: {
        priceTableId: table.id,
        status: "PUBLISHED",
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: referenceDate } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: referenceDate } }] },
        ],
      },
      orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }, { versionNumber: "desc" }],
      select: { id: true },
    });

    if (!publishedVersion) {
      return { ok: false, code: "NO_COMMERCIAL_PRICE_TABLE", missingCodes: [code] };
    }

    const item = await db.priceTableItem.findUnique({
      where: {
        priceTableVersionId_productId: {
          priceTableVersionId: publishedVersion.id,
          productId,
        },
      },
      select: { salePrice: true, commissionPerc: true },
    });

    if (!item) {
      return { ok: false, code: "NO_COMMERCIAL_PRICE_TABLE", missingCodes: [code] };
    }

    tiers.push({
      code,
      name: table.name,
      salePrice: decimalToNumber(item.salePrice),
      commissionPercent: decimalToNumber(item.commissionPerc),
    });
  }

  return { ok: true, tiers };
}
