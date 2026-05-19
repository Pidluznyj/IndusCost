/**
 * Impacto de custo: compara custo atual IndusCost vs preview pela BOM efetiva Nomus.
 * Read-only — não persiste custo nem altera ProductBOM.
 *
 * Custo atual: injetado via CurrentCostSnapshot (motor getProductCostAnalysis no server.ts).
 * Custo efetivo Nomus: materiais/componentes das linhas includedForPricing da BOM efetiva.
 * Transformação (HH/HM): nesta fase replica o custo atual do produto pai (não re-simula roteiro Nomus).
 */
import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import { resolveNomusComponentCodes } from "@/src/lib/nomusBomComparisonLoad";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import type { EffectivePricingBomLine } from "@/src/lib/nomusEffectivePricingBomTypes";
import type {
  CostBreakdown,
  CostImpactComparisonLine,
  CostImpactDelta,
  CostImpactLine,
  CostImpactSummary,
  CostLineComparisonStatus,
  CostResolvedAs,
  NomusEffectiveBomCostImpactResult,
} from "@/src/lib/nomusEffectiveBomCostImpactTypes";

/** Snapshot mínimo do motor getProductCostAnalysis (server.ts). */
export type CurrentCostSnapshot = {
  productId: string;
  sku: string;
  totalMaterialCost: number;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalIndustrialCost: number;
  costAnalysisPartial?: boolean;
  materials?: Array<{
    description?: string;
    sku?: string;
    requiredQty?: number;
    unitCost?: number;
    excludedFromCost?: boolean;
  }>;
};

const SCOPE_NOTE =
  "Impacto calculado sobre materiais/componentes da BOM; transformação (HH/HM) segue o custo atual do produto no IndusCost.";

const BLOCKED_EFFECTIVE_STATUSES = new Set([
  "NO_NOMUS_BOM",
  "PENDING_OPTIONAL_SELECTION",
  "STALE_OPTIONAL_SELECTION",
]);

/** Mesma regra de linha de material que getProductCostAnalysis (server.ts). */
function computeMaterialLineTotal(
  material: {
    currentCost: unknown;
    freight: unknown;
    standardLoss: unknown;
  },
  bomQuantity: number,
  bomLossPercentage: number
): { unitEffective: number; requiredQty: number; lineTotal: number } {
  const landed =
    Number(material.currentCost) + Number(material.freight ?? 0);
  const stdLoss = Number(material.standardLoss) / 100;
  const unitEffective =
    stdLoss >= 1 ? landed : landed / (1 - stdLoss);
  const bomLoss = Number(bomLossPercentage) / 100;
  const requiredQty =
    bomLoss >= 1 ? bomQuantity : bomQuantity / (1 - bomLoss);
  const lineTotal = unitEffective * requiredQty;
  return { unitEffective, requiredQty, lineTotal };
}

function pctDelta(current: number, effective: number): number | null {
  if (current === 0) return effective === 0 ? 0 : null;
  return ((effective - current) / current) * 100;
}

function buildDelta(
  current: CostBreakdown,
  effective: CostBreakdown
): CostImpactDelta {
  return {
    materialCost: effective.materialCost - current.materialCost,
    transformationCost: effective.transformationCost - current.transformationCost,
    totalCost: effective.totalCost - current.totalCost,
    materialCostPct: pctDelta(current.materialCost, effective.materialCost),
    totalCostPct: pctDelta(current.totalCost, effective.totalCost),
  };
}

type CurrentBomLine = {
  componentCode: string;
  description: string | null;
  quantity: number;
  lineCost: number | null;
  resolvedAs: CostResolvedAs;
  resolvedId: string | null;
  bomLineId: string;
};

async function loadCurrentBomLines(productId: string): Promise<CurrentBomLine[]> {
  const rows = await prisma.productBOM.findMany({
    where: { productId },
    include: {
      Material: true,
      ChildProduct: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { id: "asc" },
  });

  const lines: CurrentBomLine[] = [];
  for (const row of rows) {
    const qty = Number(row.quantity);
    const loss = Number(row.lossPercentage ?? 0);
    if (row.Material) {
      const mat = row.Material;
      const { lineTotal, requiredQty } = computeMaterialLineTotal(mat, qty, loss);
      lines.push({
        componentCode: mat.code,
        description: mat.description,
        quantity: requiredQty,
        lineCost: Number.isFinite(lineTotal) ? lineTotal : null,
        resolvedAs: "MATERIAL",
        resolvedId: mat.id,
        bomLineId: row.id,
      });
    } else if (row.childProductId && row.ChildProduct) {
      lines.push({
        componentCode: row.ChildProduct.sku,
        description: row.ChildProduct.name,
        quantity: loss >= 1 ? qty : qty / (1 - loss / 100),
        lineCost: null,
        resolvedAs: "PRODUCT",
        resolvedId: row.ChildProduct.id,
        bomLineId: row.id,
      });
    }
  }
  return lines;
}

async function computeProductMaterialCostOnly(
  productId: string,
  visited: Set<string>
): Promise<number | null> {
  if (visited.has(productId)) return null;
  visited.add(productId);
  const rows = await prisma.productBOM.findMany({
    where: { productId },
    include: { Material: true },
  });
  let total = 0;
  for (const row of rows) {
    if (row.Material) {
      const { lineTotal } = computeMaterialLineTotal(
        row.Material,
        Number(row.quantity),
        Number(row.lossPercentage ?? 0)
      );
      total += lineTotal;
    } else if (row.childProductId) {
      const child = await computeProductMaterialCostOnly(row.childProductId, visited);
      if (child == null) return null;
      const loss = Number(row.lossPercentage ?? 0) / 100;
      const reqQty =
        loss >= 1 ? Number(row.quantity) : Number(row.quantity) / (1 - loss);
      total += child * reqQty;
    }
  }
  visited.delete(productId);
  return total;
}

async function costLineFromEffective(
  line: EffectivePricingBomLine,
  options: {
    recursive: boolean;
    maxDepth: number;
    depth: number;
    visited: Set<string>;
    parentCode: string;
  }
): Promise<CostImpactLine> {
  const code = line.componentCode;
  const qty = line.quantity ?? 0;
  const warnings: string[] = [];
  const base: CostImpactLine = {
    componentCode: code,
    description: line.componentDescription ?? null,
    quantity: qty,
    source: line.source,
    decision: line.decision,
    includedForPricing: line.includedForPricing,
    resolvedAs: "UNRESOLVED",
    resolvedId: null,
    unitCost: null,
    totalCost: null,
    currentQuantity: null,
    effectiveQuantity: qty,
    currentLineCost: null,
    effectiveLineCost: null,
    deltaCost: null,
    warnings,
  };

  if (!line.includedForPricing) {
    return base;
  }

  const resolved = await resolveNomusComponentCodes([code]);
  const res = resolved[0];

  if (res?.materialId) {
    const mat = await prisma.material.findUnique({ where: { id: res.materialId } });
    if (mat) {
      const { unitEffective, lineTotal } = computeMaterialLineTotal(mat, qty, 0);
      return {
        ...base,
        resolvedAs: line.source.startsWith("LOCAL_") ? "LOCAL_PRODUCT_BOM" : "MATERIAL",
        resolvedId: mat.id,
        unitCost: unitEffective,
        totalCost: lineTotal,
        effectiveLineCost: lineTotal,
      };
    }
  }

  if (res?.productId) {
    const visitKey = `${normalizeSku(options.parentCode)}>${normalizeComponentCode(code)}`;
    if (options.recursive && options.depth < options.maxDepth && !options.visited.has(visitKey)) {
      const stageCount = await prisma.nomusBomComponentStage.count({
        where: {
          OR: [{ parentCode: code }, { parentCode: normalizeSku(code) }],
        },
      });
      if (stageCount > 0) {
        options.visited.add(visitKey);
        const childBom = await buildEffectivePricingBomForParentCode(code, {
          recursive: false,
          maxDepth: options.maxDepth,
        });
        let childMaterial = 0;
        for (const childLine of childBom.directLines.filter((l) => l.includedForPricing)) {
          const childCost = await costLineFromEffective(childLine, {
            ...options,
            depth: options.depth + 1,
            parentCode: code,
          });
          childMaterial += childCost.totalCost ?? 0;
        }
        options.visited.delete(visitKey);
        const lineTotal = childMaterial * qty;
        return {
          ...base,
          resolvedAs: "PRODUCT",
          resolvedId: res.productId,
          unitCost: childMaterial,
          totalCost: lineTotal,
          effectiveLineCost: lineTotal,
        };
      }
    }

    const matOnly = await computeProductMaterialCostOnly(res.productId, new Set(options.visited));
    if (matOnly != null) {
      const lineTotal = matOnly * qty;
      return {
        ...base,
        resolvedAs: "PRODUCT",
        resolvedId: res.productId,
        unitCost: matOnly,
        totalCost: lineTotal,
        effectiveLineCost: lineTotal,
        warnings: [
          "Custo do componente estimado pela BOM IndusCost (materiais); transformação do filho não incluída nesta fase.",
        ],
      };
    }
    warnings.push("Não foi possível resolver custo do componente produto.");
  }

  warnings.push("Componente sem Material ou Product correspondente no IndusCost.");
  return { ...base, warnings };
}

function comparisonStatus(
  currentQty: number | null,
  effectiveQty: number | null,
  currentCost: number | null,
  effectiveCost: number | null,
  hasCurrent: boolean,
  hasEffective: boolean,
  effectiveSource?: string
): { status: CostLineComparisonStatus; explanation: string } {
  if (!hasCurrent && hasEffective) {
    const review = effectiveSource?.startsWith("LOCAL_ONLY_INCLUDED");
    return {
      status: review ? "INCLUDED_BY_REVIEW" : "ONLY_EFFECTIVE_NOMUS",
      explanation: review
        ? "Incluído na BOM efetiva por decisão de revisão local."
        : "Presente na BOM efetiva Nomus, ausente na ProductBOM atual.",
    };
  }
  if (hasCurrent && !hasEffective) {
    return {
      status: "EXCLUDED_BY_NOMUS_EFFECTIVE",
      explanation: "Presente na ProductBOM atual, excluído da BOM efetiva Nomus.",
    };
  }
  if (!hasCurrent && !hasEffective) {
    return {
      status: "UNRESOLVED_COST",
      explanation: "Sem composição em ambos os lados.",
    };
  }
  if (currentCost == null && effectiveCost == null) {
    return {
      status: "UNRESOLVED_COST",
      explanation: "Quantidades comparáveis, mas custo não resolvido em um ou ambos os lados.",
    };
  }
  const qCur = currentQty ?? 0;
  const qEff = effectiveQty ?? 0;
  if (Math.abs(qCur - qEff) < 0.000001) {
    return {
      status: "SAME_COMPONENT_SAME_QTY",
      explanation: "Mesmo componente e mesma quantidade efetiva.",
    };
  }
  return {
    status: "SAME_COMPONENT_QTY_DIFF",
    explanation: `Quantidade difere: IndusCost=${qCur}, Nomus efetivo=${qEff}.`,
  };
}

function mergeComparisonLines(
  currentByCode: Map<string, CurrentBomLine>,
  effectiveByCode: Map<string, { line: EffectivePricingBomLine; cost: CostImpactLine }>,
  currentAnalysis: CurrentCostSnapshot | null
): CostImpactComparisonLine[] {
  const allCodes = new Set([...currentByCode.keys(), ...effectiveByCode.keys()]);
  const out: CostImpactComparisonLine[] = [];

  for (const codeKey of [...allCodes].sort()) {
    const cur = currentByCode.get(codeKey);
    const eff = effectiveByCode.get(codeKey);
    const displayCode = cur?.componentCode ?? eff?.line.componentCode ?? codeKey;

    let currentCost = cur?.lineCost ?? null;
    if (currentCost == null && cur?.resolvedAs === "PRODUCT" && currentAnalysis?.materials) {
      const row = currentAnalysis.materials.find(
        (m) => normalizeComponentCode(m.sku ?? "") === codeKey && !m.excludedFromCost
      );
      if (row?.unitCost != null) currentCost = Number(row.unitCost);
    }

    const effectiveCost = eff?.cost.effectiveLineCost ?? eff?.cost.totalCost ?? null;
    const { status, explanation } = comparisonStatus(
      cur?.quantity ?? null,
      eff?.line.quantity ?? null,
      currentCost,
      effectiveCost,
      cur != null,
      eff != null,
      eff?.line.source
    );

    const deltaCost =
      currentCost != null && effectiveCost != null ? effectiveCost - currentCost : null;

    out.push({
      componentCode: displayCode,
      description: cur?.description ?? eff?.line.componentDescription ?? null,
      currentQuantity: cur?.quantity ?? null,
      effectiveQuantity: eff?.line.quantity ?? null,
      currentCost,
      effectiveCost,
      deltaCost,
      status,
      explanation,
    });
  }
  return out;
}

export async function buildNomusEffectiveBomCostImpact(
  parentCode: string,
  options?: {
    recursive?: boolean;
    maxDepth?: number;
    lotSize?: number;
  },
  currentCostSnapshot?: CurrentCostSnapshot | null
): Promise<NomusEffectiveBomCostImpactResult> {
  const trimmed = parentCode.trim();
  const recursive = options?.recursive ?? false;
  const maxDepth = options?.maxDepth ?? 10;

  const effectiveBom = await buildEffectivePricingBomForParentCode(trimmed, {
    recursive,
    maxDepth,
  });

  const baseSummary: CostImpactSummary = {
    comparisonLinesCount: 0,
    includedEffectiveLinesCount: 0,
    excludedEffectiveLinesCount: 0,
    unresolvedCostLinesCount: 0,
    onlyCurrentCount: 0,
    onlyEffectiveCount: 0,
    qtyDiffCount: 0,
    transformationUsesCurrent: true,
    scopeNote: SCOPE_NOTE,
  };

  const warnings: string[] = [...effectiveBom.warnings];

  if (BLOCKED_EFFECTIVE_STATUSES.has(effectiveBom.status)) {
    return {
      generatedAt: new Date().toISOString(),
      parentCode: effectiveBom.parentCode,
      parentDescription: effectiveBom.parentDescription ?? null,
      indusProductId: effectiveBom.indusProductId ?? null,
      status: "BLOCKED_EFFECTIVE_BOM_NOT_READY",
      optionalPricingStatus: effectiveBom.optionalPricingStatus,
      effectiveBomStatus: effectiveBom.status,
      currentCost: null,
      effectiveNomusCost: null,
      delta: null,
      summary: baseSummary,
      lines: [],
      includedLines: [],
      excludedLines: [],
      unresolvedLines: [],
      warnings: [
        ...warnings,
        "BOM efetiva não está pronta para preview de custo. Resolva opcionais e revisões locais.",
      ],
    };
  }

  const product = effectiveBom.indusProductId
    ? await prisma.product.findUnique({
        where: { id: effectiveBom.indusProductId },
        select: { id: true, sku: true, name: true, description: true },
      })
    : await prisma.product.findFirst({
        where: {
          OR: [{ sku: trimmed }, { sku: normalizeSku(trimmed) }],
        },
        select: { id: true, sku: true, name: true, description: true },
      });

  if (!product) {
    return {
      generatedAt: new Date().toISOString(),
      parentCode: effectiveBom.parentCode,
      parentDescription: effectiveBom.parentDescription ?? null,
      indusProductId: null,
      status: "NO_INDUS_PRODUCT",
      optionalPricingStatus: effectiveBom.optionalPricingStatus,
      effectiveBomStatus: effectiveBom.status,
      currentCost: null,
      effectiveNomusCost: null,
      delta: null,
      summary: baseSummary,
      lines: [],
      includedLines: [],
      excludedLines: [],
      unresolvedLines: [],
      warnings: [...warnings, "Produto não cadastrado no IndusCost — custo atual indisponível."],
    };
  }

  let currentCost: CostBreakdown | null = null;
  if (currentCostSnapshot && !("error" in (currentCostSnapshot as object))) {
    const mat = Number(currentCostSnapshot.totalMaterialCost);
    const hh = Number(currentCostSnapshot.totalHH_Unit);
    const hm = Number(currentCostSnapshot.totalHM_Unit);
    const transformation = hh + hm;
    currentCost = {
      materialCost: mat,
      transformationCost: transformation,
      totalCost: Number(currentCostSnapshot.totalIndustrialCost),
    };
    if (currentCostSnapshot.costAnalysisPartial) {
      warnings.push("Custo atual parcial (linhas da BOM excluídas do motor de custo).");
    }
  } else {
    warnings.push(
      "Custo atual não fornecido pelo motor — informe via endpoint com produto IndusCost cadastrado."
    );
  }

  if (!currentCost) {
    return {
      generatedAt: new Date().toISOString(),
      parentCode: effectiveBom.parentCode,
      parentDescription: effectiveBom.parentDescription ?? product.description ?? product.name,
      indusProductId: product.id,
      status: "CURRENT_COST_UNAVAILABLE",
      optionalPricingStatus: effectiveBom.optionalPricingStatus,
      effectiveBomStatus: effectiveBom.status,
      currentCost: null,
      effectiveNomusCost: null,
      delta: null,
      summary: baseSummary,
      lines: [],
      includedLines: [],
      excludedLines: [],
      unresolvedLines: [],
      warnings,
    };
  }

  const visited = new Set<string>();
  const includedLines: CostImpactLine[] = [];
  const excludedLines: CostImpactLine[] = [];
  const unresolvedLines: CostImpactLine[] = [];

  for (const line of effectiveBom.directLines) {
    const costLine = await costLineFromEffective(line, {
      recursive,
      maxDepth,
      depth: 0,
      visited,
      parentCode: effectiveBom.parentCode,
    });
    if (line.includedForPricing) includedLines.push(costLine);
    else excludedLines.push(costLine);
    if (costLine.resolvedAs === "UNRESOLVED" || costLine.totalCost == null) {
      unresolvedLines.push(costLine);
    }
  }

  for (const line of [...effectiveBom.excludedLines, ...effectiveBom.reviewLines]) {
    excludedLines.push(
      await costLineFromEffective(line, {
        recursive,
        maxDepth,
        depth: 0,
        visited,
        parentCode: effectiveBom.parentCode,
      })
    );
  }

  let effectiveMaterial = includedLines.reduce((s, l) => s + (l.totalCost ?? 0), 0);
  const effectiveNomusCost: CostBreakdown = {
    materialCost: effectiveMaterial,
    transformationCost: currentCost.transformationCost,
    totalCost: effectiveMaterial + currentCost.transformationCost,
  };

  warnings.push(SCOPE_NOTE);

  const currentBomLines = await loadCurrentBomLines(product.id);
  const currentByCode = new Map<string, CurrentBomLine>();
  for (const row of currentBomLines) {
    currentByCode.set(normalizeComponentCode(row.componentCode), row);
  }

  const effectiveByCode = new Map<string, { line: EffectivePricingBomLine; cost: CostImpactLine }>();
  for (const cost of includedLines) {
    const line = effectiveBom.directLines.find(
      (l) =>
        l.includedForPricing &&
        normalizeComponentCode(l.componentCode) === normalizeComponentCode(cost.componentCode)
    );
    if (line) {
      effectiveByCode.set(normalizeComponentCode(line.componentCode), { line, cost });
    }
  }

  const comparisonLines = mergeComparisonLines(
    currentByCode,
    effectiveByCode,
    currentCostSnapshot ?? null
  );

  for (const cl of comparisonLines) {
    const inc = includedLines.find(
      (l) => normalizeComponentCode(l.componentCode) === normalizeComponentCode(cl.componentCode)
    );
    if (inc) {
      inc.currentQuantity = cl.currentQuantity;
      inc.currentLineCost = cl.currentCost;
      inc.effectiveLineCost = cl.effectiveCost;
      inc.deltaCost = cl.deltaCost;
    }
  }

  const summary: CostImpactSummary = {
    comparisonLinesCount: comparisonLines.length,
    includedEffectiveLinesCount: includedLines.length,
    excludedEffectiveLinesCount: excludedLines.length,
    unresolvedCostLinesCount: unresolvedLines.length,
    onlyCurrentCount: comparisonLines.filter((l) => l.status === "ONLY_CURRENT_INDUS").length,
    onlyEffectiveCount: comparisonLines.filter(
      (l) => l.status === "ONLY_EFFECTIVE_NOMUS" || l.status === "INCLUDED_BY_REVIEW"
    ).length,
    qtyDiffCount: comparisonLines.filter((l) => l.status === "SAME_COMPONENT_QTY_DIFF").length,
    transformationUsesCurrent: true,
    scopeNote: SCOPE_NOTE,
  };

  const delta = buildDelta(currentCost, effectiveNomusCost);

  return {
    generatedAt: new Date().toISOString(),
    parentCode: effectiveBom.parentCode,
    parentDescription: effectiveBom.parentDescription ?? product.description ?? product.name,
    indusProductId: product.id,
    status: "READY",
    optionalPricingStatus: effectiveBom.optionalPricingStatus,
    effectiveBomStatus: effectiveBom.status,
    currentCost,
    effectiveNomusCost,
    delta,
    summary,
    lines: comparisonLines,
    includedLines,
    excludedLines,
    unresolvedLines,
    warnings,
  };
}
