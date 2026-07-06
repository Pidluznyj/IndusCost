/**
 * Helpers server-side para o fluxo de reclassificação de itens.
 *
 * Fase: INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A.
 *
 * Responsabilidades:
 *  - Carregar snapshot read-only de dependências (loadProductSnapshot/loadMaterialSnapshot).
 *  - Aplicar o plano dentro de prisma.$transaction
 *    (executeReclassificationPlan).
 *  - Registrar histórico/auditoria em EngineeringChangeLog via
 *    recordEngineeringChange (changeOrigin = MANUAL_EDIT,
 *    reason = "ITEM_RECLASSIFICATION: ...").
 *
 * NÃO importe este arquivo no frontend (depende de Prisma).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import {
  analyzeItemReclassificationImpact,
  checkReclassificationConfirmation,
  describePlanForAudit,
} from "@/src/lib/itemReclassification";
import type {
  ItemReclassificationApplyError,
  ItemReclassificationApplyResult,
  ItemReclassificationImpact,
  ItemReclassificationKind,
  ItemReclassificationPlan,
  ItemReclassificationSourceSnapshot,
} from "@/src/lib/itemReclassificationTypes";
import { recordEngineeringChange } from "@/src/lib/productChangeHistory";

type Tx = Prisma.TransactionClient | PrismaClient;

const AUDIT_REASON_PREFIX = "ITEM_RECLASSIFICATION";

function hasProcessFieldsFromProduct(p: {
  cycleTimeSeconds: Prisma.Decimal | null;
  cavities: number | null;
  setupTimeMin: Prisma.Decimal | null;
  efficiencyExpected: Prisma.Decimal | null;
}): boolean {
  return (
    p.cycleTimeSeconds !== null ||
    p.cavities !== null ||
    p.setupTimeMin !== null ||
    p.efficiencyExpected !== null
  );
}

/** Snapshot de dependências do Product (PRODUCT/COMPONENT). */
export async function loadProductSnapshot(
  productId: string,
  tx: Tx = prisma
): Promise<ItemReclassificationSourceSnapshot | null> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      name: true,
      status: true,
      type: true,
      isNomusControlled: true,
      sourceSystem: true,
      cycleTimeSeconds: true,
      cavities: true,
      setupTimeMin: true,
      efficiencyExpected: true,
    },
  });
  if (!product) return null;

  const [
    bomLinesAsParent,
    bomLinesAsChild,
    routingSteps,
    pricingRows,
    proposalItems,
    salesOrderItems,
    priceTableItems,
    costCalculationLogs,
    historyEntriesByProductId,
    historyEntriesBySku,
  ] = await Promise.all([
    tx.productBOM.count({ where: { productId: product.id } }),
    tx.productBOM.count({ where: { childProductId: product.id } }),
    tx.productRouting.count({ where: { productId: product.id } }),
    tx.productPricing.count({ where: { productId: product.id } }),
    tx.proposalItem.count({ where: { productId: product.id } }),
    tx.salesOrderItem.count({ where: { productId: product.id } }),
    tx.priceTableItem.count({ where: { productId: product.id } }),
    tx.costCalculationLog.count({ where: { productId: product.id } }),
    tx.engineeringChangeLog.count({ where: { productId: product.id } }),
    tx.engineeringChangeLog.count({ where: { productSku: product.sku, productId: null } }),
  ]);

  return {
    kind: product.type as "PRODUCT" | "COMPONENT",
    id: product.id,
    sku: product.sku,
    name: product.name,
    status: product.status ?? "ACTIVE",
    isNomusControlled: product.isNomusControlled,
    sourceSystem: product.sourceSystem ?? null,
    hasProcessFields: hasProcessFieldsFromProduct(product),
    bomLinesAsParent,
    bomLinesAsChild,
    routingSteps,
    pricingRows,
    proposalItems,
    salesOrderItems,
    priceTableItems,
    costCalculationLogs,
    bomLinesAsMaterial: 0,
    materialPriceHistory: 0,
    purchaseRequestItems: 0,
    historyEntries: historyEntriesByProductId + historyEntriesBySku,
  };
}

/** Snapshot de dependências do Material. */
export async function loadMaterialSnapshot(
  materialId: string,
  tx: Tx = prisma
): Promise<ItemReclassificationSourceSnapshot | null> {
  const material = await tx.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      code: true,
      description: true,
      status: true,
    },
  });
  if (!material) return null;

  const [bomLinesAsMaterial, materialPriceHistory, purchaseRequestItems, historyByCode] =
    await Promise.all([
      tx.productBOM.count({ where: { materialId: material.id } }),
      tx.materialPriceHistory.count({ where: { materialId: material.id } }),
      tx.purchaseRequestItem.count({ where: { materialId: material.id } }),
      tx.engineeringChangeLog.count({
        where: {
          OR: [
            { entityId: material.id, entityType: "MATERIAL" },
            { productSku: material.code },
          ],
        },
      }),
    ]);

  return {
    kind: "MATERIAL",
    id: material.id,
    sku: material.code,
    name: material.description,
    status: material.status ?? "ACTIVE",
    isNomusControlled: false,
    sourceSystem: null,
    hasProcessFields: false,
    bomLinesAsParent: 0,
    bomLinesAsChild: 0,
    routingSteps: 0,
    pricingRows: 0,
    proposalItems: 0,
    salesOrderItems: 0,
    priceTableItems: 0,
    costCalculationLogs: 0,
    bomLinesAsMaterial,
    materialPriceHistory,
    purchaseRequestItems,
    historyEntries: historyByCode,
  };
}

export async function buildReclassificationImpactForProduct(
  productId: string,
  targetKind: ItemReclassificationKind
): Promise<ItemReclassificationImpact | null> {
  const snapshot = await loadProductSnapshot(productId);
  if (!snapshot) return null;
  return analyzeItemReclassificationImpact(snapshot, targetKind);
}

export async function buildReclassificationImpactForMaterial(
  materialId: string,
  targetKind: ItemReclassificationKind
): Promise<ItemReclassificationImpact | null> {
  const snapshot = await loadMaterialSnapshot(materialId);
  if (!snapshot) return null;
  return analyzeItemReclassificationImpact(snapshot, targetKind);
}

export type ExecuteReclassificationInput = {
  /** Identidade do item original. Quando é Product, productId. */
  sourceProductId?: string;
  /** Quando é Material. */
  sourceMaterialId?: string;
  /** Target. */
  targetKind: ItemReclassificationKind;
  /** Confirmação textual digitada pelo usuário. */
  confirmationText: string;
  /** Confirmação adicional (quando aplicável). */
  extraConfirmationText?: string | null;
  /** Identidade do usuário (gravada em changedBy). */
  changedBy: string | null;
};

type SuccessResult = ItemReclassificationApplyResult;
type FailureResult = ItemReclassificationApplyError;

function buildFailure(
  code: FailureResult["code"],
  message: string,
  extra?: Partial<FailureResult>
): FailureResult {
  return {
    ok: false,
    error: code,
    code,
    message,
    ...extra,
  };
}

/**
 * Aplica a reclassificação dentro de uma transação Prisma. A função:
 *   1. Recarrega o snapshot real do banco (dentro da TX, sem race).
 *   2. Recalcula o impacto com a lib pura.
 *   3. Bloqueia se status === BLOCKED.
 *   4. Valida confirmação textual.
 *   5. Executa o plano.
 *   6. Registra EngineeringChangeLog (auditoria).
 */
export async function executeItemReclassification(
  input: ExecuteReclassificationInput
): Promise<SuccessResult | FailureResult> {
  if (!input.sourceProductId && !input.sourceMaterialId) {
    return buildFailure(
      "SOURCE_NOT_FOUND",
      "Informe sourceProductId ou sourceMaterialId."
    );
  }
  if (input.sourceProductId && input.sourceMaterialId) {
    return buildFailure(
      "SOURCE_NOT_FOUND",
      "Informe apenas um identificador de origem."
    );
  }

  return prisma.$transaction(async (tx) => {
    const snapshot = input.sourceProductId
      ? await loadProductSnapshot(input.sourceProductId, tx)
      : await loadMaterialSnapshot(input.sourceMaterialId!, tx);

    if (!snapshot) {
      return buildFailure("SOURCE_NOT_FOUND", "Item de origem não encontrado.");
    }

    const impact = analyzeItemReclassificationImpact(snapshot, input.targetKind);

    if (impact.status === "BLOCKED") {
      return buildFailure(
        "RECLASSIFICATION_BLOCKED",
        impact.blockingReasons[0]?.message ??
          "Reclassificação bloqueada por regra de segurança.",
        { blockingReasons: impact.blockingReasons }
      );
    }

    const conf = checkReclassificationConfirmation(impact, {
      confirmationText: input.confirmationText,
      extraConfirmationText: input.extraConfirmationText ?? undefined,
    });
    if (conf.ok === false) {
      return buildFailure(conf.code, conf.message);
    }

    const auditReason = `${AUDIT_REASON_PREFIX}: ${describePlanForAudit(impact.plan)}`;

    if (impact.plan.kind === "UPDATE_PRODUCT_TYPE") {
      return applyUpdateProductType(tx, impact, snapshot, input.changedBy, auditReason);
    }
    if (impact.plan.kind === "CONVERT_PRODUCT_TO_MATERIAL") {
      return applyConvertProductToMaterial(
        tx,
        impact,
        snapshot,
        input.changedBy,
        auditReason
      );
    }

    return buildFailure(
      "NOT_IMPLEMENTED",
      "Este caminho de reclassificação ainda não está implementado no IndusCost."
    );
  });
}

async function applyUpdateProductType(
  tx: Prisma.TransactionClient,
  impact: ItemReclassificationImpact,
  snapshot: ItemReclassificationSourceSnapshot,
  changedBy: string | null,
  auditReason: string
): Promise<SuccessResult | FailureResult> {
  if (impact.plan.kind !== "UPDATE_PRODUCT_TYPE") {
    return buildFailure("INTERNAL_ERROR", "Plano inconsistente.");
  }
  const plan = impact.plan;

  const updateData: Prisma.ProductUpdateInput = {
    type: plan.to,
  };
  if (plan.clearProcessFields) {
    updateData.cycleTimeSeconds = null;
    updateData.cavities = null;
    updateData.setupTimeMin = null;
    updateData.efficiencyExpected = null;
  }
  await tx.product.update({ where: { id: plan.productId }, data: updateData });

  const logged = await recordEngineeringChange({
    entityType: "PRODUCT",
    entityId: plan.productId,
    productId: plan.productId,
    productSku: snapshot.sku,
    sourceSystem: snapshot.sourceSystem ?? null,
    changeOrigin: "MANUAL_EDIT",
    fieldName: "type",
    oldValue: plan.from,
    newValue: plan.to,
    oldValueJson: { type: plan.from, hasProcessFields: snapshot.hasProcessFields },
    newValueJson: {
      type: plan.to,
      clearedProcessFields: plan.clearProcessFields,
    },
    changedBy,
    summary: auditReason,
  });

  return {
    ok: true,
    appliedPlan: plan,
    productId: plan.productId,
    materialId: null,
    identifier: snapshot.sku,
    changeLogId: logged.id,
    message: `Item reclassificado com sucesso de ${plan.from} para ${plan.to}.`,
  };
}

async function applyConvertProductToMaterial(
  tx: Prisma.TransactionClient,
  impact: ItemReclassificationImpact,
  snapshot: ItemReclassificationSourceSnapshot,
  changedBy: string | null,
  auditReason: string
): Promise<SuccessResult | FailureResult> {
  if (impact.plan.kind !== "CONVERT_PRODUCT_TO_MATERIAL") {
    return buildFailure("INTERNAL_ERROR", "Plano inconsistente.");
  }
  const plan = impact.plan;

  // Defesa em profundidade: revalida ausência total de dependências críticas.
  const reSnapshot = await loadProductSnapshot(plan.productId, tx);
  if (!reSnapshot) return buildFailure("SOURCE_NOT_FOUND", "Produto não encontrado.");
  if (
    reSnapshot.bomLinesAsParent > 0 ||
    reSnapshot.routingSteps > 0 ||
    reSnapshot.proposalItems > 0 ||
    reSnapshot.salesOrderItems > 0 ||
    reSnapshot.priceTableItems > 0 ||
    reSnapshot.pricingRows > 0 ||
    reSnapshot.bomLinesAsChild > 0
  ) {
    return buildFailure(
      "RECLASSIFICATION_BLOCKED",
      "Produto adquiriu dependências entre a análise e a aplicação. Reabra a tela e analise novamente."
    );
  }

  // Verifica conflito de código no Material (Material.code é UNIQUE).
  const existingMaterial = await tx.material.findUnique({
    where: { code: plan.materialCode },
    select: { id: true },
  });
  if (existingMaterial) {
    return buildFailure(
      "TARGET_IDENTIFIER_CONFLICT",
      `Já existe um Material com o código ${plan.materialCode}. Inative o duplicado antes de prosseguir.`
    );
  }

  // 1) Cria Material novo com defaults seguros (custos zerados; histórico segue
  //    com este Material novo a partir do momento da reclassificação).
  const material = await tx.material.create({
    data: {
      code: plan.materialCode,
      description: plan.description,
      unit: "UN",
      category: "RECLASSIFIED_FROM_PRODUCT",
      supplier: null,
      currentCost: new Prisma.Decimal(0),
      averageCost: new Prisma.Decimal(0),
      standardCost: new Prisma.Decimal(0),
      freight: new Prisma.Decimal(0),
      standardLoss: new Prisma.Decimal(0),
      conversionFactor: new Prisma.Decimal(1),
      status: "ACTIVE",
    },
  });

  // 2) Inativa o Product original (preserva histórico e referências antigas).
  await tx.product.update({
    where: { id: plan.productId },
    data: { status: "INACTIVE" },
  });

  // 3) Registra auditoria — duas entradas (Product e Material) facilitam a busca por
  //    qualquer um dos identificadores no histórico.
  const productLog = await recordEngineeringChange({
    entityType: "PRODUCT",
    entityId: plan.productId,
    productId: plan.productId,
    productSku: snapshot.sku,
    sourceSystem: snapshot.sourceSystem ?? null,
    changeOrigin: "MANUAL_EDIT",
    fieldName: "@reclassified_to_material",
    oldValue: snapshot.kind,
    newValue: "MATERIAL",
    oldValueJson: {
      productId: plan.productId,
      sku: snapshot.sku,
      name: snapshot.name,
      kind: snapshot.kind,
    },
    newValueJson: {
      materialId: material.id,
      materialCode: material.code,
      kind: "MATERIAL",
    },
    changedBy,
    summary: auditReason,
  });

  await recordEngineeringChange({
    entityType: "MATERIAL",
    entityId: material.id,
    productSku: material.code,
    sourceSystem: null,
    changeOrigin: "MANUAL_EDIT",
    fieldName: "@created_from_product",
    oldValue: null,
    newValue: material.code,
    oldValueJson: {
      productId: plan.productId,
      productSku: snapshot.sku,
    },
    newValueJson: {
      materialId: material.id,
      materialCode: material.code,
    },
    changedBy,
    summary: auditReason,
  });

  return {
    ok: true,
    appliedPlan: plan,
    productId: plan.productId,
    materialId: material.id,
    identifier: material.code,
    changeLogId: productLog.id,
    message: `Material ${material.code} criado a partir do item original. O produto foi inativado para preservar histórico.`,
  };
}
