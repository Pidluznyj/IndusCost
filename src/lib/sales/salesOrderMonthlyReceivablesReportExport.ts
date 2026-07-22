/**
 * Exportação XLSX — Recebíveis mensais por Pedido de Venda (OP-08).
 */
import * as XLSX from "xlsx";
import type { SalesOrderMonthlyReceivablesReportPayload } from "./salesOrderMonthlyReceivablesReport.js";

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

export function buildSalesOrderMonthlyReceivablesXlsxBuffer(
  payload: SalesOrderMonthlyReceivablesReportPayload
): Buffer {
  const wb = XLSX.utils.book_new();
  const months = payload.period.months;

  const metaRows: Array<Array<string | number>> = [
    [payload.title],
    [payload.subtitle],
    [`Gerado em: ${formatDateTimeBr(payload.generatedAt)}`],
    [`Usuário: ${payload.emitterName ?? "—"}`],
    [
      `Período vencimento: ${payload.period.startMonth} — ${payload.period.endMonth}`,
    ],
    [`Pedidos no escopo: ${payload.totals.orderCount}`],
    [],
    ["Filtros aplicados"],
    ...payload.filterLabels.map((f) => [f.label, f.value]),
    [],
    ["Totalizadores (população filtrada)"],
    ["Valor comercial", payload.totals.orderCommercialTotal],
    ["Agenda efetiva", payload.totals.effectiveScheduleTotal],
    ["Dentro do período", payload.totals.periodScheduleTotal],
    ["Fora do período", payload.totals.outsidePeriodTotal],
    ["Diferença", payload.totals.difference],
    [],
  ];

  const header = [
    "Pedido",
    "Cliente",
    "Emissão",
    "Vendedor",
    "Status",
    "Valor comercial",
    "Agenda efetiva",
    "Dentro do período",
    "Fora do período",
    "Diferença",
    "Qualidade",
    ...months.flatMap((m) => [`${m.label} valor`, `${m.label} títulos`]),
  ];

  const totalsRow = [
    "TOTAL",
    "",
    "",
    "",
    "",
    payload.totals.orderCommercialTotal,
    payload.totals.effectiveScheduleTotal,
    payload.totals.periodScheduleTotal,
    payload.totals.outsidePeriodTotal,
    payload.totals.difference,
    "",
    ...months.flatMap((m) => {
      const cell = payload.totals.monthly[m.key];
      return [cell?.amount ?? 0, cell?.titleCount ?? 0];
    }),
  ];

  const dataRows = payload.rows.map((row) => [
    row.orderCode,
    row.customerName,
    formatDateBr(row.issueDate),
    row.sellerName,
    row.statusLabel,
    row.orderCommercialTotal,
    row.effectiveScheduleTotal,
    row.periodScheduleTotal,
    row.outsidePeriodTotal,
    row.difference,
    row.qualityStatusLabel,
    ...months.flatMap((m) => {
      const cell = row.months[m.key];
      return [cell?.amount ?? 0, cell?.titleCount ?? 0];
    }),
  ]);

  const sheetData = [...metaRows, header, totalsRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!freeze"] = { xSplit: 2, ySplit: metaRows.length + 1 };
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: metaRows.length, c: 0 },
      e: {
        r: metaRows.length + dataRows.length,
        c: header.length - 1,
      },
    }),
  };
  ws["!cols"] = header.map((_, i) => ({
    wch: i < 2 ? 18 : i < 11 ? 14 : 12,
  }));

  XLSX.utils.book_append_sheet(wb, ws, "Recebíveis mensais");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}
