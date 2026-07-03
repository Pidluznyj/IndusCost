/**
 * Tipos e resolução pura de custo de matéria-prima versionado (sem Prisma).
 */
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";

export const MATERIAL_COST_TABLE_VERSION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;

export type MaterialCostTableVersionStatus =
  (typeof MATERIAL_COST_TABLE_VERSION_STATUSES)[number];

export const MATERIAL_COST_TABLE_EDITABLE_STATUS: MaterialCostTableVersionStatus = "DRAFT";

export const MATERIAL_COST_TABLE_IMMUTABLE_STATUSES: MaterialCostTableVersionStatus[] = [
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
];

export const MATERIAL_COST_TABLE_RESOLVER_STATUSES: MaterialCostTableVersionStatus[] = [
  "PUBLISHED",
  "SUPERSEDED",
];

export const MATERIAL_COST_TABLE_ITEM_SOURCES = [
  "CURRENT_MATERIAL",
  "PRICE_HISTORY",
  "MANUAL_ADJUSTMENT",
] as const;

export type MaterialCostTableItemSource = (typeof MATERIAL_COST_TABLE_ITEM_SOURCES)[number];

export type MaterialCostTableVersionSnapshot = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: MaterialCostTableVersionStatus;
  revision: number;
  publishedAt: Date | null;
  createdAt: Date;
};

export type MaterialCostTableItemSnapshot = {
  id: string;
  materialCostTableVersionId: string;
  materialId: string;
  materialCodeSnapshot: string;
  materialDescriptionSnapshot: string;
  unitSnapshot: string;
  currentCostSnapshot: number;
  freightSnapshot: number;
  landedCostSnapshot: number;
  averageCostSnapshot: number | null;
  standardCostSnapshot: number | null;
  standardLossSnapshot: number | null;
  costSource: string;
  warningsJson: unknown;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
};

export type MaterialCostTableVersionWithItems = MaterialCostTableVersionSnapshot & {
  items: MaterialCostTableItemSnapshot[];
};

export type EffectiveMaterialCostOk = {
  status: "OK";
  materialId: string;
  landedCostSnapshot: number;
  currentCostSnapshot: number;
  freightSnapshot: number;
  unitSnapshot: string;
  materialCostTableVersionId: string;
  materialCostTableItemId: string;
  effectiveDate: Date;
  versionName: string;
  versionCode: string;
  revision: number;
  publishedAt: Date | null;
  costSource: string;
  calculationSnapshot: unknown;
};

export type EffectiveMaterialCostMissing = {
  status: "SEM_CUSTO";
  materialId: string;
  referenceDate: Date;
};

export type EffectiveMaterialCostResult = EffectiveMaterialCostOk | EffectiveMaterialCostMissing;

export type MaterialCostTableDraftItemInput = {
  materialId: string;
  materialCodeSnapshot: string;
  materialDescriptionSnapshot: string;
  unitSnapshot: string;
  currentCostSnapshot: number;
  freightSnapshot?: number;
  landedCostSnapshot: number;
  averageCostSnapshot?: number | null;
  standardCostSnapshot?: number | null;
  standardLossSnapshot?: number | null;
  costSource?: MaterialCostTableItemSource | string;
  warningsJson?: unknown;
  calculationHash?: string | null;
  calculationSnapshot?: unknown;
};

export function isMaterialCostTableVersionEditable(status: MaterialCostTableVersionStatus): boolean {
  return status === MATERIAL_COST_TABLE_EDITABLE_STATUS;
}

export function assertMaterialCostTableVersionEditable(
  status: MaterialCostTableVersionStatus,
  action = "alterar"
): void {
  if (!isMaterialCostTableVersionEditable(status)) {
    throw new Error(
      `Versão ${status} é imutável — não é permitido ${action}. Crie nova revisão DRAFT.`
    );
  }
}

export function assertNonNegativeMaterialCost(value: number, label = "landedCostSnapshot"): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} deve ser um número finito >= 0.`);
  }
}

export function assertPositiveMaterialLandedCost(value: number, materialCode = "material"): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Custo landed de ${materialCode} deve ser um número finito > 0 para publicação.`
    );
  }
}

function toTime(value: Date | null | undefined): number {
  if (!value) return 0;
  const t = value.getTime();
  return Number.isFinite(t) ? t : 0;
}

function materialCostResolverStatusRank(status: MaterialCostTableVersionStatus): number {
  if (status === "PUBLISHED") return 2;
  if (status === "SUPERSEDED") return 1;
  return 0;
}

export function compareMaterialCostTableVersionsForResolver(
  candidate: MaterialCostTableVersionSnapshot,
  incumbent: MaterialCostTableVersionSnapshot
): number {
  const effectiveDiff = toTime(candidate.effectiveDate) - toTime(incumbent.effectiveDate);
  if (effectiveDiff !== 0) return effectiveDiff;

  const statusDiff =
    materialCostResolverStatusRank(candidate.status) -
    materialCostResolverStatusRank(incumbent.status);
  if (statusDiff !== 0) return statusDiff;

  const publishedDiff = toTime(candidate.publishedAt) - toTime(incumbent.publishedAt);
  if (publishedDiff !== 0) return publishedDiff;

  const revisionDiff = candidate.revision - incumbent.revision;
  if (revisionDiff !== 0) return revisionDiff;

  return toTime(candidate.createdAt) - toTime(incumbent.createdAt);
}

function isVersionEligibleForResolver(
  version: MaterialCostTableVersionSnapshot,
  referenceDate: Date
): boolean {
  if (!MATERIAL_COST_TABLE_RESOLVER_STATUSES.includes(version.status)) return false;
  const ref = startOfCivilDate(referenceDate);
  const effective = startOfCivilDate(version.effectiveDate);
  return effective.getTime() <= ref.getTime();
}

function pickBestItemForMaterial(
  versions: MaterialCostTableVersionWithItems[],
  materialId: string,
  referenceDate: Date
): { version: MaterialCostTableVersionSnapshot; item: MaterialCostTableItemSnapshot } | null {
  let best: {
    version: MaterialCostTableVersionSnapshot;
    item: MaterialCostTableItemSnapshot;
  } | null = null;

  for (const version of versions) {
    if (!isVersionEligibleForResolver(version, referenceDate)) continue;
    const item = version.items.find((row) => row.materialId === materialId);
    if (!item) continue;
    if (item.landedCostSnapshot <= 0 || !Number.isFinite(item.landedCostSnapshot)) continue;

    if (!best || compareMaterialCostTableVersionsForResolver(version, best.version) > 0) {
      best = { version, item };
    }
  }

  return best;
}

export function resolveEffectiveMaterialCostFromCatalog(
  versions: MaterialCostTableVersionWithItems[],
  materialId: string,
  referenceDate: Date
): EffectiveMaterialCostResult {
  const ref = startOfCivilDate(referenceDate);
  const picked = pickBestItemForMaterial(versions, materialId, ref);
  if (!picked) {
    return { status: "SEM_CUSTO", materialId, referenceDate: ref };
  }

  const { version, item } = picked;
  return {
    status: "OK",
    materialId,
    landedCostSnapshot: item.landedCostSnapshot,
    currentCostSnapshot: item.currentCostSnapshot,
    freightSnapshot: item.freightSnapshot,
    unitSnapshot: item.unitSnapshot,
    materialCostTableVersionId: version.id,
    materialCostTableItemId: item.id,
    effectiveDate: startOfCivilDate(version.effectiveDate),
    versionName: version.name,
    versionCode: version.code,
    revision: version.revision,
    publishedAt: version.publishedAt,
    costSource: item.costSource,
    calculationSnapshot: item.calculationSnapshot ?? null,
  };
}

export function effectiveMaterialCostLookupKey(materialId: string, referenceDate: Date): string {
  const ref = startOfCivilDate(referenceDate);
  return `${materialId}|${ref.toISOString().slice(0, 10)}`;
}

export function nextMaterialCostTableRevision(existingMaxRevision: number | null | undefined): number {
  return (existingMaxRevision ?? 0) + 1;
}

export function materialCostTableCodeFromEffectiveDate(effectiveDate: Date): string {
  const key = toCivilDateKey(startOfCivilDate(effectiveDate));
  if (!key) throw new Error("effectiveDate inválida.");
  return key.slice(0, 7);
}

export function materialCostTableNameFromCode(code: string, revision: number): string {
  return `Custo de matéria-prima ${code} (rev. ${revision})`;
}
