/**
 * Fonte canônica do custo final oficial de produto (CIU da Engenharia de Produtos).
 * Mesma regra de GET /api/products/:id/cost-analysis → totalIndustrialCost (MP + HH + HM).
 */
import { isCostAnalysisFailure } from "./productCostSnapshot.js";

export const OFFICIAL_PRODUCT_FINAL_COST_SOURCE =
  "PRODUCT_ENGINEERING_FINAL_COST" as const;

export type OfficialProductFinalCostSource = typeof OFFICIAL_PRODUCT_FINAL_COST_SOURCE;

export type OfficialProductFinalCostDiagnosticCode =
  | "CUSTO_OFICIAL_NAO_CALCULADO"
  | "BOM_CYCLE"
  | "CONFIG_MISSING"
  | "PRODUTO_SEM_ENGENHARIA"
  | "MOTOR_ERROR"
  | "INVALID_COST_VALUE";

export type OfficialProductFinalCostDiagnostic = {
  code: OfficialProductFinalCostDiagnosticCode;
  message: string;
  motorError?: string;
};

export type OfficialProductFinalCostBreakdown = {
  totalMaterialCost: number | null;
  totalHH_Unit: number | null;
  totalHM_Unit: number | null;
  totalCIF_Unit: number | null;
  totalOPEX_Unit: number | null;
};

export type OfficialProductFinalCostSuccess = {
  ok: true;
  productId: string | null;
  sku: string | null;
  finalUnitCost: number;
  source: OfficialProductFinalCostSource;
  costAnalysisPartial: boolean;
  breakdown: OfficialProductFinalCostBreakdown;
};

export type OfficialProductFinalCostFailure = {
  ok: false;
  productId: string | null;
  sku: string | null;
  diagnostics: OfficialProductFinalCostDiagnostic[];
};

export type OfficialProductFinalCostResult =
  | OfficialProductFinalCostSuccess
  | OfficialProductFinalCostFailure;

export function isOfficialProductFinalCostFailure(
  result: OfficialProductFinalCostResult
): result is OfficialProductFinalCostFailure {
  return result.ok === false;
}

export function firstOfficialProductFinalCostDiagnostic(
  result: OfficialProductFinalCostFailure
): OfficialProductFinalCostDiagnostic | undefined {
  return result.diagnostics[0];
}

function safeFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readAnalysisRecord(analysis: unknown): Record<string, unknown> {
  if (!analysis || typeof analysis !== "object") return {};
  return analysis as Record<string, unknown>;
}

function mapMotorErrorToDiagnostic(
  error: string,
  message?: string
): OfficialProductFinalCostDiagnostic {
  if (error === "BOM_CYCLE") {
    return {
      code: "BOM_CYCLE",
      message: message ?? "Ciclo estrutural na BOM.",
      motorError: error,
    };
  }
  if (error === "CONFIG_MISSING") {
    return {
      code: "CONFIG_MISSING",
      message: message ?? "Configuração global de custeio ausente.",
      motorError: error,
    };
  }
  if (error === "CHILD_NOT_FOUND" || error === "FATAL_ERROR") {
    return {
      code: "PRODUTO_SEM_ENGENHARIA",
      message: message ?? "Estrutura de engenharia incompleta para custeio.",
      motorError: error,
    };
  }
  return {
    code: "MOTOR_ERROR",
    message: message ?? error,
    motorError: error,
  };
}

/**
 * Resolve o custo final unitário oficial a partir do resultado de getProductCostAnalysis.
 * Usa exclusivamente totalIndustrialCost — nunca costPerUnit legado.
 */
export function resolveOfficialProductFinalCostFromAnalysis(
  analysis: unknown
): OfficialProductFinalCostResult {
  if (analysis == null) {
    return {
      ok: false,
      productId: null,
      sku: null,
      diagnostics: [
        {
          code: "CUSTO_OFICIAL_NAO_CALCULADO",
          message: "Análise de custo ausente.",
        },
      ],
    };
  }

  if (isCostAnalysisFailure(analysis)) {
    const fail = analysis as { error: string; message?: string };
    return {
      ok: false,
      productId: null,
      sku: null,
      diagnostics: [mapMotorErrorToDiagnostic(fail.error, fail.message)],
    };
  }

  const raw = readAnalysisRecord(analysis);
  const summary =
    raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : raw;

  const productId = typeof raw.productId === "string" ? raw.productId : null;
  const sku = typeof raw.sku === "string" ? raw.sku : null;
  const finalUnitCost = safeFinite(summary.totalIndustrialCost ?? raw.totalIndustrialCost);

  if (finalUnitCost == null) {
    return {
      ok: false,
      productId,
      sku,
      diagnostics: [
        {
          code: "INVALID_COST_VALUE",
          message: "Custo final da engenharia inválido ou ausente (totalIndustrialCost).",
        },
      ],
    };
  }

  return {
    ok: true,
    productId,
    sku,
    finalUnitCost,
    source: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
    costAnalysisPartial: Boolean(raw.costAnalysisPartial ?? summary.costAnalysisPartial),
    breakdown: {
      totalMaterialCost: safeFinite(summary.totalMaterialCost ?? raw.totalMaterialCost),
      totalHH_Unit: safeFinite(summary.totalHH_Unit ?? raw.totalHH_Unit),
      totalHM_Unit: safeFinite(summary.totalHM_Unit ?? raw.totalHM_Unit),
      totalCIF_Unit: safeFinite(summary.totalCIF_Unit ?? raw.totalCIF_Unit),
      totalOPEX_Unit: safeFinite(summary.totalOPEX_Unit ?? raw.totalOPEX_Unit),
    },
  };
}

/** Atalho: retorna finalUnitCost ou null (sem zero silencioso). */
export function extractOfficialProductFinalUnitCost(analysis: unknown): number | null {
  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  return resolved.ok ? resolved.finalUnitCost : null;
}
