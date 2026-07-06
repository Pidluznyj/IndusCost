import type { MaterialUsageContribution } from "./materialDemandPlannedRealizedTypes.js";
import type { RawMaterialDemandLineResult } from "./salesOrderRawMaterialEstimation.js";
import type {
  RawMaterialIntelligenceBlock,
  RawMaterialIntelligenceDetailLine,
  RawMaterialIntelligenceMaterialRow,
  RawMaterialIntelligenceOrderRow,
  RawMaterialIntelligenceUnservedBalanceRow,
} from "./salesOrderRawMaterialIntelligenceTypes.js";
import { safeDisplayNumber } from "./materialDemandIntelligenceUi.js";

function round6(n: number): number {
  const v = safeDisplayNumber(n);
  return Math.round(v * 1_000_000) / 1_000_000;
}

function orderProductKey(orderId: string, productCode: string | null): string {
  return `${orderId}::${productCode ?? ""}`;
}

export function buildRawMaterialIntelligenceDetailLines(input: {
  demandLines: RawMaterialDemandLineResult[];
  orders: RawMaterialIntelligenceOrderRow[];
  contributions: MaterialUsageContribution[];
  unservedBalances: RawMaterialIntelligenceUnservedBalanceRow[];
  materialIdByCode: Map<string, string>;
}): RawMaterialIntelligenceDetailLine[] {
  const orderByKey = new Map(
    input.orders.map((row) => [orderProductKey(row.orderId, row.productCode), row])
  );
  const unservedByKey = new Map(
    input.unservedBalances.map((row) => [
      orderProductKey(row.orderId, row.productCode),
      row.openNetAmount,
    ])
  );
  const bomByKey = new Map<string, number>();
  for (const c of input.contributions) {
    const key = `${c.materialId}::${c.orderId}::${c.productSku ?? c.productId}`;
    bomByKey.set(key, safeDisplayNumber(c.materialQtyPerUnit));
  }

  const lines: RawMaterialIntelligenceDetailLine[] = [];

  for (const line of input.demandLines) {
    const materialId =
      input.materialIdByCode.get(line.materialCode) ??
      input.contributions.find(
        (c) =>
          (c.materialCode ?? c.materialId) === line.materialCode &&
          c.orderId === line.sourceOrderId
      )?.materialId ??
      line.materialCode;

    const orderRow = orderByKey.get(orderProductKey(line.sourceOrderId, line.productCode));
    const bomKey = `${materialId}::${line.sourceOrderId}::${line.productCode ?? ""}`;
    const contribMatch = input.contributions.find(
      (c) =>
        c.materialId === materialId &&
        c.orderId === line.sourceOrderId &&
        (c.productSku === line.productCode || c.productId === line.sourceItemId)
    );

    const opKey = orderProductKey(line.sourceOrderId, line.productCode);
    lines.push({
      materialId,
      materialCode: contribMatch?.materialCode ?? line.materialCode,
      materialName: line.materialName,
      unitLabel: contribMatch?.unitLabel ?? line.unit,
      orderId: line.sourceOrderId,
      orderNumber: line.sourceOrderNumber,
      customerName: orderRow?.customerName ?? contribMatch?.customerName ?? null,
      productCode: line.productCode,
      productName: line.productName,
      soldQuantity: round6(orderRow?.soldQuantity ?? 0),
      invoicedQuantity: round6(orderRow?.invoicedQuantity ?? 0),
      openQuantity: round6(orderRow?.openQuantity ?? 0),
      openNetAmount: round6(orderRow?.openNetAmount ?? 0),
      estimationStatus: line.status,
      estimationStatusLabel: orderRow?.estimationStatusLabel ?? line.classification.statusLabel,
      factorUsed: round6(line.factorUsed),
      bomQuantityPerUnit: round6(bomByKey.get(bomKey) ?? contribMatch?.materialQtyPerUnit ?? 0),
      recommendedQuantity: round6(line.recommendedDemand),
      conservativeQuantity: round6(line.conservativeDemand),
      reviewQuantity: round6(line.reviewDemand),
      unservedRevenueAmount: round6(unservedByKey.get(opKey) ?? 0),
      recommendedIncluded: orderRow?.recommendedIncluded ?? line.classification.includeInRecommended,
      conservativeIncluded: orderRow?.conservativeIncluded ?? line.classification.includeInConservative,
      inclusionReason: line.explanation || "—",
      warnings: orderRow?.warnings?.length ? orderRow.warnings : line.classification.warnings,
    });
  }

  return lines.sort(
    (a, b) =>
      a.materialName.localeCompare(b.materialName, "pt-BR") ||
      a.orderNumber.localeCompare(b.orderNumber, "pt-BR") ||
      (a.productName ?? "").localeCompare(b.productName ?? "", "pt-BR")
  );
}

export type MaterialIntelligenceDrilldownProductRow = {
  productCode: string | null;
  productName: string | null;
  bomQuantityPerUnit: number;
  recommendedQuantity: number;
  conservativeQuantity: number;
  reviewQuantity: number;
};

export type MaterialIntelligenceDrilldownOrderRow = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  productCode: string | null;
  productName: string | null;
  openQuantity: number;
  estimationStatusLabel: string;
  factorUsed: number;
  bomQuantityPerUnit: number;
  recommendedQuantity: number;
  conservativeQuantity: number;
  warnings: string[];
  inclusionReason: string;
};

export type MaterialIntelligenceMaterialDrilldown = {
  material: RawMaterialIntelligenceMaterialRow;
  products: MaterialIntelligenceDrilldownProductRow[];
  orders: MaterialIntelligenceDrilldownOrderRow[];
  totals: {
    recommendedQuantity: number;
    conservativeQuantity: number;
    reviewQuantity: number;
  };
};

export type MaterialIntelligenceOrderItemDrilldown = {
  productCode: string | null;
  productName: string | null;
  soldQuantity: number;
  invoicedQuantity: number;
  openQuantity: number;
  openNetAmount: number;
  estimationStatusLabel: string;
  factorUsed: number;
  estimatedWindowStart: string | null;
  estimatedWindowEnd: string | null;
  inclusionReason: string;
  recommendedIncluded: boolean;
  conservativeIncluded: boolean;
  materials: Array<{
    materialCode: string | null;
    materialName: string;
    unitLabel: string;
    bomQuantityPerUnit: number;
    recommendedQuantity: number;
    conservativeQuantity: number;
  }>;
};

export type MaterialIntelligenceOrderDrilldown = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  sellerName: string | null;
  nfes: Array<{ numero: string | null; serie: string | null; dataProcessamento: string }>;
  items: MaterialIntelligenceOrderItemDrilldown[];
};

export function buildMaterialDrilldownView(
  materialId: string,
  intelligence: RawMaterialIntelligenceBlock
): MaterialIntelligenceMaterialDrilldown | null {
  const material = intelligence.materials.find((m) => m.materialId === materialId);
  if (!material) return null;

  const detailLines = intelligence.detailLines.filter((l) => l.materialId === materialId);

  const productMap = new Map<string, MaterialIntelligenceDrilldownProductRow>();
  for (const line of detailLines) {
    const key = line.productCode ?? line.productName ?? "—";
    const existing = productMap.get(key) ?? {
      productCode: line.productCode,
      productName: line.productName,
      bomQuantityPerUnit: line.bomQuantityPerUnit,
      recommendedQuantity: 0,
      conservativeQuantity: 0,
      reviewQuantity: 0,
    };
    existing.recommendedQuantity += safeDisplayNumber(line.recommendedQuantity);
    existing.conservativeQuantity += safeDisplayNumber(line.conservativeQuantity);
    existing.reviewQuantity += safeDisplayNumber(line.reviewQuantity);
    productMap.set(key, existing);
  }

  const orderMap = new Map<string, MaterialIntelligenceDrilldownOrderRow>();
  for (const line of detailLines) {
    const key = orderProductKey(line.orderId, line.productCode);
    const existing = orderMap.get(key) ?? {
      orderId: line.orderId,
      orderNumber: line.orderNumber,
      customerName: line.customerName,
      productCode: line.productCode,
      productName: line.productName,
      openQuantity: line.openQuantity,
      estimationStatusLabel: line.estimationStatusLabel,
      factorUsed: line.factorUsed,
      bomQuantityPerUnit: line.bomQuantityPerUnit,
      recommendedQuantity: 0,
      conservativeQuantity: 0,
      warnings: line.warnings,
      inclusionReason: line.inclusionReason,
    };
    existing.recommendedQuantity += safeDisplayNumber(line.recommendedQuantity);
    existing.conservativeQuantity += safeDisplayNumber(line.conservativeQuantity);
    orderMap.set(key, existing);
  }

  return {
    material,
    products: [...productMap.values()],
    orders: [...orderMap.values()],
    totals: {
      recommendedQuantity: round6(
        detailLines.reduce((s, l) => s + safeDisplayNumber(l.recommendedQuantity), 0)
      ),
      conservativeQuantity: round6(
        detailLines.reduce((s, l) => s + safeDisplayNumber(l.conservativeQuantity), 0)
      ),
      reviewQuantity: round6(
        detailLines.reduce((s, l) => s + safeDisplayNumber(l.reviewQuantity), 0)
      ),
    },
  };
}

export function buildOrderDrilldownView(
  orderId: string,
  intelligence: RawMaterialIntelligenceBlock
): MaterialIntelligenceOrderDrilldown | null {
  const orderRows = intelligence.orders.filter((o) => o.orderId === orderId);
  if (orderRows.length === 0) return null;

  const first = orderRows[0]!;
  const detailLines = intelligence.detailLines.filter((l) => l.orderId === orderId);
  const nfes = intelligence.orderNfesByOrderId[orderId] ?? [];

  const items: MaterialIntelligenceOrderItemDrilldown[] = orderRows.map((row) => {
    const materials = detailLines
      .filter((l) => l.productCode === row.productCode)
      .map((l) => ({
        materialCode: l.materialCode,
        materialName: l.materialName,
        unitLabel: l.unitLabel,
        bomQuantityPerUnit: l.bomQuantityPerUnit,
        recommendedQuantity: l.recommendedQuantity,
        conservativeQuantity: l.conservativeQuantity,
      }));

    const lineMatch = detailLines.find((l) => l.productCode === row.productCode);

    return {
      productCode: row.productCode,
      productName: row.productName,
      soldQuantity: row.soldQuantity,
      invoicedQuantity: row.invoicedQuantity,
      openQuantity: row.openQuantity,
      openNetAmount: row.openNetAmount,
      estimationStatusLabel: row.estimationStatusLabel,
      factorUsed: row.factorUsed,
      estimatedWindowStart: row.estimatedWindowStart,
      estimatedWindowEnd: row.estimatedWindowEnd,
      inclusionReason: lineMatch?.inclusionReason ?? (row.recommendedIncluded ? "Incluído na estimativa recomendada" : "Excluído ou em revisão"),
      recommendedIncluded: row.recommendedIncluded,
      conservativeIncluded: row.conservativeIncluded,
      materials,
    };
  });

  return {
    orderId,
    orderNumber: first.orderNumber,
    customerName: first.customerName,
    sellerName: first.sellerName,
    nfes: nfes.map((n) => ({
      numero: n.numero,
      serie: n.serie,
      dataProcessamento: n.dataProcessamento,
    })),
    items,
  };
}

export function hasIntelligenceDisplayData(intelligence: RawMaterialIntelligenceBlock): boolean {
  return (
    intelligence.materials.length > 0 ||
    intelligence.orders.length > 0 ||
    intelligence.unservedBalances.length > 0 ||
    intelligence.reviewItems.length > 0
  );
}
