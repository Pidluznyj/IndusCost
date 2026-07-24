/**
 * Prévia e publicação em lote de custos de produção DRAFT.
 * Read-only na prévia. Escrita apenas via publishProductionCostVersionFromDraft.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import { publishProductionCostVersionFromDraft } from "./productionCostPublication.server.js";
import { getProductFrozenCostTrace } from "./productEngineeringCostSnapshot.server.js";
import { frozenCostTraceStatusLabel } from "./productEngineeringCostSnapshot.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  PRODUCTION_COST_BULK_PUBLISH_SOURCE,
  buildDifferenceLabels,
  chunkIds,
  classifyBulkPublishEligibility,
  draftMatchesCurrentCalculation,
  readProductionCostBulkPublishChunkSize,
  summarizeBulkPublishPreview,
  summarizeBulkPublishResult,
  type ProductionCostBulkPublishPreview,
  type ProductionCostBulkPublishPreviewRow,
  type ProductionCostBulkPublishResult,
  type ProductionCostBulkPublishResultRow,
} from "./productionCostBulkPublish.js";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function countDraftsByProduct(
  db: PrismaClient,
  productIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const grouped = await db.productionCostTableItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: productIds },
      costTableVersion: { status: "DRAFT" },
    },
    _count: { _all: true },
  });
  for (const row of grouped) {
    out.set(row.productId, row._count._all);
  }
  return out;
}

async function loadLatestDraftMeta(
  db: PrismaClient,
  productIds: string[]
): Promise<
  Map<
    string,
    {
      versionId: string;
      code: string;
      revision: number;
      status: string;
      source: string | null;
      createdBy: string | null;
      createdAt: Date;
      unitProductionCost: number | null;
      calculationHash: string | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      versionId: string;
      code: string;
      revision: number;
      status: string;
      source: string | null;
      createdBy: string | null;
      createdAt: Date;
      unitProductionCost: number | null;
      calculationHash: string | null;
    }
  >();
  if (productIds.length === 0) return out;

  const items = await db.productionCostTableItem.findMany({
    where: {
      productId: { in: productIds },
      costTableVersion: { status: "DRAFT" },
    },
    orderBy: { createdAt: "desc" },
    include: {
      costTableVersion: {
        select: {
          id: true,
          code: true,
          revision: true,
          status: true,
          source: true,
          createdBy: true,
          createdAt: true,
        },
      },
    },
  });

  for (const item of items) {
    if (out.has(item.productId)) continue;
    out.set(item.productId, {
      versionId: item.costTableVersion.id,
      code: item.costTableVersion.code,
      revision: item.costTableVersion.revision,
      status: item.costTableVersion.status,
      source: item.costTableVersion.source,
      createdBy: item.costTableVersion.createdBy,
      createdAt: item.costTableVersion.createdAt,
      unitProductionCost: decimalToNumber(item.unitProductionCost),
      calculationHash: item.calculationHash,
    });
  }
  return out;
}

export async function previewProductionCostBulkPublish(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: { productIds: string[]; batchRunId?: string | null }
): Promise<ProductionCostBulkPublishPreview> {
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const batchRunId = input.batchRunId?.trim() || randomUUID();
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true, status: true, version: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const draftCounts = await countDraftsByProduct(db, productIds);
  const draftMeta = await loadLatestDraftMeta(db, productIds);

  const rows: ProductionCostBulkPublishPreviewRow[] = [];
  const chunks = chunkIds(productIds, readProductionCostBulkPublishChunkSize());

  for (const chunk of chunks) {
    for (const productId of chunk) {
      const product = productById.get(productId);
      if (!product) {
        rows.push({
          productId,
          sku: "—",
          name: "Produto não encontrado",
          productStatus: null,
          productVersion: null,
          draftVersionId: null,
          draftCode: null,
          draftRevision: null,
          draftCreatedAt: null,
          draftSource: null,
          draftCreatedBy: null,
          draftUnitCost: null,
          publishedVersionId: null,
          publishedUnitCost: null,
          differenceAmount: null,
          differencePercent: null,
          draftCount: 0,
          traceStatus: null,
          eligible: false,
          status: "BLOCKED",
          blockReason: "WRONG_PRODUCT",
          message: "Produto não encontrado.",
        });
        continue;
      }

      const trace = await getProductFrozenCostTrace(db, engine, productId, new Date());
      const draft = draftMeta.get(productId) ?? null;
      const matches = draftMatchesCurrentCalculation({
        draftHash: draft?.calculationHash ?? trace?.draftHash,
        liveHash: trace?.liveHash,
        draftUnitCost: draft?.unitProductionCost ?? trace?.draftUnitCost,
        liveCiu: trace?.liveCiu,
      });
      const classification = classifyBulkPublishEligibility({
        productStatus: product.status,
        draftVersionId: draft?.versionId ?? trace?.draftVersionId,
        draftStatus: draft?.status ?? (trace?.draftVersionId ? "DRAFT" : null),
        draftUnitCost: draft?.unitProductionCost ?? trace?.draftUnitCost,
        draftMatchesCurrent: matches,
        draftCount: draftCounts.get(productId) ?? 0,
        traceStatus: trace?.traceStatus ?? null,
      });
      const publishedUnitCost = trace?.frozenCost ?? null;
      const draftUnitCost = draft?.unitProductionCost ?? trace?.draftUnitCost ?? null;
      const diff = buildDifferenceLabels(publishedUnitCost, draftUnitCost);

      rows.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        productStatus: product.status,
        productVersion: product.version,
        draftVersionId: draft?.versionId ?? trace?.draftVersionId ?? null,
        draftCode: draft?.code ?? null,
        draftRevision: draft?.revision ?? null,
        draftCreatedAt: draft?.createdAt ? draft.createdAt.toISOString() : null,
        draftSource: draft?.source ?? null,
        draftCreatedBy: draft?.createdBy ?? null,
        draftUnitCost,
        publishedVersionId: trace?.frozenVersionId ?? null,
        publishedUnitCost,
        differenceAmount: diff.amount,
        differencePercent: diff.percent,
        draftCount: draftCounts.get(productId) ?? 0,
        traceStatus: trace?.traceStatus ?? null,
        eligible: classification.eligible,
        status: classification.status,
        blockReason: classification.blockReason,
        message: classification.message,
      });
    }
  }

  // Preserve selection order
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const ordered = productIds.map((id) => byId.get(id)!).filter(Boolean);

  return {
    batchRunId,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary: summarizeBulkPublishPreview(ordered),
    rows: ordered,
  };
}

async function revalidateBeforePublish(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  productId: string,
  expectedDraftVersionId: string
): Promise<{
  ok: true;
  sku: string;
  name: string;
  productVersion: string | null;
  previousPublishedVersionId: string | null;
  previousUnitCost: number | null;
  draftUnitCost: number;
} | {
  ok: false;
  row: Omit<ProductionCostBulkPublishResultRow, "processedAt">;
}> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, status: true, version: true },
  });
  if (!product) {
    return {
      ok: false,
      row: {
        productId,
        sku: "—",
        name: "Produto não encontrado",
        productVersion: null,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "BLOCKED",
        message: "Produto não encontrado.",
      },
    };
  }

  const version = await db.productionCostTableVersion.findUnique({
    where: { id: expectedDraftVersionId },
    select: { id: true, status: true },
  });
  if (!version) {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "CONFLICT",
        message: "DRAFT não encontrado — estado alterado desde a prévia.",
      },
    };
  }
  if (version.status === "PUBLISHED") {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: expectedDraftVersionId,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "ALREADY_PUBLISHED",
        message: "DRAFT já publicado (idempotente).",
      },
    };
  }
  if (version.status !== "DRAFT") {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "CONFLICT",
        message: `Status do DRAFT mudou para ${version.status}.`,
      },
    };
  }

  const latestDraftItem = await db.productionCostTableItem.findFirst({
    where: { productId, costTableVersion: { status: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { costTableVersionId: true },
  });
  if (latestDraftItem && latestDraftItem.costTableVersionId !== expectedDraftVersionId) {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "CONFLICT",
        message: "Existe DRAFT mais recente — versão da prévia não será publicada.",
      },
    };
  }

  const belongs = await db.productionCostTableItem.findFirst({
    where: {
      productId,
      costTableVersionId: expectedDraftVersionId,
    },
    select: { id: true },
  });
  if (!belongs) {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "BLOCKED",
        message: "DRAFT não pertence a este produto.",
      },
    };
  }

  const trace = await getProductFrozenCostTrace(db, engine, productId, new Date());
  const matches = draftMatchesCurrentCalculation({
    draftHash: trace?.draftHash,
    liveHash: trace?.liveHash,
    draftUnitCost: trace?.draftUnitCost,
    liveCiu: trace?.liveCiu,
  });
  const classification = classifyBulkPublishEligibility({
    productStatus: product.status,
    draftVersionId: expectedDraftVersionId,
    draftStatus: "DRAFT",
    draftUnitCost: trace?.draftUnitCost ?? null,
    draftMatchesCurrent: matches,
    draftCount: 1,
    traceStatus: trace?.traceStatus ?? null,
  });
  if (!classification.eligible) {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: trace?.frozenVersionId ?? null,
        previousUnitCost: trace?.frozenCost ?? null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status:
          classification.status === "ELIGIBLE" ? "BLOCKED" : classification.status,
        message: classification.message,
      },
    };
  }

  const draftUnitCost = trace?.draftUnitCost;
  if (draftUnitCost == null || !(draftUnitCost > 0)) {
    return {
      ok: false,
      row: {
        productId,
        sku: product.sku,
        name: product.name,
        productVersion: product.version,
        draftVersionId: expectedDraftVersionId,
        previousPublishedVersionId: trace?.frozenVersionId ?? null,
        previousUnitCost: trace?.frozenCost ?? null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "BLOCKED",
        message: "Custo do DRAFT inválido na revalidação.",
      },
    };
  }

  return {
    ok: true,
    sku: product.sku,
    name: product.name,
    productVersion: product.version,
    previousPublishedVersionId: trace?.frozenVersionId ?? null,
    previousUnitCost: trace?.frozenCost ?? null,
    draftUnitCost,
  };
}

export async function executeProductionCostBulkPublish(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: {
    productIds: string[];
    publishedBy: string | null;
    batchRunId?: string | null;
    /** Se informado, publica exatamente estes draftVersionId (da prévia). */
    draftVersionIdsByProduct?: Record<string, string> | null;
    chunkSize?: number;
  }
): Promise<ProductionCostBulkPublishResult> {
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const batchRunId = input.batchRunId?.trim() || randomUUID();
  const chunkSize = input.chunkSize ?? readProductionCostBulkPublishChunkSize();
  const publishedVersionIds = new Set<string>();
  const rows: ProductionCostBulkPublishResultRow[] = [];

  const preview = await previewProductionCostBulkPublish(db, engine, {
    productIds,
    batchRunId,
  });
  const eligible = preview.rows.filter((r) => r.eligible && r.draftVersionId);

  // Include non-eligible as skipped/blocked in result
  for (const row of preview.rows) {
    if (row.eligible && row.draftVersionId) continue;
    rows.push({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      productVersion: row.productVersion,
      draftVersionId: row.draftVersionId,
      previousPublishedVersionId: row.publishedVersionId,
      previousUnitCost: row.publishedUnitCost,
      publishedUnitCost: null,
      differenceAmount: row.differenceAmount,
      differencePercent: row.differencePercent,
      status: row.status === "ELIGIBLE" ? "SKIPPED" : row.status,
      message: row.message,
      processedAt: new Date().toISOString(),
    });
  }

  const work = eligible.map((r) => ({
    productId: r.productId,
    draftVersionId:
      input.draftVersionIdsByProduct?.[r.productId]?.trim() || r.draftVersionId!,
  }));

  for (const chunk of chunkIds(work, chunkSize)) {
    for (const item of chunk) {
      if (publishedVersionIds.has(item.draftVersionId)) {
        const product = preview.rows.find((r) => r.productId === item.productId);
        rows.push({
          productId: item.productId,
          sku: product?.sku ?? "—",
          name: product?.name ?? "—",
          productVersion: product?.productVersion ?? null,
          draftVersionId: item.draftVersionId,
          previousPublishedVersionId: product?.publishedVersionId ?? null,
          previousUnitCost: product?.publishedUnitCost ?? null,
          publishedUnitCost: null,
          differenceAmount: null,
          differencePercent: null,
          status: "ALREADY_PUBLISHED",
          message: "Versão já processada neste lote.",
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      const revalidated = await revalidateBeforePublish(
        db,
        engine,
        item.productId,
        item.draftVersionId
      );
      if (!revalidated.ok) {
        rows.push({ ...revalidated.row, processedAt: new Date().toISOString() });
        continue;
      }

      try {
        const published = await publishProductionCostVersionFromDraft(db, {
          versionId: item.draftVersionId,
          publishedBy: input.publishedBy,
          auditContext: {
            source: PRODUCTION_COST_BULK_PUBLISH_SOURCE,
            batchRunId,
          },
        });
        publishedVersionIds.add(item.draftVersionId);
        const newCost =
          decimalToNumber(
            published.version.items.find((i) => i.productId === item.productId)
              ?.unitProductionCost
          ) ?? revalidated.draftUnitCost;
        const diff = buildDifferenceLabels(revalidated.previousUnitCost, newCost);
        rows.push({
          productId: item.productId,
          sku: revalidated.sku,
          name: revalidated.name,
          productVersion: revalidated.productVersion,
          draftVersionId: item.draftVersionId,
          previousPublishedVersionId: revalidated.previousPublishedVersionId,
          previousUnitCost: revalidated.previousUnitCost,
          publishedUnitCost: newCost,
          differenceAmount: diff.amount,
          differencePercent: diff.percent,
          status: "PUBLISHED",
          message: `Publicado (${frozenCostTraceStatusLabel("ATUALIZADO")}).`,
          processedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao publicar.";
        const already = /já publicada|imutável/i.test(message);
        rows.push({
          productId: item.productId,
          sku: revalidated.sku,
          name: revalidated.name,
          productVersion: revalidated.productVersion,
          draftVersionId: item.draftVersionId,
          previousPublishedVersionId: revalidated.previousPublishedVersionId,
          previousUnitCost: revalidated.previousUnitCost,
          publishedUnitCost: null,
          differenceAmount: null,
          differencePercent: null,
          status: already ? "ALREADY_PUBLISHED" : /não encontrada|mudou|mais recente/i.test(message)
            ? "CONFLICT"
            : "ERROR",
          message,
          processedAt: new Date().toISOString(),
        });
      }
    }
  }

  const byId = new Map(rows.map((r) => [r.productId, r]));
  const ordered = productIds.map((id) => byId.get(id)).filter(Boolean) as ProductionCostBulkPublishResultRow[];

  return {
    batchRunId,
    finishedAt: new Date().toISOString(),
    chunkSize,
    summary: summarizeBulkPublishResult(ordered),
    rows: ordered,
  };
}

/** Diagnóstico read-only de DRAFTs (sem publicar). */
export async function diagnoseProductionCostDrafts(
  db: PrismaClient,
  options?: {
    since?: Date | null;
    source?: string | null;
    createdBy?: string | null;
    autoCodeOnly?: boolean;
  }
) {
  const since = options?.since ?? null;
  const source = options?.source?.trim() || null;
  const createdBy = options?.createdBy?.trim() || null;

  const where = {
    status: "DRAFT" as const,
    ...(source ? { source } : {}),
    ...(createdBy ? { createdBy } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(options?.autoCodeOnly ? { code: { startsWith: "AUTO-" } } : {}),
  };

  const drafts = await db.productionCostTableVersion.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      code: true,
      revision: true,
      source: true,
      createdBy: true,
      createdAt: true,
      items: {
        select: {
          productId: true,
          productCodeSnapshot: true,
          productNameSnapshot: true,
          unitProductionCost: true,
        },
      },
    },
  });

  const productIds = [
    ...new Set(drafts.flatMap((d) => d.items.map((i) => i.productId))),
  ];
  const draftCountByProduct = new Map<string, number>();
  for (const d of drafts) {
    for (const item of d.items) {
      draftCountByProduct.set(item.productId, (draftCountByProduct.get(item.productId) ?? 0) + 1);
    }
  }

  return {
    readOnly: true as const,
    generatedAt: new Date().toISOString(),
    filters: {
      since: since ? since.toISOString() : null,
      source,
      createdBy,
      autoCodeOnly: Boolean(options?.autoCodeOnly),
    },
    totalDraftVersions: drafts.length,
    totalDraftItems: drafts.reduce((acc, d) => acc + d.items.length, 0),
    productsWithDraft: productIds.length,
    productsWithMultipleDrafts: [...draftCountByProduct.values()].filter((n) => n > 1).length,
    sample: drafts.slice(0, 20).map((d) => ({
      versionId: d.id,
      code: d.code,
      revision: d.revision,
      source: d.source,
      createdBy: d.createdBy,
      createdAt: d.createdAt.toISOString(),
      civilDate: toCivilDateKey(d.createdAt),
      items: d.items.map((i) => ({
        productId: i.productId,
        sku: i.productCodeSnapshot,
        name: i.productNameSnapshot,
        unitProductionCost: decimalToNumber(i.unitProductionCost),
      })),
    })),
  };
}
