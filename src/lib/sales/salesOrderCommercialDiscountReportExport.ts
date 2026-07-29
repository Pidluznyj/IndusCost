/**
 * Exportação CSV/XLSX — Relatório de descontos comerciais.
 * Espelha os mesmos valores da tela (sem custo unitário).
 */
import * as XLSX from "xlsx";
import type { CommercialDiscountReportPayload } from "./salesOrderCommercialDiscountReport.js";

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function rateToPercentDisplay(rate: number | null | undefined): number | "" {
  if (rate == null || !Number.isFinite(rate)) return "";
  return Number((rate * 100).toFixed(4));
}

function detailHeaders(includeMargin: boolean): string[] {
  const base = [
    "Pedido",
    "Emissão",
    "Cliente",
    "Vendedor",
    "Item",
    "SKU",
    "Produto",
    "Família",
    "Quantidade ativa",
    "Preço bruto",
    "Valor bruto",
    "Valor concedido em descontos (R$)",
    "Desconto %",
    "Preço líquido",
    "Valor líquido",
    "Status do desconto",
    "Divergência desconto",
    "Faturado",
  ];
  if (!includeMargin) return base;
  return [
    ...base,
    "Margem comercial (R$)",
    "Margem comercial (%)",
    "Status da margem",
  ];
}

function mapDetailRow(
  row: CommercialDiscountReportPayload["rows"][number],
  includeMargin: boolean
): Array<string | number> {
  const base: Array<string | number> = [
    row.orderCode,
    formatDateBr(row.issueDate),
    row.customerName,
    row.sellerName,
    row.itemSequence ?? "",
    row.sku,
    row.productName,
    row.familyName,
    row.activeQuantity,
    row.grossUnitPrice,
    row.grossActiveValue,
    row.discountValue,
    rateToPercentDisplay(row.discountRate),
    row.netUnitPrice ?? "",
    row.netActiveValue ?? "",
    row.discountStatusLabel,
    row.divergenceLabel ?? "",
    row.hasInvoice ? "Sim" : "Não",
  ];
  if (!includeMargin) return base;
  return [
    ...base,
    row.commercialMarginValue ?? "",
    row.commercialMarginPercent ?? "",
    row.marginStatusLabel,
  ];
}

export function buildSalesOrderCommercialDiscountCsv(
  payload: CommercialDiscountReportPayload
): string {
  const includeMargin = payload.meta.includeMargin;
  const headers = detailHeaders(includeMargin);
  const lines = [
    headers.join(";"),
    ...payload.rows.map((row) =>
      mapDetailRow(row, includeMargin)
        .map((cell) => {
          const text = String(cell ?? "");
          if (text.includes(";") || text.includes('"') || text.includes("\n")) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(";")
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function buildSalesOrderCommercialDiscountXlsxBuffer(
  payload: CommercialDiscountReportPayload
): Buffer {
  const wb = XLSX.utils.book_new();
  const includeMargin = payload.meta.includeMargin;

  const kpiRows: Array<Array<string | number>> = [
    [payload.title],
    [payload.subtitle],
    [`Gerado em: ${formatDateTimeBr(payload.generatedAt)}`],
    [`Usuário: ${payload.emitterName ?? "—"}`],
    [],
    ["Filtros aplicados"],
    ...payload.filterLabels.map((f) => [f.label, f.value]),
    [],
    ["Indicadores"],
    ["Valor bruto dos Pedidos", payload.kpis.grossActiveTotalValue],
    ["Valor concedido em descontos (R$)", payload.kpis.discountTotalValue],
    [
      "Desconto ponderado (%)",
      rateToPercentDisplay(payload.kpis.discountTotalRate),
    ],
    ["Valor líquido vendido", payload.kpis.netActiveTotalValue],
    ["Acréscimos comerciais (R$)", payload.kpis.commercialAdditionTotalValue],
    ["Pedidos com desconto", payload.kpis.ordersWithDiscount],
    ["Itens com desconto", payload.kpis.itemsWithDiscount],
  ];
  if (includeMargin) {
    kpiRows.push(
      ["Margem comercial (R$)", payload.kpis.commercialMarginTotalValue ?? ""],
      ["Margem comercial (%)", payload.kpis.commercialMarginTotalPercent ?? ""],
      [
        "Cobertura da margem (%)",
        payload.kpis.commercialMarginCoveragePercent ?? "",
      ]
    );
  }

  const kpiSheet = XLSX.utils.aoa_to_sheet(kpiRows);
  XLSX.utils.book_append_sheet(wb, kpiSheet, "Indicadores");

  const detailAoa: Array<Array<string | number>> = [
    detailHeaders(includeMargin),
    ...payload.rows.map((row) => mapDetailRow(row, includeMargin)),
  ];
  const detailSheet = XLSX.utils.aoa_to_sheet(detailAoa);
  XLSX.utils.book_append_sheet(wb, detailSheet, "Itens");

  const sellerAoa: Array<Array<string | number>> = [
    [
      "Vendedor",
      "Pedidos",
      "Itens",
      "Valor bruto",
      "Valor concedido em descontos",
      "Desconto %",
      "Valor líquido",
      ...(includeMargin ? ["Margem comercial R$", "Margem comercial %"] : []),
    ],
    ...payload.views.bySeller.map((r) => [
      r.label,
      r.orderCount,
      r.itemCount,
      r.grossActiveValue,
      r.discountValue,
      rateToPercentDisplay(r.discountRate),
      r.netActiveValue,
      ...(includeMargin
        ? [r.commercialMarginValue ?? "", r.commercialMarginPercent ?? ""]
        : []),
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sellerAoa),
    "Por vendedor"
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return Buffer.from(buf);
}

export function salesOrderCommercialDiscountExportFilename(
  format: "csv" | "xlsx"
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `relatorio-descontos-comerciais-${stamp}.${format}`;
}
