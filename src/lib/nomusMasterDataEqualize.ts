/**
 * Igualar bases Nomus × IndusCost — fase NOMUS-MASTER-DATA-EQUALIZE-A.
 *
 * Lib server-side.
 *
 * Faz duas coisas:
 *  1. Preview read-only — compara códigos do stage Nomus com Product/Material
 *     existentes e propõe ações seguras (CREATE/UPDATE/DEACTIVATE/PRESERVE).
 *  2. Apply controlado — executa SOMENTE as ações seguras, sob confirmação
 *     textual exata, registrando histórico em EngineeringChangeLog.
 *
 * NÃO mexe em ProductBOM. NÃO altera preço, proposta, pedido, custos,
 * roteiro, ProductCostingMode ou simulações. NÃO faz delete físico.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  buildNomusMasterDataImportDiagnostic,
} from "@/src/lib/nomusMasterDataImport";
import {
  cleanNomusDescription,
  isAssemblyLocalCode,
  isSafeClassification,
} from "@/src/lib/nomusMasterDataImportShared";
import type {
  MasterDataCreatePayloadPreview,
  MasterDataRow,
} from "@/src/lib/nomusMasterDataImportTypes";
import {
  ensureNomusImportHistoryForMaterial,
  ensureNomusImportHistoryForProduct,
  recordEngineeringChange,
} from "@/src/lib/productChangeHistory";
import {
  EQUALIZE_CONFIRMATION_TEXT,
} from "@/src/lib/nomusMasterDataEqualizeTypes";
import type {
  EqualizeAction,
  EqualizeApplyErrorItem,
  EqualizeApplyReportItem,
  EqualizeApplyResult,
  EqualizeApplySafety,
  EqualizeApplyStatus,
  EqualizeFieldChange,
  EqualizePreviewResult,
  EqualizeRow,
  EqualizeTarget,
  EqualizeTotals,
} from "@/src/lib/nomusMasterDataEqualizeTypes";
import { equalizeActionLabel } from "@/src/lib/nomusMasterDataEqualizeShared";
import { buildEqualizeUserMessage } from "@/src/lib/nomusEqualizeUserMessages";

const EQUALIZE_APPLY_SAFETY: EqualizeApplySafety = {
  productBomChanged: false,
  costsChanged: false,
  pricesChanged: false,
  proposalsChanged: false,
  ordersChanged: false,
  routingChanged: false,
};

function mapFailedReportToApplyErrors(
  report: EqualizeApplyReportItem[]
): EqualizeApplyErrorItem[] {
  return report
    .filter((r) => r.outcome === "FAILED")
    .map((r) => ({
      code: r.code,
      action: r.action,
      message: r.message,
      userMessage: `Não foi possível processar ${r.code} (${equalizeActionLabel(r.action)}).`,
      resolutionHint:
        "Revise o cadastro no Nomus e no IndusCost, depois rode o preview novamente.",
      sku: r.code,
    }));
}

function finalizeApplyResult(args: {
  generatedAt: string;
  status: EqualizeApplyStatus;
  message: string;
  runId: string;
  planHash?: string | null;
  createdProducts: number;
  createdMaterials: number;
  updatedProducts: number;
  updatedMaterials: number;
  deactivatedProducts: number;
  deactivatedMaterials: number;
  preservedLocal: number;
  blocked: number;
  errors: number;
  historyEntriesCreated: number;
  totalRequested: number;
  report: EqualizeApplyReportItem[];
  previewTotals?: EqualizeTotals;
  semanticRunStatus?: string;
}): EqualizeApplyResult {
  const applyErrors = mapFailedReportToApplyErrors(args.report);
  const partial: EqualizeApplyResult = {
    mode: "APPLY_SAFE",
    generatedAt: args.generatedAt,
    status: args.status,
    message: args.message,
    userMessage: "",
    runId: args.runId,
    createdProducts: args.createdProducts,
    createdMaterials: args.createdMaterials,
    updatedProducts: args.updatedProducts,
    updatedMaterials: args.updatedMaterials,
    deactivatedProducts: args.deactivatedProducts,
    deactivatedMaterials: args.deactivatedMaterials,
    preservedLocal: args.preservedLocal,
    blocked: args.blocked,
    errors: args.errors,
    historyEntriesCreated: args.historyEntriesCreated,
    totalRequested: args.totalRequested,
    report: args.report,
    previewTotals: args.previewTotals,
    safety: EQUALIZE_APPLY_SAFETY,
    applyErrors,
    technicalDetails: {
      planHash: args.planHash ?? null,
      generatedAt: args.generatedAt,
      confirmationRequiredText: EQUALIZE_CONFIRMATION_TEXT,
      semanticRunStatus: args.semanticRunStatus,
    },
  };
  partial.userMessage = buildEqualizeUserMessage(partial, args.previewTotals ?? null);
  return partial;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_APPLY_BATCH = 300;
const NOMUS_SOURCE = "NOMUS";
const NOMUS_MATERIAL_CATEGORY = "NOMUS_IMPORT";
/** Identificador de origem usado no summaryJson do EngineeringSyncRun. */
const EQUALIZE_RUN_ORIGIN = "MASTER_DATA_EQUALIZE" as const;

/** Cria o EngineeringSyncRun pai antes de gravar histórico (respeita a FK runId). */
async function openEqualizationRun(input: {
  applicableCodes: string[];
  confirmationText: string;
  requestedBy: string | null;
  previewTotals: Record<string, number>;
}): Promise<{ runId: string; planHash: string }> {
  // planHash determinístico do conjunto de códigos a serem alterados.
  const fingerprint = [...input.applicableCodes].sort().join("|");
  const planHash = createHash("sha1")
    .update(`equalize|${fingerprint || "empty"}|${new Date().toISOString().slice(0, 10)}`)
    .digest("hex");

  const run = await prisma.engineeringSyncRun.create({
    data: {
      mode: "ALL_NOMUS_PRODUCTS",
      status: "PREVIEWED",
      parentCode: null,
      planHash,
      confirmationText: input.confirmationText,
      approvedBy: input.requestedBy ?? "nomus-equalize",
      startedAt: new Date(),
      summaryJson: {
        origin: EQUALIZE_RUN_ORIGIN,
        applicableCount: input.applicableCodes.length,
        previewTotals: input.previewTotals,
      } as never,
    },
    select: { id: true },
  });
  return { runId: run.id, planHash };
}

/** Atualiza o EngineeringSyncRun com status final e contadores ao fim do apply. */
async function closeEqualizationRun(input: {
  runId: string;
  status: "APPLIED" | "PARTIAL" | "FAILED";
  summaryJson: Record<string, unknown>;
  errorsJson?: unknown;
}): Promise<void> {
  try {
    await prisma.engineeringSyncRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        summaryJson: input.summaryJson as never,
        errorsJson: input.errorsJson === undefined ? undefined : (input.errorsJson as never),
      },
    });
  } catch (err) {
    // Não relançar — o apply principal não pode falhar por causa do update do cabeçalho.
    console.error("[equalize] falha ao fechar run", input.runId, err);
  }
}

function clampLimit(limit?: number): number {
  const raw = Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_LIMIT);
}

function clampOffset(offset?: number): number {
  const raw = Number.isFinite(offset ?? NaN) ? Number(offset) : 0;
  return Math.max(0, Math.floor(raw));
}

type ProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  sourceSystem: string | null;
  isNomusControlled: boolean;
  status: string | null;
  type: "PRODUCT" | "COMPONENT";
};

type MaterialSnapshot = {
  id: string;
  code: string;
  description: string;
  category: string;
  status: string | null;
};

function isProductNomusControlled(p: ProductSnapshot): boolean {
  return p.isNomusControlled === true || p.sourceSystem === NOMUS_SOURCE;
}

function isMaterialNomusControlled(m: MaterialSnapshot): boolean {
  return m.category === NOMUS_MATERIAL_CATEGORY;
}

async function loadAllNomusControlledNotInStage(stageCodes: Set<string>): Promise<{
  products: ProductSnapshot[];
  materials: MaterialSnapshot[];
}> {
  // Selecionamos itens controlados pelo Nomus para detectar os que sumiram do stage.
  const productsRaw = await prisma.product.findMany({
    where: {
      OR: [{ isNomusControlled: true }, { sourceSystem: NOMUS_SOURCE }],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      sourceSystem: true,
      isNomusControlled: true,
      status: true,
      type: true,
    },
  });
  const materialsRaw = await prisma.material.findMany({
    where: { category: NOMUS_MATERIAL_CATEGORY },
    select: {
      id: true,
      code: true,
      description: true,
      category: true,
      status: true,
    },
  });

  const products: ProductSnapshot[] = productsRaw
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      sourceSystem: p.sourceSystem,
      isNomusControlled: p.isNomusControlled,
      status: p.status,
      type: p.type as "PRODUCT" | "COMPONENT",
    }))
    .filter((p) => !stageCodes.has(normalizeSku(p.sku)));

  const materials: MaterialSnapshot[] = materialsRaw
    .map((m) => ({
      id: m.id,
      code: m.code,
      description: m.description,
      category: m.category,
      status: m.status,
    }))
    .filter((m) => !stageCodes.has(normalizeSku(m.code)));

  return { products, materials };
}

async function loadProductAndMaterialByCodes(
  codes: string[]
): Promise<{
  productsByKey: Map<string, ProductSnapshot>;
  materialsByKey: Map<string, MaterialSnapshot>;
}> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { productsByKey: new Map(), materialsByKey: new Map() };
  }
  const normalized = new Set(unique.map((c) => normalizeSku(c)));
  const lookup = [...new Set([...unique, ...normalized])];

  const [products, materials] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: lookup } },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        sourceSystem: true,
        isNomusControlled: true,
        status: true,
        type: true,
      },
    }),
    prisma.material.findMany({
      where: { code: { in: lookup } },
      select: {
        id: true,
        code: true,
        description: true,
        category: true,
        status: true,
      },
    }),
  ]);

  const productsByKey = new Map<string, ProductSnapshot>();
  for (const p of products) {
    productsByKey.set(normalizeSku(p.sku), {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      sourceSystem: p.sourceSystem,
      isNomusControlled: p.isNomusControlled,
      status: p.status,
      type: p.type as "PRODUCT" | "COMPONENT",
    });
  }

  const materialsByKey = new Map<string, MaterialSnapshot>();
  for (const m of materials) {
    materialsByKey.set(normalizeSku(m.code), {
      id: m.id,
      code: m.code,
      description: m.description,
      category: m.category,
      status: m.status,
    });
  }

  return { productsByKey, materialsByKey };
}

function nomusDescription(row: MasterDataRow): string {
  return cleanNomusDescription(row.description);
}

function emptyCurrentSnapshot(): EqualizeRow["currentSnapshot"] {
  return {
    productId: null,
    materialId: null,
    productName: null,
    productSourceSystem: null,
    productIsNomusControlled: null,
    productStatus: null,
    materialDescription: null,
    materialCategory: null,
    materialStatus: null,
  };
}

function snapshotFromProduct(p: ProductSnapshot | undefined): EqualizeRow["currentSnapshot"] {
  const base = emptyCurrentSnapshot();
  if (!p) return base;
  base.productId = p.id;
  base.productName = p.name;
  base.productSourceSystem = p.sourceSystem;
  base.productIsNomusControlled = p.isNomusControlled;
  base.productStatus = p.status;
  return base;
}

function snapshotFromMaterial(
  m: MaterialSnapshot | undefined,
  base: EqualizeRow["currentSnapshot"]
): EqualizeRow["currentSnapshot"] {
  if (!m) return base;
  return {
    ...base,
    materialId: m.id,
    materialDescription: m.description,
    materialCategory: m.category,
    materialStatus: m.status,
  };
}

function diffProductFields(
  current: ProductSnapshot,
  proposed: { name: string; description: string | null }
): EqualizeFieldChange[] {
  const changes: EqualizeFieldChange[] = [];
  if (proposed.name && current.name !== proposed.name) {
    changes.push({ fieldName: "name", oldValue: current.name, newValue: proposed.name });
  }
  const newDescription = proposed.description ?? null;
  if ((current.description ?? null) !== newDescription) {
    changes.push({
      fieldName: "description",
      oldValue: current.description ?? null,
      newValue: newDescription,
    });
  }
  if (current.isNomusControlled !== true) {
    changes.push({
      fieldName: "isNomusControlled",
      oldValue: String(current.isNomusControlled),
      newValue: "true",
    });
  }
  if (current.sourceSystem !== NOMUS_SOURCE) {
    changes.push({
      fieldName: "sourceSystem",
      oldValue: current.sourceSystem ?? null,
      newValue: NOMUS_SOURCE,
    });
  }
  return changes;
}

function diffMaterialFields(
  current: MaterialSnapshot,
  proposed: { description: string }
): EqualizeFieldChange[] {
  const changes: EqualizeFieldChange[] = [];
  if (proposed.description && current.description !== proposed.description) {
    changes.push({
      fieldName: "description",
      oldValue: current.description,
      newValue: proposed.description,
    });
  }
  return changes;
}

function classifyRow(
  row: MasterDataRow,
  productByKey: Map<string, ProductSnapshot>,
  materialByKey: Map<string, MaterialSnapshot>
): EqualizeRow {
  const key = normalizeSku(row.code);
  const existingProduct = productByKey.get(key);
  const existingMaterial = materialByKey.get(key);
  let snapshot = snapshotFromProduct(existingProduct);
  snapshot = snapshotFromMaterial(existingMaterial, snapshot);
  const description = nomusDescription(row);

  // Bloqueios fortes que precedem qualquer outra ação.
  if (isAssemblyLocalCode(row.code)) {
    return {
      code: row.code,
      description: description || null,
      action: "BLOCKED_LOCAL_PROCESS_CODE",
      actionLabel: equalizeActionLabel("BLOCKED_LOCAL_PROCESS_CODE"),
      target: "NONE",
      currentSnapshot: snapshot,
      createPayload: null,
      fieldChanges: [],
      reason:
        "Códigos 800.xx são montagem local do IndusCost — nunca importados, atualizados ou removidos automaticamente.",
      blockers: ["Código 800.xx — preservado como montagem local."],
      warnings: [],
      isControlledByNomus: false,
      appearsInNomusStage: true,
    };
  }

  // Caso: código existe em Product E Material (ambíguo).
  if (existingProduct && existingMaterial) {
    return {
      code: row.code,
      description: description || null,
      action: "AMBIGUOUS_REVIEW",
      actionLabel: equalizeActionLabel("AMBIGUOUS_REVIEW"),
      target: "NONE",
      currentSnapshot: snapshot,
      createPayload: null,
      fieldChanges: [],
      reason:
        "Código existe simultaneamente como Product e Material — necessária decisão humana.",
      blockers: ["Duplicidade Product/Material — revisar manualmente."],
      warnings: [],
      isControlledByNomus: false,
      appearsInNomusStage: true,
    };
  }

  // Caso: existe como Product.
  if (existingProduct) {
    const isControlled = isProductNomusControlled(existingProduct);
    if (!isControlled) {
      return {
        code: row.code,
        description: description || null,
        action: "PRESERVE_LOCAL",
        actionLabel: equalizeActionLabel("PRESERVE_LOCAL"),
        target: "PRODUCT",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason:
          "Product existe no IndusCost como local/manual (não está marcado como Nomus). Não será alterado.",
        blockers: [],
        warnings: description
          ? existingProduct.name !== description
            ? ["Nome local diverge do Nomus — revisar manualmente se desejar atualizar."]
            : []
          : [],
        isControlledByNomus: false,
        appearsInNomusStage: true,
      };
    }
    if (!description) {
      return {
        code: row.code,
        description: null,
        action: "BLOCKED_MISSING_DESCRIPTION",
        actionLabel: equalizeActionLabel("BLOCKED_MISSING_DESCRIPTION"),
        target: "PRODUCT",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason: "Nomus não possui descrição utilizável para atualizar este Product.",
        blockers: ["Descrição Nomus vazia."],
        warnings: [],
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
    const fieldChanges = diffProductFields(existingProduct, {
      name: description,
      description: description || null,
    });
    if (fieldChanges.length === 0) {
      return {
        code: row.code,
        description,
        action: "PRESERVE_NOMUS_CONTROLLED",
        actionLabel: equalizeActionLabel("PRESERVE_NOMUS_CONTROLLED"),
        target: "PRODUCT",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason: "Product controlado pelo Nomus já está alinhado.",
        blockers: [],
        warnings: [],
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
    return {
      code: row.code,
      description,
      action: "UPDATE_PRODUCT",
      actionLabel: equalizeActionLabel("UPDATE_PRODUCT"),
      target: "PRODUCT",
      currentSnapshot: snapshot,
      createPayload: null,
      fieldChanges,
      reason: "Product controlado pelo Nomus tem campos divergentes do stage Nomus.",
      blockers: [],
      warnings: [],
      isControlledByNomus: true,
      appearsInNomusStage: true,
    };
  }

  // Caso: existe como Material.
  if (existingMaterial) {
    const isControlled = isMaterialNomusControlled(existingMaterial);
    if (!isControlled) {
      return {
        code: row.code,
        description: description || null,
        action: "PRESERVE_LOCAL",
        actionLabel: equalizeActionLabel("PRESERVE_LOCAL"),
        target: "MATERIAL",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason:
          "Material existe no IndusCost com categoria local — não foi cadastrado pela Carga Mestre Nomus. Não será alterado.",
        blockers: [],
        warnings: [],
        isControlledByNomus: false,
        appearsInNomusStage: true,
      };
    }
    if (!description) {
      return {
        code: row.code,
        description: null,
        action: "BLOCKED_MISSING_DESCRIPTION",
        actionLabel: equalizeActionLabel("BLOCKED_MISSING_DESCRIPTION"),
        target: "MATERIAL",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason: "Nomus não possui descrição utilizável para atualizar este Material.",
        blockers: ["Descrição Nomus vazia."],
        warnings: [],
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
    const fieldChanges = diffMaterialFields(existingMaterial, { description });
    if (fieldChanges.length === 0) {
      return {
        code: row.code,
        description,
        action: "PRESERVE_NOMUS_CONTROLLED",
        actionLabel: equalizeActionLabel("PRESERVE_NOMUS_CONTROLLED"),
        target: "MATERIAL",
        currentSnapshot: snapshot,
        createPayload: null,
        fieldChanges: [],
        reason: "Material controlado pelo Nomus já está alinhado.",
        blockers: [],
        warnings: [],
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
    return {
      code: row.code,
      description,
      action: "UPDATE_MATERIAL",
      actionLabel: equalizeActionLabel("UPDATE_MATERIAL"),
      target: "MATERIAL",
      currentSnapshot: snapshot,
      createPayload: null,
      fieldChanges,
      reason: "Material controlado pelo Nomus tem descrição divergente do stage Nomus.",
      blockers: [],
      warnings: [],
      isControlledByNomus: true,
      appearsInNomusStage: true,
    };
  }

  // Caso: não existe em nenhum lado. Usamos a classificação da Carga Mestre.
  if (isSafeClassification(row.classification) && row.proposedCreatePayloadPreview) {
    const payload = row.proposedCreatePayloadPreview as MasterDataCreatePayloadPreview;
    if (payload?.kind === "PRODUCT") {
      return {
        code: row.code,
        description,
        action: "CREATE_PRODUCT",
        actionLabel: equalizeActionLabel("CREATE_PRODUCT"),
        target: "PRODUCT",
        currentSnapshot: snapshot,
        createPayload: payload,
        fieldChanges: [],
        reason: row.reason,
        blockers: [],
        warnings: row.warnings,
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
    if (payload?.kind === "MATERIAL") {
      return {
        code: row.code,
        description,
        action: "CREATE_MATERIAL",
        actionLabel: equalizeActionLabel("CREATE_MATERIAL"),
        target: "MATERIAL",
        currentSnapshot: snapshot,
        createPayload: payload,
        fieldChanges: [],
        reason: row.reason,
        blockers: [],
        warnings: row.warnings,
        isControlledByNomus: true,
        appearsInNomusStage: true,
      };
    }
  }

  if (
    row.classification === "BLOCKED_INVALID_CODE" ||
    row.classification === "BLOCKED_MISSING_DESCRIPTION" ||
    row.classification === "BLOCKED_UNSUPPORTED_REQUIRED_FIELDS"
  ) {
    return {
      code: row.code,
      description: description || null,
      action: row.classification === "BLOCKED_MISSING_DESCRIPTION"
        ? "BLOCKED_MISSING_DESCRIPTION"
        : "AMBIGUOUS_REVIEW",
      actionLabel: equalizeActionLabel(
        row.classification === "BLOCKED_MISSING_DESCRIPTION"
          ? "BLOCKED_MISSING_DESCRIPTION"
          : "AMBIGUOUS_REVIEW"
      ),
      target: "NONE",
      currentSnapshot: snapshot,
      createPayload: null,
      fieldChanges: [],
      reason: row.reason,
      blockers: row.blockers,
      warnings: row.warnings,
      isControlledByNomus: false,
      appearsInNomusStage: true,
    };
  }

  return {
    code: row.code,
    description: description || null,
    action: "AMBIGUOUS_REVIEW",
    actionLabel: equalizeActionLabel("AMBIGUOUS_REVIEW"),
    target: "NONE",
    currentSnapshot: snapshot,
    createPayload: null,
    fieldChanges: [],
    reason: row.reason,
    blockers: row.blockers,
    warnings: row.warnings,
    isControlledByNomus: false,
    appearsInNomusStage: true,
  };
}

function buildDeactivateRow(input: {
  code: string;
  description: string | null;
  target: "PRODUCT" | "MATERIAL";
  snapshot: EqualizeRow["currentSnapshot"];
  currentStatus: string | null;
}): EqualizeRow {
  if ((input.currentStatus ?? "ACTIVE") !== "ACTIVE") {
    return {
      code: input.code,
      description: input.description,
      action: "NO_CHANGES",
      actionLabel: equalizeActionLabel("NO_CHANGES"),
      target: input.target,
      currentSnapshot: input.snapshot,
      createPayload: null,
      fieldChanges: [],
      reason:
        "Item controlado pelo Nomus não está mais no stage Nomus, e já não está ativo no IndusCost.",
      blockers: [],
      warnings: [],
      isControlledByNomus: true,
      appearsInNomusStage: false,
    };
  }
  return {
    code: input.code,
    description: input.description,
    action: input.target === "PRODUCT" ? "DEACTIVATE_PRODUCT" : "DEACTIVATE_MATERIAL",
    actionLabel: equalizeActionLabel(
      input.target === "PRODUCT" ? "DEACTIVATE_PRODUCT" : "DEACTIVATE_MATERIAL"
    ),
    target: input.target,
    currentSnapshot: input.snapshot,
    createPayload: null,
    fieldChanges: [
      {
        fieldName: "status",
        oldValue: input.currentStatus,
        newValue: "INACTIVE",
      },
    ],
    reason:
      "Item está marcado como Nomus mas não aparece mais no stage Nomus — será marcado como INACTIVE (nunca apagado fisicamente).",
    blockers: [],
    warnings: [],
    isControlledByNomus: true,
    appearsInNomusStage: false,
  };
}

function aggregateTotals(rows: EqualizeRow[]): EqualizeTotals {
  const totals: EqualizeTotals = {
    createProducts: 0,
    createMaterials: 0,
    updateProducts: 0,
    updateMaterials: 0,
    deactivateProducts: 0,
    deactivateMaterials: 0,
    preserveLocalProducts: 0,
    preserveLocalMaterials: 0,
    preserveNomusControlled: 0,
    ambiguous: 0,
    blocked: 0,
    noChanges: 0,
    totalRowsConsidered: rows.length,
  };
  for (const r of rows) {
    switch (r.action) {
      case "CREATE_PRODUCT":
        totals.createProducts += 1;
        break;
      case "CREATE_MATERIAL":
        totals.createMaterials += 1;
        break;
      case "UPDATE_PRODUCT":
        totals.updateProducts += 1;
        break;
      case "UPDATE_MATERIAL":
        totals.updateMaterials += 1;
        break;
      case "DEACTIVATE_PRODUCT":
        totals.deactivateProducts += 1;
        break;
      case "DEACTIVATE_MATERIAL":
        totals.deactivateMaterials += 1;
        break;
      case "PRESERVE_LOCAL":
        if (r.target === "PRODUCT") totals.preserveLocalProducts += 1;
        else if (r.target === "MATERIAL") totals.preserveLocalMaterials += 1;
        break;
      case "PRESERVE_NOMUS_CONTROLLED":
        totals.preserveNomusControlled += 1;
        break;
      case "AMBIGUOUS_REVIEW":
        totals.ambiguous += 1;
        break;
      case "BLOCKED_LOCAL_PROCESS_CODE":
      case "BLOCKED_MISSING_DESCRIPTION":
        totals.blocked += 1;
        break;
      case "NO_CHANGES":
        totals.noChanges += 1;
        break;
    }
  }
  return totals;
}

export type BuildEqualizePreviewInput = {
  limit?: number;
  offset?: number;
  search?: string;
  scope?: "ALL" | "ACTIONABLE";
  includeExisting?: boolean;
  includeUnmatchedIndusCost?: boolean;
};

async function buildAllEqualizeRows(opts: {
  includeUnmatchedIndusCost: boolean;
}): Promise<EqualizeRow[]> {
  // 1. Reusa o diagnóstico master-data (já agrega códigos e classifica) para
  //    pegar TODAS as linhas, incluindo existentes — precisamos das duas pontas.
  const diagnostic = await buildNomusMasterDataImportDiagnostic({
    limit: MAX_LIMIT,
    offset: 0,
    includeExisting: true,
  });
  const allRows = diagnostic.rows;
  // O diagnóstico já é ordenado e paginado em MAX_LIMIT; pode haver mais.
  // Vamos varrer todas as páginas restantes para o equalize.
  let collected: MasterDataRow[] = [...allRows];
  let offset = collected.length;
  while (diagnostic.pagination.totalRowsMatched > offset && offset < 5000) {
    const more = await buildNomusMasterDataImportDiagnostic({
      limit: MAX_LIMIT,
      offset,
      includeExisting: true,
    });
    if (more.rows.length === 0) break;
    collected = collected.concat(more.rows);
    offset += more.rows.length;
    if (!more.pagination.hasMore) break;
  }

  // 2. Carrega snapshots reais (Product/Material) para os códigos coletados.
  const allCodes = collected.map((r) => r.code);
  const { productsByKey, materialsByKey } = await loadProductAndMaterialByCodes(allCodes);

  const stageCodes = new Set(collected.map((r) => normalizeSku(r.code)));

  // 3. Classifica cada linha do diagnóstico no contexto do equalize.
  const equalizeRows: EqualizeRow[] = collected.map((row) =>
    classifyRow(row, productsByKey, materialsByKey)
  );

  // 4. Detecta itens controlados pelo Nomus que sumiram do stage → DEACTIVATE.
  if (opts.includeUnmatchedIndusCost) {
    const missing = await loadAllNomusControlledNotInStage(stageCodes);
    for (const p of missing.products) {
      equalizeRows.push(
        buildDeactivateRow({
          code: p.sku,
          description: p.description ?? p.name,
          target: "PRODUCT",
          snapshot: snapshotFromProduct(p),
          currentStatus: p.status ?? null,
        })
      );
    }
    for (const m of missing.materials) {
      const snap = snapshotFromMaterial(m, emptyCurrentSnapshot());
      equalizeRows.push(
        buildDeactivateRow({
          code: m.code,
          description: m.description,
          target: "MATERIAL",
          snapshot: snap,
          currentStatus: m.status ?? null,
        })
      );
    }
  }

  // 5. Ordena: ações primeiro, preserves depois.
  const weight: Record<EqualizeAction, number> = {
    CREATE_PRODUCT: 0,
    CREATE_MATERIAL: 0,
    UPDATE_PRODUCT: 1,
    UPDATE_MATERIAL: 1,
    DEACTIVATE_PRODUCT: 2,
    DEACTIVATE_MATERIAL: 2,
    AMBIGUOUS_REVIEW: 3,
    BLOCKED_LOCAL_PROCESS_CODE: 3,
    BLOCKED_MISSING_DESCRIPTION: 3,
    PRESERVE_LOCAL: 4,
    PRESERVE_NOMUS_CONTROLLED: 5,
    NO_CHANGES: 6,
  };
  equalizeRows.sort((a, b) => {
    const wa = weight[a.action];
    const wb = weight[b.action];
    if (wa !== wb) return wa - wb;
    return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
  });
  return equalizeRows;
}

function filterEqualizeRows(
  rows: EqualizeRow[],
  filters: { search?: string; scope?: "ALL" | "ACTIONABLE" }
): EqualizeRow[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const onlyActionable = (filters.scope ?? "ACTIONABLE") === "ACTIONABLE";

  return rows.filter((r) => {
    if (onlyActionable) {
      if (
        r.action === "PRESERVE_NOMUS_CONTROLLED" ||
        r.action === "PRESERVE_LOCAL" ||
        r.action === "NO_CHANGES"
      ) {
        return false;
      }
    }
    if (search) {
      const hay = `${r.code} ${r.description ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export async function buildNomusMasterDataEqualizePreview(
  input: BuildEqualizePreviewInput = {}
): Promise<EqualizePreviewResult> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  const includeUnmatchedIndusCost = input.includeUnmatchedIndusCost !== false;

  const allRows = await buildAllEqualizeRows({ includeUnmatchedIndusCost });
  const totals = aggregateTotals(allRows);
  const filtered = filterEqualizeRows(allRows, {
    search: input.search,
    scope: input.scope,
  });
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    mode: "READ_ONLY",
    generatedAt,
    totals,
    rows: page,
    pagination: {
      limit,
      offset,
      hasMore,
      nextOffset,
      totalRowsMatched: filtered.length,
    },
    warnings: [],
  };
}

export type ApplyEqualizeInput = {
  confirmationText: string;
  scope?: "SAFE_ONLY";
  codes?: string[];
  requestedBy?: string | null;
};

const APPLYABLE_ACTIONS: EqualizeAction[] = [
  "CREATE_PRODUCT",
  "CREATE_MATERIAL",
  "UPDATE_PRODUCT",
  "UPDATE_MATERIAL",
  "DEACTIVATE_PRODUCT",
  "DEACTIVATE_MATERIAL",
];

export async function applyNomusMasterDataEqualize(
  input: ApplyEqualizeInput
): Promise<EqualizeApplyResult> {
  const generatedAt = new Date().toISOString();

  const blockedResult = (message: string, status: EqualizeApplyStatus = "BLOCKED") =>
    finalizeApplyResult({
      generatedAt,
      status,
      message,
      runId: "",
      createdProducts: 0,
      createdMaterials: 0,
      updatedProducts: 0,
      updatedMaterials: 0,
      deactivatedProducts: 0,
      deactivatedMaterials: 0,
      preservedLocal: 0,
      blocked: 0,
      errors: 0,
      historyEntriesCreated: 0,
      totalRequested: 0,
      report: [],
    });

  if ((input.scope ?? "SAFE_ONLY") !== "SAFE_ONLY") {
    return blockedResult('Apenas scope="SAFE_ONLY" é aceito nesta fase.');
  }
  if (input.confirmationText !== EQUALIZE_CONFIRMATION_TEXT) {
    return blockedResult(
      `Confirmação inválida — envie confirmationText exatamente igual a: "${EQUALIZE_CONFIRMATION_TEXT}".`
    );
  }

  const allRows = await buildAllEqualizeRows({ includeUnmatchedIndusCost: true });
  const codesSet = input.codes && input.codes.length > 0
    ? new Set(input.codes.map((c) => normalizeSku(c)))
    : null;

  const applicable = allRows.filter((r) => {
    if (codesSet && !codesSet.has(normalizeSku(r.code))) return false;
    return APPLYABLE_ACTIONS.includes(r.action);
  });

  if (applicable.length === 0) {
    const previewTotals = aggregateTotals(allRows);
    return finalizeApplyResult({
      generatedAt,
      status: "NO_CHANGES",
      message: "Nenhuma ação aplicável com os filtros atuais.",
      runId: "",
      createdProducts: 0,
      createdMaterials: 0,
      updatedProducts: 0,
      updatedMaterials: 0,
      deactivatedProducts: 0,
      deactivatedMaterials: 0,
      preservedLocal: 0,
      blocked: 0,
      errors: 0,
      historyEntriesCreated: 0,
      totalRequested: 0,
      report: [],
      previewTotals,
    });
  }

  if (applicable.length > MAX_APPLY_BATCH) {
    return blockedResult(
      `Lote acima do limite seguro (${MAX_APPLY_BATCH}). Filtre por códigos ou rode em batches menores.`
    );
  }

  // Cria o EngineeringSyncRun pai ANTES de gravar qualquer EngineeringChangeLog,
  // para respeitar a FK runId. O runId só existe agora a partir deste ponto.
  const previewTotalsForRun: Record<string, number> = {};
  for (const r of applicable) {
    previewTotalsForRun[r.action] = (previewTotalsForRun[r.action] ?? 0) + 1;
  }
  const { runId, planHash } = await openEqualizationRun({
    applicableCodes: applicable.map((r) => r.code),
    confirmationText: input.confirmationText,
    requestedBy: input.requestedBy ?? null,
    previewTotals: previewTotalsForRun,
  });

  const report: EqualizeApplyReportItem[] = [];
  let createdProducts = 0;
  let createdMaterials = 0;
  let updatedProducts = 0;
  let updatedMaterials = 0;
  let deactivatedProducts = 0;
  let deactivatedMaterials = 0;
  let errors = 0;
  let historyEntriesCreated = 0;

  const changedBy = input.requestedBy?.trim() || "nomus-equalize";

  async function pushHistory(args: {
    entityType: "PRODUCT" | "MATERIAL";
    entityId: string;
    productId: string | null;
    productSku: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    summary: string;
    isCreateOrDeactivate: boolean;
  }): Promise<void> {
    await recordEngineeringChange({
      entityType: args.entityType,
      entityId: args.entityId,
      productId: args.productId,
      productSku: args.productSku,
      sourceSystem: NOMUS_SOURCE,
      changeOrigin: args.isCreateOrDeactivate && args.fieldName === "@created"
        ? "NOMUS_SYNC"
        : "NOMUS_ENGINEERING_APPLY",
      fieldName: args.fieldName,
      oldValue: args.oldValue,
      newValue: args.newValue,
      changedBy,
      runId,
      planHash,
      summary: args.summary,
    });
    historyEntriesCreated += 1;
  }

  for (const row of applicable) {
    try {
      switch (row.action) {
        case "CREATE_PRODUCT": {
          const payload = row.createPayload;
          if (!payload || payload.kind !== "PRODUCT") {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "Payload PRODUCT ausente.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          const existing = await prisma.product.findFirst({
            where: { sku: { in: [payload.sku, normalizeSku(payload.sku)] } },
            select: { id: true, sku: true },
          });
          if (existing) {
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "SKIPPED",
              message: `Já existia (sku=${existing.sku}).`,
              createdId: existing.id,
              fieldChangesApplied: [],
            });
            break;
          }
          const created = await prisma.product.create({
            data: {
              sku: payload.sku,
              name: payload.name,
              description: payload.description,
              type: payload.type,
              sourceSystem: NOMUS_SOURCE,
              isNomusControlled: true,
              status: payload.status,
              defaultLotSize: payload.defaultLotSize,
              version: "1.0.0",
            },
            select: { id: true, sku: true },
          });
          createdProducts += 1;
          await pushHistory({
            entityType: "PRODUCT",
            entityId: created.id,
            productId: created.id,
            productSku: created.sku,
            fieldName: "@created",
            oldValue: null,
            newValue: `Product ${created.sku}`,
            summary: `Produto ${created.sku} criado pelo fluxo Igualar Bases.`,
            isCreateOrDeactivate: true,
          });
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "CREATED",
            message: `Product criado (sku=${created.sku}).`,
            createdId: created.id,
            fieldChangesApplied: [],
          });
          break;
        }

        case "CREATE_MATERIAL": {
          const payload = row.createPayload;
          if (!payload || payload.kind !== "MATERIAL") {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "Payload MATERIAL ausente.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          const existing = await prisma.material.findFirst({
            where: { code: { in: [payload.code, normalizeSku(payload.code)] } },
            select: { id: true, code: true },
          });
          if (existing) {
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "SKIPPED",
              message: `Já existia (code=${existing.code}).`,
              createdId: existing.id,
              fieldChangesApplied: [],
            });
            break;
          }
          const created = await prisma.material.create({
            data: {
              code: payload.code,
              description: payload.description,
              unit: payload.unit,
              category: payload.category,
              currentCost: payload.currentCost,
              averageCost: payload.averageCost,
              standardCost: payload.standardCost,
              freight: payload.freight,
              standardLoss: payload.standardLoss,
              conversionFactor: payload.conversionFactor,
              status: payload.status,
            },
            select: { id: true, code: true },
          });
          createdMaterials += 1;
          await pushHistory({
            entityType: "MATERIAL",
            entityId: created.id,
            productId: null,
            productSku: created.code,
            fieldName: "@created",
            oldValue: null,
            newValue: `Material ${created.code}`,
            summary: `Material ${created.code} criado pelo fluxo Igualar Bases.`,
            isCreateOrDeactivate: true,
          });
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "CREATED",
            message: `Material criado (code=${created.code}).`,
            createdId: created.id,
            fieldChangesApplied: [],
          });
          break;
        }

        case "UPDATE_PRODUCT": {
          const productId = row.currentSnapshot.productId;
          if (!productId) {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "productId ausente.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          // Backfill retroativo de histórico se ainda não houver entrada.
          await ensureNomusImportHistoryForProduct({
            productId,
            productSku: row.code,
            runId,
            planHash,
            summary:
              "Produto criado anteriormente via Carga Mestre Nomus (registro retroativo).",
          });
          const data: Record<string, unknown> = {};
          for (const ch of row.fieldChanges) {
            if (ch.fieldName === "name" && ch.newValue) data.name = ch.newValue;
            if (ch.fieldName === "description") data.description = ch.newValue;
            if (ch.fieldName === "isNomusControlled") data.isNomusControlled = ch.newValue === "true";
            if (ch.fieldName === "sourceSystem") data.sourceSystem = ch.newValue;
          }
          if (Object.keys(data).length === 0) {
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "SKIPPED",
              message: "Nada a atualizar.",
              createdId: productId,
              fieldChangesApplied: [],
            });
            break;
          }
          data.lastNomusSyncAt = new Date();
          await prisma.product.update({
            where: { id: productId },
            data,
          });
          updatedProducts += 1;
          for (const ch of row.fieldChanges) {
            await pushHistory({
              entityType: "PRODUCT",
              entityId: productId,
              productId,
              productSku: row.code,
              fieldName: ch.fieldName,
              oldValue: ch.oldValue,
              newValue: ch.newValue,
              summary: `Produto ${row.code}: ${ch.fieldName} atualizado pelo Nomus.`,
              isCreateOrDeactivate: false,
            });
          }
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "UPDATED",
            message: `Product atualizado (sku=${row.code}).`,
            createdId: productId,
            fieldChangesApplied: row.fieldChanges,
          });
          break;
        }

        case "UPDATE_MATERIAL": {
          const materialId = row.currentSnapshot.materialId;
          if (!materialId) {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "materialId ausente.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          await ensureNomusImportHistoryForMaterial({
            materialId,
            materialCode: row.code,
            runId,
            planHash,
            summary:
              "Material criado anteriormente via Carga Mestre Nomus (registro retroativo).",
          });
          const data: Record<string, unknown> = {};
          for (const ch of row.fieldChanges) {
            if (ch.fieldName === "description" && ch.newValue) data.description = ch.newValue;
          }
          if (Object.keys(data).length === 0) {
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "SKIPPED",
              message: "Nada a atualizar.",
              createdId: materialId,
              fieldChangesApplied: [],
            });
            break;
          }
          await prisma.material.update({
            where: { id: materialId },
            data,
          });
          updatedMaterials += 1;
          for (const ch of row.fieldChanges) {
            await pushHistory({
              entityType: "MATERIAL",
              entityId: materialId,
              productId: null,
              productSku: row.code,
              fieldName: ch.fieldName,
              oldValue: ch.oldValue,
              newValue: ch.newValue,
              summary: `Material ${row.code}: ${ch.fieldName} atualizado pelo Nomus.`,
              isCreateOrDeactivate: false,
            });
          }
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "UPDATED",
            message: `Material atualizado (code=${row.code}).`,
            createdId: materialId,
            fieldChangesApplied: row.fieldChanges,
          });
          break;
        }

        case "DEACTIVATE_PRODUCT": {
          const productId = row.currentSnapshot.productId;
          if (!productId) {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "productId ausente para inativação.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          await prisma.product.update({
            where: { id: productId },
            data: { status: "INACTIVE", lastNomusSyncAt: new Date() },
          });
          deactivatedProducts += 1;
          await pushHistory({
            entityType: "PRODUCT",
            entityId: productId,
            productId,
            productSku: row.code,
            fieldName: "@deactivated",
            oldValue: row.currentSnapshot.productStatus,
            newValue: "INACTIVE",
            summary: `Produto ${row.code} marcado como INACTIVE — não aparece mais no stage Nomus.`,
            isCreateOrDeactivate: true,
          });
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "DEACTIVATED",
            message: `Product marcado como INACTIVE (sku=${row.code}).`,
            createdId: productId,
            fieldChangesApplied: row.fieldChanges,
          });
          break;
        }

        case "DEACTIVATE_MATERIAL": {
          const materialId = row.currentSnapshot.materialId;
          if (!materialId) {
            errors += 1;
            report.push({
              code: row.code,
              action: row.action,
              target: row.target,
              outcome: "FAILED",
              message: "materialId ausente para inativação.",
              createdId: null,
              fieldChangesApplied: [],
            });
            break;
          }
          await prisma.material.update({
            where: { id: materialId },
            data: { status: "INACTIVE" },
          });
          deactivatedMaterials += 1;
          await pushHistory({
            entityType: "MATERIAL",
            entityId: materialId,
            productId: null,
            productSku: row.code,
            fieldName: "@deactivated",
            oldValue: row.currentSnapshot.materialStatus,
            newValue: "INACTIVE",
            summary: `Material ${row.code} marcado como INACTIVE — não aparece mais no stage Nomus.`,
            isCreateOrDeactivate: true,
          });
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "DEACTIVATED",
            message: `Material marcado como INACTIVE (code=${row.code}).`,
            createdId: materialId,
            fieldChangesApplied: row.fieldChanges,
          });
          break;
        }

        default:
          report.push({
            code: row.code,
            action: row.action,
            target: row.target,
            outcome: "SKIPPED",
            message: "Ação não aplicável.",
            createdId: null,
            fieldChangesApplied: [],
          });
      }
    } catch (err) {
      errors += 1;
      report.push({
        code: row.code,
        action: row.action,
        target: row.target,
        outcome: "FAILED",
        message: err instanceof Error ? err.message : String(err),
        createdId: null,
        fieldChangesApplied: [],
      });
    }
  }

  const totalApplied =
    createdProducts +
    createdMaterials +
    updatedProducts +
    updatedMaterials +
    deactivatedProducts +
    deactivatedMaterials;

  let status: EqualizeApplyStatus;
  if (errors > 0 && totalApplied === 0) status = "FAILED";
  else if (totalApplied === 0) status = "NO_CHANGES";
  else if (errors > 0) status = "PARTIAL";
  else status = "APPLIED";

  const message =
    status === "APPLIED"
      ? `Bases igualadas com sucesso. Criados: ${createdProducts} P / ${createdMaterials} M · Atualizados: ${updatedProducts} P / ${updatedMaterials} M · Inativados: ${deactivatedProducts} P / ${deactivatedMaterials} M.`
      : status === "NO_CHANGES"
        ? "Nenhuma alteração aplicada — bases já estavam alinhadas."
        : status === "PARTIAL"
          ? `Igualação parcial — ${totalApplied} item(ns) aplicado(s), ${errors} erro(s).`
          : "Igualação falhou — ver relatório.";

  const previewTotals = aggregateTotals(await buildAllEqualizeRows({ includeUnmatchedIndusCost: true }));

  // Atualiza o EngineeringSyncRun com o status final e contadores.
  const runStatusFinal: "APPLIED" | "PARTIAL" | "FAILED" =
    status === "APPLIED"
      ? "APPLIED"
      : status === "PARTIAL"
        ? "PARTIAL"
        : status === "FAILED"
          ? "FAILED"
          : "APPLIED";

  const summaryFinal = {
    origin: EQUALIZE_RUN_ORIGIN,
    totalRequested: applicable.length,
    totalApplied,
    historyEntriesCreated,
    createdProducts,
    createdMaterials,
    updatedProducts,
    updatedMaterials,
    deactivatedProducts,
    deactivatedMaterials,
    errors,
    semanticStatus: status,
    message,
  };
  const errorsListed = report
    .filter((r) => r.outcome === "FAILED")
    .map((r) => ({ code: r.code, action: r.action, message: r.message }));

  await closeEqualizationRun({
    runId,
    status: runStatusFinal,
    summaryJson: summaryFinal,
    errorsJson: errorsListed.length > 0 ? errorsListed : undefined,
  });

  return finalizeApplyResult({
    generatedAt,
    status,
    message,
    runId,
    planHash,
    createdProducts,
    createdMaterials,
    updatedProducts,
    updatedMaterials,
    deactivatedProducts,
    deactivatedMaterials,
    preservedLocal: 0,
    blocked: 0,
    errors,
    historyEntriesCreated,
    totalRequested: applicable.length,
    report,
    previewTotals,
    semanticRunStatus: runStatusFinal,
  });
}
