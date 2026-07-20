/**
 * Contrato frontend-safe — custos industriais + resultado do pedido no detalhe.
 * Reutiliza a semântica do Relatório de Resultado Industrial (sem Prisma).
 */
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import type {
  IndustrialCostSourceStatus,
  IndustrialTaxSource,
  SalesOrderIndustrialResultReportRow,
} from "@/src/lib/sales/salesOrderIndustrialResultReport.js";
import type { ProductionCostBomLineAudit } from "@/src/lib/productionCostCalculationSnapshotAudit.js";
import type { ExplosionRowCore } from "@/src/lib/openBookMaterialExplosion.js";

export type SalesOrderDetailIndustrialMaterialLine = {
  materialKey: string;
  materialId: string | null;
  sku: string | null;
  name: string;
  unit: string | null;
  /** Qtd total no pedido (BOM × qtd do item). */
  quantityInOrder: number;
  /** Preço unitário considerado (R$/un. da MP — tipicamente R$/kg). */
  unitCostUsed: number | null;
  /** Custo total da MP no pedido. */
  totalCost: number;
  sourceProductSku: string | null;
  sourceProductName: string | null;
  lineType: string;
};

export type SalesOrderDetailIndustrialResultVerdict =
  | "POSITIVE"
  | "NEGATIVE"
  | "ZERO"
  | "INCOMPLETE";

export type SalesOrderDetailIndustrialResultBlock = {
  available: boolean;
  row: SalesOrderIndustrialResultReportRow | null;
  materials: SalesOrderDetailIndustrialMaterialLine[];
  materialsTotalCost: number;
  verdict: SalesOrderDetailIndustrialResultVerdict;
  verdictLabel: string;
  /** Texto executivo: quanto sobra (ou falta) após custos industriais + impostos. */
  resultNarrative: string;
  warnings: string[];
};

export function resolveIndustrialResultVerdict(
  row: SalesOrderIndustrialResultReportRow | null
): SalesOrderDetailIndustrialResultVerdict {
  if (!row || !row.includedInConsolidation || row.industrialResult == null) {
    return "INCOMPLETE";
  }
  if (row.industrialResult > 0.009) return "POSITIVE";
  if (row.industrialResult < -0.009) return "NEGATIVE";
  return "ZERO";
}

export function industrialResultVerdictLabel(
  verdict: SalesOrderDetailIndustrialResultVerdict
): string {
  switch (verdict) {
    case "POSITIVE":
      return "Resultado positivo";
    case "NEGATIVE":
      return "Resultado negativo";
    case "ZERO":
      return "Resultado zerado";
    default:
      return "Apuração incompleta";
  }
}

export function buildIndustrialResultNarrative(
  row: SalesOrderIndustrialResultReportRow | null
): string {
  if (!row || !row.includedInConsolidation || row.industrialResult == null) {
    return "Não foi possível concluir o resultado industrial (custo e/ou imposto incompletos).";
  }
  const surplus = row.industrialResult;
  const afterTax = row.revenueAfterTaxes ?? 0;
  const cost = row.totalIndustrialCost ?? 0;
  const taxes = row.totalTaxes ?? 0;
  if (surplus >= 0) {
    return (
      `Após impostos (R$ ${taxes.toFixed(2)}) e custos industriais (R$ ${cost.toFixed(2)}), ` +
      `restam R$ ${surplus.toFixed(2)} sobre a receita líquida de impostos (R$ ${afterTax.toFixed(2)}).`
    );
  }
  return (
    `Após impostos (R$ ${taxes.toFixed(2)}) e custos industriais (R$ ${cost.toFixed(2)}), ` +
    `o pedido fica negativo em R$ ${Math.abs(surplus).toFixed(2)} ` +
    `(receita líquida de impostos R$ ${afterTax.toFixed(2)}).`
  );
}

export type ScaleBomMaterialInput = {
  line: Pick<
    ProductionCostBomLineAudit,
    | "materialId"
    | "sku"
    | "name"
    | "unit"
    | "requiredQty"
    | "unitCostUsed"
    | "lineTotalCost"
    | "lineType"
    | "excludedFromCost"
  >;
  orderItemQuantity: number;
  sourceProductSku: string | null;
  sourceProductName: string | null;
};

/**
 * Escala uma linha BOM (por unidade do produto) pela quantidade vendida do item.
 */
export function scaleBomMaterialLineForOrderItem(
  input: ScaleBomMaterialInput
): SalesOrderDetailIndustrialMaterialLine | null {
  const { line, orderItemQuantity } = input;
  if (line.excludedFromCost) return null;
  if (line.lineType !== "MATERIAL" && line.lineType !== "COMPONENT") return null;
  const qtyUnit = line.requiredQty ?? 0;
  if (!(qtyUnit > 0) || !(orderItemQuantity > 0)) return null;
  const quantityInOrder = roundMoney(qtyUnit * orderItemQuantity);
  const unitCost =
    line.unitCostUsed != null && Number.isFinite(line.unitCostUsed)
      ? line.unitCostUsed
      : qtyUnit > 0
        ? line.lineTotalCost / qtyUnit
        : null;
  const totalCost =
    unitCost != null
      ? roundMoney(unitCost * quantityInOrder)
      : roundMoney(line.lineTotalCost * orderItemQuantity);
  const sku = line.sku?.trim() || null;
  const name = line.name?.trim() || sku || "Material sem nome";
  const materialKey =
    line.materialId?.trim() ||
    sku ||
    `${name}|${input.sourceProductSku ?? ""}`;

  return {
    materialKey,
    materialId: line.materialId,
    sku,
    name,
    unit: line.unit,
    quantityInOrder,
    unitCostUsed: unitCost != null ? roundMoney(unitCost) : null,
    totalCost,
    sourceProductSku: input.sourceProductSku,
    sourceProductName: input.sourceProductName,
    lineType: line.lineType,
  };
}

/**
 * Escala linha da explosão Open Book (MP folha por unidade do produto) × qtd do item.
 * Mesma origem da Inteligência de Matéria-Prima.
 */
export function scaleOpenBookExplosionRowForOrderItem(input: {
  row: ExplosionRowCore;
  orderItemQuantity: number;
  sourceProductSku: string | null;
  sourceProductName: string | null;
}): SalesOrderDetailIndustrialMaterialLine | null {
  const { row, orderItemQuantity } = input;
  if (!(orderItemQuantity > 0)) return null;
  const qtyPerUnit = Number(row.quantity);
  const costPerUnit = Number(row.totalCost);
  if (!(qtyPerUnit > 0) || !Number.isFinite(qtyPerUnit)) return null;
  const quantityInOrder = roundMoney(qtyPerUnit * orderItemQuantity);
  const unitCostUsed =
    qtyPerUnit > 0 && Number.isFinite(costPerUnit)
      ? roundMoney(costPerUnit / qtyPerUnit)
      : null;
  const totalCost = Number.isFinite(costPerUnit)
    ? roundMoney(costPerUnit * orderItemQuantity)
    : unitCostUsed != null
      ? roundMoney(unitCostUsed * quantityInOrder)
      : 0;
  const sku = row.code?.trim() || null;
  const name = row.description?.trim() || sku || "Material sem nome";
  const materialKey = row.materialId?.trim() || sku || name;

  return {
    materialKey,
    materialId: row.materialId?.trim() || null,
    sku,
    name,
    unit: row.unit?.trim() || null,
    quantityInOrder,
    unitCostUsed,
    totalCost,
    sourceProductSku: input.sourceProductSku,
    sourceProductName: input.sourceProductName,
    lineType: "MATERIAL",
  };
}

/** Consolida MPs iguais (mesmo materialKey) somando qtd e custo. */
export function mergeIndustrialMaterialLines(
  lines: SalesOrderDetailIndustrialMaterialLine[]
): SalesOrderDetailIndustrialMaterialLine[] {
  const map = new Map<string, SalesOrderDetailIndustrialMaterialLine>();
  for (const line of lines) {
    const prev = map.get(line.materialKey);
    if (!prev) {
      map.set(line.materialKey, { ...line });
      continue;
    }
    const quantityInOrder = roundMoney(prev.quantityInOrder + line.quantityInOrder);
    const totalCost = roundMoney(prev.totalCost + line.totalCost);
    const unitCostUsed =
      quantityInOrder > 0 ? roundMoney(totalCost / quantityInOrder) : prev.unitCostUsed;
    map.set(line.materialKey, {
      ...prev,
      quantityInOrder,
      totalCost,
      unitCostUsed,
      name: prev.name || line.name,
      sku: prev.sku || line.sku,
      unit: prev.unit || line.unit,
    });
  }
  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost);
}

export function buildSalesOrderDetailIndustrialResultBlock(input: {
  row: SalesOrderIndustrialResultReportRow | null;
  materials: SalesOrderDetailIndustrialMaterialLine[];
  extraWarnings?: string[];
}): SalesOrderDetailIndustrialResultBlock {
  const materials = mergeIndustrialMaterialLines(input.materials);
  const materialsTotalCost = roundMoney(
    materials.reduce((sum, m) => sum + m.totalCost, 0)
  );
  const verdict = resolveIndustrialResultVerdict(input.row);
  const warnings = [
    ...(input.row?.warnings ?? []),
    ...(input.extraWarnings ?? []),
  ];
  return {
    available: input.row != null,
    row: input.row,
    materials,
    materialsTotalCost,
    verdict,
    verdictLabel: industrialResultVerdictLabel(verdict),
    resultNarrative: buildIndustrialResultNarrative(input.row),
    warnings,
  };
}

export type {
  IndustrialCostSourceStatus,
  IndustrialTaxSource,
  SalesOrderIndustrialResultReportRow,
};
