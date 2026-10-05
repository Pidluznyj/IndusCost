/**
 * Contrato (puro) da fonte de custo de um produto existente:
 *
 *   PUBLISHED = custo oficial vigente (ProductionCostTableVersion/Item publicado).
 *   LIVE      = cálculo atual da engenharia (getProductCostAnalysis) — NÃO publicado.
 *
 * Não existe fallback entre as fontes: sem custo publicado o resultado é NO_PUBLISHED_COST.
 */

export const PRODUCT_COST_BASELINE_SOURCES = ["PUBLISHED", "LIVE"] as const;
export type ProductCostBaselineSource = (typeof PRODUCT_COST_BASELINE_SOURCES)[number];

/** Registros anteriores à governança de baseline: a base era o motor vivo e não foi gravada. */
export const LEGACY_LIVE_BASELINE = "LEGACY_LIVE" as const;
export type RecordedCostBaselineSource = ProductCostBaselineSource | typeof LEGACY_LIVE_BASELINE;

export type ProductCostBaselineContext =
  | "ENGINEERING_SCENARIO"
  | "NEW_PRODUCT_SIMULATION"
  | "COMMERCIAL_PRICING"
  | "ENGINEERING_PREVIEW";

/**
 * Decomposição do processo PRÓPRIO do produto (sem filhos da BOM), por unidade.
 * Só a transformação depende de eficiência; setup não.
 */
export type OwnProcessDecomposition = {
  transformHh: number;
  transformHm: number;
  setupHh: number;
  setupHm: number;
};

export type ProductCostBaselineWarning = { code: string; message: string };

export type ProductCostBaselineOk = {
  status: "OK";
  source: ProductCostBaselineSource;
  productId: string;
  sku: string | null;
  name: string | null;
  totalMaterialCost: number;
  totalHHUnit: number;
  totalHMUnit: number;
  /** MP + HH + HM (custo industrial unitário). */
  totalIndustrialCost: number;
  /** Só em PUBLISHED. */
  productionCostVersionId: string | null;
  productionCostVersionCode: string | null;
  productionCostRevision: number | null;
  /** ISO date (YYYY-MM-DD) da vigência da versão publicada. */
  effectiveDate: string | null;
  publishedAt: string | null;
  /** Só em LIVE: instante do cálculo no servidor. */
  calculatedAt: string | null;
  /** Data de referência usada para resolver o custo publicado (ISO date). */
  referenceDate: string | null;
  ownProcess: OwnProcessDecomposition | null;
  warnings: ProductCostBaselineWarning[];
  metadata: { context: ProductCostBaselineContext; costAnalysisPartial: boolean };
};

export type ProductCostBaselineUnavailableCode =
  | "NO_PUBLISHED_COST"
  | "PRODUCT_NOT_FOUND"
  | "LIVE_COST_UNAVAILABLE";

export type ProductCostBaselineUnavailable = {
  status: ProductCostBaselineUnavailableCode;
  source: ProductCostBaselineSource;
  productId: string;
  message: string;
};

export type ProductCostBaselineResult = ProductCostBaselineOk | ProductCostBaselineUnavailable;

export function isProductCostBaselineSource(value: unknown): value is ProductCostBaselineSource {
  return value === "PUBLISHED" || value === "LIVE";
}

/** Rótulo visível ao usuário — LIVE nunca é chamado de "oficial". */
export function productCostBaselineLabel(source: RecordedCostBaselineSource | null | undefined): string {
  if (source === "PUBLISHED") return "Custo oficial publicado";
  if (source === "LIVE") return "Engenharia atual — não publicada";
  return "Engenharia (registro legado — base não registrada)";
}

export function productCostBaselineBadge(source: RecordedCostBaselineSource | null | undefined): string {
  if (source === "PUBLISHED") return "PUBLICADO";
  if (source === "LIVE") return "LIVE — NÃO PUBLICADO";
  return "LEGADO — BASE NÃO REGISTRADA";
}

export const NO_PUBLISHED_COST_MESSAGE = "Este produto não possui custo oficial publicado.";

/**
 * Extrai a decomposição transformação × setup do processo próprio a partir do detalhe
 * do motor (`details.processBreakdown`, linhas sem `rollupFromBom`). Somente leitura.
 * Retorna null quando o detalhe não traz os campos necessários.
 */
export function extractOwnProcessDecompositionFromAnalysis(
  analysis: unknown
): OwnProcessDecomposition | null {
  if (!analysis || typeof analysis !== "object") return null;
  const raw = analysis as Record<string, unknown>;
  const details = raw.details && typeof raw.details === "object" ? (raw.details as Record<string, unknown>) : null;
  if (!details || !Array.isArray(details.processBreakdown)) return null;
  const ownRows = details.processBreakdown.filter(
    (row) => row && typeof row === "object" && (row as Record<string, unknown>).rollupFromBom !== true
  ) as Array<Record<string, unknown>>;

  const out: OwnProcessDecomposition = { transformHh: 0, transformHm: 0, setupHh: 0, setupHm: 0 };
  for (const row of ownRows) {
    const calc =
      row.calculationDetails && typeof row.calculationDetails === "object"
        ? (row.calculationDetails as Record<string, unknown>)
        : null;
    if (!calc) return null;
    const unitTransform = Number(calc.unitTransform);
    const setupCost = Number(calc.setupCost);
    const total = Number(row.total);
    const labor = Number(row.laborCost);
    const machine = Number(row.machineCost);
    if (![unitTransform, setupCost, total, labor, machine].every(Number.isFinite)) return null;
    if (total <= 0) continue;
    const hhRatio = labor / total;
    const hmRatio = machine / total;
    out.transformHh += unitTransform * hhRatio;
    out.transformHm += unitTransform * hmRatio;
    out.setupHh += setupCost * hhRatio;
    out.setupHm += setupCost * hmRatio;
  }
  return out;
}
