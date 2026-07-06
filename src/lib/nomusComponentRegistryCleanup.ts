import { createHash } from "node:crypto";
import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import { isRegistryActiveStatus } from "@/src/lib/nomusComponentRegistryResolve";
import {
  codeBaseLikeCore,
  componentCodeMatchesBasePrefix,
  confirmationTextForRegistryCleanup,
} from "@/src/lib/nomusComponentRegistryConflictShared";
import {
  loadEffectiveNomusCodesByParent,
  loadParentNomusStageSnapshotForCode,
} from "@/src/lib/nomusRegistryStageSnapshotView";

export type RegistryCleanupScope = "ONE_PARENT" | "ALL_PARENTS";

export type RegistryCleanupLineEligibility = "ALLOWED" | "BLOCKED";

export type RegistryCleanupPlanLine = {
  productBomLineId: string;
  parentSku: string;
  parentProductId: string;
  linkKind: "MATERIAL" | "PRODUCT" | "UNKNOWN";
  linkedCode: string;
  linkedDescription: string | null;
  linkedActive: boolean;
  isNomusControlled: boolean;
  localException: boolean;
  nomusComponentCode: string | null;
  quantity: number | null;
  eligibility: RegistryCleanupLineEligibility;
  removalReason: string | null;
  blockReason: string | null;
};

export type RegistryCleanupParentDetail = {
  parentCode: string;
  parentProductId: string | null;
  latestSyncedAt: string | null;
  latestRunId: string | null;
  /** Snapshot Nomus efetivo atual (mesmo critério do apply). */
  nomusStageLines: Array<{
    componentCode: string;
    componentDescription: string | null;
    quantity: number | null;
  }>;
  /** Apenas diagnóstico — não usado para wouldNomusRecreate nem expectedNomusComponentCodes. */
  historicalNomusStageLines: Array<{
    componentCode: string;
    componentDescription: string | null;
    quantity: number | null;
    syncedAt: string;
    runId: string | null;
    note: string;
  }>;
  productBomLines: Array<{
    productBomLineId: string;
    linkKind: "MATERIAL" | "PRODUCT" | "UNKNOWN";
    linkedCode: string;
    linkedActive: boolean;
    isNomusControlled: boolean;
    localException: boolean;
    nomusComponentCode: string | null;
    quantity: number | null;
  }>;
  comparisonLines: Array<{
    componentCode: string;
    status: string;
    nomusQuantity: number | null;
    indusQuantity: number | null;
  }>;
};

export type RegistryCleanupPlan = {
  generatedAt: string;
  planHash: string;
  code: string;
  scope: RegistryCleanupScope;
  parentCode: string | null;
  confirmationRequiredText: string;
  linesAllowed: RegistryCleanupPlanLine[];
  linesBlocked: RegistryCleanupPlanLine[];
  parentDetail: RegistryCleanupParentDetail | null;
  expectedNomusComponentCodes: string[];
  risks: string[];
  recommendations: string[];
  wouldNomusRecreateAfterCleanup: boolean;
  canApply: boolean;
  summary: {
    allowedCount: number;
    blockedCount: number;
    parentsAffected: number;
  };
};

export type ApplyRegistryCleanupInput = {
  code: string;
  scope: RegistryCleanupScope;
  parentCode?: string | null;
  planHash: string;
  confirmationText: string;
  approvedBy?: string;
  backupFilePath?: string;
  /** Permite remover linhas com localException (uso excepcional). */
  allowLocalException?: boolean;
};

export type ApplyRegistryCleanupResult = {
  resultStatus: "APPLIED" | "BLOCKED" | "FAILED";
  planHash: string;
  removedCount: number;
  removedLineIds: string[];
  backupFilePath: string | null;
  runId: string | null;
  message: string;
  errors: string[];
};

export function buildRegistryCleanupPlanHash(payload: {
  code: string;
  scope: RegistryCleanupScope;
  parentCode: string | null;
  allowedLineIds: string[];
}): string {
  const stable = {
    code: normalizeSku(payload.code),
    scope: payload.scope,
    parentCode: payload.parentCode ? normalizeSku(payload.parentCode) : null,
    allowedLineIds: [...payload.allowedLineIds].sort(),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type ClassifyCleanupLineInput = {
  codeBase: string;
  expectedNomusComponentCodes: string[];
  localException: boolean;
  isNomusControlled: boolean;
  linkKind: "MATERIAL" | "PRODUCT" | "UNKNOWN";
  linkedCode: string;
  linkedActive: boolean;
  allowLocalException?: boolean;
};

export function classifyCleanupBomLine(input: ClassifyCleanupLineInput): {
  eligibility: RegistryCleanupLineEligibility;
  removalReason: string | null;
  blockReason: string | null;
} {
  if (!componentCodeMatchesBasePrefix(input.codeBase, input.linkedCode)) {
    return {
      eligibility: "BLOCKED",
      removalReason: null,
      blockReason: "OUT_OF_CODE_SCOPE",
    };
  }

  if (input.localException && !input.allowLocalException) {
    return {
      eligibility: "BLOCKED",
      removalReason: null,
      blockReason: "LOCAL_EXCEPTION",
    };
  }

  if (!input.linkedActive) {
    if (!input.isNomusControlled) {
      return {
        eligibility: "BLOCKED",
        removalReason: null,
        blockReason: "MANUAL_BOM_LINE_INACTIVE_REGISTRY",
      };
    }
    return {
      eligibility: "ALLOWED",
      removalReason:
        input.linkKind === "MATERIAL"
          ? "ProductBOM vinculada a Material inativo (cadastro divergente/obsoleto)."
          : "ProductBOM vinculada a Product inativo.",
      blockReason: null,
    };
  }

  if (
    input.linkKind === "PRODUCT" &&
    input.expectedNomusComponentCodes.length > 0 &&
    !input.expectedNomusComponentCodes.some(
      (c) => normalizeSku(c) === normalizeSku(input.linkedCode)
    )
  ) {
    if (!input.isNomusControlled) {
      return {
        eligibility: "BLOCKED",
        removalReason: null,
        blockReason: "MANUAL_BOM_LINE_DIVERGENT_CODE",
      };
    }
    return {
      eligibility: "ALLOWED",
      removalReason: `Subproduto ativo divergente (${input.linkedCode}); Nomus espera ${input.expectedNomusComponentCodes.join(" ou ")}.`,
      blockReason: null,
    };
  }

  if (
    input.linkKind === "MATERIAL" &&
    input.isNomusControlled &&
    input.expectedNomusComponentCodes.length > 0 &&
    !input.expectedNomusComponentCodes.some(
      (c) => normalizeSku(c) === normalizeSku(input.linkedCode)
    )
  ) {
    return {
      eligibility: "ALLOWED",
      removalReason: `Material ativo com código divergente do Nomus (${input.linkedCode}).`,
      blockReason: null,
    };
  }

  return {
    eligibility: "BLOCKED",
    removalReason: null,
    blockReason: "NOT_ELIGIBLE",
  };
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function generateProductBomBackupSql(
  rows: Array<{
    id: string;
    productId: string;
    materialId: string | null;
    childProductId: string | null;
    quantity: string;
    lossPercentage: string | null;
    notes: string | null;
    sourceSystem: string | null;
    isNomusControlled: boolean;
    localException: boolean;
    nomusComponentCode: string | null;
  }>
): string {
  const lines: string[] = [
    "-- Backup ProductBOM (restauração manual)",
    `-- generatedAt: ${new Date().toISOString()}`,
    "BEGIN;",
  ];
  for (const row of rows) {
    const cols = [
      `"id"`,
      `"productId"`,
      `"materialId"`,
      `"childProductId"`,
      `"quantity"`,
      `"lossPercentage"`,
      `"notes"`,
      `"sourceSystem"`,
      `"isNomusControlled"`,
      `"localException"`,
      `"nomusComponentCode"`,
    ];
    const vals = [
      `'${sqlEscape(row.id)}'`,
      `'${sqlEscape(row.productId)}'`,
      row.materialId ? `'${sqlEscape(row.materialId)}'` : "NULL",
      row.childProductId ? `'${sqlEscape(row.childProductId)}'` : "NULL",
      row.quantity,
      row.lossPercentage ?? "NULL",
      row.notes ? `'${sqlEscape(row.notes)}'` : "NULL",
      row.sourceSystem ? `'${sqlEscape(row.sourceSystem)}'` : "NULL",
      row.isNomusControlled ? "true" : "false",
      row.localException ? "true" : "false",
      row.nomusComponentCode ? `'${sqlEscape(row.nomusComponentCode)}'` : "NULL",
    ];
    lines.push(`INSERT INTO "ProductBOM" (${cols.join(", ")}) VALUES (${vals.join(", ")});`);
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

async function loadParentProduct(parentCode: string) {
  const trimmed = parentCode.trim();
  return prisma.product.findFirst({
    where: { OR: [{ sku: trimmed }, { sku: normalizeSku(trimmed) }] },
    select: { id: true, sku: true, name: true },
  });
}

async function loadScopedBomRows(input: {
  codeBase: string;
  scope: RegistryCleanupScope;
  parentCode: string | null;
}) {
  const likeCore = codeBaseLikeCore(input.codeBase);
  const materials = await prisma.material.findMany({
    where: { code: { startsWith: likeCore, mode: "insensitive" } },
    select: { id: true, code: true, description: true, status: true },
  });
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: likeCore, mode: "insensitive" } },
    select: { id: true, sku: true, name: true, status: true },
  });

  const materialIds = materials.map((m) => m.id);
  const productIds = products.map((p) => p.id);
  if (materialIds.length === 0 && productIds.length === 0) {
    return { materials, products, bomRows: [] };
  }

  let parentProductId: string | null = null;
  if (input.scope === "ONE_PARENT") {
    const parent = await loadParentProduct(input.parentCode ?? "");
    if (!parent) {
      throw new Error(`Produto pai não encontrado: ${input.parentCode}`);
    }
    parentProductId = parent.id;
  }

  const bomRows = await prisma.productBOM.findMany({
    where: {
      ...(parentProductId ? { productId: parentProductId } : {}),
      OR: [
        ...(materialIds.length > 0 ? [{ materialId: { in: materialIds } }] : []),
        ...(productIds.length > 0 ? [{ childProductId: { in: productIds } }] : []),
      ],
    },
    select: {
      id: true,
      productId: true,
      quantity: true,
      nomusComponentCode: true,
      isNomusControlled: true,
      localException: true,
      materialId: true,
      childProductId: true,
      Material: { select: { code: true, description: true, status: true } },
      ChildProduct: { select: { sku: true, name: true, status: true } },
      ParentProduct: { select: { id: true, sku: true, name: true } },
    },
    orderBy: [{ ParentProduct: { sku: "asc" } }, { id: "asc" }],
  });

  return { materials, products, bomRows };
}

async function loadExpectedNomusCodesByParent(input: {
  codeBase: string;
  scope: RegistryCleanupScope;
  parentCode: string | null;
  parentSkusFromPlan?: string[];
}): Promise<{ global: string[]; byParent: Map<string, string[]> }> {
  if (input.scope === "ONE_PARENT" && input.parentCode) {
    const pKey = normalizeSku(input.parentCode);
    const view = await loadParentNomusStageSnapshotForCode({
      parentCode: input.parentCode,
      codeBase: input.codeBase,
    });
    const codes = [...new Set(view.effectiveLines.map((l) => l.componentCode))];
    return { global: codes, byParent: new Map([[pKey, codes]]) };
  }

  const parentKeys = [
    ...new Set((input.parentSkusFromPlan ?? []).map((p) => normalizeSku(p)).filter(Boolean)),
  ];
  const byParent = await loadEffectiveNomusCodesByParent(input.codeBase, parentKeys);
  const globalSet = new Set<string>();
  for (const codes of byParent.values()) {
    for (const c of codes) globalSet.add(c);
  }
  return { global: [...globalSet], byParent };
}

export async function buildParentDetail(
  parentCode: string,
  codeBase: string
): Promise<RegistryCleanupParentDetail> {
  const parent = await loadParentProduct(parentCode);

  const stageView = await loadParentNomusStageSnapshotForCode({ parentCode, codeBase });

  const productBomRows = parent
    ? await prisma.productBOM.findMany({
        where: { productId: parent.id },
        select: {
          id: true,
          quantity: true,
          nomusComponentCode: true,
          isNomusControlled: true,
          localException: true,
          materialId: true,
          childProductId: true,
          Material: { select: { code: true, status: true } },
          ChildProduct: { select: { sku: true, status: true } },
        },
      })
    : [];

  const productBomLines = productBomRows
    .filter((row) => {
      const code =
        row.Material?.code ?? row.ChildProduct?.sku ?? row.nomusComponentCode ?? "";
      return componentCodeMatchesBasePrefix(codeBase, code);
    })
    .map((row) => {
      const linkedCode = row.Material?.code ?? row.ChildProduct?.sku ?? "?";
      const linkedStatus = row.Material?.status ?? row.ChildProduct?.status ?? null;
      return {
        productBomLineId: row.id,
        linkKind: row.materialId
          ? ("MATERIAL" as const)
          : row.childProductId
            ? ("PRODUCT" as const)
            : ("UNKNOWN" as const),
        linkedCode,
        linkedActive: isRegistryActiveStatus(linkedStatus),
        isNomusControlled: row.isNomusControlled,
        localException: row.localException,
        nomusComponentCode: row.nomusComponentCode,
        quantity: row.quantity != null ? Number(row.quantity.toString()) : null,
      };
    });

  let comparisonLines: RegistryCleanupParentDetail["comparisonLines"] = [];
  if (parent) {
    const { buildBomComparisonForParentCode } = await import("@/src/lib/nomusBomComparisonLoad");
    const cmp = await buildBomComparisonForParentCode(parent.sku);
    comparisonLines = cmp.lines
      .filter((l) => componentCodeMatchesBasePrefix(codeBase, l.componentCode))
      .map((l) => ({
        componentCode: l.componentCode,
        status: l.status,
        nomusQuantity: l.nomusQuantity ?? null,
        indusQuantity: l.indusQuantity ?? null,
      }));
  }

  return {
    parentCode: parent?.sku ?? parentCode,
    parentProductId: parent?.id ?? null,
    latestSyncedAt: stageView.latestSyncedAt,
    latestRunId: stageView.latestRunId,
    nomusStageLines: stageView.effectiveLines,
    historicalNomusStageLines: stageView.historicalLines,
    productBomLines,
    comparisonLines,
  };
}

export async function buildRegistryCleanupPlan(input: {
  code: string;
  parentCode?: string | null;
  allParents?: boolean;
  allowLocalException?: boolean;
}): Promise<RegistryCleanupPlan> {
  const code = input.code.trim();
  if (!code) throw new Error("code é obrigatório.");

  const allParents = input.allParents === true;
  const parentCode = input.parentCode?.trim() || null;

  if (!allParents && !parentCode) {
    throw new Error("Informe --parentCode=<sku> ou --all-parents.");
  }
  if (allParents && parentCode) {
    throw new Error("Use apenas um modo: --parentCode ou --all-parents.");
  }

  const scope: RegistryCleanupScope = allParents ? "ALL_PARENTS" : "ONE_PARENT";
  const { bomRows } = await loadScopedBomRows({ codeBase: code, scope, parentCode });

  const parentSkusFromBom = [...new Set(bomRows.map((r) => r.ParentProduct.sku))];
  const { global: expectedNomusGlobal, byParent: expectedByParent } =
    await loadExpectedNomusCodesByParent({
      codeBase: code,
      scope,
      parentCode,
      parentSkusFromPlan: parentSkusFromBom,
    });

  const linesAllowed: RegistryCleanupPlanLine[] = [];
  const linesBlocked: RegistryCleanupPlanLine[] = [];

  for (const row of bomRows) {
    const linkKind = row.materialId
      ? ("MATERIAL" as const)
      : row.childProductId
        ? ("PRODUCT" as const)
        : ("UNKNOWN" as const);
    const linkedCode = row.Material?.code ?? row.ChildProduct?.sku ?? "?";
    const linkedStatus = row.Material?.status ?? row.ChildProduct?.status ?? null;
    const linkedActive = isRegistryActiveStatus(linkedStatus);

    const stageForParent =
      expectedByParent.get(normalizeSku(row.ParentProduct.sku)) ?? expectedNomusGlobal;

    const classified = classifyCleanupBomLine({
      codeBase: code,
      expectedNomusComponentCodes: stageForParent,
      localException: row.localException,
      isNomusControlled: row.isNomusControlled,
      linkKind,
      linkedCode,
      linkedActive,
      allowLocalException: input.allowLocalException,
    });

    const planLine: RegistryCleanupPlanLine = {
      productBomLineId: row.id,
      parentSku: row.ParentProduct.sku,
      parentProductId: row.ParentProduct.id,
      linkKind,
      linkedCode,
      linkedDescription: row.Material?.description ?? row.ChildProduct?.name ?? null,
      linkedActive,
      isNomusControlled: row.isNomusControlled,
      localException: row.localException,
      nomusComponentCode: row.nomusComponentCode,
      quantity: row.quantity != null ? Number(row.quantity.toString()) : null,
      eligibility: classified.eligibility,
      removalReason: classified.removalReason,
      blockReason: classified.blockReason,
    };

    if (classified.eligibility === "ALLOWED") {
      linesAllowed.push(planLine);
    } else {
      linesBlocked.push(planLine);
    }
  }

  const parentDetail =
    scope === "ONE_PARENT" && parentCode
      ? await buildParentDetail(parentCode, code)
      : null;

  const allowedLineIds = linesAllowed.map((l) => l.productBomLineId);
  const planHash = buildRegistryCleanupPlanHash({
    code,
    scope,
    parentCode,
    allowedLineIds,
  });

  const confirmationRequiredText = confirmationTextForRegistryCleanup(
    code,
    scope,
    parentCode
  );

  const parentsAffected = new Set(linesAllowed.map((l) => l.parentSku)).size;
  const risks: string[] = [];
  const recommendations: string[] = [
    "Após o apply, execute separadamente o apply controlado da BOM Nomus do produto pai (não é feito automaticamente).",
  ];

  if (scope === "ALL_PARENTS") {
    risks.push("Limpeza global: afeta múltiplos produtos pais — exige confirmação literal forte.");
  }
  if (linesBlocked.some((l) => l.blockReason === "LOCAL_EXCEPTION")) {
    risks.push("Linhas com localException=true estão bloqueadas (use flag explícita se necessário).");
  }
  if (linesBlocked.some((l) => l.blockReason?.startsWith("MANUAL_BOM"))) {
    risks.push("Linhas não controladas pelo Nomus exigem revisão manual.");
  }

  const wouldNomusRecreateAfterCleanup =
    scope === "ONE_PARENT" && parentCode
      ? (expectedByParent.get(normalizeSku(parentCode)) ?? []).length > 0
      : [...expectedByParent.values()].some((codes) => codes.length > 0);

  if (parentDetail && parentDetail.comparisonLines.length === 0 && parentDetail.productBomLines.length > 0) {
    recommendations.push(
      "comparisonLines vazio mas há ProductBOM no pai: possível divergência de código (ex. 420.01A vs 420.01A-) — use nomusStageLines e productBomLines do parentDetail.",
    );
  }
  if (
    parentDetail &&
    parentDetail.historicalNomusStageLines.length > 0 &&
    parentDetail.nomusStageLines.length === 0
  ) {
    risks.push(
      "Componente presente apenas em snapshot Nomus antigo (historicalNomusStageLines) — apply Nomus não recriará após limpeza."
    );
    recommendations.push(
      `${code}: existiu em snapshot antigo (${parentDetail.historicalNomusStageLines.map((h) => `${h.componentCode} @ ${h.syncedAt}`).join("; ")}) mas não na BOM efetiva atual (latestSyncedAt=${parentDetail.latestSyncedAt ?? "—"}). wouldNomusRecreateAfterCleanup=false para este pai.`
    );
  }
  if (!wouldNomusRecreateAfterCleanup && parentDetail?.productBomLines.length) {
    recommendations.push(
      "Após limpeza, a linha 420.01* não voltará automaticamente neste pai até o Nomus incluir o componente no snapshot efetivo e você rodar apply BOM separadamente."
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    planHash,
    code,
    scope,
    parentCode,
    confirmationRequiredText,
    linesAllowed,
    linesBlocked,
    parentDetail,
    expectedNomusComponentCodes: expectedNomusGlobal,
    risks,
    recommendations,
    wouldNomusRecreateAfterCleanup,
    canApply: linesAllowed.length > 0,
    summary: {
      allowedCount: linesAllowed.length,
      blockedCount: linesBlocked.length,
      parentsAffected,
    },
  };
}

export async function applyRegistryCleanupPlan(
  input: ApplyRegistryCleanupInput
): Promise<ApplyRegistryCleanupResult> {
  const plan = await buildRegistryCleanupPlan({
    code: input.code,
    parentCode: input.parentCode,
    allParents: input.scope === "ALL_PARENTS",
    allowLocalException: input.allowLocalException,
  });

  if (plan.planHash !== input.planHash.trim()) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      removedCount: 0,
      removedLineIds: [],
      backupFilePath: null,
      runId: null,
      message: "planHash divergente — regenere o preview.",
      errors: ["PLAN_HASH_MISMATCH"],
    };
  }

  const expectedConfirmation = confirmationTextForRegistryCleanup(
    input.code,
    input.scope,
    input.parentCode
  );
  if (input.confirmationText.trim() !== expectedConfirmation) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      removedCount: 0,
      removedLineIds: [],
      backupFilePath: null,
      runId: null,
      message: `Confirmação inválida. Esperado: "${expectedConfirmation}"`,
      errors: ["CONFIRMATION_MISMATCH"],
    };
  }

  if (plan.linesAllowed.length === 0) {
    return {
      resultStatus: "BLOCKED",
      planHash: plan.planHash,
      removedCount: 0,
      removedLineIds: [],
      backupFilePath: null,
      runId: null,
      message: "Nenhuma linha elegível para remoção no plano.",
      errors: ["NO_ALLOWED_LINES"],
    };
  }

  const allowedIds = plan.linesAllowed.map((l) => l.productBomLineId);
  const scopeParentKey =
    input.scope === "ONE_PARENT" && input.parentCode
      ? normalizeSku(input.parentCode)
      : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.productBOM.findMany({
        where: { id: { in: allowedIds } },
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
          ParentProduct: { select: { sku: true } },
        },
      });

      if (rows.length !== allowedIds.length) {
        throw new Error("Linhas do plano não encontradas ou já removidas.");
      }

      for (const row of rows) {
        if (scopeParentKey && normalizeSku(row.ParentProduct.sku) !== scopeParentKey) {
          throw new Error(
            `Linha ${row.id} pertence ao pai ${row.ParentProduct.sku}, fora do escopo ${scopeParentKey}.`
          );
        }
        if (row.localException && !input.allowLocalException) {
          throw new Error(`Linha ${row.id} tem localException=true.`);
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

      const run = await tx.engineeringSyncRun.create({
        data: {
          mode: input.scope === "ONE_PARENT" ? "ONE_PRODUCT" : "ALL_NOMUS_PRODUCTS",
          status: "APPLIED",
          parentCode: input.parentCode?.trim() || null,
          planHash: plan.planHash,
          confirmationText: input.confirmationText.trim(),
          approvedBy: input.approvedBy ?? "registry-cleanup-cli",
          startedAt: new Date(),
          finishedAt: new Date(),
          summaryJson: {
            code: input.code,
            scope: input.scope,
            removedLineIds: allowedIds,
            removedCount: allowedIds.length,
          },
        },
      });

      await tx.productBOM.deleteMany({ where: { id: { in: allowedIds } } });

      for (const line of plan.linesAllowed) {
        await tx.engineeringChangeLog.create({
          data: {
            entityType: "PRODUCT_BOM",
            entityId: line.productBomLineId,
            productId: line.parentProductId,
            productSku: line.parentSku,
            changeOrigin: "MANUAL_EDIT",
            fieldName: "@deleted",
            oldValue: line.linkedCode,
            newValue: null,
            oldValueJson: {
              productBomLineId: line.productBomLineId,
              linkKind: line.linkKind,
              linkedCode: line.linkedCode,
              removalReason: line.removalReason,
            },
            runId: run.id,
            planHash: plan.planHash,
            changedBy: input.approvedBy ?? "registry-cleanup-cli",
            reason: `Limpeza cadastro divergente ${input.code}: removida linha BOM ${line.linkedCode} (${line.removalReason})`,
          },
        });
      }

      return { runId: run.id, backupFilePath, removedCount: allowedIds.length };
    });

    return {
      resultStatus: "APPLIED",
      planHash: plan.planHash,
      removedCount: result.removedCount,
      removedLineIds: allowedIds,
      backupFilePath: result.backupFilePath,
      runId: result.runId,
      message: `${result.removedCount} linha(s) ProductBOM removida(s). Execute apply BOM Nomus do pai separadamente.`,
      errors: [],
    };
  } catch (err) {
    return {
      resultStatus: "FAILED",
      planHash: plan.planHash,
      removedCount: 0,
      removedLineIds: [],
      backupFilePath: null,
      runId: null,
      message: err instanceof Error ? err.message : "Falha na transação.",
      errors: ["TRANSACTION_FAILED"],
    };
  }
}
