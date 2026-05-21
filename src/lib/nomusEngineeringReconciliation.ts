/**
 * Reconciliação de engenharia: produz um plano para alinhar IndusCost ao Nomus
 * (Produto + ProductBOM) com preview, auditoria e segurança.
 *
 * Esta lib NÃO altera proposta/pedido/preço; apenas Product e ProductBOM
 * (e marca como Nomus-controlled). A aplicação é controlada por planHash
 * + confirmationText + transação + EngineeringSyncRun/EngineeringChangeLog.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import { resolveNomusComponentCodes } from "@/src/lib/nomusBomComparisonLoad";
import type {
  EngineeringBomActionPlan,
  EngineeringBomActionType,
  EngineeringProductActionPlan,
  EngineeringSyncApplyResult,
  EngineeringSyncBlockingDetail,
  EngineeringSyncPlan,
  EngineeringSyncScope,
} from "@/src/lib/nomusEngineeringReconciliationTypes";

const DEFAULT_MAX_DEPTH = 10;

/** Allowlist de auto-resolve Product+Material -> Material (regra de engenharia). */
const AUTO_RESOLVE_PREFER_MATERIAL_SKUS = new Set([normalizeSku("420.01A-")]);

function isAutoResolveMaterial(componentCode: string): boolean {
  return AUTO_RESOLVE_PREFER_MATERIAL_SKUS.has(normalizeSku(componentCode));
}

function decimalToNumber(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  try {
    const n = Number(d.toString());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function buildPlanHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function confirmationTextForEngineeringSync(parentCode: string): string {
  return `SINCRONIZAR ENGENHARIA ${normalizeSku(parentCode)}`;
}

export type BuildEngineeringSyncPlanInput = {
  scope: EngineeringSyncScope;
  parentCode?: string;
  recursive?: boolean;
  maxDepth?: number;
};

async function loadStageSummary(): Promise<EngineeringSyncPlan["stageSummary"]> {
  const [parents, components, latest] = await Promise.all([
    prisma.nomusBomComponentStage.groupBy({ by: ["parentCode"], _count: { _all: true } }),
    prisma.nomusBomComponentStage.count(),
    prisma.nomusBomComponentStage.findFirst({
      select: { syncedAt: true },
      orderBy: { syncedAt: "desc" },
    }),
  ]);
  return {
    parentsInStage: parents.length,
    componentsInStage: components,
    lastStageSyncAt: latest?.syncedAt?.toISOString() ?? null,
  };
}

async function loadCurrentBomLines(productId: string): Promise<
  Array<{
    id: string;
    quantity: number | null;
    lossPercentage: number | null;
    materialId: string | null;
    childProductId: string | null;
    materialCode: string | null;
    childSku: string | null;
    isNomusControlled: boolean;
    localException: boolean;
    nomusComponentCode: string | null;
  }>
> {
  const rows = await prisma.productBOM.findMany({
    where: { productId },
    select: {
      id: true,
      quantity: true,
      lossPercentage: true,
      materialId: true,
      childProductId: true,
      isNomusControlled: true,
      localException: true,
      nomusComponentCode: true,
      Material: { select: { code: true } },
      ChildProduct: { select: { sku: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    quantity: decimalToNumber(r.quantity),
    lossPercentage: decimalToNumber(r.lossPercentage),
    materialId: r.materialId,
    childProductId: r.childProductId,
    materialCode: r.Material?.code ?? null,
    childSku: r.ChildProduct?.sku ?? null,
    isNomusControlled: r.isNomusControlled,
    localException: r.localException,
    nomusComponentCode: r.nomusComponentCode ?? null,
  }));
}

type ResolveResult = {
  componentCode: string;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
  productId: string | null;
  materialId: string | null;
};

function pickRowForResolved(
  componentCode: string,
  resolved: ResolveResult,
  currentRows: Awaited<ReturnType<typeof loadCurrentBomLines>>
): (typeof currentRows)[number] | null {
  const codeKey = normalizeComponentCode(componentCode);
  const candidates = currentRows.filter((r) => {
    if (r.nomusComponentCode && normalizeComponentCode(r.nomusComponentCode) === codeKey) return true;
    if (r.materialCode && normalizeComponentCode(r.materialCode) === codeKey) return true;
    if (r.childSku && normalizeComponentCode(r.childSku) === codeKey) return true;
    return false;
  });
  if (candidates.length === 0) return null;

  if (isAutoResolveMaterial(componentCode) && resolved.resolvedKind === "BOTH") {
    return candidates.find((c) => c.materialId) ?? candidates[0];
  }
  if (resolved.resolvedKind === "MATERIAL") {
    return candidates.find((c) => c.materialId) ?? candidates[0];
  }
  if (resolved.resolvedKind === "PRODUCT") {
    return candidates.find((c) => c.childProductId) ?? candidates[0];
  }
  return candidates[0];
}

async function buildBomActionsForParent(params: {
  parentCode: string;
  productId: string | null;
  recursive: boolean;
  maxDepth: number;
  blockingDetails: EngineeringSyncBlockingDetail[];
  warnings: string[];
  pendingCost: { componentCode: string; reason: string }[];
  pendingRouting: { componentCode: string; reason: string }[];
}): Promise<EngineeringBomActionPlan[]> {
  const { parentCode, productId, recursive, maxDepth, blockingDetails, warnings, pendingCost } =
    params;

  const effective = await buildEffectivePricingBomForParentCode(parentCode, {
    recursive: false,
    maxDepth,
  });

  if (effective.status === "PENDING_OPTIONAL_SELECTION") {
    blockingDetails.push({
      parentCode,
      reason: "Opcionais Nomus pendentes — resolva antes de sincronizar engenharia.",
    });
  }
  if (effective.status === "NO_NOMUS_BOM") {
    blockingDetails.push({ parentCode, reason: "BOM efetiva Nomus indisponível." });
  }
  if (effective.status === "STALE_OPTIONAL_SELECTION") {
    warnings.push(`${parentCode}: seleção de opcionais desatualizada — revise antes de aplicar.`);
  }

  const includedLines = effective.directLines.filter((l) => l.includedForPricing);
  const codes = includedLines.map((l) => l.componentCode);
  const resolvedList = await resolveNomusComponentCodes(codes);
  const resolvedByCode = new Map(
    resolvedList.map((r) => [normalizeComponentCode(r.componentCode), r as ResolveResult])
  );

  const currentRows = productId ? await loadCurrentBomLines(productId) : [];
  const matchedRowIds = new Set<string>();
  const out: EngineeringBomActionPlan[] = [];

  for (const line of includedLines) {
    const codeKey = normalizeComponentCode(line.componentCode);
    const resolved = resolvedByCode.get(codeKey) ?? {
      componentCode: line.componentCode,
      resolvedKind: "NONE" as const,
      productId: null,
      materialId: null,
    };

    let materialId: string | null = null;
    let childProductId: string | null = null;
    let actionType: EngineeringBomActionType;
    let resolutionMode: EngineeringBomActionPlan["resolutionMode"];
    let resolvedByRule = false;
    let reason = "";

    if (resolved.resolvedKind === "MATERIAL" && resolved.materialId) {
      materialId = resolved.materialId;
    } else if (resolved.resolvedKind === "PRODUCT" && resolved.productId) {
      childProductId = resolved.productId;
    } else if (resolved.resolvedKind === "BOTH" && resolved.productId && resolved.materialId) {
      if (isAutoResolveMaterial(line.componentCode)) {
        materialId = resolved.materialId;
        resolutionMode = "PREFER_MATERIAL";
        resolvedByRule = true;
        reason = "Resolvido como Material por regra PREFER_MATERIAL.";
      } else {
        out.push({
          parentCode,
          productId,
          productBomLineId: null,
          componentCode: line.componentCode,
          componentDescription: line.componentDescription ?? null,
          actionType: "BLOCK_AMBIGUOUS_COMPONENT",
          resolvedAs: "BOTH",
          materialId: resolved.materialId,
          childProductId: resolved.productId,
          oldQuantity: null,
          newQuantity: line.quantity ?? null,
          oldLossPercentage: null,
          newLossPercentage: null,
          willApply: false,
          reason: "Product e Material com mesmo código — sem regra automática.",
        });
        blockingDetails.push({
          parentCode,
          reason: `Componente ${line.componentCode} ambíguo (Product + Material).`,
        });
        continue;
      }
    } else {
      out.push({
        parentCode,
        productId,
        productBomLineId: null,
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        actionType: "BLOCK_MISSING_COMPONENT",
        resolvedAs: resolved.resolvedKind,
        materialId: null,
        childProductId: null,
        oldQuantity: null,
        newQuantity: line.quantity ?? null,
        oldLossPercentage: null,
        newLossPercentage: null,
        willApply: false,
        reason: "Componente sem cadastro como Product nem Material no IndusCost.",
      });
      blockingDetails.push({
        parentCode,
        reason: `Componente ${line.componentCode} sem cadastro — não pode entrar na BOM.`,
      });
      pendingCost.push({
        componentCode: line.componentCode,
        reason: "Componente sem cadastro — sem custo possível.",
      });
      continue;
    }

    const matched = pickRowForResolved(line.componentCode, resolved, currentRows);
    const newQty = line.quantity ?? 0;
    const newQuantity = newQty > 0 ? newQty : 1;

    if (!matched) {
      actionType = "CREATE_PRODUCT_BOM_LINE";
      out.push({
        parentCode,
        productId,
        productBomLineId: null,
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        actionType,
        resolvedAs:
          resolved.resolvedKind === "BOTH"
            ? "BOTH"
            : resolved.resolvedKind === "MATERIAL"
              ? "MATERIAL"
              : resolved.resolvedKind === "PRODUCT"
                ? "PRODUCT"
                : "NONE",
        materialId,
        childProductId,
        oldQuantity: null,
        newQuantity,
        oldLossPercentage: null,
        newLossPercentage: 0,
        willApply: true,
        reason: reason || "Criar linha ProductBOM a partir do Nomus.",
        resolutionMode,
        resolvedByRule: resolvedByRule || undefined,
      });
      continue;
    }

    matchedRowIds.add(matched.id);

    const oldQty = matched.quantity ?? 0;
    const sameQty = Math.abs(oldQty - newQuantity) < 1e-9;
    const linkChange =
      (materialId && matched.materialId !== materialId) ||
      (childProductId && matched.childProductId !== childProductId);

    if (linkChange) {
      actionType = "UPDATE_PRODUCT_BOM_LINE_COMPONENT";
      out.push({
        parentCode,
        productId,
        productBomLineId: matched.id,
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        actionType,
        resolvedAs: resolved.resolvedKind === "BOTH" ? "BOTH" : resolved.resolvedKind,
        materialId,
        childProductId,
        oldQuantity: oldQty,
        newQuantity,
        oldLossPercentage: matched.lossPercentage,
        newLossPercentage: matched.lossPercentage,
        willApply: true,
        reason:
          reason ||
          "Atualizar vínculo da linha para refletir resolução Nomus (Material/Produto).",
        resolutionMode,
        resolvedByRule: resolvedByRule || undefined,
      });
      continue;
    }

    if (!sameQty) {
      actionType = "UPDATE_PRODUCT_BOM_LINE_QUANTITY";
      out.push({
        parentCode,
        productId,
        productBomLineId: matched.id,
        componentCode: line.componentCode,
        componentDescription: line.componentDescription ?? null,
        actionType,
        resolvedAs: resolved.resolvedKind === "BOTH" ? "BOTH" : resolved.resolvedKind,
        materialId,
        childProductId,
        oldQuantity: oldQty,
        newQuantity,
        oldLossPercentage: matched.lossPercentage,
        newLossPercentage: matched.lossPercentage,
        willApply: true,
        reason: reason || "Atualizar quantidade da linha para refletir Nomus.",
        resolutionMode,
        resolvedByRule: resolvedByRule || undefined,
      });
      continue;
    }

    out.push({
      parentCode,
      productId,
      productBomLineId: matched.id,
      componentCode: line.componentCode,
      componentDescription: line.componentDescription ?? null,
      actionType: "KEEP_PRODUCT_BOM_LINE",
      resolvedAs: resolved.resolvedKind === "BOTH" ? "BOTH" : resolved.resolvedKind,
      materialId,
      childProductId,
      oldQuantity: oldQty,
      newQuantity,
      oldLossPercentage: matched.lossPercentage,
      newLossPercentage: matched.lossPercentage,
      willApply: false,
      reason: reason || "Linha já está alinhada com o Nomus.",
      resolutionMode,
      resolvedByRule: resolvedByRule || undefined,
    });
  }

  for (const row of currentRows) {
    if (matchedRowIds.has(row.id)) continue;
    if (row.localException) {
      out.push({
        parentCode,
        productId,
        productBomLineId: row.id,
        componentCode: row.nomusComponentCode ?? row.materialCode ?? row.childSku ?? "(local)",
        componentDescription: null,
        actionType: "KEEP_LOCAL_EXCEPTION",
        resolvedAs: row.materialId ? "MATERIAL" : row.childProductId ? "PRODUCT" : "NONE",
        materialId: row.materialId,
        childProductId: row.childProductId,
        oldQuantity: row.quantity,
        newQuantity: row.quantity,
        oldLossPercentage: row.lossPercentage,
        newLossPercentage: row.lossPercentage,
        willApply: false,
        reason: "Linha mantida como exceção local autorizada.",
      });
      continue;
    }

    out.push({
      parentCode,
      productId,
      productBomLineId: row.id,
      componentCode: row.nomusComponentCode ?? row.materialCode ?? row.childSku ?? "(local)",
      componentDescription: null,
      actionType: "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS",
      resolvedAs: row.materialId ? "MATERIAL" : row.childProductId ? "PRODUCT" : "NONE",
      materialId: row.materialId,
      childProductId: row.childProductId,
      oldQuantity: row.quantity,
      newQuantity: null,
      oldLossPercentage: row.lossPercentage,
      newLossPercentage: null,
      willApply: true,
      reason: "Linha não existe na BOM efetiva Nomus e não está marcada como exceção local.",
    });
    warnings.push(
      `${parentCode}: linha local "${
        row.nomusComponentCode ?? row.materialCode ?? row.childSku
      }" será removida (sem exceção local).`
    );
  }

  if (recursive && maxDepth > 1) {
    void params;
  }

  return out;
}

async function buildProductActionForParent(
  parentCode: string,
  productId: string | null,
  productActions: EngineeringProductActionPlan[]
): Promise<EngineeringProductActionPlan> {
  const sku = normalizeSku(parentCode);
  const stage = await prisma.nomusBomComponentStage.findFirst({
    where: { OR: [{ parentCode: sku }, { parentCode }] },
    orderBy: { syncedAt: "desc" },
    select: {
      parentExternalProductId: true,
      parentDescription: true,
    },
  });
  const existsInNomus = stage != null;
  const product = productId
    ? await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          isNomusControlled: true,
          sourceSystem: true,
          sourceExternalId: true,
        },
      })
    : null;

  const fieldChanges: EngineeringProductActionPlan["fieldChanges"] = [];
  const nomusDescription = stage?.parentDescription ?? null;
  const nomusExternalId =
    stage?.parentExternalProductId != null ? String(stage.parentExternalProductId) : null;

  let actionType: EngineeringProductActionPlan["actionType"];
  let reason: string;

  if (!existsInNomus) {
    actionType = "KEEP_LOCAL_PRODUCT";
    reason = "Produto não existe no Nomus — mantido como local.";
  } else if (!product) {
    actionType = "CREATE_PRODUCT_FROM_NOMUS";
    reason = "Produto ausente no IndusCost — será criado a partir do Nomus.";
    fieldChanges.push({ field: "sku", oldValue: null, newValue: sku });
    fieldChanges.push({ field: "name", oldValue: null, newValue: nomusDescription ?? sku });
    fieldChanges.push({ field: "isNomusControlled", oldValue: null, newValue: "true" });
    if (nomusExternalId) {
      fieldChanges.push({ field: "sourceExternalId", oldValue: null, newValue: nomusExternalId });
    }
  } else {
    if (!product.isNomusControlled) {
      actionType = "MARK_PRODUCT_NOMUS_CONTROLLED";
      reason = "Produto existe no IndusCost — passa a ser marcado como controlado pelo Nomus.";
      fieldChanges.push({
        field: "isNomusControlled",
        oldValue: String(product.isNomusControlled),
        newValue: "true",
      });
      if (product.sourceSystem !== "NOMUS") {
        fieldChanges.push({
          field: "sourceSystem",
          oldValue: product.sourceSystem ?? null,
          newValue: "NOMUS",
        });
      }
      if (nomusExternalId && product.sourceExternalId !== nomusExternalId) {
        fieldChanges.push({
          field: "sourceExternalId",
          oldValue: product.sourceExternalId ?? null,
          newValue: nomusExternalId,
        });
      }
    } else {
      actionType = "KEEP_PRODUCT_AS_NOMUS_CONTROLLED";
      reason = "Produto já está marcado como controlado pelo Nomus.";
    }

    if (nomusDescription && product.name !== nomusDescription) {
      fieldChanges.push({
        field: "name",
        oldValue: product.name,
        newValue: nomusDescription,
      });
      actionType =
        actionType === "MARK_PRODUCT_NOMUS_CONTROLLED" ? actionType : "UPDATE_PRODUCT_FROM_NOMUS";
    }
  }

  const plan: EngineeringProductActionPlan = {
    parentCode: sku,
    parentDescription: nomusDescription,
    actionType,
    existsInNomus,
    existsInIndusCost: Boolean(product),
    indusProductId: product?.id ?? null,
    isAlreadyNomusControlled: Boolean(product?.isNomusControlled),
    reason,
    fieldChanges,
  };
  productActions.push(plan);
  return plan;
}

export async function buildNomusEngineeringReconciliationPlan(
  input: BuildEngineeringSyncPlanInput
): Promise<EngineeringSyncPlan> {
  if (input.scope === "ALL_NOMUS_PRODUCTS") {
    throw new Error(
      "Escopo ALL_NOMUS_PRODUCTS ainda não habilitado — use ONE_PRODUCT por enquanto."
    );
  }
  if (!input.parentCode || !input.parentCode.trim()) {
    throw new Error("parentCode é obrigatório no escopo ONE_PRODUCT.");
  }

  const parentCode = normalizeSku(input.parentCode.trim());
  const recursive = input.recursive ?? true;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;

  const blockingReasons: string[] = [];
  const blockingDetails: EngineeringSyncBlockingDetail[] = [];
  const warnings: string[] = [];
  const pendingCost: { componentCode: string; reason: string }[] = [];
  const pendingRouting: { componentCode: string; reason: string }[] = [];

  const stageSummary = await loadStageSummary();
  if (stageSummary.parentsInStage === 0) {
    blockingReasons.push("NomusBomComponentStage está vazio — rode o sync Nomus antes.");
  }

  const product = await prisma.product.findFirst({
    where: { sku: parentCode },
    select: { id: true, sku: true, ProductRouting: { select: { id: true }, take: 1 } },
  });

  const productActions: EngineeringProductActionPlan[] = [];
  await buildProductActionForParent(parentCode, product?.id ?? null, productActions);

  if (product && product.ProductRouting.length === 0) {
    pendingRouting.push({
      componentCode: parentCode,
      reason: "Produto principal sem roteiro/montagem — custo de conversão indisponível.",
    });
  }

  const bomActions = await buildBomActionsForParent({
    parentCode,
    productId: product?.id ?? null,
    recursive,
    maxDepth,
    blockingDetails,
    warnings,
    pendingCost,
    pendingRouting,
  });

  for (const d of blockingDetails) {
    blockingReasons.push(d.reason);
  }

  const summary = {
    productsToCreate: productActions.filter((p) => p.actionType === "CREATE_PRODUCT_FROM_NOMUS")
      .length,
    productsToUpdate: productActions.filter(
      (p) =>
        p.actionType === "UPDATE_PRODUCT_FROM_NOMUS" ||
        p.actionType === "MARK_PRODUCT_NOMUS_CONTROLLED"
    ).length,
    bomLinesToCreate: bomActions.filter((b) => b.actionType === "CREATE_PRODUCT_BOM_LINE").length,
    bomLinesToUpdate: bomActions.filter(
      (b) =>
        b.actionType === "UPDATE_PRODUCT_BOM_LINE_QUANTITY" ||
        b.actionType === "UPDATE_PRODUCT_BOM_LINE_LOSS" ||
        b.actionType === "UPDATE_PRODUCT_BOM_LINE_COMPONENT"
    ).length,
    bomLinesToRemove: bomActions.filter(
      (b) => b.actionType === "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS"
    ).length,
    bomLinesKept: bomActions.filter((b) => b.actionType === "KEEP_PRODUCT_BOM_LINE").length,
    localExceptionsKept: bomActions.filter((b) => b.actionType === "KEEP_LOCAL_EXCEPTION").length,
    blockedItems: bomActions.filter(
      (b) =>
        b.actionType === "BLOCK_AMBIGUOUS_COMPONENT" ||
        b.actionType === "BLOCK_MISSING_COMPONENT" ||
        b.actionType === "BLOCK_OPTIONAL_SELECTION_REQUIRED"
    ).length,
  };

  const planHashInput = {
    scope: input.scope,
    parentCode,
    recursive,
    maxDepth,
    productActions: productActions.map((p) => ({
      parentCode: p.parentCode,
      actionType: p.actionType,
      fields: p.fieldChanges.map((f) => `${f.field}:${f.oldValue ?? ""}->${f.newValue ?? ""}`),
    })),
    bomActions: bomActions.map((b) => ({
      type: b.actionType,
      code: b.componentCode,
      lineId: b.productBomLineId,
      mat: b.materialId,
      child: b.childProductId,
      oldQ: b.oldQuantity,
      newQ: b.newQuantity,
    })),
  };
  const planHash = buildPlanHash(planHashInput);

  const canApply = blockingDetails.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    scope: input.scope,
    parentCodes: [parentCode],
    recursive,
    maxDepth,
    stageSummary,
    productActions,
    bomActions,
    blockingReasons: [...new Set(blockingReasons)],
    blockingDetails,
    warnings,
    pendingCostItems: pendingCost,
    pendingRoutingItems: pendingRouting,
    canApply,
    planHash,
    confirmationRequiredText: confirmationTextForEngineeringSync(parentCode),
    summary,
  };
}

export type ApplyEngineeringSyncInput = {
  scope: EngineeringSyncScope;
  parentCode?: string;
  recursive?: boolean;
  maxDepth?: number;
  planHash: string;
  confirmationText: string;
  approvedBy?: string | null;
};

export async function applyNomusEngineeringSync(
  input: ApplyEngineeringSyncInput
): Promise<EngineeringSyncApplyResult> {
  const plan = await buildNomusEngineeringReconciliationPlan({
    scope: input.scope,
    parentCode: input.parentCode,
    recursive: input.recursive,
    maxDepth: input.maxDepth,
  });

  if (plan.planHash !== input.planHash.trim()) {
    throw new Error("Plano desatualizado. Gere o preview novamente antes de aplicar.");
  }
  if (!plan.canApply) {
    throw new Error(
      plan.blockingReasons.join(" ") || "Aplicação bloqueada pelos gates de segurança."
    );
  }
  if (input.confirmationText.trim() !== plan.confirmationRequiredText) {
    throw new Error(`Confirmação inválida. Digite exatamente: ${plan.confirmationRequiredText}`);
  }

  const warnings = [...plan.warnings];
  const errors: string[] = [];
  let productsCreated = 0;
  let productsUpdated = 0;
  let bomLinesCreated = 0;
  let bomLinesUpdated = 0;
  let bomLinesRemoved = 0;
  let bomLinesKept = plan.summary.bomLinesKept + plan.summary.localExceptionsKept;

  const startedAt = new Date();

  const run = await prisma.engineeringSyncRun.create({
    data: {
      mode: plan.scope === "ONE_PRODUCT" ? "ONE_PRODUCT" : "ALL_NOMUS_PRODUCTS",
      status: "PREVIEWED",
      parentCode: plan.parentCodes[0] ?? null,
      planHash: plan.planHash,
      confirmationText: input.confirmationText.trim(),
      approvedBy: input.approvedBy?.trim() || null,
      startedAt,
      summaryJson: { summary: plan.summary, warnings: plan.warnings },
    },
  });

  try {
    for (const prodAction of plan.productActions) {
      const sku = normalizeSku(prodAction.parentCode);
      if (prodAction.actionType === "CREATE_PRODUCT_FROM_NOMUS") {
        const created = await prisma.product.create({
          data: {
            sku,
            name: prodAction.parentDescription ?? sku,
            description: prodAction.parentDescription,
            type: "PRODUCT",
            isNomusControlled: true,
            sourceSystem: "NOMUS",
            sourceExternalId:
              prodAction.fieldChanges.find((f) => f.field === "sourceExternalId")?.newValue ?? null,
            lastNomusSyncAt: new Date(),
          },
          select: { id: true, sku: true },
        });
        productsCreated += 1;
        prodAction.indusProductId = created.id;
        await prisma.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT",
            entityId: created.id,
            productId: created.id,
            productSku: created.sku,
            sourceSystem: "NOMUS",
            changeOrigin: "NOMUS_ENGINEERING_APPLY",
            fieldName: null,
            newValueJson: {
              sku: created.sku,
              name: prodAction.parentDescription,
              isNomusControlled: true,
            },
            changedBy: input.approvedBy?.trim() || null,
            runId: run.id,
            planHash: plan.planHash,
            reason: prodAction.reason,
          },
        });
      } else if (
        prodAction.actionType === "MARK_PRODUCT_NOMUS_CONTROLLED" ||
        prodAction.actionType === "UPDATE_PRODUCT_FROM_NOMUS"
      ) {
        if (!prodAction.indusProductId) continue;
        const before = await prisma.product.findUnique({
          where: { id: prodAction.indusProductId },
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            isNomusControlled: true,
            sourceSystem: true,
            sourceExternalId: true,
          },
        });
        if (!before) continue;
        const updateData: Prisma.ProductUpdateInput = {
          isNomusControlled: true,
          sourceSystem: "NOMUS",
          lastNomusSyncAt: new Date(),
        };
        const nameChange = prodAction.fieldChanges.find((f) => f.field === "name");
        if (nameChange && nameChange.newValue) updateData.name = nameChange.newValue;
        const sourceExtChange = prodAction.fieldChanges.find(
          (f) => f.field === "sourceExternalId"
        );
        if (sourceExtChange) updateData.sourceExternalId = sourceExtChange.newValue;

        await prisma.product.update({
          where: { id: prodAction.indusProductId },
          data: updateData,
        });
        productsUpdated += 1;

        for (const change of prodAction.fieldChanges) {
          await prisma.engineeringChangeLog.create({
            data: {
              entityType: "PRODUCT",
              entityId: before.id,
              productId: before.id,
              productSku: before.sku,
              sourceSystem: "NOMUS",
              changeOrigin: "NOMUS_ENGINEERING_APPLY",
              fieldName: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changedBy: input.approvedBy?.trim() || null,
              runId: run.id,
              planHash: plan.planHash,
              reason: prodAction.reason,
            },
          });
        }
      }
    }

    const productByParentCode = new Map<string, string>();
    for (const p of plan.productActions) {
      if (p.indusProductId) {
        productByParentCode.set(normalizeSku(p.parentCode), p.indusProductId);
      }
    }

    for (const action of plan.bomActions) {
      const productId = productByParentCode.get(normalizeSku(action.parentCode));
      if (!productId) continue;

      if (action.actionType === "CREATE_PRODUCT_BOM_LINE") {
        const qty = action.newQuantity ?? 1;
        if (!action.materialId && !action.childProductId) {
          warnings.push(
            `Linha BOM ignorada (sem vínculo): ${action.componentCode} em ${action.parentCode}`
          );
          continue;
        }
        const created = await prisma.productBOM.create({
          data: {
            productId,
            materialId: action.materialId,
            childProductId: action.childProductId,
            quantity: qty,
            lossPercentage: action.newLossPercentage ?? 0,
            notes: action.resolvedByRule
              ? "Importado do Nomus (resolvido como Material por regra)."
              : "Importado do Nomus.",
            sourceSystem: "NOMUS",
            isNomusControlled: true,
            localException: false,
            lastNomusSyncAt: new Date(),
            nomusComponentCode: action.componentCode,
          },
          select: { id: true },
        });
        bomLinesCreated += 1;
        await prisma.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: created.id,
            productId,
            productSku: normalizeSku(action.parentCode),
            sourceSystem: "NOMUS",
            changeOrigin: "NOMUS_ENGINEERING_APPLY",
            fieldName: null,
            newValueJson: {
              componentCode: action.componentCode,
              materialId: action.materialId,
              childProductId: action.childProductId,
              quantity: qty,
              lossPercentage: action.newLossPercentage ?? 0,
              isNomusControlled: true,
            },
            changedBy: input.approvedBy?.trim() || null,
            runId: run.id,
            planHash: plan.planHash,
            reason: action.reason,
          },
        });
      } else if (action.actionType === "UPDATE_PRODUCT_BOM_LINE_QUANTITY") {
        if (!action.productBomLineId || action.newQuantity == null) continue;
        await prisma.productBOM.update({
          where: { id: action.productBomLineId },
          data: {
            quantity: action.newQuantity,
            isNomusControlled: true,
            sourceSystem: "NOMUS",
            lastNomusSyncAt: new Date(),
            nomusComponentCode: action.componentCode,
          },
        });
        bomLinesUpdated += 1;
        await prisma.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: action.productBomLineId,
            productId,
            productSku: normalizeSku(action.parentCode),
            sourceSystem: "NOMUS",
            changeOrigin: "NOMUS_ENGINEERING_APPLY",
            fieldName: "quantity",
            oldValue: action.oldQuantity != null ? String(action.oldQuantity) : null,
            newValue: String(action.newQuantity),
            changedBy: input.approvedBy?.trim() || null,
            runId: run.id,
            planHash: plan.planHash,
            reason: action.reason,
          },
        });
      } else if (action.actionType === "UPDATE_PRODUCT_BOM_LINE_COMPONENT") {
        if (!action.productBomLineId) continue;
        await prisma.productBOM.update({
          where: { id: action.productBomLineId },
          data: {
            materialId: action.materialId,
            childProductId: action.childProductId,
            quantity: action.newQuantity ?? undefined,
            isNomusControlled: true,
            sourceSystem: "NOMUS",
            lastNomusSyncAt: new Date(),
            nomusComponentCode: action.componentCode,
          },
        });
        bomLinesUpdated += 1;
        await prisma.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: action.productBomLineId,
            productId,
            productSku: normalizeSku(action.parentCode),
            sourceSystem: "NOMUS",
            changeOrigin: "NOMUS_ENGINEERING_APPLY",
            fieldName: "componentLink",
            oldValueJson: { materialId: null, childProductId: null },
            newValueJson: {
              materialId: action.materialId,
              childProductId: action.childProductId,
            },
            changedBy: input.approvedBy?.trim() || null,
            runId: run.id,
            planHash: plan.planHash,
            reason: action.reason,
          },
        });
      } else if (action.actionType === "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS") {
        if (!action.productBomLineId) continue;
        const before = await prisma.productBOM.findUnique({
          where: { id: action.productBomLineId },
          select: { id: true, materialId: true, childProductId: true, quantity: true },
        });
        await prisma.productBOM.delete({ where: { id: action.productBomLineId } });
        bomLinesRemoved += 1;
        await prisma.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: action.productBomLineId,
            productId,
            productSku: normalizeSku(action.parentCode),
            sourceSystem: "NOMUS",
            changeOrigin: "NOMUS_ENGINEERING_APPLY",
            fieldName: null,
            oldValueJson: before
              ? {
                  materialId: before.materialId,
                  childProductId: before.childProductId,
                  quantity: decimalToNumber(before.quantity),
                }
              : null,
            newValueJson: { removed: true },
            changedBy: input.approvedBy?.trim() || null,
            runId: run.id,
            planHash: plan.planHash,
            reason: action.reason,
          },
        });
      } else if (action.actionType === "KEEP_PRODUCT_BOM_LINE" && action.productBomLineId) {
        await prisma.productBOM.update({
          where: { id: action.productBomLineId },
          data: {
            isNomusControlled: true,
            sourceSystem: "NOMUS",
            lastNomusSyncAt: new Date(),
            nomusComponentCode: action.componentCode,
          },
        });
        bomLinesKept += 0;
      }
    }

    await prisma.engineeringSyncRun.update({
      where: { id: run.id },
      data: {
        status: errors.length > 0 ? "PARTIAL" : "APPLIED",
        finishedAt: new Date(),
        summaryJson: {
          productsCreated,
          productsUpdated,
          bomLinesCreated,
          bomLinesUpdated,
          bomLinesRemoved,
          bomLinesKept,
        },
        warningsJson: warnings,
        errorsJson: errors,
      },
    });

    return {
      runId: run.id,
      status: errors.length > 0 ? "PARTIAL" : "APPLIED",
      appliedAt: new Date().toISOString(),
      productsCreated,
      productsUpdated,
      bomLinesCreated,
      bomLinesUpdated,
      bomLinesRemoved,
      bomLinesKept,
      warnings,
      errors,
    };
  } catch (err) {
    await prisma.engineeringSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorsJson: [err instanceof Error ? err.message : String(err)],
      },
    });
    throw err;
  }
}

export type ListEngineeringChangeLogInput = {
  productId?: string;
  productSku?: string;
  limit?: number;
};

export async function listEngineeringChangeLog(
  input: ListEngineeringChangeLogInput
): Promise<
  Array<{
    id: string;
    entityType: string;
    entityId: string | null;
    productId: string | null;
    productSku: string | null;
    changeOrigin: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    changedBy: string | null;
    changedAt: string;
    runId: string | null;
    reason: string | null;
  }>
> {
  const where: Prisma.EngineeringChangeLogWhereInput = {};
  if (input.productId) where.productId = input.productId;
  if (input.productSku) where.productSku = normalizeSku(input.productSku);
  const rows = await prisma.engineeringChangeLog.findMany({
    where,
    orderBy: { changedAt: "desc" },
    take: input.limit ?? 200,
  });
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    productId: r.productId,
    productSku: r.productSku,
    changeOrigin: r.changeOrigin,
    fieldName: r.fieldName,
    oldValue: r.oldValue,
    newValue: r.newValue,
    changedBy: r.changedBy,
    changedAt: r.changedAt.toISOString(),
    runId: r.runId,
    reason: r.reason,
  }));
}
