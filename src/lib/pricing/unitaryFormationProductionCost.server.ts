/**
 * Gera DRAFT unitário de custo de produção (1 SKU) reutilizando a infraestrutura oficial.
 * Não publica. Não altera PUBLISHED. Não apaga DRAFTs anteriores.
 *
 * Publicação unitária: revalida e chama publishProductionCostVersionFromDraft (sem UPDATE manual).
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
  createProductionCostTableDraft,
} from "../productionCostTables.server.js";
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
} from "./unitaryFormationProductionCost.js";

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
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason(
        "CONFLICT_NEWER_DRAFT",
        "Existe DRAFT mais recente — versão informada não será publicada."
      ),
    };
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
    draftUnitCost: trace?.draftUnitCost ?? productionCostDecimalToNumber(itemOnVersion.unitProductionCost),
    draftMatchesCurrent: matches,
    draftCount: 1,
    traceStatus: trace?.traceStatus ?? null,
  });

  if (!classification.eligible) {
    return {
      ok: false,
      error: mapUnitaryPublishBlockReason(
        classification.blockReason,
        classification.message
      ),
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
  if (revalidated.alreadyPublished === true) {
    return { ok: true, data: revalidated.data };
  }

  const publishFromDraft = deps?.publishFromDraft ?? publishProductionCostVersionFromDraft;
  const previousPublishedVersionId = revalidated.previousPublishedVersionId;
  const previousUnitCost = revalidated.previousUnitCost;

  try {
    const published = await publishFromDraft(db, {
      versionId: input.draftVersionId,
      publishedBy: input.publishedBy ?? null,
      auditContext: {
        source: UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE,
      },
    });

    // Resultado oficial omite `source` e breakdown de custos — lê do banco pós-publish
    // (somente read-model da resposta; sem alterar status/custo).
    const [versionMeta, itemFull] = await Promise.all([
      db.productionCostTableVersion.findUnique({
        where: { id: published.version.id },
        select: { source: true },
      }),
      db.productionCostTableItem.findFirst({
        where: {
          costTableVersionId: published.version.id,
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

    if (!itemFull) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "ERROR",
          message: "Publicação concluída sem item do produto na versão.",
        },
      };
    }

    return {
      ok: true,
      data: buildUnitaryProductionCostPublishResponse({
        productId: input.productId,
        draftVersionId: input.draftVersionId,
        alreadyPublished: false,
        version: {
          id: published.version.id,
          code: published.version.code,
          revision: published.version.revision,
          status: published.version.status,
          effectiveDate: published.version.effectiveDate,
          publishedAt: published.version.publishedAt,
          publishedBy: published.version.publishedBy,
          source: versionMeta?.source ?? null,
        },
        item: toItemNumbers(itemFull),
        previousPublishedVersionId,
        previousUnitCost,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao publicar DRAFT unitário.";
    if (/já publicada|imutável/i.test(message)) {
      const version = await db.productionCostTableVersion.findUnique({
        where: { id: input.draftVersionId },
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
      });
      const item = await db.productionCostTableItem.findFirst({
        where: { costTableVersionId: input.draftVersionId, productId: input.productId },
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
      if (version?.status === "PUBLISHED" && item) {
        return {
          ok: true,
          data: buildUnitaryProductionCostPublishResponse({
            productId: input.productId,
            draftVersionId: input.draftVersionId,
            alreadyPublished: true,
            version,
            item: toItemNumbers(item),
            previousPublishedVersionId: input.draftVersionId,
            previousUnitCost: productionCostDecimalToNumber(item.unitProductionCost),
          }),
        };
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
    // Mesma semântica do generate em lote: DRAFT permitido com warning.
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

  // Garantia: nenhum PUBLISHED foi tocado — só criamos DRAFT novo.
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
