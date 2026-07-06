/**
 * Auditoria read-only de rastreabilidade de custo de produto — tipos e helpers puros.
 */
import type { ProductionCostBomLineAudit } from "./productionCostCalculationSnapshotAudit.js";
import type { ProductionCostProcessPerformanceAudit } from "./productionCostCalculationSnapshotAudit.js";
import {
  hasProductionCostDifference,
  resolveProductEngineeringCostWarning,
  type ProductEngineeringCostWarningResult,
} from "./productEngineeringCostWarning.js";
import { OFFICIAL_PRODUCT_FINAL_COST_SOURCE } from "./productOfficialFinalCost.js";

export type ProductCostTraceAuditStatus = "PASS" | "FAIL";

export type ProductCostTraceAuditQuery = {
  sku?: string | null;
  productId?: string | null;
  referenceDate: Date;
  includeBom?: boolean;
  includeProcess?: boolean;
  includeMaterials?: boolean;
};

export type ProductCostTraceDataSource = {
  field: string;
  source: string;
  note?: string | null;
};

export type ProductCostTraceCostLine = {
  sku: string | null;
  name: string | null;
  lineType: string;
  quantity: number | null;
  unitCost: number | null;
  totalCost: number;
  sharePercent: number | null;
  rank?: number | null;
};

export type ProductCostTraceAlert = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  context?: string | null;
};

export type ProductCostTraceCommercialPrice = {
  priceTableCode: string;
  priceTableName: string;
  versionNumber: number | null;
  salePrice: number | null;
  frozenTotalCost: number | null;
  publishedAt: string | null;
  staleVsOfficialCost: boolean;
  costDifference: number | null;
};

export type ProductCostTraceAuditReport = {
  status: ProductCostTraceAuditStatus;
  auditedAt: string;
  referenceDate: string;
  errorMessage?: string | null;
  product: {
    productId: string;
    sku: string;
    name: string;
    type: string;
    status: string;
  } | null;
  currentCost: {
    engineeringCost: number | null;
    engineeringSource: string;
    officialPublishedCost: number | null;
    officialSource: string;
    difference: number | null;
    warning: ProductEngineeringCostWarningResult | null;
  };
  officialVersion: {
    versionId: string | null;
    versionCode: string | null;
    versionName: string | null;
    revision: number | null;
    status: string | null;
    effectiveDate: string | null;
    publishedAt: string | null;
    materialCostTableVersionId: string | null;
    materialCostTableVersionCode: string | null;
  };
  costBreakdown: {
    materialCost: number | null;
    laborCost: number | null;
    machineCost: number | null;
    overheadCost: number | null;
    otherCost: number | null;
    totalCost: number | null;
    source: string;
  };
  bom: {
    included: boolean;
    componentCount: number;
    components: ProductCostTraceCostLine[];
    source: string;
  };
  materials: {
    included: boolean;
    materialCount: number;
    materials: ProductCostTraceCostLine[];
    topCostRanking: ProductCostTraceCostLine[];
    source: string;
  };
  process: {
    included: boolean;
    cycleTimeSeconds: number | null;
    cavities: number | null;
    laborCost: number | null;
    machineCost: number | null;
    efficiencyExpectedPercent: number | null;
    setupTimeMin: number | null;
    netPiecesPerHour: number | null;
    processSource: string | null;
    dataSource: string | null;
    source: string;
  };
  commercialPrices: ProductCostTraceCommercialPrice[];
  alerts: ProductCostTraceAlert[];
  dataSources: ProductCostTraceDataSource[];
  checklist: Record<string, boolean | string>;
};

export function roundCost(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function computeCostSharePercent(lineTotal: number, baseTotal: number | null): number | null {
  if (baseTotal == null || baseTotal <= 0 || !Number.isFinite(lineTotal)) return null;
  return Math.round((lineTotal / baseTotal) * 10_000) / 100;
}

export function mapBomLineToCostLine(
  line: ProductionCostBomLineAudit,
  baseTotal: number | null,
  rank?: number | null
): ProductCostTraceCostLine {
  return {
    sku: line.sku,
    name: line.name,
    lineType: line.lineType,
    quantity: line.requiredQty ?? line.quantity,
    unitCost: roundCost(line.unitCostUsed),
    totalCost: roundCost(line.lineTotalCost) ?? 0,
    sharePercent: computeCostSharePercent(line.lineTotalCost, baseTotal),
    rank: rank ?? null,
  };
}

export function rankCostLinesByTotal(lines: ProductCostTraceCostLine[]): ProductCostTraceCostLine[] {
  const sorted = [...lines].sort(
    (a, b) => b.totalCost - a.totalCost || (a.sku ?? "").localeCompare(b.sku ?? "", "pt-BR")
  );
  return sorted.map((line, index) => ({ ...line, rank: index + 1 }));
}

export function buildProductCostTraceAlerts(input: {
  bomLines: ProductionCostBomLineAudit[];
  warning: ProductEngineeringCostWarningResult | null;
  hasOfficialCost: boolean;
  engineeringCost: number | null;
  officialCost: number | null;
  commercialPrices: ProductCostTraceCommercialPrice[];
  engineWarnings: Array<{ code: string; message: string; severity?: string | null }>;
}): ProductCostTraceAlert[] {
  const alerts: ProductCostTraceAlert[] = [];

  for (const line of input.bomLines) {
    if (line.lineType === "MATERIAL" && (line.unitCostUsed == null || line.unitCostUsed <= 0)) {
      alerts.push({
        code: "MATERIAL_WITHOUT_COST",
        severity: "error",
        message: `Matéria-prima sem custo: ${line.sku ?? line.name ?? line.materialId ?? "—"}`,
        context: "BOM",
      });
    }
    if (line.lineType === "COMPONENT" && (line.unitCostUsed == null || line.unitCostUsed <= 0)) {
      alerts.push({
        code: "COMPONENT_WITHOUT_COST",
        severity: "error",
        message: `Componente sem custo oficial: ${line.sku ?? line.name ?? line.childProductId ?? "—"}`,
        context: "BOM",
      });
    }
    if (line.lineType === "INCOMPLETE" || line.errorCode === "BOM_LINE_INCOMPLETE") {
      alerts.push({
        code: "INCOMPLETE_BOM_LINE",
        severity: "warning",
        message: `Linha de BOM incompleta: ${line.sku ?? line.name ?? line.bomLineId ?? "—"}`,
        context: "BOM",
      });
    }
  }

  if (!input.hasOfficialCost && input.engineeringCost != null) {
    alerts.push({
      code: "MISSING_OFFICIAL_COST",
      severity: "warning",
      message: "Produto sem custo oficial publicado vigente.",
      context: "PRODUCTION_COST_TABLE",
    });
  }

  if (
    input.warning?.warningStatus === "COST_DIFF_PENDING_PUBLICATION" ||
    hasProductionCostDifference(input.officialCost, input.engineeringCost)
  ) {
    alerts.push({
      code: "DIVERGENT_COST",
      severity: "warning",
      message:
        input.warning?.message ??
        "Custo de engenharia diverge do custo oficial publicado.",
      context: "ENGINEERING_VS_OFFICIAL",
    });
  }

  for (const price of input.commercialPrices) {
    if (price.staleVsOfficialCost) {
      alerts.push({
        code: "STALE_COMMERCIAL_PRICE",
        severity: "warning",
        message: `Preço comercial desatualizado (${price.priceTableCode}): custo congelado difere do oficial vigente.`,
        context: "COMMERCIAL_PRICE",
      });
    }
  }

  for (const warning of input.engineWarnings) {
    alerts.push({
      code: warning.code,
      severity: warning.severity === "error" ? "error" : "warning",
      message: warning.message,
      context: "ENGINE",
    });
  }

  return alerts;
}

export function buildEmptyProductCostTraceReport(
  referenceDate: string,
  errorMessage: string
): ProductCostTraceAuditReport {
  return {
    status: "FAIL",
    auditedAt: new Date().toISOString(),
    referenceDate,
    errorMessage,
    product: null,
    currentCost: {
      engineeringCost: null,
      engineeringSource: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
      officialPublishedCost: null,
      officialSource: "ProductionCostTableVersion (vigente)",
      difference: null,
      warning: null,
    },
    officialVersion: {
      versionId: null,
      versionCode: null,
      versionName: null,
      revision: null,
      status: null,
      effectiveDate: null,
      publishedAt: null,
      materialCostTableVersionId: null,
      materialCostTableVersionCode: null,
    },
    costBreakdown: {
      materialCost: null,
      laborCost: null,
      machineCost: null,
      overheadCost: null,
      otherCost: null,
      totalCost: null,
      source: "—",
    },
    bom: { included: false, componentCount: 0, components: [], source: "—" },
    materials: {
      included: false,
      materialCount: 0,
      materials: [],
      topCostRanking: [],
      source: "—",
    },
    process: {
      included: false,
      cycleTimeSeconds: null,
      cavities: null,
      laborCost: null,
      machineCost: null,
      efficiencyExpectedPercent: null,
      setupTimeMin: null,
      netPiecesPerHour: null,
      processSource: null,
      dataSource: null,
      source: "—",
    },
    commercialPrices: [],
    alerts: [],
    dataSources: [],
    checklist: {},
  };
}

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}

export function buildProductCostTraceCsv(report: ProductCostTraceAuditReport): string {
  const lines: string[] = [];
  lines.push(csvLine(["section", "field", "value"]));
  lines.push(csvLine(["meta", "status", report.status]));
  lines.push(csvLine(["meta", "referenceDate", report.referenceDate]));
  lines.push(csvLine(["meta", "auditedAt", report.auditedAt]));

  if (report.product) {
    lines.push(csvLine(["product", "sku", report.product.sku]));
    lines.push(csvLine(["product", "name", report.product.name]));
    lines.push(csvLine(["product", "type", report.product.type]));
    lines.push(csvLine(["product", "status", report.product.status]));
  }

  lines.push(csvLine(["cost", "engineeringCost", report.currentCost.engineeringCost]));
  lines.push(csvLine(["cost", "officialPublishedCost", report.currentCost.officialPublishedCost]));
  lines.push(csvLine(["cost", "difference", report.currentCost.difference]));

  for (const [key, value] of Object.entries(report.officialVersion)) {
    lines.push(csvLine(["officialVersion", key, value]));
  }

  for (const [key, value] of Object.entries(report.costBreakdown)) {
    if (key === "source") continue;
    lines.push(csvLine(["breakdown", key, value]));
  }

  for (const row of report.bom.components) {
    lines.push(
      csvLine([
        "bom",
        row.sku,
        row.name,
        row.quantity,
        row.unitCost,
        row.totalCost,
        row.sharePercent,
      ])
    );
  }

  for (const row of report.materials.topCostRanking) {
    lines.push(
      csvLine([
        "material",
        row.rank,
        row.sku,
        row.name,
        row.quantity,
        row.unitCost,
        row.totalCost,
        row.sharePercent,
      ])
    );
  }

  if (report.process.included) {
    lines.push(csvLine(["process", "cycleTimeSeconds", report.process.cycleTimeSeconds]));
    lines.push(csvLine(["process", "cavities", report.process.cavities]));
    lines.push(csvLine(["process", "laborCost", report.process.laborCost]));
    lines.push(csvLine(["process", "machineCost", report.process.machineCost]));
    lines.push(csvLine(["process", "efficiencyExpectedPercent", report.process.efficiencyExpectedPercent]));
  }

  for (const alert of report.alerts) {
    lines.push(csvLine(["alert", alert.code, alert.severity, alert.message]));
  }

  return `${lines.join("\n")}\n`;
}

export function formatProductCostTraceText(report: ProductCostTraceAuditReport): string {
  const out: string[] = [];
  out.push("=== Auditoria — Rastreabilidade de custo do produto ===\n");
  out.push(`Status: ${report.status}`);
  out.push(`Data de referência: ${report.referenceDate}`);
  out.push(`Auditado em: ${report.auditedAt}`);

  if (report.errorMessage) {
    out.push(`\nErro: ${report.errorMessage}`);
    return out.join("\n");
  }

  if (report.product) {
    out.push(`\n--- Produto ---`);
    out.push(`SKU: ${report.product.sku}`);
    out.push(`Nome: ${report.product.name}`);
    out.push(`Tipo: ${report.product.type}`);
    out.push(`Status: ${report.product.status}`);
  }

  out.push(`\n--- Custo atual ---`);
  out.push(
    `Engenharia: ${report.currentCost.engineeringCost ?? "—"} (${report.currentCost.engineeringSource})`
  );
  out.push(
    `Oficial vigente: ${report.currentCost.officialPublishedCost ?? "—"} (${report.currentCost.officialSource})`
  );
  out.push(`Diferença: ${report.currentCost.difference ?? "—"}`);
  if (report.currentCost.warning?.message) {
    out.push(`Aviso: ${report.currentCost.warning.message}`);
  }

  out.push(`\n--- Versão oficial ---`);
  out.push(`Código: ${report.officialVersion.versionCode ?? "—"}`);
  out.push(`Revisão: ${report.officialVersion.revision ?? "—"}`);
  out.push(`Vigência: ${report.officialVersion.effectiveDate ?? "—"}`);
  out.push(`Publicado em: ${report.officialVersion.publishedAt ?? "—"}`);
  out.push(`Tabela MP: ${report.officialVersion.materialCostTableVersionCode ?? "—"}`);

  out.push(`\n--- Quebra de custo (${report.costBreakdown.source}) ---`);
  out.push(`MP: ${report.costBreakdown.materialCost ?? "—"}`);
  out.push(`HH: ${report.costBreakdown.laborCost ?? "—"}`);
  out.push(`HM: ${report.costBreakdown.machineCost ?? "—"}`);
  out.push(`Overhead: ${report.costBreakdown.overheadCost ?? "—"}`);

  if (report.bom.included) {
    out.push(`\n--- BOM (${report.bom.componentCount} componente(s), ${report.bom.source}) ---`);
    for (const row of report.bom.components.slice(0, 30)) {
      out.push(
        `  ${row.sku ?? "—"} | qty=${row.quantity ?? "—"} | unit=${row.unitCost ?? "—"} | total=${row.totalCost} | ${row.sharePercent ?? "—"}%`
      );
    }
  }

  if (report.materials.included) {
    out.push(`\n--- Matérias-primas (${report.materials.materialCount}, ${report.materials.source}) ---`);
    for (const row of report.materials.topCostRanking.slice(0, 10)) {
      out.push(
        `  #${row.rank} ${row.sku ?? "—"} | consumo=${row.quantity ?? "—"} | unit=${row.unitCost ?? "—"} | total=${row.totalCost} | ${row.sharePercent ?? "—"}%`
      );
    }
  }

  if (report.process.included) {
    out.push(`\n--- Processo (${report.process.source}) ---`);
    out.push(`Ciclo (s): ${report.process.cycleTimeSeconds ?? "—"}`);
    out.push(`Cavidades: ${report.process.cavities ?? "—"}`);
    out.push(`HH: ${report.process.laborCost ?? "—"}`);
    out.push(`HM: ${report.process.machineCost ?? "—"}`);
    out.push(`Eficiência (%): ${report.process.efficiencyExpectedPercent ?? "—"}`);
  }

  if (report.alerts.length > 0) {
    out.push(`\n--- Alertas (${report.alerts.length}) ---`);
    for (const alert of report.alerts) {
      out.push(`  [${alert.severity}] ${alert.code}: ${alert.message}`);
    }
  }

  out.push(`\n--- Fontes de dados ---`);
  for (const ds of report.dataSources) {
    out.push(`  ${ds.field}: ${ds.source}${ds.note ? ` — ${ds.note}` : ""}`);
  }

  return out.join("\n");
}

export function mapProcessAuditToTrace(
  performance: ProductionCostProcessPerformanceAudit,
  breakdown: { laborCost: number | null; machineCost: number | null }
) {
  return {
    cycleTimeSeconds: performance.cycleTimeSeconds,
    cavities: performance.cavities,
    laborCost: breakdown.laborCost,
    machineCost: breakdown.machineCost,
    efficiencyExpectedPercent: performance.efficiencyExpectedPercent,
    setupTimeMin: performance.setupTimeMin,
    netPiecesPerHour: performance.netPiecesPerHour,
    processSource: performance.processSource,
    dataSource: performance.dataSource,
  };
}
