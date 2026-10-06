/**
 * Gera DRAFT unitário de custo de produção (1 SKU) reutilizando a infraestrutura oficial.
 * Não publica. Não altera PUBLISHED. Não apaga DRAFTs anteriores.
 *
 * Publicação unitária:
 * 1) revalida o DRAFT candidato parcial;
 * 2) materializa nova DRAFT completa (OFFICIAL + PATCH);
 * 3) publica a versão completa via publishProductionCostVersionFromDraft;
 * 4) arquiva DRAFTs unitários obsoletos do produto.
 * O candidato parcial NÃO vira PUBLISHED.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate, toCivilDateKey } from "../financeCivilDate.js";
import type { ProductCostAnalysisEngine } from "../productCostAnalysisEngine.server.js";
import {
  firstOfficialProductFinalCostDiagnostic,
  isOfficialProductFinalCostFailure,
  resolveOfficialProductFinalCostFromAnalysis,
} from "../productOfficialFinalCost.js";
import {
  PRODUCTION_COST_PUBLICATION_SOURCE,
  buildProductionCostDraftItemFromAnalysis,
  productionCostTableCodeFromEffectiveDate,
  productionCostTableNameFromCode,
} from "../productionCostPublication.js";
import {
  findLatestPublishedProductionCostVersionByCode,
  publishProductionCostVersionFromDraft,
} from "../productionCostPublication.server.js";
import {
  addOrUpdateProductionCostTableDraftItem,
  archiveObsoleteProductDraftsAfterPublication,
  createProductionCostTableDraft,
} from "../productionCostTables.server.js";
import {
  materializeCompleteProductionCostSnapshot,
  type MaterializeCompleteProductionCostSnapshotDeps,
  type MaterializeCompleteProductionCostSnapshotResult,
} from "../productionCostCompleteSnapshot.server.js";
import {
  evaluateProductionCostPublishBase,
  isProductionCostPublishStaleBaseError,
} from "../productionCostCompleteSnapshot.js";
import { loadMaterialCostEngineCatalogForProductionDraft } from "../materialCostEngineResolver.js";
import {
  BOM_INACTIVE_COMPONENT_CODE,
  buildBomHealthBlockMessage,
} from "../productBomHealth.js";
import { analyzeProductsBomHealthBatch } from "../productBomHealth.server.js";
import { productionCostDecimalToNumber } from "../productionCostVersioning.js";
import {
  classifyBulkPublishEligibility,
  draftMatchesCurrentCalculation,
} from "../productionCostBulkPublish.js";
import {
  getProductFrozenCostTrace,
  type ProductFrozenCostTrace,
} from "../productEngineeringCostSnapshot.server.js";
import {
  UNITARY_PRODUCTION_COST_DRAFT_SOURCE,
  UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE,
  buildUnitaryProductionCostDraftNotes,
  buildUnitaryProductionCostDraftResponse,
  buildUnitaryProductionCostPublishResponse,
  mapUnitaryPublishBlockReason,
  type UnitaryProductionCostDraftError,
  type UnitaryProductionCostDraftResponse,
  type UnitaryProductionCostPublishError,
  type UnitaryProductionCostPublishResponse,
  type UnitaryProductionCostPublishSnapshotSummary,
} from "./unitaryFormationProductionCost.js";

/** Rastreabilidade candidateDraft → completeDraft (preservada em notes). */
export const UNITARY_CANDIDATE_MATERIALIZED_INTO_MARKER =
  "UNITARY_CANDIDATE_MATERIALIZED_INTO" as const;

export type CreateUnitaryProductionCostDraftInput = {
  productId: string;
  effectiveDate: Date;
  createdBy?: string | null;
  notes?: string | null;
};

export type PublishUnitaryProductionCostDraftInput = {
  productId: string;
  draftVersionId: string;
  publishedBy?: string | null;
};

export type PublishUnitaryProductionCostDraftDeps = {
  loadTrace?: (
    db: PrismaClient,
    engine: ProductCostAnalysisEngine,
    productId: string,
    referenceDate?: Date
  ) => Promise<ProductFrozenCostTrace | null>;
  publishFromDraft?: typeof publishProductionCostVersionFromDraft;
  archiveObsoleteDrafts?: typeof archiveObsoleteProductDraftsAfterPublication;
  materializeComplete?: typeof materializeCompleteProductionCostSnapshot;
  materializeDeps?: MaterializeCompleteProductionCostSnapshotDeps;
};

async function safeDeleteDraftVersion(db: PrismaClient, versionId: string): Promise<void> {
  try {
    await db.productionCostTableVersion.delete({ where: { id: versionId } });
  } catch {
    // best-effort cleanup — não mascara o erro original
  }
}

function toItemNumbers(item: {
  unitProductionCost: unknown;
  materialCost: unknown;
  laborCost: unknown;
  machineCost: unknown;
  overheadCost: unknown;
  otherCost: unknown;
  calculationHash: string | null;
}) {
  return {
    unitProductionCost: productionCostDecimalToNumber(item.unitProductionCost),
    materialCost: productionCostDecimalToNumber(item.materialCost),
    laborCost: productionCostDecimalToNumber(item.laborCost),
    machineCost: productionCostDecimalToNumber(item.machineCost),
    overheadCost: productionCostDecimalToNumber(item.overheadCost),
    otherCost: productionCostDecimalToNumber(item.otherCost),
    calculationHash: item.calculationHash,
  };
}

export function parseUnitaryCandidateMaterializedIntoVersionId(
  notes: string | null | undefined
): string | null {
  if (!notes) return null;
  const re = new RegExp(
    `${UNITARY_CANDIDATE_MATERIALIZED_INTO_MARKER}\\s+completeVersionId=([\\w-]+)`,
    "i"
  );
  const match = notes.match(re);
  const id = match?.[1]?.trim();
  return id || null;
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
  if (parseUnitaryCandidateMaterializedIntoVersionId(row.notes) === completeVersionId) return;
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${UNITARY_CANDIDATE_MATERIALIZED_INTO_MARKER} completeVersionId=${completeVersionId}`;
  const nextNotes = row.notes?.trim() ? `${row.notes.trim()}\n${line}` : line;
  await db.productionCostTableVersion.update({
    where: { id: candidateDraftVersionId },
    data: { notes: nextNotes },
  });
}

async function loadPublishedItemForResponse(
  db: PrismaClient,
  versionId: string,
  productId: string
): Promise<{
  version: {
    id: string;
    code: string;
    revision: number;
    status: string;
    effectiveDate: Date;
    publishedAt: Date | null;
    publishedBy: string | null;
    source: string | null;
  };
  item: ReturnType<typeof toItemNumbers>;
} | null> {
  const [version, itemFull] = await Promise.all([
    db.productionCostTableVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        code: true,
        revision: true,
        status: true,
        effectiveDate: true,
        publishedAt: true,
        publishedBy: true,
        source: true,
      },
    }),
    db.productionCostTableItem.findFirst({
      where: { costTableVersionId: versionId, productId },
      select: {
        unitProductionCost: true,
        materialCost: true,
        laborCost: true,
        machineCost: true,
        overheadCost: true,
        otherCost: true,
        calculationHash: true,
      },
    }),
  ]);
  if (!version || version.status !== "PUBLISHED" || !itemFull) return null;
  return { version, item: toItemNumbers(itemFull) };
}

async function resolveCandidateMaterializationLink(
  db: PrismaClient,
  candidateDraftVersionId: string,
  productId: string
): Promise<
  | {
      kind: "published";
      versionId: string;
      snapshot?: UnitaryProductionCostPublishSnapshotSummary;
    }
  | {
      kind: "ready_to_publish";
      versionId: string;
      snapshot?: UnitaryProductionCostPublishSnapshotSummary;
    }
  | null
> {
  const candidate = await db.productionCostTableVersion.findUnique({
    where: { id: candidateDraftVersionId },
    select: { notes: true },
  });
  const linkedId = parseUnitaryCandidateMaterializedIntoVersionId(candidate?.notes);
  if (!linkedId) return null;

  const linked = await db.productionCostTableVersion.findUnique({
    where: { id: linkedId },
    select: { id: true, status: true, notes: true },
  });
  if (!linked) return null;

  const item = await db.productionCostTableItem.findFirst({
    where: { costTableVersionId: linked.id, productId },
    select: { productId: true },
  });
  if (!item) return null;

  const snapshot = snapshotSummaryFromNotes(linked.notes, candidateDraftVersionId, linked.id);

  if (linked.status === "PUBLISHED") {
    return { kind: "published", versionId: linked.id, snapshot };
  }
  if (linked.status === "DRAFT") {
    return { kind: "ready_to_publish", versionId: linked.id, snapshot };
  }
  return null;
}

function snapshotSummaryFromNotes(
  notes: string | null | undefined,
  candidateDraftVersionId: string,
  completeDraftVersionId: string
): UnitaryProductionCostPublishSnapshotSummary | undefined {
  if (!notes) return undefined;
  const match = notes.match(/\{[^{}]*"kind"\s*:\s*"COMPLETE_SNAPSHOT_MATERIALIZATION"[^{}]*\}/);
  if (!match) return undefined;
  try {
    const meta = JSON.parse(match[0]!) as {
      totalItems?: number;
      changedCount?: number;
      carriedForwardCount?: number;
      missingCount?: number;
    };
    if (
      typeof meta.totalItems !== "number" ||
      typeof meta.changedCount !== "number" ||
      typeof meta.carriedForwardCount !== "number"
    ) {
      return undefined;
    }
    return {
      totalItems: meta.totalItems,
      changedCount: meta.changedCount,
      carriedForwardCount: meta.carriedForwardCount,
      missingCount: typeof meta.missingCount === "number" ? meta.missingCount : 0,
      candidateDraftVersionId,
      completeDraftVersionId,
    };
  } catch {
    return undefined;
  }
}

async function isCompleteDraftBaseCurrent(
  db: PrismaClient,
  completeVersionId: string
): Promise<boolean> {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: completeVersionId },
    select: { code: true, supersedesVersionId: true, status: true },
  });
  if (!version || version.status !== "DRAFT") return false;
  const current = await findLatestPublishedProductionCostVersionByCode(db, version.code);
  const check = evaluateProductionCostPublishBase({
    draftSupersedesVersionId: version.supersedesVersionId,
    currentPublishedVersionId: current?.id ?? null,
  });
  return check.ok;
}

function snapshotFromMaterializeResult(
  result: MaterializeCompleteProductionCostSnapshotResult,
  candidateDraftVersionId: string
): UnitaryProductionCostPublishSnapshotSummary {
  return {
    totalItems: result.summary.totalItems,
    changedCount: result.summary.changedCount,
    carriedForwardCount: result.summary.carriedForwardCount,
    missingCount: result.summary.missingCount,
    candidateDraftVersionId,
    completeDraftVersionId: result.version.id,
  };
}

function mapMaterializeFailure(
  code: string,
  message: string
): UnitaryProductionCostPublishError {
  if (code === "PATCH_INVALID_COST") {
    return mapUnitaryPublishBlockReason("INVALID_COST", message);
  }
  if (code === "PATCH_PRODUCT_MISSING" || code === "PATCH_PRODUCT_OUT_OF_POPULATION") {
    return mapUnitaryPublishBlockReason("WRONG_PRODUCT", message);
  }
  if (code === "EMPTY_PATCH" || code === "DUPLICATE_PATCH_PRODUCT") {
    return { httpStatus: 409, code: "ERROR", message };
  }
  return { httpStatus: 409, code: "ERROR", message };
}

export async function revalidateUnitaryDraftForPublish(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  productId: string,
  draftVersionId: string,
  deps?: Pick<PublishUnitaryProductionCostDraftDeps, "loadTrace">
): Promise<
  | {
      ok: true;
      alreadyPublished: false;
      sku: string;
      name: string;
      previousPublishedVersionId: string | null;
      previousUnitCost: number | null;
      draftUnitCost: number;
      effectiveDate: Date;
    }
  | {
      ok: true;
      alreadyPublished: true;
      data: UnitaryProductionCostPublishResponse;
    }
  | { ok: false; error: UnitaryProductionCostPublishError }
> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, status: true },
  });
  if (!product) {
    return {
      ok: false,
      error: {
        httpStatus: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Produto ou componente não encontrado.",
      },
    };
  }
  if (product.status != null && product.status !== "ACTIVE") {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason("INACTIVE_PRODUCT", "Produto inativo — publicação bloqueada."),
    };
  }

  const version = await db.productionCostTableVersion.findUnique({
    where: { id: draftVersionId },
    select: {
      id: true,
      code: true,
      revision: true,
      status: true,
      effectiveDate: true,
      publishedAt: true,
      publishedBy: true,
      source: true,
      notes: true,
    },
  });
  if (!version) {
    return {
      ok: false,
      error: {
        httpStatus: 404,
        code: "DRAFT_NOT_FOUND",
        message: "DRAFT não encontrado.",
      },
    };
  }

  const itemOnVersion = await db.productionCostTableItem.findFirst({
    where: { costTableVersionId: draftVersionId, productId },
    select: {
      unitProductionCost: true,
      materialCost: true,
      laborCost: true,
      machineCost: true,
      overheadCost: true,
      otherCost: true,
      calculationHash: true,
    },
  });

  // Legado: candidato parcial já publicado diretamente (antes do snapshot completo).
  if (version.status === "PUBLISHED") {
    if (!itemOnVersion) {
      return {
        ok: false,
        error: mapUnitaryPublishBlockReason(
          "WRONG_PRODUCT",
          "Versão publicada não contém este produto."
        ),
      };
    }
    const nums = toItemNumbers(itemOnVersion);
    return {
      ok: true,
      alreadyPublished: true,
      data: buildUnitaryProductionCostPublishResponse({
        productId,
        draftVersionId,
        alreadyPublished: true,
        version,
        item: nums,
        previousPublishedVersionId: draftVersionId,
        previousUnitCost: nums.unitProductionCost,
      }),
    };
  }

  // Snapshot completo já publicado a partir deste candidato.
  const linkedPublished = await resolveCandidateMaterializationLink(db, draftVersionId, productId);
  if (linkedPublished?.kind === "published") {
    const loaded = await loadPublishedItemForResponse(db, linkedPublished.versionId, productId);
    if (loaded) {
      return {
        ok: true,
        alreadyPublished: true,
        data: buildUnitaryProductionCostPublishResponse({
          productId,
          draftVersionId,
          alreadyPublished: true,
          version: loaded.version,
          item: loaded.item,
          previousPublishedVersionId: linkedPublished.versionId,
          previousUnitCost: loaded.item.unitProductionCost,
          snapshot: linkedPublished.snapshot,
        }),
      };
    }
  }

  if (version.status !== "DRAFT") {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason(
        "CONFLICT_STATUS_CHANGED",
        `Status do DRAFT mudou para ${version.status}.`
      ),
    };
  }

  if (!itemOnVersion) {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason(
        "WRONG_PRODUCT",
        "DRAFT não pertence a este produto."
      ),
    };
  }

  const latestDraftItem = await db.productionCostTableItem.findFirst({
    where: { productId, costTableVersion: { status: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { costTableVersionId: true },
  });
  if (latestDraftItem && latestDraftItem.costTableVersionId !== draftVersionId) {
    const linkedCompleteId = parseUnitaryCandidateMaterializedIntoVersionId(version.notes);
    const latestIsLinkedComplete = linkedCompleteId === latestDraftItem.costTableVersionId;
    const latestIsReadyComplete =
      linkedPublished?.kind === "ready_to_publish" &&
      latestDraftItem.costTableVersionId === linkedPublished.versionId;
    if (!latestIsLinkedComplete && !latestIsReadyComplete) {
      return {
        ok: false,
        error: mapUnitaryPublishBlockReason(
          "CONFLICT_NEWER_DRAFT",
          "Existe DRAFT mais recente — versão informada não será publicada."
        ),
      };
    }
  }

  const loadTrace = deps?.loadTrace ?? getProductFrozenCostTrace;
  const trace = await loadTrace(db, engine, productId, new Date());
  const matches = draftMatchesCurrentCalculation({
    draftHash: trace?.draftHash,
    liveHash: trace?.liveHash,
    draftUnitCost: trace?.draftUnitCost,
    liveCiu: trace?.liveCiu,
  });
  const classification = classifyBulkPublishEligibility({
    productStatus: product.status,
    draftVersionId,
    draftStatus: "DRAFT",
    draftUnitCost:
      trace?.draftUnitCost ?? productionCostDecimalToNumber(itemOnVersion.unitProductionCost),
    draftMatchesCurrent: matches,
    draftCount: 1,
    traceStatus: trace?.traceStatus ?? null,
  });

  if (!classification.eligible) {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason(classification.blockReason, classification.message),
    };
  }

  const draftUnitCost =
    trace?.draftUnitCost ?? productionCostDecimalToNumber(itemOnVersion.unitProductionCost);
  if (draftUnitCost == null || !(draftUnitCost > 0)) {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason("INVALID_COST", "Custo do DRAFT inválido na revalidação."),
    };
  }

  return {
    ok: true,
    alreadyPublished: false,
    sku: product.sku,
    name: product.name,
    previousPublishedVersionId: trace?.frozenVersionId ?? null,
    previousUnitCost: trace?.frozenCost ?? null,
    draftUnitCost,
    effectiveDate: version.effectiveDate,
  };
}

export async function publishUnitaryProductionCostDraft(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: PublishUnitaryProductionCostDraftInput,
  deps?: PublishUnitaryProductionCostDraftDeps
): Promise<
  | { ok: true; data: UnitaryProductionCostPublishResponse }
  | { ok: false; error: UnitaryProductionCostPublishError }
> {
  const revalidated = await revalidateUnitaryDraftForPublish(
    db,
    engine,
    input.productId,
    input.draftVersionId,
    deps
  );
  if (revalidated.ok === false) {
    return { ok: false, error: revalidated.error };
  }

  const archiveObsolete =
    deps?.archiveObsoleteDrafts ?? archiveObsoleteProductDraftsAfterPublication;

  if (revalidated.alreadyPublished === true) {
    await archiveObsolete(db, {
      publishedVersionId: revalidated.data.versionId,
      productIds: [input.productId],
    });
    return { ok: true, data: revalidated.data };
  }

  const publishFromDraft = deps?.publishFromDraft ?? publishProductionCostVersionFromDraft;
  const materialize =
    deps?.materializeComplete ?? materializeCompleteProductionCostSnapshot;
  const previousPublishedVersionId = revalidated.previousPublishedVersionId;
  const previousUnitCost = revalidated.previousUnitCost;

  const materializeFresh = async (): Promise<
    | { ok: true; completeVersionId: string; snapshot: UnitaryProductionCostPublishSnapshotSummary }
    | { ok: false; error: UnitaryProductionCostPublishError }
  > => {
    const materialized = await materialize(
      db,
      {
        effectiveDate: revalidated.effectiveDate,
        changedProductIds: [input.productId],
        patchDraftVersionIds: [input.draftVersionId],
        createdBy: input.publishedBy ?? null,
        notes: `unitary-formation · candidateDraftVersionId=${input.draftVersionId}`,
      },
      deps?.materializeDeps
    );
    if (materialized.ok === false) {
      return {
        ok: false,
        error: mapMaterializeFailure(materialized.error.code, materialized.error.message),
      };
    }
    const completeVersionId = materialized.data.version.id;
    const snapshot = snapshotFromMaterializeResult(materialized.data, input.draftVersionId);
    try {
      await linkCandidateDraftToCompleteSnapshot(db, input.draftVersionId, completeVersionId);
    } catch {
      // best-effort
    }
    return { ok: true, completeVersionId, snapshot };
  };

  let completeVersionId: string;
  let snapshot: UnitaryProductionCostPublishSnapshotSummary | undefined;

  const existingLink = await resolveCandidateMaterializationLink(
    db,
    input.draftVersionId,
    input.productId
  );
  if (existingLink?.kind === "published") {
    const loaded = await loadPublishedItemForResponse(db, existingLink.versionId, input.productId);
    if (loaded) {
      await archiveObsolete(db, {
        publishedVersionId: existingLink.versionId,
        productIds: [input.productId],
      });
      return {
        ok: true,
        data: buildUnitaryProductionCostPublishResponse({
          productId: input.productId,
          draftVersionId: input.draftVersionId,
          alreadyPublished: true,
          version: loaded.version,
          item: loaded.item,
          previousPublishedVersionId: existingLink.versionId,
          previousUnitCost: loaded.item.unitProductionCost,
          snapshot: existingLink.snapshot,
        }),
      };
    }
  }

  if (existingLink?.kind === "ready_to_publish") {
    const baseOk = await isCompleteDraftBaseCurrent(db, existingLink.versionId);
    if (baseOk) {
      completeVersionId = existingLink.versionId;
      snapshot = existingLink.snapshot;
    } else {
      // Cenário 4/5/7: link de retry aponta para snapshot com base antiga — rematerializa.
      await safeDeleteDraftVersion(db, existingLink.versionId);
      const fresh = await materializeFresh();
      if (fresh.ok === false) return fresh;
      completeVersionId = fresh.completeVersionId;
      snapshot = fresh.snapshot;
    }
  } else {
    const fresh = await materializeFresh();
    if (fresh.ok === false) return fresh;
    completeVersionId = fresh.completeVersionId;
    snapshot = fresh.snapshot;
  }

  const finishPublished = async (
    publishedVersionId: string,
    alreadyPublished: boolean,
    publishSnapshot: UnitaryProductionCostPublishSnapshotSummary | undefined
  ) => {
    await archiveObsolete(db, {
      publishedVersionId,
      productIds: [input.productId],
    });

    const [versionMeta, itemFull] = await Promise.all([
      db.productionCostTableVersion.findUnique({
        where: { id: publishedVersionId },
        select: {
          id: true,
          code: true,
          revision: true,
          status: true,
          effectiveDate: true,
          publishedAt: true,
          publishedBy: true,
          source: true,
        },
      }),
      db.productionCostTableItem.findFirst({
        where: {
          costTableVersionId: publishedVersionId,
          productId: input.productId,
        },
        select: {
          unitProductionCost: true,
          materialCost: true,
          laborCost: true,
          machineCost: true,
          overheadCost: true,
          otherCost: true,
          calculationHash: true,
        },
      }),
    ]);

    if (!versionMeta || !itemFull) {
      return {
        ok: false as const,
        error: {
          httpStatus: 409 as const,
          code: "ERROR" as const,
          message: "Publicação concluída sem item do produto na versão completa.",
        },
      };
    }

    let snap = publishSnapshot;
    if (!snap) {
      const itemCount = await db.productionCostTableItem.count({
        where: { costTableVersionId: publishedVersionId },
      });
      snap = {
        totalItems: itemCount,
        changedCount: 1,
        carriedForwardCount: Math.max(0, itemCount - 1),
        missingCount: 0,
        candidateDraftVersionId: input.draftVersionId,
        completeDraftVersionId: publishedVersionId,
      };
    }

    return {
      ok: true as const,
      data: buildUnitaryProductionCostPublishResponse({
        productId: input.productId,
        draftVersionId: input.draftVersionId,
        alreadyPublished,
        version: versionMeta,
        item: toItemNumbers(itemFull),
        previousPublishedVersionId: alreadyPublished
          ? publishedVersionId
          : previousPublishedVersionId,
        previousUnitCost: alreadyPublished
          ? toItemNumbers(itemFull).unitProductionCost
          : previousUnitCost,
        snapshot: snap,
      }),
    };
  };

  const attemptPublish = async (versionId: string) =>
    publishFromDraft(db, {
      versionId,
      publishedBy: input.publishedBy ?? null,
      auditContext: {
        source: UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE,
      },
    });

  try {
    const published = await attemptPublish(completeVersionId);
    return await finishPublished(published.version.id, false, snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao publicar DRAFT unitário.";
    if (/já publicada|imutável/i.test(message)) {
      const loaded = await loadPublishedItemForResponse(db, completeVersionId, input.productId);
      if (loaded) {
        return finishPublished(completeVersionId, true, snapshot);
      }
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "ALREADY_PUBLISHED",
          message,
        },
      };
    }

    if (isProductionCostPublishStaleBaseError(err)) {
      // Cenário 1/3/7: base mudou entre materialize e publish — um retry com rematerialize.
      await safeDeleteDraftVersion(db, completeVersionId);
      const fresh = await materializeFresh();
      if (fresh.ok === false) return fresh;
      try {
        const published = await attemptPublish(fresh.completeVersionId);
        return await finishPublished(published.version.id, false, fresh.snapshot);
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message : "Erro ao republicar após STALE_BASE.";
        if (isProductionCostPublishStaleBaseError(retryErr)) {
          return {
            ok: false,
            error: {
              httpStatus: 409,
              code: "CONFLICT_STALE_BASE",
              message: retryMsg,
            },
          };
        }
        if (/já publicada|imutável/i.test(retryMsg)) {
          const loaded = await loadPublishedItemForResponse(
            db,
            fresh.completeVersionId,
            input.productId
          );
          if (loaded) return finishPublished(fresh.completeVersionId, true, fresh.snapshot);
        }
        return {
          ok: false,
          error: { httpStatus: 409, code: "ERROR", message: retryMsg },
        };
      }
    }

    if (/não encontrada|mudou|mais recente/i.test(message)) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "CONFLICT_STATUS_CHANGED",
          message,
        },
      };
    }
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "ERROR",
        message,
      },
    };
  }
}

export async function createUnitaryProductionCostDraftFromLive(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: CreateUnitaryProductionCostDraftInput
): Promise<
  | { ok: true; data: UnitaryProductionCostDraftResponse }
  | { ok: false; error: UnitaryProductionCostDraftError }
> {
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_EFFECTIVE_DATE",
        message: "effectiveDate inválida.",
      },
    };
  }
  const effectiveDateKey = toCivilDateKey(effectiveDate) ?? "";

  const product = await db.product.findFirst({
    where: { id: input.productId },
    select: { id: true, sku: true, name: true, type: true, status: true },
  });
  if (!product) {
    return {
      ok: false,
      error: {
        httpStatus: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Produto ou componente não encontrado.",
      },
    };
  }
  if (product.type !== "PRODUCT" && product.type !== "COMPONENT") {
    return {
      ok: false,
      error: {
        httpStatus: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Item não é produto/componente elegível para custo de produção.",
      },
    };
  }
  if (product.status != null && product.status !== "ACTIVE") {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "INACTIVE_PRODUCT",
        message: "Produto inativo — geração de DRAFT bloqueada.",
      },
    };
  }

  const bomHealthById = await analyzeProductsBomHealthBatch(db, [product.id]);
  const bomHealth = bomHealthById.get(product.id);
  if (bomHealth && !bomHealth.ok) {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: BOM_INACTIVE_COMPONENT_CODE as UnitaryProductionCostDraftError["code"],
        message: buildBomHealthBlockMessage(bomHealth),
      },
    };
  }

  let materialCostCatalog;
  try {
    materialCostCatalog = await loadMaterialCostEngineCatalogForProductionDraft(db, effectiveDate);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao carregar catálogo de MP.";
    return {
      ok: false,
      error: {
        httpStatus: 422,
        code: "LIVE_COST_ERROR",
        message,
      },
    };
  }

  const cache = await engine.initAnalysisCache();
  cache.materialCostCatalog = materialCostCatalog;
  const calculatedAt = new Date();

  let analysis: unknown;
  try {
    analysis = await engine.getProductCostAnalysis(product.id, cache, true);
  } catch (err) {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_ERROR",
        message: err instanceof Error ? err.message : "Erro no motor de custo LIVE.",
      },
    };
  }

  if (!analysis) {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_ERROR",
        message: "Produto não encontrado para análise de custo.",
      },
    };
  }

  if (engine.isCostAnalysisFailure(analysis)) {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_ERROR",
        message: engine.describeCostAnalysisFailure(analysis),
      },
    };
  }

  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  if (isOfficialProductFinalCostFailure(resolved)) {
    const diagnostic = firstOfficialProductFinalCostDiagnostic(resolved);
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_ERROR",
        message: diagnostic?.message ?? "Custo oficial não calculado.",
      },
    };
  }

  if (!(resolved.finalUnitCost > 0) || !Number.isFinite(resolved.finalUnitCost)) {
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_INVALID",
        message: "Custo unitário LIVE inválido (deve ser finito e > 0).",
      },
    };
  }

  const warnings: Array<{ code: string; message: string }> = [];
  if (resolved.costAnalysisPartial) {
    warnings.push({
      code: "COST_ANALYSIS_PARTIAL",
      message: "Análise de custo parcial — revise antes de publicar.",
    });
  }

  const code = productionCostTableCodeFromEffectiveDate(effectiveDate);
  const latestPublished = await findLatestPublishedProductionCostVersionByCode(db, code);
  const maxRevisionRow = await db.productionCostTableVersion.findFirst({
    where: { code },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const nextRevision = (maxRevisionRow?.revision ?? 0) + 1;

  const draft = await createProductionCostTableDraft(db, {
    code,
    name: productionCostTableNameFromCode(code, nextRevision),
    effectiveDate,
    revision: nextRevision,
    supersedesVersionId: latestPublished?.id ?? null,
    source: UNITARY_PRODUCTION_COST_DRAFT_SOURCE,
    notes: buildUnitaryProductionCostDraftNotes(input.notes),
    createdBy: input.createdBy?.trim() || null,
    materialCostTableVersionId: materialCostCatalog.materialCostTableVersionId,
  });

  try {
    const itemInput = buildProductionCostDraftItemFromAnalysis(
      {
        id: product.id,
        sku: product.sku,
        name: product.name,
        type: product.type,
      },
      resolved,
      analysis,
      calculatedAt,
      materialCostCatalog
    );
    await addOrUpdateProductionCostTableDraftItem(db, draft.id, itemInput);
  } catch (err) {
    await safeDeleteDraftVersion(db, draft.id);
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "UNEXPECTED_ERROR",
        message: err instanceof Error ? err.message : "Falha ao persistir item do DRAFT unitário.",
      },
    };
  }

  const items = await db.productionCostTableItem.findMany({
    where: { costTableVersionId: draft.id },
    select: {
      productId: true,
      productCodeSnapshot: true,
      productNameSnapshot: true,
      unitProductionCost: true,
      materialCost: true,
      laborCost: true,
      machineCost: true,
      overheadCost: true,
      otherCost: true,
      calculationHash: true,
    },
  });

  if (items.length !== 1) {
    await safeDeleteDraftVersion(db, draft.id);
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "UNEXPECTED_ERROR",
        message: `DRAFT unitário deve ter exatamente 1 item (obtido ${items.length}).`,
      },
    };
  }

  const item = items[0]!;
  const unitCost = productionCostDecimalToNumber(item.unitProductionCost);
  if (!(unitCost > 0)) {
    await safeDeleteDraftVersion(db, draft.id);
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "LIVE_COST_INVALID",
        message: "Custo unitário persistido inválido.",
      },
    };
  }

  void PRODUCTION_COST_PUBLICATION_SOURCE;

  const version = await db.productionCostTableVersion.findUnique({
    where: { id: draft.id },
    select: {
      id: true,
      code: true,
      revision: true,
      status: true,
      effectiveDate: true,
      createdAt: true,
      createdBy: true,
      source: true,
    },
  });
  if (!version || version.status !== "DRAFT") {
    await safeDeleteDraftVersion(db, draft.id);
    return {
      ok: false,
      error: {
        httpStatus: 409,
        code: "UNEXPECTED_ERROR",
        message: "Versão DRAFT unitária inconsistente após persistência.",
      },
    };
  }

  return {
    ok: true,
    data: buildUnitaryProductionCostDraftResponse({
      version,
      item: {
        productId: item.productId,
        productCodeSnapshot: item.productCodeSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        unitProductionCost: unitCost,
        materialCost: productionCostDecimalToNumber(item.materialCost),
        laborCost: productionCostDecimalToNumber(item.laborCost),
        machineCost: productionCostDecimalToNumber(item.machineCost),
        overheadCost: productionCostDecimalToNumber(item.overheadCost),
        otherCost: productionCostDecimalToNumber(item.otherCost),
        calculationHash: item.calculationHash,
      },
      costAnalysisPartial: Boolean(resolved.costAnalysisPartial),
      warnings,
      effectiveDateKey,
    }),
  };
}
