/**
 * Tipos e resolução pura de custo de produção versionado (sem Prisma).
 * Separado de formação de preço comercial (PriceTable*).
 */
import { startOfCivilDate } from "./financeCivilDate.js";

export const PRODUCTION_COST_TABLE_VERSION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;

export type ProductionCostTableVersionStatus =
  (typeof PRODUCTION_COST_TABLE_VERSION_STATUSES)[number];

export const PRODUCTION_COST_TABLE_EDITABLE_STATUS: ProductionCostTableVersionStatus = "DRAFT";

export const PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES: ProductionCostTableVersionStatus[] = [
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
];

/** Versões cujos itens podem alimentar o resolver de custo vigente. */
export const PRODUCTION_COST_TABLE_RESOLVER_STATUSES: ProductionCostTableVersionStatus[] = [
  "PUBLISHED",
  "SUPERSEDED",
];

export type ProductionCostBreakdown = {
  materialCost: number;
  processCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  otherCost: number;
};

export type ProductionCostTableVersionSnapshot = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: ProductionCostTableVersionStatus;
  revision: number;
  publishedAt: Date | null;
  createdAt: Date;
};

export type ProductionCostTableItemSnapshot = {
  id: string;
  costTableVersionId: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: number;
  currency: string;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
  breakdown: ProductionCostBreakdown;
};

export type ProductionCostTableVersionWithItems = ProductionCostTableVersionSnapshot & {
  items: ProductionCostTableItemSnapshot[];
};

export type EffectiveProductProductionCostOk = {
  status: "OK";
  productId: string;
  unitProductionCost: number;
  costTableVersionId: string;
  costTableItemId: string;
  effectiveDate: Date;
  versionName: string;
  versionCode: string;
  revision: number;
  publishedAt: Date | null;
  currency: string;
  breakdown: ProductionCostBreakdown;
  calculationSnapshot: unknown;
};

export type EffectiveProductProductionCostMissing = {
  status: "SEM_CUSTO";
  productId: string;
  referenceDate: Date;
};

export type EffectiveProductProductionCostResult =
  | EffectiveProductProductionCostOk
  | EffectiveProductProductionCostMissing;

export type ProductionCostTableDraftItemInput = {
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: number;
  materialCost?: number;
  processCost?: number;
  laborCost?: number;
  machineCost?: number;
  overheadCost?: number;
  otherCost?: number;
  currency?: string;
  calculationHash?: string | null;
  calculationSnapshot?: unknown;
};

export function isProductionCostTableVersionEditable(
  status: ProductionCostTableVersionStatus
): boolean {
  return status === PRODUCTION_COST_TABLE_EDITABLE_STATUS;
}

export function assertProductionCostTableVersionEditable(
  status: ProductionCostTableVersionStatus,
  action = "alterar"
): void {
  if (!isProductionCostTableVersionEditable(status)) {
    throw new Error(
      `Versão ${status} é imutável — não é permitido ${action}. Crie nova revisão DRAFT.`
    );
  }
}

export function assertNonNegativeProductionUnitCost(value: number, label = "unitProductionCost"): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} deve ser um número finito >= 0.`);
  }
}

export function assertPositiveProductionUnitCost(value: number, label = "unitProductionCost"): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} deve ser um número finito > 0 para publicação.`);
  }
}

function toTime(value: Date | null | undefined): number {
  if (!value) return 0;
  const t = value.getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Retorna > 0 se `candidate` é mais recente que `incumbent` para resolver custo vigente. */
export function compareProductionCostTableVersionsForResolver(
  candidate: ProductionCostTableVersionSnapshot,
  incumbent: ProductionCostTableVersionSnapshot
): number {
  const effectiveDiff = toTime(candidate.effectiveDate) - toTime(incumbent.effectiveDate);
  if (effectiveDiff !== 0) return effectiveDiff;

  const publishedDiff = toTime(candidate.publishedAt) - toTime(incumbent.publishedAt);
  if (publishedDiff !== 0) return publishedDiff;

  const revisionDiff = candidate.revision - incumbent.revision;
  if (revisionDiff !== 0) return revisionDiff;

  return toTime(candidate.createdAt) - toTime(incumbent.createdAt);
}

function isVersionEligibleForResolver(
  version: ProductionCostTableVersionSnapshot,
  referenceDate: Date
): boolean {
  if (!PRODUCTION_COST_TABLE_RESOLVER_STATUSES.includes(version.status)) return false;
  const ref = startOfCivilDate(referenceDate);
  const effective = startOfCivilDate(version.effectiveDate);
  return effective.getTime() <= ref.getTime();
}

function pickBestItemForProduct(
  versions: ProductionCostTableVersionWithItems[],
  productId: string,
  referenceDate: Date
): { version: ProductionCostTableVersionSnapshot; item: ProductionCostTableItemSnapshot } | null {
  let best: {
    version: ProductionCostTableVersionSnapshot;
    item: ProductionCostTableItemSnapshot;
  } | null = null;

  for (const version of versions) {
    if (!isVersionEligibleForResolver(version, referenceDate)) continue;
    const item = version.items.find((row) => row.productId === productId);
    if (!item) continue;
    if (item.unitProductionCost <= 0 || !Number.isFinite(item.unitProductionCost)) continue;

    if (!best || compareProductionCostTableVersionsForResolver(version, best.version) > 0) {
      best = { version, item };
    }
  }

  return best;
}

export function resolveEffectiveProductProductionCostFromCatalog(
  versions: ProductionCostTableVersionWithItems[],
  productId: string,
  referenceDate: Date
): EffectiveProductProductionCostResult {
  const ref = startOfCivilDate(referenceDate);
  const picked = pickBestItemForProduct(versions, productId, ref);
  if (!picked) {
    return { status: "SEM_CUSTO", productId, referenceDate: ref };
  }

  const { version, item } = picked;
  return {
    status: "OK",
    productId,
    unitProductionCost: item.unitProductionCost,
    costTableVersionId: version.id,
    costTableItemId: item.id,
    effectiveDate: startOfCivilDate(version.effectiveDate),
    versionName: version.name,
    versionCode: version.code,
    revision: version.revision,
    publishedAt: version.publishedAt,
    currency: item.currency,
    breakdown: item.breakdown,
    calculationSnapshot: item.calculationSnapshot ?? null,
  };
}

export function resolveEffectiveProductProductionCostsFromCatalog(
  versions: ProductionCostTableVersionWithItems[],
  productIds: string[],
  referenceDate: Date
): Map<string, EffectiveProductProductionCostResult> {
  const ref = startOfCivilDate(referenceDate);
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const map = new Map<string, EffectiveProductProductionCostResult>();
  for (const productId of uniqueIds) {
    map.set(
      productId,
      resolveEffectiveProductProductionCostFromCatalog(versions, productId, ref)
    );
  }
  return map;
}

export function nextProductionCostTableRevision(existingMaxRevision: number | null | undefined): number {
  const base = existingMaxRevision ?? 0;
  return base + 1;
}

export function formatProductionCostTableVersionLabel(code: string, revision: number): string {
  return `${code} v${revision}`;
}
