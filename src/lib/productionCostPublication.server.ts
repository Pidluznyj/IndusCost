/**
 * Orquestração: gera DRAFT/publicação de custo de produção a partir do motor industrial.
 * Não altera parametrização industrial — apenas persiste fotos versionadas.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "./financeCivilDate.js";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  resolveOfficialProductFinalCostFromAnalysis,
  firstOfficialProductFinalCostDiagnostic,
} from "./productOfficialFinalCost.js";
import {
  PRODUCTION_COST_PUBLICATION_SOURCE,
  buildProductionCostDraftItemFromAnalysis,
  productionCostTableCodeFromEffectiveDate,
  productionCostTableNameFromCode,
} from "./productionCostPublication.js";
import {
  DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE,
  matchesProductionCostDraftItemScope,
  parseProductionCostDraftItemScope,
  prismaProductTypeFilterForProductionCostDraftScope,
  type ProductionCostDraftItemScope,
} from "./productionCostDraftItemScope.js";
import {
  addOrUpdateProductionCostTableDraftItem,
  createProductionCostTableDraft,
  publishProductionCostTableVersion,
} from "./productionCostTables.server.js";

export type GenerateProductionCostDraftIssue = {
  code: string;
  productId: string;
  sku: string;
  productName: string;
  message: string;
};

export type GenerateProductionCostDraftSummary = {
  /** Escopo aplicado na geração. */
  itemScope: ProductionCostDraftItemScope;
  /** Total de itens de engenharia elegíveis avaliados (produtos + componentes). */
  itemsEvaluated: number;
  productsEvaluated: number;
  componentsEvaluated: number;
  productsCalculated: number;
  componentsCalculated: number;
  materialsIgnored: number;
  /** @deprecated Use itemsEvaluated — mantido por compatibilidade com UI/API existente. */
  productsRead: number;
  itemsCreated: number;
  itemsSkipped: number;
  errors: GenerateProductionCostDraftIssue[];
  warnings: GenerateProductionCostDraftIssue[];
};

export type GenerateProductionCostDraftInput = {
  effectiveDate: Date;
  productIds: string[];
  notes?: string | null;
  createdBy?: string | null;
  includeAllActiveProducts?: boolean;
  /** Default: PRODUCT_AND_COMPONENT — produtos e componentes ativos. */
  itemScope?: ProductionCostDraftItemScope | string | null;
  /** Período opcional para escopo SOLD_COMPONENTS (pedidos com issueDate no intervalo). */
  soldComponentsPeriod?: { from: Date; to: Date } | null;
};

export type ProductionCostDraftProductRow = {
  id: string;
  sku: string;
  name: string;
  type: string;
};

export async function findSoldActiveComponentProductIds(
  db: PrismaClient,
  period?: { from: Date; to: Date } | null
): Promise<string[]> {
  const rows = await db.salesOrderItem.findMany({
    where: {
      Product: { type: "COMPONENT", status: "ACTIVE" },
      ...(period
        ? {
            SalesOrder: {
              issueDate: { gte: period.from, lte: period.to },
            },
          }
        : {}),
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.map((row) => row.productId);
}

export async function resolveProductsForProductionCostDraft(
  db: PrismaClient,
  input: {
    productIds: string[];
    includeAllActiveProducts?: boolean;
    itemScope: ProductionCostDraftItemScope;
    soldComponentsPeriod?: { from: Date; to: Date } | null;
  }
): Promise<ProductionCostDraftProductRow[]> {
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const typeFilter = prismaProductTypeFilterForProductionCostDraftScope(input.itemScope);

  const select = {
    id: true,
    sku: true,
    name: true,
    type: true,
  } as const;

  if (input.itemScope === "SOLD_COMPONENTS") {
    const soldIds = await findSoldActiveComponentProductIds(db, input.soldComponentsPeriod);
    const targetIds =
      productIds.length > 0
        ? productIds.filter((id) => soldIds.includes(id))
        : input.includeAllActiveProducts
          ? soldIds
          : productIds;

    if (targetIds.length === 0) return [];

    return db.product.findMany({
      where: {
        status: "ACTIVE",
        type: "COMPONENT",
        id: { in: targetIds },
      },
      select,
      orderBy: { sku: "asc" },
    });
  }

  if (productIds.length > 0) {
    const rows = await db.product.findMany({
      where: {
        status: "ACTIVE",
        type: typeFilter,
        id: { in: productIds },
      },
      select,
      orderBy: { sku: "asc" },
    });
    return rows.filter((row) => matchesProductionCostDraftItemScope(row.type, input.itemScope));
  }

  if (input.includeAllActiveProducts) {
    return db.product.findMany({
      where: {
        status: "ACTIVE",
        type: typeFilter,
      },
      select,
      orderBy: { sku: "asc" },
    });
  }

  return [];
}

export async function findLatestPublishedProductionCostVersionByCode(
  db: PrismaClient,
  code: string
) {
  return db.productionCostTableVersion.findFirst({
    where: { code, status: "PUBLISHED" },
    orderBy: [{ revision: "desc" }, { publishedAt: "desc" }],
    select: { id: true, code: true, revision: true, status: true },
  });
}

export async function generateProductionCostTableDraftFromProducts(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: GenerateProductionCostDraftInput
) {
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error("effectiveDate inválida.");
  }

  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const itemScope = parseProductionCostDraftItemScope(
    input.itemScope ?? DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE
  );

  const selectedProducts = await resolveProductsForProductionCostDraft(db, {
    productIds,
    includeAllActiveProducts: input.includeAllActiveProducts,
    itemScope,
    soldComponentsPeriod: input.soldComponentsPeriod,
  });

  if (selectedProducts.length === 0) {
    throw new Error(
      itemScope === "SOLD_COMPONENTS"
        ? "Nenhum componente vendido ativo encontrado para geração de custo de produção no escopo/período informado."
        : "Nenhum item de engenharia ativo elegível (produto ou componente) selecionado para geração de custo de produção."
    );
  }

  const materialsIgnored =
    productIds.length > 0 || itemScope !== "PRODUCT_AND_COMPONENT"
      ? 0
      : await db.product.count({ where: { status: "ACTIVE", type: "MATERIAL" } });
  const productsEvaluated = selectedProducts.filter((p) => p.type === "PRODUCT").length;
  const componentsEvaluated = selectedProducts.filter((p) => p.type === "COMPONENT").length;

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
    source: PRODUCTION_COST_PUBLICATION_SOURCE,
    notes: input.notes?.trim() || null,
    createdBy: input.createdBy?.trim() || null,
  });

  const summary: GenerateProductionCostDraftSummary = {
    itemScope,
    itemsEvaluated: selectedProducts.length,
    productsEvaluated,
    componentsEvaluated,
    productsCalculated: 0,
    componentsCalculated: 0,
    materialsIgnored,
    productsRead: selectedProducts.length,
    itemsCreated: 0,
    itemsSkipped: 0,
    errors: [],
    warnings: [],
  };

  const cache = await engine.initAnalysisCache();
  const calculatedAt = new Date();

  for (const product of selectedProducts) {
    try {
      const analysis = await engine.getProductCostAnalysis(product.id, cache, true);
      if (!analysis) {
        summary.itemsSkipped += 1;
        summary.errors.push({
          code: "PRODUCT_NOT_FOUND",
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          message: "Produto não encontrado para análise de custo.",
        });
        continue;
      }

      if (engine.isCostAnalysisFailure(analysis)) {
        summary.itemsSkipped += 1;
        summary.errors.push({
          code: String((analysis as { error?: string }).error ?? "COST_ANALYSIS_ERROR"),
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          message: engine.describeCostAnalysisFailure(analysis),
        });
        continue;
      }

      const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
      if (!resolved.ok) {
        summary.itemsSkipped += 1;
        const diagnostic = firstOfficialProductFinalCostDiagnostic(resolved);
        summary.errors.push({
          code: diagnostic?.code ?? "CUSTO_OFICIAL_NAO_CALCULADO",
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          message: diagnostic?.message ?? "Custo oficial não calculado.",
        });
        continue;
      }

      if (resolved.costAnalysisPartial) {
        summary.warnings.push({
          code: "COST_ANALYSIS_PARTIAL",
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          message: "Análise de custo parcial — revise antes de publicar.",
        });
      }

      const item = buildProductionCostDraftItemFromAnalysis(
        product,
        resolved,
        analysis,
        calculatedAt
      );
      await addOrUpdateProductionCostTableDraftItem(db, draft.id, item);
      summary.itemsCreated += 1;
      if (product.type === "COMPONENT") {
        summary.componentsCalculated += 1;
      } else {
        summary.productsCalculated += 1;
      }
    } catch (error) {
      summary.itemsSkipped += 1;
      summary.errors.push({
        code: "UNEXPECTED_ERROR",
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        message: error instanceof Error ? error.message : "Erro inesperado ao calcular custo.",
      });
    }
  }

  const version = await db.productionCostTableVersion.findUnique({
    where: { id: draft.id },
    include: { _count: { select: { items: true } } },
  });

  return { version, summary, supersedesVersionId: latestPublished?.id ?? null };
}

export type PublishProductionCostVersionInput = {
  versionId: string;
  publishedBy?: string | null;
  supersedeVersionId?: string | null;
};

export async function publishProductionCostVersionFromDraft(
  db: PrismaClient,
  input: PublishProductionCostVersionInput
) {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, code: true, supersedesVersionId: true, status: true },
  });
  if (!version) throw new Error("Versão não encontrada.");

  let supersedeId = input.supersedeVersionId ?? version.supersedesVersionId;
  if (!supersedeId) {
    const latestPublished = await findLatestPublishedProductionCostVersionByCode(db, version.code);
    if (latestPublished && latestPublished.id !== version.id) {
      supersedeId = latestPublished.id;
    }
  }

  return publishProductionCostTableVersion(db, {
    versionId: input.versionId,
    publishedBy: input.publishedBy,
    supersedeVersionId: supersedeId,
  });
}

export async function listProductionCostTableVersions(
  db: PrismaClient,
  options?: { limit?: number; status?: string | null; code?: string | null }
) {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const status =
    typeof options?.status === "string" && options.status.trim()
      ? options.status.trim().toUpperCase()
      : null;
  const code =
    typeof options?.code === "string" && options.code.trim() ? options.code.trim() : null;

  return db.productionCostTableVersion.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(code ? { code } : {}),
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      _count: { select: { items: true } },
      supersedesVersion: {
        select: { id: true, code: true, revision: true, status: true },
      },
    },
  });
}

export async function getProductionCostTableVersionById(db: PrismaClient, versionId: string) {
  return db.productionCostTableVersion.findUnique({
    where: { id: versionId },
    include: {
      items: {
        orderBy: { productCodeSnapshot: "asc" },
        take: 500,
      },
      supersedesVersion: {
        select: { id: true, code: true, revision: true, status: true },
      },
    },
  });
}
