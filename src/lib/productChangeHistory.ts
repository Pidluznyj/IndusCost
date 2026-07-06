/**
 * Server-side wrapper para EngineeringChangeLog usado pelo histórico do produto.
 *
 * NÃO importe este arquivo no frontend — ele importa Prisma.
 */

import { prisma } from "@/src/lib/prisma";
import type {
  ProductChangeActionLabel,
  ProductChangeEntityType,
  ProductChangeHistoryEntry,
  ProductChangeHistoryResult,
  ProductChangeOrigin,
} from "@/src/lib/productChangeHistoryTypes";

export type RecordChangeInput = {
  entityType: ProductChangeEntityType;
  entityId?: string | null;
  productId?: string | null;
  productSku?: string | null;
  sourceSystem?: string | null;
  changeOrigin: ProductChangeOrigin;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  oldValueJson?: unknown;
  newValueJson?: unknown;
  changedBy?: string | null;
  runId?: string | null;
  planHash?: string | null;
  /** Mensagem humana resumida — gravada em `reason`. */
  summary?: string | null;
};

function jsonOrUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value;
}

export async function recordEngineeringChange(
  input: RecordChangeInput
): Promise<{ id: string }> {
  const created = await prisma.engineeringChangeLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      productId: input.productId ?? null,
      productSku: input.productSku ?? null,
      sourceSystem: input.sourceSystem ?? null,
      changeOrigin: input.changeOrigin,
      fieldName: input.fieldName ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      oldValueJson: jsonOrUndefined(input.oldValueJson) as never,
      newValueJson: jsonOrUndefined(input.newValueJson) as never,
      changedBy: input.changedBy ?? null,
      runId: input.runId ?? null,
      planHash: input.planHash ?? null,
      reason: input.summary ?? null,
    },
    select: { id: true },
  });
  return created;
}

/**
 * Deriva um label humano da ação a partir dos dados crus do log.
 *
 * Regras:
 *  - se fieldName === "@created" → CREATED
 *  - se fieldName === "@deactivated" → DEACTIVATED
 *  - se fieldName === "@reactivated" → REACTIVATED
 *  - se changeOrigin === "NOMUS_SYNC" → IMPORTED
 *  - se changeOrigin === "NOMUS_ENGINEERING_APPLY" e fieldName ≠ "@..." → EQUALIZED
 *  - se reason começa com "BLOCKED" → BLOCKED; "SKIPPED" → SKIPPED
 *  - senão → UPDATED
 */
function deriveActionLabel(entry: {
  changeOrigin: string;
  fieldName: string | null;
  reason: string | null;
}): ProductChangeActionLabel {
  if (entry.fieldName === "@created") return "CREATED";
  if (entry.fieldName === "@deactivated") return "DEACTIVATED";
  if (entry.fieldName === "@reactivated") return "REACTIVATED";
  if (entry.reason && /^BLOCKED/i.test(entry.reason)) return "BLOCKED";
  if (entry.reason && /^SKIPPED/i.test(entry.reason)) return "SKIPPED";
  if (entry.changeOrigin === "NOMUS_SYNC") return "IMPORTED";
  if (entry.changeOrigin === "NOMUS_ENGINEERING_APPLY") return "EQUALIZED";
  return "UPDATED";
}

export type LoadProductHistoryInput = {
  productId?: string | null;
  productSku?: string | null;
  limit?: number;
  offset?: number;
};

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

function clampLimit(limit?: number): number {
  const raw = Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_HISTORY_LIMIT);
}

export async function loadProductChangeHistory(
  input: LoadProductHistoryInput
): Promise<ProductChangeHistoryResult> {
  const limit = clampLimit(input.limit);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const productId = input.productId?.trim() || null;
  const productSkuRaw = input.productSku?.trim() || null;

  let resolvedProductId: string | null = null;
  let productSku: string | null = null;
  let productName: string | null = null;

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, name: true },
    });
    if (product) {
      resolvedProductId = product.id;
      productSku = product.sku;
      productName = product.name;
    }
  } else if (productSkuRaw) {
    const product = await prisma.product.findFirst({
      where: { sku: productSkuRaw },
      select: { id: true, sku: true, name: true },
    });
    if (product) {
      resolvedProductId = product.id;
      productSku = product.sku;
      productName = product.name;
    } else {
      productSku = productSkuRaw;
    }
  }

  if (!resolvedProductId && !productSku) {
    return {
      productId: productId ?? "",
      productSku: null,
      productName: null,
      entries: [],
      totalCount: 0,
      hasMore: false,
      nextOffset: null,
    };
  }

  const whereOr: Array<{ productId?: string; productSku?: string }> = [];
  if (resolvedProductId) whereOr.push({ productId: resolvedProductId });
  if (productSku) whereOr.push({ productSku });

  const where = whereOr.length === 1 ? whereOr[0] : { OR: whereOr };

  const [totalCount, rows] = await Promise.all([
    prisma.engineeringChangeLog.count({ where }),
    prisma.engineeringChangeLog.findMany({
      where,
      orderBy: { changedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        productId: true,
        productSku: true,
        sourceSystem: true,
        changeOrigin: true,
        fieldName: true,
        oldValue: true,
        newValue: true,
        oldValueJson: true,
        newValueJson: true,
        changedBy: true,
        changedAt: true,
        runId: true,
        planHash: true,
        reason: true,
      },
    }),
  ]);

  const entries: ProductChangeHistoryEntry[] = rows.map((row) => ({
    id: row.id,
    entityType: row.entityType as ProductChangeEntityType,
    entityId: row.entityId,
    productId: row.productId,
    productSku: row.productSku,
    sourceSystem: row.sourceSystem,
    changeOrigin: row.changeOrigin as ProductChangeOrigin,
    fieldName: row.fieldName,
    oldValue: row.oldValue,
    newValue: row.newValue,
    oldValueJson: row.oldValueJson ?? null,
    newValueJson: row.newValueJson ?? null,
    changedBy: row.changedBy,
    changedAt: row.changedAt.toISOString(),
    runId: row.runId,
    planHash: row.planHash,
    reason: row.reason,
    summary: row.reason,
    actionLabel: deriveActionLabel({
      changeOrigin: row.changeOrigin,
      fieldName: row.fieldName,
      reason: row.reason,
    }),
  }));

  const hasMore = offset + rows.length < totalCount;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    productId: resolvedProductId ?? productId ?? "",
    productSku,
    productName,
    entries,
    totalCount,
    hasMore,
    nextOffset,
  };
}

/**
 * Garante que existe pelo menos uma entrada "IMPORTED" para um Product já criado
 * pela Carga Mestre Nomus. Idempotente: não cria duplicidade.
 *
 * O runId, quando informado, precisa apontar para um EngineeringSyncRun real
 * (a FK runId é validada pelo banco). Quem chama é responsável por isso.
 */
export async function ensureNomusImportHistoryForProduct(input: {
  productId: string;
  productSku: string;
  runId?: string | null;
  planHash?: string | null;
  summary?: string | null;
}): Promise<{ created: boolean }> {
  const existing = await prisma.engineeringChangeLog.findFirst({
    where: {
      productId: input.productId,
      entityType: "PRODUCT",
      changeOrigin: "NOMUS_SYNC",
    },
    select: { id: true },
  });
  if (existing) return { created: false };

  await recordEngineeringChange({
    entityType: "PRODUCT",
    entityId: input.productId,
    productId: input.productId,
    productSku: input.productSku,
    sourceSystem: "NOMUS",
    changeOrigin: "NOMUS_SYNC",
    fieldName: "@created",
    summary:
      input.summary ??
      "Produto criado a partir da Carga Mestre Nomus (registro retroativo de auditoria).",
    runId: input.runId ?? null,
    planHash: input.planHash ?? null,
  });
  return { created: true };
}

/**
 * Mesma ideia para Material — registra entry retroativa via productSku=code,
 * já que Material não tem productId.
 */
export async function ensureNomusImportHistoryForMaterial(input: {
  materialId: string;
  materialCode: string;
  runId?: string | null;
  planHash?: string | null;
  summary?: string | null;
}): Promise<{ created: boolean }> {
  const existing = await prisma.engineeringChangeLog.findFirst({
    where: {
      entityId: input.materialId,
      entityType: "MATERIAL",
      changeOrigin: "NOMUS_SYNC",
    },
    select: { id: true },
  });
  if (existing) return { created: false };

  await recordEngineeringChange({
    entityType: "MATERIAL",
    entityId: input.materialId,
    productSku: input.materialCode,
    sourceSystem: "NOMUS",
    changeOrigin: "NOMUS_SYNC",
    fieldName: "@created",
    summary:
      input.summary ??
      "Material criado a partir da Carga Mestre Nomus (registro retroativo de auditoria).",
    runId: input.runId ?? null,
    planHash: input.planHash ?? null,
  });
  return { created: true };
}
