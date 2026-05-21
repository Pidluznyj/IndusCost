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
import { parseProductBomLineIdFromLine } from "@/src/lib/nomusBomReviewDecision";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import type { EffectivePricingBomLine } from "@/src/lib/nomusEffectivePricingBomTypes";
import { scaleChildContribution, type ChildUnitAnalysis } from "@/src/lib/costRollup";
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
    bomLineId?: string;
    requiredQty?: number;
    unitCost?: number;
    excludedFromCost?: boolean;
  }>;
};

/** No snapshot do cost-analysis, `unitCost` em materials = custo total da linha (não unitário). */
function lookupLineTotalFromCostAnalysis(
  componentCode: string,
  bomLineId: string | null,
  currentAnalysis: CurrentCostSnapshot | null
): number | null {
  if (!currentAnalysis?.materials?.length) return null;
  const codeKey = normalizeComponentCode(componentCode);
  const row =
    (bomLineId
      ? currentAnalysis.materials.find(
          (m) => m.bomLineId === bomLineId && !m.excludedFromCost
        )
      : undefined) ??
    currentAnalysis.materials.find(
      (m) =>
        !m.excludedFromCost &&
        m.sku != null &&
        normalizeComponentCode(m.sku) === codeKey
    );
  if (row?.unitCost == null) return null;
  const cost = Number(row.unitCost);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

type CostAnalysisMaterialRow = NonNullable<CurrentCostSnapshot["materials"]>[number];

function lookupMaterialRowFromCostAnalysis(
  componentCode: string,
  bomLineId: string | null,
  currentAnalysis: CurrentCostSnapshot | null
): CostAnalysisMaterialRow | null {
  if (!currentAnalysis?.materials?.length) return null;
  const codeKey = normalizeComponentCode(componentCode);
  return (
    (bomLineId
      ? currentAnalysis.materials.find(
          (m) => m.bomLineId === bomLineId && !m.excludedFromCost
        )
      : undefined) ??
    currentAnalysis.materials.find(
      (m) =>
        !m.excludedFromCost &&
        m.sku != null &&
        normalizeComponentCode(m.sku) === codeKey
    ) ??
    null
  );
}

/**
 * Detecta se uma linha está presente no snapshot do cost-analysis com `excludedFromCost = true`.
 * Quando isso acontece, o motor `getProductCostAnalysis` NÃO somou essa linha em `totalMaterialCost`.
 * O impacto de custo precisa replicar essa exclusão para não inflar o custo efetivo.
 */
function lineIsExcludedInCostAnalysis(
  componentCode: string,
  bomLineId: string | null,
  currentAnalysis: CurrentCostSnapshot | null
): boolean {
  if (!currentAnalysis?.materials?.length) return false;
  const codeKey = normalizeComponentCode(componentCode);
  const row =
    (bomLineId
      ? currentAnalysis.materials.find((m) => m.bomLineId === bomLineId)
      : undefined) ??
    currentAnalysis.materials.find(
      (m) => m.sku != null && normalizeComponentCode(m.sku) === codeKey
    );
  return Boolean(row?.excludedFromCost);
}

type ResolvedLocalIncludedCost = {
  currentQuantity: number | null;
  currentLineTotal: number | null;
  effectiveLineTotal: number | null;
  effectiveQuantity: number;
  deltaCost: number | null;
  warnings: string[];
};

async function resolveLocalIncludedReviewLineCost(
  line: EffectivePricingBomLine,
  options: {
    productId: string;
    currentAnalysis: CurrentCostSnapshot | null;
    currentByCode: Map<string, CurrentBomLine>;
  }
): Promise<ResolvedLocalIncludedCost> {
  const code = line.componentCode;
  const codeKey = normalizeComponentCode(code);
  const bomLineId = parseProductBomLineIdFromLine(line);
  const effectiveQuantity = line.quantity ?? 0;
  const warnings: string[] = [];

  const cur = options.currentByCode.get(codeKey);
  let currentQuantity: number | null = cur?.quantity ?? null;
  let currentLineTotal: number | null = cur?.lineCost ?? null;

  const analysisRow = lookupMaterialRowFromCostAnalysis(
    code,
    bomLineId && bomLineId !== "unknown" ? bomLineId : null,
    options.currentAnalysis
  );
  if (analysisRow?.requiredQty != null && Number.isFinite(Number(analysisRow.requiredQty))) {
    currentQuantity = currentQuantity ?? Number(analysisRow.requiredQty);
  }
  if (currentLineTotal == null) {
    currentLineTotal = lookupLineTotalFromCostAnalysis(
      code,
      bomLineId && bomLineId !== "unknown" ? bomLineId : null,
      options.currentAnalysis
    );
  }

  // Reconciliação de linha local já existente: se o motor de custo (getProductCostAnalysis)
  // marcou essa linha como `excludedFromCost: true`, ela NÃO entrou em currentCost.materialCost.
  // Aplicar a BOM efetiva (que apenas mantém a linha) não pode aumentar o custo total.
  // Mantemos current = 0 e effective = 0 para alinhar com o que entra no totalMaterialCost atual.
  const lineExistsInProductBom =
    cur != null || Boolean(bomLineId && bomLineId !== "unknown");
  const excludedFromMotor = lineIsExcludedInCostAnalysis(
    code,
    bomLineId && bomLineId !== "unknown" ? bomLineId : null,
    options.currentAnalysis
  );
  if (lineExistsInProductBom && excludedFromMotor) {
    return {
      currentQuantity: currentQuantity ?? effectiveQuantity,
      currentLineTotal: 0,
      effectiveLineTotal: 0,
      effectiveQuantity,
      deltaCost: 0,
      warnings: [
        `Linha local ${code} já existente na ProductBOM atual e mantida na BOM efetiva. ` +
          "Motor de custo não atribui custo a esta linha (excluída do cost-analysis); aplicar não altera o custo.",
      ],
    };
  }

  if (currentLineTotal == null && bomLineId && bomLineId !== "unknown") {
    currentLineTotal = await loadCurrentBomLineCost(
      bomLineId,
      options.productId,
      options.currentAnalysis
    );
    if (currentQuantity == null) {
      const bomRow = await prisma.productBOM.findFirst({
        where: { id: bomLineId, productId: options.productId },
        select: { quantity: true, lossPercentage: true },
      });
      if (bomRow) {
        const qty = Number(bomRow.quantity);
        const loss = Number(bomRow.lossPercentage ?? 0) / 100;
        currentQuantity = loss >= 1 ? qty : qty / (1 - loss);
      }
    }
  }

  if (currentLineTotal == null) {
    currentLineTotal = lookupLineTotalFromCostAnalysis(code, null, options.currentAnalysis);
  }

  if (currentLineTotal == null) {
    warnings.push(
      `Linha local incluída por revisão sem custo resolvido no cost-analysis atual: ${code}.`
    );
    return {
      currentQuantity,
      currentLineTotal: null,
      effectiveLineTotal: null,
      effectiveQuantity,
      deltaCost: null,
      warnings,
    };
  }

  let effectiveLineTotal: number;
  if (
    currentQuantity != null &&
    currentQuantity > 0 &&
    Number.isFinite(effectiveQuantity) &&
    Math.abs(currentQuantity - effectiveQuantity) >= 0.000001
  ) {
    effectiveLineTotal = (currentLineTotal / currentQuantity) * effectiveQuantity;
  } else {
    effectiveLineTotal = currentLineTotal;
    if (currentQuantity == null && effectiveQuantity > 0) {
      currentQuantity = effectiveQuantity;
    }
  }

  const deltaCost = effectiveLineTotal - currentLineTotal;

  return {
    currentQuantity,
    currentLineTotal,
    effectiveLineTotal,
    effectiveQuantity,
    deltaCost,
    warnings,
  };
}

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

async function approximateChildUnitAnalysis(
  childProductId: string,
  visiting: Set<string>
): Promise<ChildUnitAnalysis | null> {
  if (visiting.has(childProductId)) return null;
  visiting.add(childProductId);

  const product = await prisma.product.findUnique({
    where: { id: childProductId },
    include: {
      ProductBOM: { include: { Material: true } },
    },
  });
  if (!product) {
    visiting.delete(childProductId);
    return null;
  }

  let totalMaterialCost = 0;
  for (const item of product.ProductBOM) {
    if (item.Material) {
      const { lineTotal } = computeMaterialLineTotal(
        item.Material,
        Number(item.quantity),
        Number(item.lossPercentage ?? 0)
      );
      totalMaterialCost += lineTotal;
    } else if (item.childProductId) {
      const childUnit = await approximateChildUnitAnalysis(item.childProductId, visiting);
      if (!childUnit) continue;
      const loss = Number(item.lossPercentage ?? 0) / 100;
      const reqQty =
        loss >= 1 ? Number(item.quantity) : Number(item.quantity) / (1 - loss);
      const scaled = scaleChildContribution(childUnit, reqQty);
      totalMaterialCost += scaled.structuralLine;
    }
  }

  visiting.delete(childProductId);
  return {
    totalMaterialCost,
    totalHH_Unit: 0,
    totalHM_Unit: 0,
    totalCIF_Unit: 0,
    totalIndustrialCost: totalMaterialCost,
  };
}

async function loadCurrentBomLineCost(
  bomLineId: string,
  productId: string,
  currentAnalysis: CurrentCostSnapshot | null
): Promise<number | null> {
  const fromAnalysis = lookupLineTotalFromCostAnalysis("", bomLineId, currentAnalysis);
  if (fromAnalysis != null) return fromAnalysis;

  const row = await prisma.productBOM.findFirst({
    where: { id: bomLineId, productId },
    include: {
      Material: true,
      ChildProduct: { select: { id: true, sku: true, name: true } },
    },
  });
  if (!row) return null;

  const qty = Number(row.quantity);
  const loss = Number(row.lossPercentage ?? 0);
  const requiredQty = loss >= 1 ? qty : qty / (1 - loss / 100);

  if (row.Material) {
    const { lineTotal } = computeMaterialLineTotal(row.Material, qty, loss);
    return Number.isFinite(lineTotal) ? lineTotal : null;
  }
  if (row.childProductId && row.ChildProduct) {
    const sku = row.ChildProduct.sku;
    const fromSku =
      lookupLineTotalFromCostAnalysis(sku, bomLineId, currentAnalysis) ??
      lookupLineTotalFromCostAnalysis(sku, null, currentAnalysis);
    if (fromSku != null) return fromSku;

    const childUnit = await approximateChildUnitAnalysis(row.childProductId, new Set());
    if (childUnit) {
      const scaled = scaleChildContribution(childUnit, requiredQty);
      return Number.isFinite(scaled.structuralLine) ? scaled.structuralLine : null;
    }
  }
  return null;
}

async function loadCurrentBomLines(
  productId: string,
  currentAnalysis: CurrentCostSnapshot | null
): Promise<CurrentBomLine[]> {
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
      const requiredQty = loss >= 1 ? qty : qty / (1 - loss / 100);
      // Ordem: 1) cost-analysis incluído → custo já computado pelo motor;
      // 2) cost-analysis excluído (excludedFromCost=true) → 0 para alinhar com totalMaterialCost atual;
      // 3) sem snapshot ou linha ausente do snapshot → fallback por aproximação para listar a linha.
      const fromAnalysis = lookupLineTotalFromCostAnalysis(
        row.ChildProduct.sku,
        row.id,
        currentAnalysis
      );
      const excludedFromMotor = lineIsExcludedInCostAnalysis(
        row.ChildProduct.sku,
        row.id,
        currentAnalysis
      );
      const lineCost =
        fromAnalysis != null
          ? fromAnalysis
          : excludedFromMotor
            ? 0
            : await loadCurrentBomLineCost(row.id, productId, currentAnalysis);
      lines.push({
        componentCode: row.ChildProduct.sku,
        description: row.ChildProduct.name,
        quantity: requiredQty,
        lineCost,
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
    productId: string;
    currentAnalysis: CurrentCostSnapshot | null;
    currentByCode: Map<string, CurrentBomLine>;
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

  if (line.source === "LOCAL_ONLY_INCLUDED_BY_REVIEW") {
    const bomLineId = parseProductBomLineIdFromLine(line);
    const resolved = await resolveLocalIncludedReviewLineCost(line, {
      productId: options.productId,
      currentAnalysis: options.currentAnalysis,
      currentByCode: options.currentByCode,
    });
    warnings.push(...resolved.warnings);

    if (resolved.effectiveLineTotal != null) {
      const unitCost =
        resolved.effectiveQuantity > 0
          ? resolved.effectiveLineTotal / resolved.effectiveQuantity
          : resolved.effectiveLineTotal;
      return {
        ...base,
        resolvedAs: "LOCAL_PRODUCT_BOM",
        resolvedId:
          bomLineId && bomLineId !== "unknown"
            ? bomLineId
            : options.currentByCode.get(normalizeComponentCode(code))?.bomLineId ?? null,
        unitCost,
        totalCost: resolved.effectiveLineTotal,
        currentQuantity: resolved.currentQuantity,
        effectiveQuantity: resolved.effectiveQuantity,
        currentLineCost: resolved.currentLineTotal,
        effectiveLineCost: resolved.effectiveLineTotal,
        deltaCost: resolved.deltaCost,
        warnings:
          resolved.warnings.length > 0
            ? resolved.warnings
            : [
                "Componente local mantido por decisão de revisão e custeado pelo custo atual do IndusCost.",
              ],
      };
    }
    return { ...base, warnings, resolvedAs: "UNRESOLVED" };
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
    const localIncluded = effectiveSource === "LOCAL_ONLY_INCLUDED_BY_REVIEW";
    return {
      status: localIncluded ? "LOCAL_INCLUDED_BY_REVIEW" : "INCLUDED_BY_REVIEW",
      explanation: localIncluded
        ? "Componente local mantido por decisão de revisão e custeado pelo custo atual do IndusCost."
        : "Incluído na BOM efetiva por decisão de revisão local.",
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
    if (
      effectiveSource === "LOCAL_ONLY_INCLUDED_BY_REVIEW" &&
      currentCost != null &&
      effectiveCost != null &&
      Math.abs(currentCost - effectiveCost) < 0.000001
    ) {
      return {
        status: "LOCAL_INCLUDED_BY_REVIEW",
        explanation:
          "Componente local mantido por decisão de revisão e custeado pelo custo atual do IndusCost.",
      };
    }
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
    if (currentCost == null && currentAnalysis?.materials) {
      currentCost =
        lookupLineTotalFromCostAnalysis(
          displayCode,
          cur?.bomLineId ?? null,
          currentAnalysis
        ) ?? currentCost;
    }

    let effectiveCost = eff?.cost.effectiveLineCost ?? eff?.cost.totalCost ?? null;
    if (
      eff?.line.source === "LOCAL_ONLY_INCLUDED_BY_REVIEW" &&
      effectiveCost == null &&
      eff.cost.effectiveLineCost != null
    ) {
      effectiveCost = eff.cost.effectiveLineCost;
    }
    if (
      eff?.line.source === "LOCAL_ONLY_INCLUDED_BY_REVIEW" &&
      currentCost == null &&
      eff.cost.currentLineCost != null
    ) {
      currentCost = eff.cost.currentLineCost;
    }
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

  const currentBomLines = await loadCurrentBomLines(product.id, currentCostSnapshot ?? null);
  const currentByCode = new Map<string, CurrentBomLine>();
  for (const row of currentBomLines) {
    currentByCode.set(normalizeComponentCode(row.componentCode), row);
  }

  const costLineOptions = {
    recursive,
    maxDepth,
    depth: 0,
    visited: new Set<string>(),
    parentCode: effectiveBom.parentCode,
    productId: product.id,
    currentAnalysis: currentCostSnapshot ?? null,
    currentByCode,
  };

  const includedLines: CostImpactLine[] = [];
  const excludedLines: CostImpactLine[] = [];
  const unresolvedLines: CostImpactLine[] = [];

  for (const line of effectiveBom.directLines) {
    const costLine = await costLineFromEffective(line, costLineOptions);
    if (line.includedForPricing) includedLines.push(costLine);
    else excludedLines.push(costLine);
    if (costLine.resolvedAs === "UNRESOLVED" || costLine.totalCost == null) {
      unresolvedLines.push(costLine);
    }
  }

  for (const line of [...effectiveBom.excludedLines, ...effectiveBom.reviewLines]) {
    excludedLines.push(await costLineFromEffective(line, costLineOptions));
  }

  let effectiveMaterial = includedLines.reduce((s, l) => s + (l.totalCost ?? 0), 0);
  const effectiveNomusCost: CostBreakdown = {
    materialCost: effectiveMaterial,
    transformationCost: currentCost.transformationCost,
    totalCost: effectiveMaterial + currentCost.transformationCost,
  };

  warnings.push(SCOPE_NOTE);

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
      inc.currentQuantity = cl.currentQuantity ?? inc.currentQuantity;
      inc.currentLineCost = cl.currentCost ?? inc.currentLineCost;
      inc.effectiveLineCost = cl.effectiveCost ?? inc.effectiveLineCost;
      inc.deltaCost = cl.deltaCost ?? inc.deltaCost;
    }
    if (
      cl.status === "LOCAL_INCLUDED_BY_REVIEW" &&
      cl.effectiveCost != null &&
      Math.abs(cl.effectiveCost) < 0.000001 &&
      cl.currentCost != null &&
      cl.currentCost > 0
    ) {
      cl.effectiveCost = cl.currentCost;
      cl.deltaCost = 0;
      cl.explanation =
        "Componente local mantido por decisão de revisão e custeado pelo custo atual do IndusCost.";
    }
  }

  for (const inc of includedLines) {
    if (inc.source !== "LOCAL_ONLY_INCLUDED_BY_REVIEW") continue;
    const unresolvedMsg = `Linha local incluída por revisão sem custo resolvido no cost-analysis atual: ${inc.componentCode}.`;
    if (inc.totalCost == null || inc.effectiveLineCost == null) {
      if (!warnings.includes(unresolvedMsg)) warnings.push(unresolvedMsg);
    }
  }

  const summary: CostImpactSummary = {
    comparisonLinesCount: comparisonLines.length,
    includedEffectiveLinesCount: includedLines.length,
    excludedEffectiveLinesCount: excludedLines.length,
    unresolvedCostLinesCount: unresolvedLines.length,
    onlyCurrentCount: comparisonLines.filter((l) => l.status === "ONLY_CURRENT_INDUS").length,
    onlyEffectiveCount: comparisonLines.filter(
      (l) =>
        l.status === "ONLY_EFFECTIVE_NOMUS" ||
        l.status === "INCLUDED_BY_REVIEW" ||
        l.status === "LOCAL_INCLUDED_BY_REVIEW"
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
