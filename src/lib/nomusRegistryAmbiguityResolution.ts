import { createHash } from "node:crypto";
import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  isRegistryActiveStatus,
  registerPreferMaterialComponentCode,
} from "@/src/lib/nomusComponentRegistryResolve";
import { generateProductBomBackupSql } from "@/src/lib/nomusComponentRegistryCleanup";

export type AmbiguityPrefer = "MATERIAL" | "PRODUCT";

export type AmbiguityBomRelinkLine = {
  productBomLineId: string;
  parentSku: string;
  parentProductId: string;
  quantity: number | null;
  nomusComponentCode: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  sourceSystem: string | null;
  currentLink: "PRODUCT" | "MATERIAL";
  targetLink: "PRODUCT" | "MATERIAL";
  eligibility: "ALLOWED" | "BLOCKED";
  blockReason: string | null;
  action: "RELINK_TO_MATERIAL" | "RELINK_TO_PRODUCT" | "NO_CHANGE" | "SKIP";
};

export type AmbiguityResolutionPlan = {
  generatedAt: string;
  code: string;
  prefer: AmbiguityPrefer;
  planHash: string;
  confirmationRequiredText: string;
  product: {
    id: string;
    sku: string;
    name: string;
    status: string | null;
    active: boolean;
    sourceSystem: string | null;
    isNomusControlled: boolean;
    costingMode: string;
    ownBomLineCount: number;
    routingCount: number;
  } | null;
  material: {
    id: string;
    code: string;
    description: string;
    status: string | null;
    active: boolean;
    currentCost: number | null;
    standardCost: number | null;
    unit: string;
    category: string;
  } | null;
  productBomAsProductCount: number;
  productBomAsMaterialCount: number;
  linesToRelink: AmbiguityBomRelinkLine[];
  reactivateMaterial: boolean;
  productRecommendation: string;
  costImpact: {
    summary: string;
    materialUnitCost: number | null;
    expectsCostInclusionAfterApply: boolean;
  };
  risks: string[];
  recommendations: string[];
  canApply: boolean;
};

export type ApplyAmbiguityResolutionInput = {
  code: string;
  prefer: AmbiguityPrefer;
  planHash: string;
  confirmationText: string;
  backupFilePath?: string;
  approvedBy?: string;
  allowLocalException?: boolean;
};

export type ApplyAmbiguityResolutionResult = {
  resultStatus: "APPLIED" | "BLOCKED" | "FAILED";
  planHash: string;
  relinkedCount: number;
  materialReactivated: boolean;
  runId: string | null;
  backupFilePath: string | null;
  message: string;
  errors: string[];
};

export function confirmationTextForAmbiguityResolution(
  code: string,
  prefer: AmbiguityPrefer
): string {
  return `RESOLVER AMBIGUIDADE ${normalizeSku(code)} ${prefer}`;
}

export function buildAmbiguityPlanHash(payload: {
  code: string;
  prefer: AmbiguityPrefer;
  lineIds: string[];
  reactivateMaterial: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        code: normalizeSku(payload.code),
        prefer: payload.prefer,
        reactivateMaterial: payload.reactivateMaterial,
        lineIds: [...payload.lineIds].sort(),
      })
    )
    .digest("hex");
}

function toNumber(d: unknown): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : null;
}

export function classifyAmbiguityRelinkLine(input: {
  prefer: AmbiguityPrefer;
  row: {
    id: string;
    materialId: string | null;
    childProductId: string | null;
    localException: boolean;
    isNomusControlled: boolean;
    productId: string;
    materialTargetId: string;
    productTargetId: string;
  };
  allowLocalException?: boolean;
}): Pick<AmbiguityBomRelinkLine, "eligibility" | "blockReason" | "action" | "currentLink" | "targetLink"> {
  const currentLink = input.row.childProductId
    ? ("PRODUCT" as const)
    : input.row.materialId
      ? ("MATERIAL" as const)
      : ("PRODUCT" as const);

  if (!input.row.isNomusControlled) {
    return {
      currentLink,
      targetLink: input.prefer === "MATERIAL" ? "MATERIAL" : "PRODUCT",
      eligibility: "ALLOWED",
      blockReason: null,
      action: "SKIP",
    };
  }

  if (input.row.localException && !input.allowLocalException) {
    return {
      currentLink,
      targetLink: input.prefer === "MATERIAL" ? "MATERIAL" : "PRODUCT",
      eligibility: "BLOCKED",
      blockReason: "LOCAL_EXCEPTION",
      action: "SKIP",
    };
  }

  if (input.prefer === "MATERIAL") {
    if (currentLink === "MATERIAL" && input.row.materialId === input.row.materialTargetId) {
      return {
        currentLink,
        targetLink: "MATERIAL",
        eligibility: "ALLOWED",
        blockReason: null,
        action: "NO_CHANGE",
      };
    }
    if (currentLink === "PRODUCT" && input.row.childProductId === input.row.productTargetId) {
      return {
        currentLink,
        targetLink: "MATERIAL",
        eligibility: "ALLOWED",
        blockReason: null,
        action: "RELINK_TO_MATERIAL",
      };
    }
    return {
      currentLink,
      targetLink: "MATERIAL",
      eligibility: "BLOCKED",
      blockReason: "NOT_NOMUS_PRODUCT_LINK",
      action: "SKIP",
    };
  }

  if (currentLink === "PRODUCT" && input.row.childProductId === input.row.productTargetId) {
    return {
      currentLink,
      targetLink: "PRODUCT",
      eligibility: "ALLOWED",
      blockReason: null,
      action: "NO_CHANGE",
    };
  }
  return {
    currentLink,
    targetLink: "PRODUCT",
    eligibility: "BLOCKED",
    blockReason: "PREFER_PRODUCT_NOT_IMPLEMENTED_FOR_RELINK",
    action: "SKIP",
  };
}

export async function buildAmbiguityResolutionPlan(input: {
  code: string;
  prefer: AmbiguityPrefer;
  allowLocalException?: boolean;
}): Promise<AmbiguityResolutionPlan> {
  const code = input.code.trim();
  const key = normalizeSku(code);
  const prefer = input.prefer;

  const [products, materials] = await Promise.all([
    prisma.product.findMany({
      where: { OR: [{ sku: code }, { sku: key }] },
      select: {
        id: true,
        sku: true,
        name: true,
        status: true,
        sourceSystem: true,
        isNomusControlled: true,
        costingMode: true,
        _count: { select: { ProductBOM: true, ProductRouting: true, UsedInBOM: true } },
      },
    }),
    prisma.material.findMany({
      where: { OR: [{ code: code }, { code: key }] },
      select: {
        id: true,
        code: true,
        description: true,
        status: true,
        currentCost: true,
        standardCost: true,
        unit: true,
        category: true,
        _count: { select: { ProductBOM: true, PurchaseRequestItem: true } },
      },
    }),
  ]);

  const product = products[0] ?? null;
  const material = materials[0] ?? null;

  const productId = product?.id;
  const materialId = material?.id;

  const bomRows =
    productId || materialId
      ? await prisma.productBOM.findMany({
          where: {
            OR: [
              ...(productId ? [{ childProductId: productId }] : []),
              ...(materialId ? [{ materialId: materialId }] : []),
            ],
          },
          select: {
            id: true,
            productId: true,
            materialId: true,
            childProductId: true,
            quantity: true,
            nomusComponentCode: true,
            isNomusControlled: true,
            localException: true,
            sourceSystem: true,
            ParentProduct: { select: { id: true, sku: true } },
          },
          orderBy: [{ ParentProduct: { sku: "asc" } }, { id: "asc" }],
        })
      : [];

  const linesToRelink: AmbiguityBomRelinkLine[] = [];
  for (const row of bomRows) {
    if (!product || !material) continue;
    const classified = classifyAmbiguityRelinkLine({
      prefer,
      row: {
        id: row.id,
        materialId: row.materialId,
        childProductId: row.childProductId,
        localException: row.localException,
        isNomusControlled: row.isNomusControlled,
        productId: row.productId,
        materialTargetId: material.id,
        productTargetId: product.id,
      },
      allowLocalException: input.allowLocalException,
    });
    linesToRelink.push({
      productBomLineId: row.id,
      parentSku: row.ParentProduct.sku,
      parentProductId: row.ParentProduct.id,
      quantity: toNumber(row.quantity),
      nomusComponentCode: row.nomusComponentCode,
      isNomusControlled: row.isNomusControlled,
      localException: row.localException,
      sourceSystem: row.sourceSystem,
      ...classified,
    });
  }

  const reactivateMaterial =
    prefer === "MATERIAL" && material != null && !isRegistryActiveStatus(material.status);

  const allowedRelinks = linesToRelink.filter((l) => l.action === "RELINK_TO_MATERIAL");
  const planHash = buildAmbiguityPlanHash({
    code,
    prefer,
    lineIds: allowedRelinks.map((l) => l.productBomLineId),
    reactivateMaterial,
  });

  const risks: string[] = [];
  const recommendations: string[] = [];

  if (!product && !material) {
    risks.push("Nenhum Product nem Material encontrado com este código.");
  }
  if (product && material) {
    risks.push("Código existe como Product e Material — ambiguidade cadastral.");
  }
  if (product && product._count.ProductBOM > 0 && product._count.ProductRouting === 0) {
    risks.push(
      "Product sem roteiro e com BOM própria vazia — custo OWN_PROCESS tende a excluir da análise."
    );
  }
  if (material && material._count.PurchaseRequestItem > 0) {
    risks.push("Material possui vínculos em pedidos de compra — reativação exige cautela.");
  }
  if (reactivateMaterial) {
    recommendations.push("Plano inclui reativação do Material (status ACTIVE).");
  }
  if (prefer === "MATERIAL") {
    recommendations.push(
      "Após apply, o código entra na allowlist PREFER_MATERIAL e o apply BOM Nomus usará Material ativo.",
    );
  }

  const productHasOwnStructure =
    !!product &&
    (product._count.ProductRouting > 0 || product._count.ProductBOM > 0);

  const materialUnitCost = material ? toNumber(material.standardCost) ?? toNumber(material.currentCost) : null;

  let productRecommendation = "Indefinido";
  if (prefer === "MATERIAL" && material) {
    productRecommendation =
      "Manter Product cadastrado, mas não usá-lo na ProductBOM Nomus; preferir Material para custo.";
  }

  if (prefer === "MATERIAL" && productHasOwnStructure) {
    risks.push(
      "Product possui BOM própria ou roteiro — não aplicar preferência MATERIAL automaticamente.",
    );
  }

  const blockingLines = linesToRelink.filter(
    (l) => l.eligibility === "BLOCKED" && l.action !== "SKIP"
  );
  const hasWork =
    reactivateMaterial ||
    allowedRelinks.length > 0 ||
    linesToRelink.some((l) => l.action === "NO_CHANGE");

  const canApply =
    prefer === "MATERIAL" &&
    !!material &&
    !!product &&
    !productHasOwnStructure &&
    hasWork &&
    blockingLines.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    code,
    prefer,
    planHash,
    confirmationRequiredText: confirmationTextForAmbiguityResolution(code, prefer),
    product: product
      ? {
          id: product.id,
          sku: product.sku,
          name: product.name,
          status: product.status,
          active: isRegistryActiveStatus(product.status),
          sourceSystem: product.sourceSystem,
          isNomusControlled: product.isNomusControlled,
          costingMode: String(product.costingMode),
          ownBomLineCount: product._count.ProductBOM,
          routingCount: product._count.ProductRouting,
        }
      : null,
    material: material
      ? {
          id: material.id,
          code: material.code,
          description: material.description,
          status: material.status,
          active: isRegistryActiveStatus(material.status),
          currentCost: toNumber(material.currentCost),
          standardCost: toNumber(material.standardCost),
          unit: material.unit,
          category: material.category,
        }
      : null,
    productBomAsProductCount: bomRows.filter((r) => r.childProductId === productId).length,
    productBomAsMaterialCount: bomRows.filter((r) => r.materialId === materialId).length,
    linesToRelink,
    reactivateMaterial,
    productRecommendation,
    costImpact: {
      summary:
        prefer === "MATERIAL" && materialUnitCost != null
          ? `Custo unitário esperado do Material: ${materialUnitCost} — linha deve entrar em materialCost após relink.`
          : "Sem custo de Material definido — verifique currentCost/standardCost.",
      materialUnitCost,
      expectsCostInclusionAfterApply:
        prefer === "MATERIAL" && materialUnitCost != null && materialUnitCost > 0,
    },
    risks,
    recommendations,
    canApply,
  };
}

export async function applyAmbiguityResolutionPlan(
  input: ApplyAmbiguityResolutionInput
): Promise<ApplyAmbiguityResolutionResult> {
  const plan = await buildAmbiguityResolutionPlan({
    code: input.code,
    prefer: input.prefer,
    allowLocalException: input.allowLocalException,
  });

  if (plan.planHash !== input.planHash.trim()) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      relinkedCount: 0,
      materialReactivated: false,
      runId: null,
      backupFilePath: null,
      message: "planHash divergente — regenere o preview.",
      errors: ["PLAN_HASH_MISMATCH"],
    };
  }

  const expected = confirmationTextForAmbiguityResolution(input.code, input.prefer);
  if (input.confirmationText.trim() !== expected) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      relinkedCount: 0,
      materialReactivated: false,
      runId: null,
      backupFilePath: null,
      message: `Confirmação inválida. Esperado: "${expected}"`,
      errors: ["CONFIRMATION_MISMATCH"],
    };
  }

  if (!plan.canApply) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      relinkedCount: 0,
      materialReactivated: false,
      runId: null,
      backupFilePath: null,
      message: "Plano bloqueado — revise linesToRelink e riscos.",
      errors: ["PLAN_BLOCKED"],
    };
  }

  const relinkIds = plan.linesToRelink
    .filter((l) => l.action === "RELINK_TO_MATERIAL")
    .map((l) => l.productBomLineId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows =
        relinkIds.length > 0
          ? await tx.productBOM.findMany({
              where: { id: { in: relinkIds } },
              select: {
                id: true,
                productId: true,
                materialId: true,
                childProductId: true,
                quantity: true,
                lossPercentage: true,
                notes: true,
                sourceSystem: true,
                isNomusControlled: true,
                localException: true,
                nomusComponentCode: true,
              },
            })
          : [];

      if (rows.length !== relinkIds.length) {
        throw new Error("Linhas ProductBOM do plano não encontradas.");
      }

      for (const row of rows) {
        if (row.localException && !input.allowLocalException) {
          throw new Error(`Linha ${row.id} com localException bloqueada.`);
        }
      }

      const backupSql = generateProductBomBackupSql(
        rows.map((r) => ({
          id: r.id,
          productId: r.productId,
          materialId: r.materialId,
          childProductId: r.childProductId,
          quantity: r.quantity.toString(),
          lossPercentage: r.lossPercentage?.toString() ?? null,
          notes: r.notes,
          sourceSystem: r.sourceSystem,
          isNomusControlled: r.isNomusControlled,
          localException: r.localException,
          nomusComponentCode: r.nomusComponentCode,
        }))
      );

      let backupFilePath: string | null = null;
      if (input.backupFilePath) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(input.backupFilePath, backupSql, "utf8");
        backupFilePath = input.backupFilePath;
      }

      let materialReactivated = false;
      if (plan.reactivateMaterial && plan.material) {
        await tx.material.update({
          where: { id: plan.material.id },
          data: { status: "ACTIVE" },
        });
        materialReactivated = true;
      }

      const materialId = plan.material!.id;
      for (const row of rows) {
        await tx.productBOM.update({
          where: { id: row.id },
          data: {
            materialId,
            childProductId: null,
          },
        });
      }

      if (input.prefer === "MATERIAL") {
        registerPreferMaterialComponentCode(input.code);
      }

      const run = await tx.engineeringSyncRun.create({
        data: {
          mode: "ONE_PRODUCT",
          status: "APPLIED",
          parentCode: null,
          planHash: plan.planHash,
          confirmationText: input.confirmationText.trim(),
          approvedBy: input.approvedBy ?? "ambiguity-resolution-cli",
          startedAt: new Date(),
          finishedAt: new Date(),
          summaryJson: {
            code: input.code,
            prefer: input.prefer,
            relinkedIds: relinkIds,
            materialReactivated,
          },
        },
      });

      for (const line of plan.linesToRelink.filter((l) => l.action === "RELINK_TO_MATERIAL")) {
        await tx.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: line.productBomLineId,
            productId: line.parentProductId,
            productSku: line.parentSku,
            changeOrigin: "MANUAL_EDIT",
            fieldName: "@relink_registry",
            oldValue: "PRODUCT",
            newValue: "MATERIAL",
            oldValueJson: { childProduct: plan.product?.id },
            newValueJson: { materialId: plan.material?.id },
            runId: run.id,
            planHash: plan.planHash,
            changedBy: input.approvedBy ?? "ambiguity-resolution-cli",
            reason: `Ambiguidade ${input.code}: ProductBOM relinkada para Material (${input.prefer}).`,
          },
        });
      }

      if (materialReactivated && plan.material) {
        await tx.engineeringChangeLog.create({
          data: {
            entityType: "MATERIAL",
            entityId: plan.material.id,
            changeOrigin: "MANUAL_EDIT",
            fieldName: "@reactivated",
            oldValue: plan.material.status,
            newValue: "ACTIVE",
            runId: run.id,
            planHash: plan.planHash,
            reason: `Material ${input.code} reativado para resolução de ambiguidade.`,
          },
        });
      }

      return { runId: run.id, backupFilePath, relinkedCount: rows.length, materialReactivated };
    });

    return {
      resultStatus: "APPLIED",
      planHash: plan.planHash,
      relinkedCount: result.relinkedCount,
      materialReactivated: result.materialReactivated,
      runId: result.runId,
      backupFilePath: result.backupFilePath,
      message: `${result.relinkedCount} linha(s) relinkada(s) para Material.${result.materialReactivated ? " Material reativado." : ""} Recalcule custo / confira análise.`,
      errors: [],
    };
  } catch (err) {
    return {
      resultStatus: "FAILED",
      planHash: plan.planHash,
      relinkedCount: 0,
      materialReactivated: false,
      runId: null,
      backupFilePath: null,
      message: err instanceof Error ? err.message : "Falha na transação.",
      errors: ["TRANSACTION_FAILED"],
    };
  }
}
