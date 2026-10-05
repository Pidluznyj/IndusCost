/**
 * Contrato read-only do detalhe da Formação de Preço Unitária.
 * Assembly puro: não chama Prisma nem o motor.
 */

import {
  OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
  isOfficialProductFinalCostFailure,
  resolveOfficialProductFinalCostFromAnalysis,
} from "../productOfficialFinalCost.js";
import type { EffectiveProductProductionCostResult } from "../productionCostVersioning.js";
import { civilDateToLocalDate, toCivilDateKey } from "../financeCivilDate.js";

export const UNITARY_FORMATION_PRODUCT_DETAIL_ENDPOINT_PREFIX =
  "/api/pricing/unitary-formation/products";

export const UNITARY_FORMATION_COMPARISON_TOLERANCE_ABS = 1e-6;

export type UnitaryFormationProcessSource = "STANDARD_PROCESS" | "ROUTING" | "NONE";

export type UnitaryFormationLiveCostStatus = "OK" | "PARTIAL" | "ERROR";

export type UnitaryFormationPublishedCostStatus = "OK" | "SEM_CUSTO" | "ERROR";

export type UnitaryFormationComparisonStatus =
  | "IGUAL"
  | "ALTERADO"
  | "SEM_CUSTO_PUBLICADO"
  | "ERRO_CALCULO"
  | "CUSTO_PARCIAL";

export type UnitaryFormationBomLineType = "MATERIAL" | "COMPONENT" | "INCOMPLETE";

export type UnitaryFormationIdentification = {
  productId: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string | null;
  costingMode: string;
};

export type UnitaryFormationProcess = {
  cycleTimeSeconds: number | null;
  cavities: number | null;
  efficiencyExpected: number | null;
  setupTimeMin: number | null;
  defaultLotSize: number | null;
  routingStepCount: number;
  processSource: UnitaryFormationProcessSource;
};

export type UnitaryFormationCostWarning = {
  code: string;
  severity: string;
  message: string;
  context?: string;
};

export type UnitaryFormationLiveCost = {
  origin: "LIVE";
  source: typeof OFFICIAL_PRODUCT_FINAL_COST_SOURCE;
  status: UnitaryFormationLiveCostStatus;
  error: { code: string; message: string } | null;
  materialCost: number | null;
  laborCost: number | null;
  machineCost: number | null;
  processCost: number | null;
  overheadCost: number | null;
  otherCost: number | null;
  totalIndustrialCost: number | null;
  costAnalysisPartial: boolean | null;
  warnings: UnitaryFormationCostWarning[];
};

export type UnitaryFormationPublishedCost = {
  origin: "PUBLISHED";
  source: "VERSIONED_PRODUCTION_COST_TABLE";
  status: UnitaryFormationPublishedCostStatus;
  error: { code: string; message: string } | null;
  versionId: string | null;
  code: string | null;
  revision: number | null;
  versionStatus: string | null;
  effectiveDate: string | null;
  publishedAt: string | null;
  materialCost: number | null;
  laborCost: number | null;
  machineCost: number | null;
  processCost: number | null;
  overheadCost: number | null;
  otherCost: number | null;
  unitProductionCost: number | null;
};

export type UnitaryFormationComparison = {
  liveCost: number | null;
  publishedCost: number | null;
  diffValue: number | null;
  diffPercent: number | null;
  status: UnitaryFormationComparisonStatus;
  toleranceAbs: number;
};

export type UnitaryFormationBomLine = {
  bomLineId: string | null;
  sku: string | null;
  name: string | null;
  lineType: UnitaryFormationBomLineType;
  quantity: number | null;
  lossPercentage: number | null;
  unitCostUsed: number | null;
  lineTotalCost: number | null;
  materialId: string | null;
  childProductId: string | null;
  excludedFromCost: boolean;
  message: string | null;
  errorCode: string | null;
};

export type UnitaryFormationProductDetailResponse = {
  meta: {
    readOnly: true;
    referenceDate: string;
    generatedAt: string;
    capabilities: {
      canPublish: false;
      canCreateVersion: false;
      canEdit: false;
    };
  };
  identification: UnitaryFormationIdentification;
  process: UnitaryFormationProcess;
  liveCost: UnitaryFormationLiveCost;
  publishedCost: UnitaryFormationPublishedCost;
  comparison: UnitaryFormationComparison;
  bom: UnitaryFormationBomLine[];
};

export type UnitaryFormationProductRow = {
  id: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string | null;
  costingMode: string;
  cycleTimeSeconds: unknown;
  cavities: number | null;
  efficiencyExpected: unknown;
  setupTimeMin: unknown;
  defaultLotSize: unknown;
  routingStepCount: number;
};

function safeFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

/**
 * Mesma precedência do motor (`inferOwnProcessSourceForMotorDisplay`),
 * sem alterar o engine: PRODUCT com ciclo → STANDARD_PROCESS; senão ROUTING se houver;
 * ciclo padrão → STANDARD_PROCESS; caso contrário NONE.
 */
export function resolveUnitaryFormationProcessSource(input: {
  type: string;
  cycleTimeSeconds: unknown;
  routingStepCount: number;
}): UnitaryFormationProcessSource {
  const cycle = safeFinite(input.cycleTimeSeconds);
  const productHasStandardCycle = cycle != null && cycle > 0;
  const routingCount = Number(input.routingStepCount) || 0;
  const preferStandardOverRouting = input.type === "PRODUCT" && productHasStandardCycle;
  if (preferStandardOverRouting) return "STANDARD_PROCESS";
  if (routingCount > 0) return "ROUTING";
  if (productHasStandardCycle) return "STANDARD_PROCESS";
  return "NONE";
}

export function mapUnitaryFormationIdentification(
  product: UnitaryFormationProductRow
): UnitaryFormationIdentification {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    type: product.type,
    status: product.status,
    costingMode: product.costingMode,
  };
}

export function mapUnitaryFormationProcess(
  product: UnitaryFormationProductRow
): UnitaryFormationProcess {
  return {
    cycleTimeSeconds: safeFinite(product.cycleTimeSeconds),
    cavities: product.cavities == null ? null : Number(product.cavities),
    efficiencyExpected: safeFinite(product.efficiencyExpected),
    setupTimeMin: safeFinite(product.setupTimeMin),
    defaultLotSize: safeFinite(product.defaultLotSize),
    routingStepCount: Number(product.routingStepCount) || 0,
    processSource: resolveUnitaryFormationProcessSource({
      type: product.type,
      cycleTimeSeconds: product.cycleTimeSeconds,
      routingStepCount: product.routingStepCount,
    }),
  };
}

export function mapUnitaryFormationLiveCost(analysis: unknown): UnitaryFormationLiveCost {
  const empty = (status: UnitaryFormationLiveCostStatus, error: UnitaryFormationLiveCost["error"]): UnitaryFormationLiveCost => ({
    origin: "LIVE",
    source: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
    status,
    error,
    materialCost: null,
    laborCost: null,
    machineCost: null,
    processCost: null,
    overheadCost: null,
    otherCost: null,
    totalIndustrialCost: null,
    costAnalysisPartial: null,
    warnings: [],
  });

  if (analysis == null) {
    return empty("ERROR", {
      code: "PRODUCT_NOT_FOUND",
      message: "Produto não encontrado para análise de custo.",
    });
  }

  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  if (isOfficialProductFinalCostFailure(resolved)) {
    const diag = resolved.diagnostics[0];
    return empty("ERROR", {
      code: diag?.code ?? "CUSTO_OFICIAL_NAO_CALCULADO",
      message: diag?.message ?? "Custo LIVE indisponível.",
    });
  }

  const raw = analysis as Record<string, unknown>;
  const materialCost = safeFinite(resolved.breakdown.totalMaterialCost ?? raw.totalMaterialCost);
  const laborCost = safeFinite(resolved.breakdown.totalHH_Unit ?? raw.totalHH_Unit);
  const machineCost = safeFinite(resolved.breakdown.totalHM_Unit ?? raw.totalHM_Unit);
  const processCost =
    materialCost == null && laborCost == null && machineCost == null
      ? null
      : roundMoney((laborCost ?? 0) + (machineCost ?? 0));

  const warningsRaw = Array.isArray(raw.warnings) ? raw.warnings : [];
  const warnings: UnitaryFormationCostWarning[] = [];
  for (const w of warningsRaw) {
    if (!w || typeof w !== "object") continue;
    const row = w as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.message !== "string") continue;
    warnings.push({
      code: row.code,
      severity: typeof row.severity === "string" ? row.severity : "warning",
      message: row.message,
      context: typeof row.context === "string" ? row.context : undefined,
    });
  }

  const partial = Boolean(resolved.costAnalysisPartial);
  return {
    origin: "LIVE",
    source: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
    status: partial ? "PARTIAL" : "OK",
    error: null,
    materialCost,
    laborCost,
    machineCost,
    processCost,
    overheadCost: null,
    otherCost: null,
    totalIndustrialCost: resolved.finalUnitCost,
    costAnalysisPartial: partial,
    warnings,
  };
}

export function mapUnitaryFormationPublishedCost(
  effective: EffectiveProductProductionCostResult,
  versionStatus: string | null
): UnitaryFormationPublishedCost {
  if (effective.status === "SEM_CUSTO") {
    return {
      origin: "PUBLISHED",
      source: "VERSIONED_PRODUCTION_COST_TABLE",
      status: "SEM_CUSTO",
      error: null,
      versionId: null,
      code: null,
      revision: null,
      versionStatus: null,
      effectiveDate: null,
      publishedAt: null,
      materialCost: null,
      laborCost: null,
      machineCost: null,
      processCost: null,
      overheadCost: null,
      otherCost: null,
      unitProductionCost: null,
    };
  }

  const bd = effective.breakdown;
  return {
    origin: "PUBLISHED",
    source: "VERSIONED_PRODUCTION_COST_TABLE",
    status: "OK",
    error: null,
    versionId: effective.costTableVersionId,
    code: effective.versionCode,
    revision: effective.revision,
    versionStatus,
    effectiveDate: toCivilDateKey(effective.effectiveDate),
    publishedAt: effective.publishedAt ? effective.publishedAt.toISOString() : null,
    materialCost: safeFinite(bd.materialCost),
    laborCost: safeFinite(bd.laborCost),
    machineCost: safeFinite(bd.machineCost),
    processCost: safeFinite(bd.processCost),
    overheadCost: safeFinite(bd.overheadCost),
    otherCost: safeFinite(bd.otherCost),
    unitProductionCost: safeFinite(effective.unitProductionCost),
  };
}

export function mapUnitaryFormationPublishedCostError(message: string): UnitaryFormationPublishedCost {
  return {
    origin: "PUBLISHED",
    source: "VERSIONED_PRODUCTION_COST_TABLE",
    status: "ERROR",
    error: { code: "PUBLISHED_COST_LOOKUP_FAILED", message },
    versionId: null,
    code: null,
    revision: null,
    versionStatus: null,
    effectiveDate: null,
    publishedAt: null,
    materialCost: null,
    laborCost: null,
    machineCost: null,
    processCost: null,
    overheadCost: null,
    otherCost: null,
    unitProductionCost: null,
  };
}

export function resolveUnitaryFormationComparison(
  live: UnitaryFormationLiveCost,
  published: UnitaryFormationPublishedCost,
  toleranceAbs: number = UNITARY_FORMATION_COMPARISON_TOLERANCE_ABS
): UnitaryFormationComparison {
  const liveCost = live.totalIndustrialCost;
  const publishedCost = published.unitProductionCost;

  if (live.status === "ERROR" || liveCost == null) {
    return {
      liveCost,
      publishedCost,
      diffValue: null,
      diffPercent: null,
      status: "ERRO_CALCULO",
      toleranceAbs,
    };
  }

  if (published.status !== "OK" || publishedCost == null) {
    return {
      liveCost,
      publishedCost: null,
      diffValue: null,
      diffPercent: null,
      status: "SEM_CUSTO_PUBLICADO",
      toleranceAbs,
    };
  }

  if (live.costAnalysisPartial === true || live.status === "PARTIAL") {
    const diffValue = roundMoney(liveCost - publishedCost);
    const diffPercent =
      publishedCost === 0 ? null : roundMoney((diffValue / publishedCost) * 100);
    return {
      liveCost,
      publishedCost,
      diffValue,
      diffPercent,
      status: "CUSTO_PARCIAL",
      toleranceAbs,
    };
  }

  const diffValue = roundMoney(liveCost - publishedCost);
  const diffPercent =
    publishedCost === 0 ? null : roundMoney((diffValue / publishedCost) * 100);
  const status: UnitaryFormationComparisonStatus =
    Math.abs(diffValue) <= toleranceAbs ? "IGUAL" : "ALTERADO";

  return {
    liveCost,
    publishedCost,
    diffValue,
    diffPercent,
    status,
    toleranceAbs,
  };
}

function asBomLineType(value: unknown): UnitaryFormationBomLineType {
  if (value === "MATERIAL" || value === "COMPONENT" || value === "INCOMPLETE") return value;
  return "INCOMPLETE";
}

export function mapUnitaryFormationBomLines(analysis: unknown): UnitaryFormationBomLine[] {
  if (!analysis || typeof analysis !== "object") return [];
  const details = (analysis as { details?: { materials?: unknown } }).details;
  const materials = details?.materials;
  if (!Array.isArray(materials)) return [];

  const rows: UnitaryFormationBomLine[] = [];
  for (const item of materials) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const excluded = row.excludedFromCost === true;
    rows.push({
      bomLineId: typeof row.bomLineId === "string" ? row.bomLineId : null,
      sku: typeof row.sku === "string" ? row.sku : null,
      name:
        typeof row.name === "string"
          ? row.name
          : typeof row.description === "string"
            ? row.description
            : null,
      lineType: asBomLineType(row.lineType),
      quantity: safeFinite(row.quantity),
      lossPercentage: safeFinite(row.lossPercentage),
      unitCostUsed: safeFinite(row.unitCostUsed),
      lineTotalCost: safeFinite(row.unitCost),
      materialId: typeof row.materialId === "string" ? row.materialId : null,
      childProductId: typeof row.childProductId === "string" ? row.childProductId : null,
      excludedFromCost: excluded,
      message: typeof row.message === "string" ? row.message : null,
      errorCode: typeof row.errorCode === "string" ? row.errorCode : null,
    });
  }
  return rows;
}

export function buildUnitaryFormationProductDetailResponse(input: {
  product: UnitaryFormationProductRow;
  referenceDate: string;
  generatedAt: string;
  analysis: unknown;
  effective: EffectiveProductProductionCostResult;
  publishedVersionStatus: string | null;
}): UnitaryFormationProductDetailResponse {
  const liveCost = mapUnitaryFormationLiveCost(input.analysis);
  const publishedCost = mapUnitaryFormationPublishedCost(
    input.effective,
    input.publishedVersionStatus
  );
  const comparison = resolveUnitaryFormationComparison(liveCost, publishedCost);
  const bom = liveCost.status === "ERROR" ? [] : mapUnitaryFormationBomLines(input.analysis);

  return {
    meta: {
      readOnly: true,
      referenceDate: input.referenceDate,
      generatedAt: input.generatedAt,
      capabilities: {
        canPublish: false,
        canCreateVersion: false,
        canEdit: false,
      },
    },
    identification: mapUnitaryFormationIdentification(input.product),
    process: mapUnitaryFormationProcess(input.product),
    liveCost,
    publishedCost,
    comparison,
    bom,
  };
}

export function buildUnitaryFormationProductDetailUrl(
  productId: string,
  referenceDate?: string | null
): string {
  const base = `${UNITARY_FORMATION_PRODUCT_DETAIL_ENDPOINT_PREFIX}/${encodeURIComponent(productId)}`;
  if (!referenceDate?.trim()) return base;
  const params = new URLSearchParams({ referenceDate: referenceDate.trim() });
  return `${base}?${params.toString()}`;
}

/** Rótulos de UI — apenas apresentação, sem regra de custeio. */
export function unitaryFormationTypeLabel(type: string): string {
  if (type === "COMPONENT") return "Componente";
  if (type === "PRODUCT") return "Produto";
  return type || "—";
}

export function unitaryFormationProcessSourceLabel(source: UnitaryFormationProcessSource): string {
  if (source === "STANDARD_PROCESS") return "Processo padrão";
  if (source === "ROUTING") return "Roteiro";
  return "Sem processo";
}

export function unitaryFormationComparisonStatusLabel(
  status: UnitaryFormationComparisonStatus
): string {
  switch (status) {
    case "IGUAL":
      return "IGUAL";
    case "ALTERADO":
      return "ALTERADO";
    case "SEM_CUSTO_PUBLICADO":
      return "SEM CUSTO PUBLICADO";
    case "ERRO_CALCULO":
      return "ERRO";
    case "CUSTO_PARCIAL":
      return "PARCIAL";
    default:
      return status;
  }
}

export function unitaryFormationComparisonBadgeClass(
  status: UnitaryFormationComparisonStatus
): string {
  switch (status) {
    case "IGUAL":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "ALTERADO":
      return "bg-amber-100 text-amber-950 border-amber-200";
    case "SEM_CUSTO_PUBLICADO":
      return "bg-slate-100 text-slate-800 border-slate-200";
    case "ERRO_CALCULO":
      return "bg-red-100 text-red-800 border-red-200";
    case "CUSTO_PARCIAL":
      return "bg-orange-100 text-orange-950 border-orange-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function unitaryFormationBomLineTypeLabel(lineType: UnitaryFormationBomLineType): string {
  if (lineType === "MATERIAL") return "Material";
  if (lineType === "COMPONENT") return "Componente";
  return "Incompleta";
}

export function unitaryFormationBomLineStatusLabel(line: {
  excludedFromCost: boolean;
  errorCode: string | null;
}): string {
  if (line.errorCode) return line.errorCode;
  if (line.excludedFromCost) return "Excluída do custo";
  return "Incluída";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUnitaryFormationProductId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export type UnitaryFormationProductDetailParseError = {
  httpStatus: 400;
  code: "INVALID_PRODUCT_ID" | "INVALID_REFERENCE_DATE";
  message: string;
};

export function parseUnitaryFormationProductDetailRequest(input: {
  productId: string;
  referenceDateRaw?: string | null;
  now?: Date;
}):
  | { ok: true; productId: string; referenceDate: Date; referenceDateKey: string }
  | { ok: false; error: UnitaryFormationProductDetailParseError } {
  const productId = String(input.productId ?? "").trim();
  if (!isUnitaryFormationProductId(productId)) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_PRODUCT_ID",
        message: "productId inválido.",
      },
    };
  }

  const raw = typeof input.referenceDateRaw === "string" ? input.referenceDateRaw.trim() : "";
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return {
        ok: false,
        error: {
          httpStatus: 400,
          code: "INVALID_REFERENCE_DATE",
          message: "referenceDate inválida (yyyy-mm-dd).",
        },
      };
    }
    const referenceDate = civilDateToLocalDate(raw);
    if (Number.isNaN(referenceDate.getTime())) {
      return {
        ok: false,
        error: {
          httpStatus: 400,
          code: "INVALID_REFERENCE_DATE",
          message: "referenceDate inválida.",
        },
      };
    }
    return { ok: true, productId, referenceDate, referenceDateKey: raw };
  }

  const now = input.now ?? new Date();
  const referenceDateKey = toCivilDateKey(now);
  if (!referenceDateKey) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_REFERENCE_DATE",
        message: "Não foi possível determinar a data de referência.",
      },
    };
  }
  return {
    ok: true,
    productId,
    referenceDate: civilDateToLocalDate(referenceDateKey),
    referenceDateKey,
  };
}
