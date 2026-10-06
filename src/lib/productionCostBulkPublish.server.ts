/**
 * Prévia e publicação em lote de custos de produção DRAFT.
 * Read-only na prévia.
 *
 * Escrita:
 * - phase=validate → só revalida (sem PUBLISHED);
 * - phase=finalize → materializa snapshot completo + publishProductionCostVersionFromDraft
 *   (uma versão PUBLISHED completa por batchRunId).
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import { publishProductionCostVersionFromDraft } from "./productionCostPublication.server.js";
import { getProductFrozenCostTrace } from "./productEngineeringCostSnapshot.server.js";
import { frozenCostTraceStatusLabel } from "./productEngineeringCostSnapshot.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  materializeCompleteProductionCostSnapshot,
} from "./productionCostCompleteSnapshot.server.js";
import { isProductionCostPublishStaleBaseError } from "./productionCostCompleteSnapshot.js";
import { archiveObsoleteProductDraftsAfterPublication } from "./productionCostTables.server.js";
import { productionCostDecimalToNumber } from "./productionCostVersioning.js";
import {
  PRODUCTION_COST_BULK_PUBLISH_SOURCE,
  buildDifferenceLabels,
  chunkIds,
  classifyBulkPublishEligibility,
  draftMatchesCurrentCalculation,
  readProductionCostBulkPublishChunkSize,
  summarizeBulkPublishPreview,
  summarizeBulkPublishResult,
  type ProductionCostBulkPublishPhase,
  type ProductionCostBulkPublishPreview,
  type ProductionCostBulkPublishPreviewRow,
  type ProductionCostBulkPublishResult,
  type ProductionCostBulkPublishResultRow,
} from "./productionCostBulkPublish.js";

/** Mesmo marcador do fluxo unitário — rastreabilidade candidate → complete. */
const CANDIDATE_MATERIALIZED_INTO_MARKER = "UNITARY_CANDIDATE_MATERIALIZED_INTO";

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

async function linkCandidateDraftToCompleteSnapshot(
  db: PrismaClient,
  candidateDraftVersionId: string,
  completeVersionId: string
): Promise<void> {
  const row = await db.productionCostTableVersion.findUnique({
    where: { id: candidateDraftVersionId },
    select: { notes: true, status: true },
  });
  if (!row || (row.status !== "DRAFT" && row.status !== "ARCHIVED")) return;
  if (row.notes?.includes(`completeVersionId=${completeVersionId}`)) return;
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${CANDIDATE_MATERIALIZED_INTO_MARKER} completeVersionId=${completeVersionId}`;
  const nextNotes = row.notes?.trim() ? `${row.notes.trim()}\n${line}` : line;
  await db.productionCostTableVersion.update({
    where: { id: candidateDraftVersionId },
    data: { notes: nextNotes },
  });
}

/**
 * Revalidação leve pré-finalize (sem motor LIVE): status DRAFT + item + custo > 0.
 * A revalidação LIVE ocorre nos chunks HTTP `validate` imediatamente antes.
 */
async function lightValidateDraftForFinalize(
  db: PrismaClient,
  productId: string,
  expectedDraftVersionId: string
): Promise<{
  ok: true;
  sku: string;
  name: string;
  productVersion: string | null;
  draftUnitCost: number;
  previousPublishedVersionId: string | null;
  previousUnitCost: number | null;
  effectiveDate: Date;
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
  if (product.status != null && product.status !== "ACTIVE") {
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
        message: "Produto inativo — publicação bloqueada.",
      },
    };
  }

  const version = await db.productionCostTableVersion.findUnique({
    where: { id: expectedDraftVersionId },
    select: { id: true, status: true, effectiveDate: true, notes: true },
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

  // Candidato já consumido por snapshot completo deste (ou outro) lote.
  const linkedMatch = version.notes?.match(
    new RegExp(`${CANDIDATE_MATERIALIZED_INTO_MARKER}\\s+completeVersionId=([\\w-]+)`, "i")
  );
  if (linkedMatch?.[1]) {
    const linked = await db.productionCostTableVersion.findUnique({
      where: { id: linkedMatch[1] },
      select: { id: true, status: true },
    });
    if (linked?.status === "PUBLISHED") {
      const item = await db.productionCostTableItem.findFirst({
        where: { costTableVersionId: linked.id, productId },
        select: { unitProductionCost: true },
      });
      const cost = item ? productionCostDecimalToNumber(item.unitProductionCost) : null;
      return {
        ok: false,
        row: {
          productId,
          sku: product.sku,
          name: product.name,
          productVersion: product.version,
          draftVersionId: expectedDraftVersionId,
          previousPublishedVersionId: linked.id,
          previousUnitCost: cost,
          publishedUnitCost: cost,
          differenceAmount: null,
          differencePercent: null,
          status: "ALREADY_PUBLISHED",
          message: "Snapshot completo já publicado para este candidato (idempotente).",
        },
      };
    }
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

  const item = await db.productionCostTableItem.findFirst({
    where: { productId, costTableVersionId: expectedDraftVersionId },
    select: { unitProductionCost: true },
  });
  if (!item) {
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
  const draftUnitCost = productionCostDecimalToNumber(item.unitProductionCost);
  if (!(draftUnitCost > 0)) {
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
        message: "Custo do DRAFT inválido na revalidação.",
      },
    };
  }

  return {
    ok: true,
    sku: product.sku,
    name: product.name,
    productVersion: product.version,
    draftUnitCost,
    previousPublishedVersionId: null,
    previousUnitCost: null,
    effectiveDate: version.effectiveDate,
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
    /**
     * validate = só revalida (chunk HTTP intermediário).
     * finalize = materializa + publica snapshot completo (default / último chunk).
     */
    phase?: ProductionCostBulkPublishPhase | null;
    chunkIndex?: number | null;
    chunkTotal?: number | null;
  }
): Promise<ProductionCostBulkPublishResult> {
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const batchRunId = input.batchRunId?.trim() || randomUUID();
  const chunkSize = input.chunkSize ?? readProductionCostBulkPublishChunkSize();
  const phase: ProductionCostBulkPublishPhase =
    input.phase === "validate" ? "validate" : "finalize";
  const rows: ProductionCostBulkPublishResultRow[] = [];
  const draftMap = input.draftVersionIdsByProduct ?? null;

  // ---------- VALIDATE (HTTP chunk): prévia+LIVE só neste bloco (≤25) ----------
  if (phase === "validate") {
    const preview = await previewProductionCostBulkPublish(db, engine, {
      productIds,
      batchRunId,
    });
    const eligible = preview.rows.filter((r) => r.eligible && r.draftVersionId);

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
      draftVersionId: draftMap?.[r.productId]?.trim() || r.draftVersionId!,
    }));

    for (const chunk of chunkIds(work, chunkSize)) {
      for (const item of chunk) {
        const revalidated = await revalidateBeforePublish(
          db,
          engine,
          item.productId,
          item.draftVersionId
        );
        if (revalidated.ok === false) {
          rows.push({ ...revalidated.row, processedAt: new Date().toISOString() });
          continue;
        }
        const diff = buildDifferenceLabels(
          revalidated.previousUnitCost,
          revalidated.draftUnitCost
        );
        rows.push({
          productId: item.productId,
          sku: revalidated.sku,
          name: revalidated.name,
          productVersion: revalidated.productVersion,
          draftVersionId: item.draftVersionId,
          previousPublishedVersionId: revalidated.previousPublishedVersionId,
          previousUnitCost: revalidated.previousUnitCost,
          publishedUnitCost: null,
          differenceAmount: diff.amount,
          differencePercent: diff.percent,
          status: "VALIDATED",
          message: "Revalidado — aguardando publicação do snapshot completo do lote.",
          processedAt: new Date().toISOString(),
        });
      }
    }

    const byId = new Map(rows.map((r) => [r.productId, r]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductionCostBulkPublishResultRow[];

    return {
      batchRunId,
      finishedAt: new Date().toISOString(),
      chunkSize,
      phase,
      completePublishedVersionId: null,
      snapshot: null,
      summary: summarizeBulkPublishResult(ordered),
      rows: ordered,
    };
  }

  // ---------- FINALIZE: sem prévia LIVE em massa (evita 524); checks leves + materialize ----------
  const work: Array<{ productId: string; draftVersionId: string }> = [];
  for (const productId of productIds) {
    const draftVersionId = draftMap?.[productId]?.trim();
    if (!draftVersionId) {
      rows.push({
        productId,
        sku: "—",
        name: "—",
        productVersion: null,
        draftVersionId: null,
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "SKIPPED",
        message: "Sem draftVersionId no lote — item ignorado no finalize.",
        processedAt: new Date().toISOString(),
      });
      continue;
    }
    work.push({ productId, draftVersionId });
  }

  const accepted: Array<{
    productId: string;
    draftVersionId: string;
    sku: string;
    name: string;
    productVersion: string | null;
    draftUnitCost: number;
    previousPublishedVersionId: string | null;
    previousUnitCost: number | null;
    effectiveDate: Date;
  }> = [];

  for (const item of work) {
    const checked = await lightValidateDraftForFinalize(
      db,
      item.productId,
      item.draftVersionId
    );
    if (checked.ok === false) {
      rows.push({ ...checked.row, processedAt: new Date().toISOString() });
      continue;
    }
    accepted.push({
      productId: item.productId,
      draftVersionId: item.draftVersionId,
      sku: checked.sku,
      name: checked.name,
      productVersion: checked.productVersion,
      draftUnitCost: checked.draftUnitCost,
      previousPublishedVersionId: checked.previousPublishedVersionId,
      previousUnitCost: checked.previousUnitCost,
      effectiveDate: checked.effectiveDate,
    });
  }

  if (accepted.length === 0) {
    const byId = new Map(rows.map((r) => [r.productId, r]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductionCostBulkPublishResultRow[];
    return {
      batchRunId,
      finishedAt: new Date().toISOString(),
      chunkSize,
      phase,
      completePublishedVersionId: null,
      snapshot: null,
      summary: summarizeBulkPublishResult(ordered),
      rows: ordered,
    };
  }

  const effectiveDate = accepted.reduce(
    (max, row) => (row.effectiveDate.getTime() > max.getTime() ? row.effectiveDate : max),
    accepted[0]!.effectiveDate
  );

  const materialized = await materializeCompleteProductionCostSnapshot(db, {
    effectiveDate,
    changedProductIds: accepted.map((a) => a.productId),
    patchDraftVersionIds: [...new Set(accepted.map((a) => a.draftVersionId))],
    createdBy: input.publishedBy,
    notes: `bulk-publish · batchRunId=${batchRunId}`,
  });

  if (materialized.ok === false) {
    for (const a of accepted) {
      rows.push({
        productId: a.productId,
        sku: a.sku,
        name: a.name,
        productVersion: a.productVersion,
        draftVersionId: a.draftVersionId,
        previousPublishedVersionId: a.previousPublishedVersionId,
        previousUnitCost: a.previousUnitCost,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "ERROR",
        message: materialized.error.message,
        processedAt: new Date().toISOString(),
      });
    }
    const byId = new Map(rows.map((r) => [r.productId, r]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductionCostBulkPublishResultRow[];
    return {
      batchRunId,
      finishedAt: new Date().toISOString(),
      chunkSize,
      phase,
      completePublishedVersionId: null,
      snapshot: null,
      summary: summarizeBulkPublishResult(ordered),
      rows: ordered,
    };
  }

  const completeDraftId = materialized.data.version.id;
  for (const a of accepted) {
    try {
      await linkCandidateDraftToCompleteSnapshot(db, a.draftVersionId, completeDraftId);
    } catch {
      // best-effort
    }
  }

  try {
    const published = await publishProductionCostVersionFromDraft(db, {
      versionId: completeDraftId,
      publishedBy: input.publishedBy,
      auditContext: {
        source: PRODUCTION_COST_BULK_PUBLISH_SOURCE,
        batchRunId,
      },
    });

    await archiveObsoleteProductDraftsAfterPublication(db, {
      publishedVersionId: published.version.id,
      productIds: accepted.map((a) => a.productId),
    });

    const publishedItems = new Map(
      published.version.items.map((i) => [
        i.productId,
        productionCostDecimalToNumber(i.unitProductionCost),
      ])
    );

    for (const a of accepted) {
      const newCost = publishedItems.get(a.productId) ?? a.draftUnitCost;
      const diff = buildDifferenceLabels(a.previousUnitCost, newCost);
      rows.push({
        productId: a.productId,
        sku: a.sku,
        name: a.name,
        productVersion: a.productVersion,
        draftVersionId: a.draftVersionId,
        previousPublishedVersionId: a.previousPublishedVersionId,
        previousUnitCost: a.previousUnitCost,
        publishedUnitCost: newCost,
        differenceAmount: diff.amount,
        differencePercent: diff.percent,
        status: "PUBLISHED",
        message: `Publicado no snapshot completo (${frozenCostTraceStatusLabel("ATUALIZADO")}; batch ${batchRunId}).`,
        processedAt: new Date().toISOString(),
      });
    }

    const byId = new Map(rows.map((r) => [r.productId, r]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductionCostBulkPublishResultRow[];

    return {
      batchRunId,
      finishedAt: new Date().toISOString(),
      chunkSize,
      phase,
      completePublishedVersionId: published.version.id,
      snapshot: {
        totalItems: materialized.data.summary.totalItems,
        changedCount: materialized.data.summary.changedCount,
        carriedForwardCount: materialized.data.summary.carriedForwardCount,
        missingCount: materialized.data.summary.missingCount,
      },
      summary: summarizeBulkPublishResult(ordered),
      rows: ordered,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao publicar snapshot completo.";
    try {
      const v = await db.productionCostTableVersion.findUnique({
        where: { id: completeDraftId },
        select: { status: true },
      });
      if (v?.status === "DRAFT") {
        await db.productionCostTableVersion.delete({ where: { id: completeDraftId } });
      }
    } catch {
      // ignore
    }

    // Cenário bulk∥unitário / base mudou: um rematerialize+retry controlado.
    if (isProductionCostPublishStaleBaseError(error)) {
      const rematerialized = await materializeCompleteProductionCostSnapshot(db, {
        effectiveDate,
        changedProductIds: accepted.map((a) => a.productId),
        patchDraftVersionIds: [...new Set(accepted.map((a) => a.draftVersionId))],
        createdBy: input.publishedBy,
        notes: `bulk-publish · batchRunId=${batchRunId} · stale-base-retry`,
      });
      if (rematerialized.ok) {
        const retryDraftId = rematerialized.data.version.id;
        for (const a of accepted) {
          try {
            await linkCandidateDraftToCompleteSnapshot(db, a.draftVersionId, retryDraftId);
          } catch {
            // best-effort
          }
        }
        try {
          const published = await publishProductionCostVersionFromDraft(db, {
            versionId: retryDraftId,
            publishedBy: input.publishedBy,
            auditContext: {
              source: PRODUCTION_COST_BULK_PUBLISH_SOURCE,
              batchRunId,
            },
          });
          await archiveObsoleteProductDraftsAfterPublication(db, {
            publishedVersionId: published.version.id,
            productIds: accepted.map((a) => a.productId),
          });
          const publishedItems = new Map(
            published.version.items.map((i) => [
              i.productId,
              productionCostDecimalToNumber(i.unitProductionCost),
            ])
          );
          for (const a of accepted) {
            const newCost = publishedItems.get(a.productId) ?? a.draftUnitCost;
            const diff = buildDifferenceLabels(a.previousUnitCost, newCost);
            rows.push({
              productId: a.productId,
              sku: a.sku,
              name: a.name,
              productVersion: a.productVersion,
              draftVersionId: a.draftVersionId,
              previousPublishedVersionId: a.previousPublishedVersionId,
              previousUnitCost: a.previousUnitCost,
              publishedUnitCost: newCost,
              differenceAmount: diff.amount,
              differencePercent: diff.percent,
              status: "PUBLISHED",
              message: `Publicado no snapshot completo (${frozenCostTraceStatusLabel("ATUALIZADO")}; batch ${batchRunId}; stale-base-retry).`,
              processedAt: new Date().toISOString(),
            });
          }
          const byIdRetry = new Map(rows.map((r) => [r.productId, r]));
          const orderedRetry = productIds
            .map((id) => byIdRetry.get(id))
            .filter(Boolean) as ProductionCostBulkPublishResultRow[];
          return {
            batchRunId,
            finishedAt: new Date().toISOString(),
            chunkSize,
            phase,
            completePublishedVersionId: published.version.id,
            snapshot: {
              totalItems: rematerialized.data.summary.totalItems,
              changedCount: rematerialized.data.summary.changedCount,
              carriedForwardCount: rematerialized.data.summary.carriedForwardCount,
              missingCount: rematerialized.data.summary.missingCount,
            },
            summary: summarizeBulkPublishResult(orderedRetry),
            rows: orderedRetry,
          };
        } catch (retryErr) {
          try {
            const v2 = await db.productionCostTableVersion.findUnique({
              where: { id: retryDraftId },
              select: { status: true },
            });
            if (v2?.status === "DRAFT") {
              await db.productionCostTableVersion.delete({ where: { id: retryDraftId } });
            }
          } catch {
            // ignore
          }
          const retryMsg =
            retryErr instanceof Error ? retryErr.message : message;
          for (const a of accepted) {
            rows.push({
              productId: a.productId,
              sku: a.sku,
              name: a.name,
              productVersion: a.productVersion,
              draftVersionId: a.draftVersionId,
              previousPublishedVersionId: a.previousPublishedVersionId,
              previousUnitCost: a.previousUnitCost,
              publishedUnitCost: null,
              differenceAmount: null,
              differencePercent: null,
              status: "CONFLICT",
              message: retryMsg,
              processedAt: new Date().toISOString(),
            });
          }
          const byIdFail = new Map(rows.map((r) => [r.productId, r]));
          const orderedFail = productIds
            .map((id) => byIdFail.get(id))
            .filter(Boolean) as ProductionCostBulkPublishResultRow[];
          return {
            batchRunId,
            finishedAt: new Date().toISOString(),
            chunkSize,
            phase,
            completePublishedVersionId: null,
            snapshot: null,
            summary: summarizeBulkPublishResult(orderedFail),
            rows: orderedFail,
          };
        }
      }
    }

    for (const a of accepted) {
      rows.push({
        productId: a.productId,
        sku: a.sku,
        name: a.name,
        productVersion: a.productVersion,
        draftVersionId: a.draftVersionId,
        previousPublishedVersionId: a.previousPublishedVersionId,
        previousUnitCost: a.previousUnitCost,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: /já publicada|imutável/i.test(message) ? "ALREADY_PUBLISHED" : "ERROR",
        message,
        processedAt: new Date().toISOString(),
      });
    }
    const byId = new Map(rows.map((r) => [r.productId, r]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductionCostBulkPublishResultRow[];
    return {
      batchRunId,
      finishedAt: new Date().toISOString(),
      chunkSize,
      phase,
      completePublishedVersionId: null,
      snapshot: null,
      summary: summarizeBulkPublishResult(ordered),
      rows: ordered,
    };
  }
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
