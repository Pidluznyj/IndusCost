/**
 * Planilha da posição de estoque. Os números saem do mesmo payload do PDF.
 */
import * as XLSX from "xlsx";
import type { InventoryPositionReport, InventoryPositionReportSection } from "./inventoryPositionReport.js";

function moneyCell(value: number | null): number | string {
  return value == null ? "" : value;
}

function sectionRows(section: InventoryPositionReportSection): (string | number)[][] {
  const header = [
    "Código",
    "Descrição",
    "Unidade",
    "Quantidade física",
    "Custo unitário",
    "Valor contábil",
    "Preço unitário Varejo 1",
    "Valor potencial de venda",
  ];
  const body = section.rows.map((row) => [
    row.itemCode,
    row.description,
    row.unit,
    Number(row.physicalQuantity),
    moneyCell(row.unitCost),
    moneyCell(row.totalCost),
    section.itemType === "RAW_MATERIAL" ? "" : moneyCell(row.unitSalePrice),
    section.itemType === "RAW_MATERIAL" ? "" : moneyCell(row.totalSaleValue),
  ]);
  const total: (string | number)[] = [
    "Total",
    "",
    "",
    "",
    "",
    moneyCell(section.costTotal),
    "",
    section.itemType === "RAW_MATERIAL" ? "" : moneyCell(section.saleTotal),
  ];
  return [header, ...body, total];
}

export function buildInventoryPositionReportWorkbook(report: InventoryPositionReport): XLSX.WorkBook {
  const cover: (string | number)[][] = [
    [report.title],
    [],
    ["O que é este relatório", report.purpose],
    ["Emitido em", report.generatedAt],
    [],
    ["Filtro", "Valor"],
    ...report.filters.map((filter) => [filter.label, filter.value]),
    [],
    ["Como o valor foi formado"],
    ...report.methodology.map((line) => [line]),
    [],
    ["Seção", "Itens", "Valor contábil", "Valor potencial de venda", "Itens sem custo", "Itens sem preço de venda"],
    ...report.sections.map((section) => [
      section.title,
      section.itemCount,
      moneyCell(section.costTotal),
      section.itemType === "RAW_MATERIAL" ? "" : moneyCell(section.saleTotal),
      section.costUncoveredItems,
      section.itemType === "RAW_MATERIAL" ? "" : section.saleUncoveredItems,
    ]),
    [],
    ["Saldos negativos fora dos totais", report.negativeLines.length],
    ["Outros tipos com saldo positivo, fora deste relatório", report.excludedOtherPositiveItems],
  ];
  if (report.factoryCostUnavailableReason) cover.push(["Custo fabril", report.factoryCostUnavailableReason]);
  if (report.materialCostUnavailableReason) cover.push(["Custo de matéria-prima", report.materialCostUnavailableReason]);
  if (report.retailUnavailableReason) cover.push(["Valor de venda", report.retailUnavailableReason]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(cover), "Capa");
  for (const section of report.sections) {
    const name = section.title.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(section)), name);
  }
  if (report.negativeLines.length > 0) {
    const negatives: (string | number)[][] = [
      ["Código", "Descrição", "Tipo", "Unidade", "Quantidade física"],
      ...report.negativeLines.map((line) => [
        line.itemCode,
        line.description,
        line.itemTypeLabel,
        line.unit,
        Number(line.physicalQuantity),
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(negatives), "Saldos negativos");
  }
  return workbook;
}

export function buildInventoryPositionReportXlsx(report: InventoryPositionReport): Buffer {
  return XLSX.write(buildInventoryPositionReportWorkbook(report), {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

export function inventoryPositionReportFilename(generatedAtIso: string): string {
  const day = generatedAtIso.slice(0, 10);
  return `posicao-estoque-${day}.xlsx`;
}
