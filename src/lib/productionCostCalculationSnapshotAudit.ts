/**
 * Extração auditável da estrutura BOM/material do resultado do motor industrial.
 * Puramente leitura — não altera cálculo.
 */
import type { ExcludedBomLineRecord } from "./costAnalysisPartial.js";

export type ProductionCostSnapshotLineType = "MATERIAL" | "COMPONENT" | "EXCLUDED" | "INCOMPLETE";

export type ProductionCostBomLineAudit = {
  bomLineId: string | null;
  lineType: ProductionCostSnapshotLineType;
  materialId: string | null;
  childProductId: string | null;
  sku: string | null;
  name: string | null;
  quantity: number | null;
  lossPercentage: number | null;
  requiredQty: number | null;
  unit: string | null;
  unitCostUsed: number | null;
  lineTotalCost: number;
  excludedFromCost: boolean;
  errorCode: string | null;
  message: string | null;
};

export type ProductionCostAuditWarning = {
  code: string;
  severity: string | null;
  message: string;
  context: string | null;
};

export type ProductionCostBomAuditStructure = {
  lineCount: number;
  materialLineCount: number;
  componentLineCount: number;
  excludedLineCount: number;
  lines: ProductionCostBomLineAudit[];
  excludedBomLines: ExcludedBomLineRecord[];
};

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferLineType(row: Record<string, unknown>): ProductionCostSnapshotLineType {
  if (row.excludedFromCost === true) return "EXCLUDED";
  if (row.errorCode === "BOM_LINE_INCOMPLETE") return "INCOMPLETE";
  if (row.childProductId != null) return "COMPONENT";
  if (row.materialId != null) return "MATERIAL";
  if (row.lineType === "COMPONENT" || row.lineType === "MATERIAL") {
    return row.lineType as ProductionCostSnapshotLineType;
  }
  const sku = readString(row.sku);
  const desc = readString(row.description);
  if (row.basePrice != null && row.requiredQty != null && !row.materialId && !row.childProductId) {
    return "COMPONENT";
  }
  if (sku || desc) return "MATERIAL";
  return "INCOMPLETE";
}

export function normalizeProductionCostBomLineAudit(row: unknown): ProductionCostBomLineAudit {
  const raw = readRecord(row);
  const lineType = inferLineType(raw);
  const requiredQty = readNumber(raw.requiredQty);
  const lineTotalCost = readNumber(raw.unitCost) ?? 0;
  const unitCostUsed =
    readNumber(raw.unitCostUsed) ??
    (requiredQty != null && requiredQty > 0 ? lineTotalCost / requiredQty : readNumber(raw.basePrice));

  return {
    bomLineId: readString(raw.bomLineId),
    lineType,
    materialId: readString(raw.materialId),
    childProductId: readString(raw.childProductId),
    sku: readString(raw.sku),
    name: readString(raw.description) ?? readString(raw.name),
    quantity: readNumber(raw.quantity),
    lossPercentage: readNumber(raw.lossPercentage),
    requiredQty,
    unit: readString(raw.unit),
    unitCostUsed,
    lineTotalCost,
    excludedFromCost: raw.excludedFromCost === true || lineType === "EXCLUDED",
    errorCode: readString(raw.errorCode),
    message: readString(raw.message),
  };
}

export function extractProductionCostWarningsFromAnalysis(analysis: unknown): ProductionCostAuditWarning[] {
  const raw = readRecord(analysis);
  const warnings = Array.isArray(raw.warnings) ? raw.warnings : [];
  return warnings
    .map((entry) => {
      const row = readRecord(entry);
      const message = readString(row.message);
      if (!message) return null;
      return {
        code: readString(row.code) ?? "WARNING",
        severity: readString(row.severity),
        message,
        context: readString(row.context),
      };
    })
    .filter((row): row is ProductionCostAuditWarning => row != null);
}

export function extractProductionCostBomAuditStructureFromAnalysis(
  analysis: unknown
): ProductionCostBomAuditStructure {
  const raw = readRecord(analysis);
  const details = readRecord(raw.details);
  const materialRows = Array.isArray(details.materials) ? details.materials : [];
  const lines = materialRows.map(normalizeProductionCostBomLineAudit);
  const excludedBomLines = Array.isArray(raw.excludedBomLines)
    ? (raw.excludedBomLines as ExcludedBomLineRecord[])
    : [];

  return {
    lineCount: lines.length,
    materialLineCount: lines.filter((line) => line.lineType === "MATERIAL").length,
    componentLineCount: lines.filter((line) => line.lineType === "COMPONENT").length,
    excludedLineCount: lines.filter((line) => line.excludedFromCost).length + excludedBomLines.length,
    lines,
    excludedBomLines,
  };
}

/** Assinatura estável da estrutura BOM para hash — ordenada por bomLineId/sku. */
export function buildProductionCostBomStructureHashInput(
  structure: ProductionCostBomAuditStructure
): Array<Record<string, unknown>> {
  const sorted = [...structure.lines].sort((a, b) => {
    const left = a.bomLineId ?? a.sku ?? "";
    const right = b.bomLineId ?? b.sku ?? "";
    return left.localeCompare(right);
  });
  return sorted.map((line) => ({
    bomLineId: line.bomLineId,
    lineType: line.lineType,
    materialId: line.materialId,
    childProductId: line.childProductId,
    sku: line.sku,
    requiredQty: line.requiredQty,
    unitCostUsed: line.unitCostUsed,
    lineTotalCost: line.lineTotalCost,
    excludedFromCost: line.excludedFromCost,
    errorCode: line.errorCode,
  }));
}

export function productionCostSnapshotHasBomAuditStructure(snapshot: unknown): boolean {
  const raw = readRecord(snapshot);
  const bom = readRecord(raw.bomStructure);
  return Array.isArray(bom.lines) && bom.lines.length >= 0;
}

export const PRODUCTION_COST_SNAPSHOT_KIND = "FROZEN_AT_GENERATION" as const;

export const PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE =
  "Snapshot congelado na geração do DRAFT/publicação. A BOM viva (Nomus) pode divergir após a publicação.";

export const PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE =
  "Ciclo e cavidades congelados na geração do DRAFT/publicação. Alterações em Operações > Performance afetam apenas novas gerações de custo; custos publicados permanecem congelados.";

export type ProductionCostProcessPerformanceSource =
  | "STANDARD_PROCESS"
  | "ROUTING"
  | "NONE"
  | "SKIPPED_BY_COSTING_MODE";

export type ProductionCostProcessPerformanceDataSource =
  | "PRODUCT_LIVE_FIELDS"
  | "ROUTING_STEP"
  | "NONE";

export type ProductionCostProcessPerformanceAudit = {
  processSource: ProductionCostProcessPerformanceSource;
  cycleTimeSeconds: number | null;
  cavities: number | null;
  efficiencyExpectedPercent: number | null;
  setupTimeMin: number | null;
  netPiecesPerHour: number | null;
  dataSource: ProductionCostProcessPerformanceDataSource;
  liveOperationalNotice: typeof PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE;
};

/** Extrai ciclo/cavidades usados pelo motor a partir do detalhamento de processo. */
export function extractProductionCostProcessPerformanceFromAnalysis(
  analysis: unknown
): ProductionCostProcessPerformanceAudit {
  const empty: ProductionCostProcessPerformanceAudit = {
    processSource: "NONE",
    cycleTimeSeconds: null,
    cavities: null,
    efficiencyExpectedPercent: null,
    setupTimeMin: null,
    netPiecesPerHour: null,
    dataSource: "NONE",
    liveOperationalNotice: PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
  };

  const raw = readRecord(analysis);
  if (raw.ownProcessSkipped === true) {
    return {
      ...empty,
      processSource: "SKIPPED_BY_COSTING_MODE",
    };
  }

  const details = readRecord(raw.details);
  const processRows = Array.isArray(details.processBreakdown) ? details.processBreakdown : [];
  const ownRow = processRows.find((row) => readRecord(row).rollupFromBom !== true);
  if (!ownRow) return empty;

  const row = readRecord(ownRow);
  const calc = readRecord(row.calculationDetails);
  const sourceRaw = readString(row.source);
  const processSource: ProductionCostProcessPerformanceSource =
    sourceRaw === "ROUTING"
      ? "ROUTING"
      : sourceRaw === "STANDARD_PROCESS"
        ? "STANDARD_PROCESS"
        : "NONE";
  const dataSource: ProductionCostProcessPerformanceDataSource =
    processSource === "ROUTING"
      ? "ROUTING_STEP"
      : processSource === "STANDARD_PROCESS"
        ? "PRODUCT_LIVE_FIELDS"
        : "NONE";

  return {
    processSource,
    cycleTimeSeconds: readNumber(calc.cycle),
    cavities: readNumber(calc.cavities),
    efficiencyExpectedPercent: readNumber(calc.efficiency),
    setupTimeMin: readNumber(calc.setupTimeMin),
    netPiecesPerHour: readNumber(calc.netPph),
    dataSource,
    liveOperationalNotice: PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
  };
}

/** Warnings adicionais quando ciclo/cavidades necessários estão ausentes no snapshot. */
export function buildProductionCostPerformanceAuditWarnings(
  performance: ProductionCostProcessPerformanceAudit,
  productType: string | null
): ProductionCostAuditWarning[] {
  const warnings: ProductionCostAuditWarning[] = [];
  if (productType === "COMPONENT" && performance.processSource === "NONE") {
    warnings.push({
      code: "PERFORMANCE_DATA_MISSING",
      severity: "error",
      message:
        "Componente sem ciclo/cavidades (processo padrão ou roteiro) — custo de processo não calculado.",
      context: "PROCESS_PERFORMANCE",
    });
  }
  if (
    performance.processSource === "STANDARD_PROCESS" ||
    performance.processSource === "ROUTING"
  ) {
    if (performance.cycleTimeSeconds == null || performance.cycleTimeSeconds <= 0) {
      warnings.push({
        code: "PERFORMANCE_CYCLE_MISSING",
        severity: "warning",
        message: "Ciclo ausente ou inválido no snapshot de performance.",
        context: "PROCESS_PERFORMANCE",
      });
    }
    if (performance.cavities == null || performance.cavities < 1) {
      warnings.push({
        code: "PERFORMANCE_CAVITIES_MISSING",
        severity: "warning",
        message: "Cavidades ausentes ou inválidas no snapshot de performance.",
        context: "PROCESS_PERFORMANCE",
      });
    }
  }
  return warnings;
}
