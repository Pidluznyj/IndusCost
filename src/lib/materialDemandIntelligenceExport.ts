import { fleetRowsToCsv } from "./fleetCsv.js";
import { safeDisplayNumber } from "./materialDemandIntelligenceUi.js";
import type { RawMaterialIntelligenceBlock } from "./salesOrderRawMaterialIntelligenceTypes.js";

export const INTELLIGENCE_CSV_CORE_HEADERS = [
  "Matéria-prima",
  "Código MP",
  "Produto",
  "Pedido",
  "Cliente",
  "Quantidade vendida",
  "Quantidade faturada",
  "Saldo",
  "Status da estimativa",
  "Necessidade recomendada",
  "Necessidade conservadora",
  "Potencial não realizado",
  "Motivo de revisão",
  "Fator aplicado",
] as const;

function pctFactor(v: number): string {
  const n = safeDisplayNumber(v);
  if (n >= 1) return "100%";
  return `${Math.round(n * 10000) / 100}%`;
}

function materialLabel(name: string, code: string | null): string {
  return code ? `${name} (${code})` : name;
}

function productLabel(name: string | null, code: string | null): string {
  if (name && code) return `${name} [${code}]`;
  return name ?? code ?? "";
}

function reviewReasonForLine(
  intelligence: RawMaterialIntelligenceBlock,
  orderId: string,
  productCode: string | null
): string {
  const item = intelligence.reviewItems.find(
    (r) => r.orderId === orderId && r.productCode === productCode
  );
  return item?.reason ?? "";
}

function detailLineToCsvRow(
  intelligence: RawMaterialIntelligenceBlock,
  line: RawMaterialIntelligenceBlock["detailLines"][number]
): (string | number)[] {
  return [
    line.materialName,
    line.materialCode ?? "",
    productLabel(line.productName, line.productCode),
    line.orderNumber,
    line.customerName ?? "",
    safeDisplayNumber(line.soldQuantity),
    safeDisplayNumber(line.invoicedQuantity),
    safeDisplayNumber(line.openQuantity),
    line.estimationStatusLabel,
    safeDisplayNumber(line.recommendedQuantity),
    safeDisplayNumber(line.conservativeQuantity),
    safeDisplayNumber(line.unservedRevenueAmount),
    reviewReasonForLine(intelligence, line.orderId, line.productCode),
    pctFactor(line.factorUsed),
  ];
}

export function buildIntelligenceMaterialsCsv(intelligence: RawMaterialIntelligenceBlock): string {
  if (intelligence.detailLines.length > 0) {
    const rows = intelligence.detailLines.map((line) => detailLineToCsvRow(intelligence, line));
    return fleetRowsToCsv([...INTELLIGENCE_CSV_CORE_HEADERS], rows);
  }

  const rows = intelligence.materials.map((m) => [
    m.materialName,
    m.materialCode ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    m.statusSummary,
    safeDisplayNumber(m.recommendedQuantity),
    safeDisplayNumber(m.conservativeQuantity),
    "",
    "",
    "",
  ]);

  return fleetRowsToCsv([...INTELLIGENCE_CSV_CORE_HEADERS], rows);
}

export function buildIntelligenceOrdersCsv(intelligence: RawMaterialIntelligenceBlock): string {
  const rows: (string | number)[][] = [];

  for (const order of intelligence.orders) {
    const materials = intelligence.detailLines.filter(
      (l) => l.orderId === order.orderId && l.productCode === order.productCode
    );

    if (materials.length === 0) {
      rows.push([
        "",
        "",
        productLabel(order.productName, order.productCode),
        order.orderNumber,
        order.customerName ?? "",
        safeDisplayNumber(order.soldQuantity),
        safeDisplayNumber(order.invoicedQuantity),
        safeDisplayNumber(order.openQuantity),
        order.estimationStatusLabel,
        "",
        "",
        "",
        reviewReasonForLine(intelligence, order.orderId, order.productCode),
        pctFactor(order.factorUsed),
      ]);
      continue;
    }

    for (const line of materials) {
      rows.push(detailLineToCsvRow(intelligence, line));
    }
  }

  return fleetRowsToCsv([...INTELLIGENCE_CSV_CORE_HEADERS], rows);
}

export function buildIntelligenceUnservedCsv(intelligence: RawMaterialIntelligenceBlock): string {
  const headers = [
    "Pedido",
    "Cliente",
    "Vendedor",
    "Produto",
    "Saldo não faturado",
    "Valor não faturado",
    "Última NF",
    "Dias fora da janela",
    "Faixa de atraso",
    "Status",
    "Potencial não realizado",
  ];

  const rows = intelligence.unservedBalances.map((row) => [
    row.orderNumber,
    row.customerName ?? "",
    row.sellerName ?? "",
    productLabel(row.productName, row.productCode),
    safeDisplayNumber(row.openQuantity),
    safeDisplayNumber(row.openNetAmount),
    row.lastInvoiceDate ?? "",
    row.daysAfterLiveWindow,
    row.agingBucket,
    row.statusLabel,
    safeDisplayNumber(row.openNetAmount),
  ]);

  return fleetRowsToCsv(headers, rows);
}

export function buildIntelligenceReviewCsv(intelligence: RawMaterialIntelligenceBlock): string {
  const headers = [
    "Motivo de revisão",
    "Pedido",
    "Cliente",
    "Produto",
    "Impacto",
    "Ação sugerida",
    "Matéria-prima",
    "Necessidade recomendada",
    "Necessidade conservadora",
    "Fator aplicado",
  ];

  const rows = intelligence.reviewItems.map((item) => {
    const order = intelligence.orders.find((o) => o.orderId === item.orderId);
    const detail = intelligence.detailLines.find(
      (l) => l.orderId === item.orderId && l.productCode === item.productCode
    );
    return [
      item.reason,
      item.orderNumber,
      order?.customerName ?? "",
      productLabel(item.productName, item.productCode),
      item.impact,
      item.suggestedAction,
      detail ? materialLabel(detail.materialName, detail.materialCode) : "",
      detail ? safeDisplayNumber(detail.recommendedQuantity) : "",
      detail ? safeDisplayNumber(detail.conservativeQuantity) : "",
      detail ? pctFactor(detail.factorUsed) : "",
    ];
  });

  return fleetRowsToCsv(headers, rows);
}

export function downloadIntelligenceCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function intelligenceExportFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}-${stamp}.csv`;
}
