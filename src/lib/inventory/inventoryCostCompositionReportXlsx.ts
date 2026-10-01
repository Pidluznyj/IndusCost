/**
 * Planilha do Relatório de Estoque – Composição de Custo. Só formata o payload
 * de `buildInventoryCostCompositionReport`; não calcula nada.
 *
 * SheetJS community 0.18.5 grava largura de coluna, autofilter e number
 * formats (`cell.z`), mas NÃO grava freeze panes nem fonte/fill (`cell.s`).
 * Como em `purchasing/supplierClassificationXlsx.ts`, o freeze é injetado no
 * OOXML com `jszip`; aqui também injetamos uma fonte em negrito para o
 * cabeçalho (styles.xml + atributo `s` das células da linha 1).
 */
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type {
  InventoryCostCompositionReport,
  InventoryCostCompositionRow,
  InventoryCostCompositionSummaryRow,
} from "./inventoryCostCompositionReport.js";

export const INVENTORY_COST_COMPOSITION_SHEETS = ["Estoque Detalhado", "Resumo", "Metodologia"] as const;

/** Prefixo que neutraliza fórmula em Excel/LibreOffice (OWASP formula injection). */
const FORMULA_RE = /^[=+\-@\t\r]/;

function text(value: string | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return FORMULA_RE.test(raw) ? `'${raw}` : raw;
}

const FORMAT_UNIT_COST = '"R$" #,##0.0000';
const FORMAT_MONEY = '"R$" #,##0.00';
const FORMAT_QUANTITY = "#,##0.000";
const FORMAT_INTEGER = "0";

type Cell = string | number | null;

/**
 * Visão enxuta para a contabilidade: só o custo oficial COM HH e SEM HH
 * (unitário e total). A decomposição MP/HH/HM continua sendo lida e
 * reconciliada no payload — só não é exportada coluna a coluna. Itens sem
 * custo, com custo parcial ou inconsistente aparecem na coluna Status.
 */
export const INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS = [
  "Código",
  "Descrição",
  "Tipo",
  "Unidade",
  "Quantidade em estoque",
  "Custo unitário com HH",
  "Custo unitário sem HH",
  "Valor estoque com HH",
  "Valor estoque sem HH",
  "Status do custo",
] as const;

const DETAIL_FORMATS: Array<string | null> = [
  null,
  null,
  null,
  null,
  FORMAT_QUANTITY,
  FORMAT_UNIT_COST,
  FORMAT_UNIT_COST,
  FORMAT_MONEY,
  FORMAT_MONEY,
  null,
];

const DETAIL_WIDTHS = [16, 48, 16, 9, 20, 22, 22, 22, 22, 16];

export const INVENTORY_COST_COMPOSITION_SUMMARY_COLUMNS = [
  "Tipo",
  "Quantidade de SKUs",
  "Valor estoque com HH",
  "Valor estoque sem HH",
  "Itens sem custo",
  "Itens com custo parcial",
  "Itens inconsistentes",
] as const;

const SUMMARY_FORMATS: Array<string | null> = [
  null,
  FORMAT_INTEGER,
  FORMAT_MONEY,
  FORMAT_MONEY,
  FORMAT_INTEGER,
  FORMAT_INTEGER,
  FORMAT_INTEGER,
];

const SUMMARY_WIDTHS = [20, 18, 22, 22, 16, 22, 20];

/** Célula vazia quando não há custo: nunca zero silencioso. */
function money(value: number | null): Cell {
  return value == null ? "" : value;
}

function detailRow(row: InventoryCostCompositionRow): Cell[] {
  return [
    text(row.itemCode),
    text(row.description),
    row.itemTypeLabel,
    text(row.unit),
    Number(row.physicalQuantity),
    money(row.officialUnitCost),
    money(row.unitCostWithoutHh),
    money(row.officialStockValue),
    money(row.stockValueWithoutHh),
    row.status,
  ];
}

function summaryRow(row: InventoryCostCompositionSummaryRow): Cell[] {
  return [
    row.label,
    row.skuCount,
    row.officialStockValue,
    row.stockValueWithoutHh,
    row.itemsWithoutCost,
    row.itemsPartialCost,
    row.itemsInconsistent,
  ];
}

function applyFormats(ws: XLSX.WorkSheet, formats: ReadonlyArray<string | null>, firstRow: number, lastRow: number): void {
  for (let r = firstRow; r <= lastRow; r += 1) {
    formats.forEach((z, c) => {
      if (!z) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = z;
    });
  }
}

function tableSheet(
  header: readonly string[],
  body: Cell[][],
  formats: ReadonlyArray<string | null>,
  widths: readonly number[],
  textColumns: readonly number[]
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[...header], ...body]);
  // Códigos/SKU sempre como texto, mesmo quando parecem número.
  for (let r = 1; r <= body.length; r += 1) {
    for (const c of textColumns) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell) {
        cell.t = "s";
        cell.v = String(cell.v ?? "");
      }
    }
  }
  applyFormats(ws, formats, 1, body.length);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 22 }];
  const lastCol = XLSX.utils.encode_col(header.length - 1);
  ws["!autofilter"] = { ref: `A1:${lastCol}${Math.max(body.length + 1, 1)}` };
  return ws;
}

export function buildInventoryCostCompositionWorkbook(report: InventoryCostCompositionReport): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: report.title,
    Subject: report.purpose,
    Author: "IndusCost",
    CreatedDate: new Date(report.generatedAt),
  };

  const detail = tableSheet(
    INVENTORY_COST_COMPOSITION_DETAIL_COLUMNS,
    report.rows.map(detailRow),
    DETAIL_FORMATS,
    DETAIL_WIDTHS,
    [0]
  );
  XLSX.utils.book_append_sheet(wb, detail, INVENTORY_COST_COMPOSITION_SHEETS[0]);

  const summary = tableSheet(
    INVENTORY_COST_COMPOSITION_SUMMARY_COLUMNS,
    report.summary.map(summaryRow),
    SUMMARY_FORMATS,
    SUMMARY_WIDTHS,
    []
  );
  XLSX.utils.book_append_sheet(wb, summary, INVENTORY_COST_COMPOSITION_SHEETS[1]);

  const methodology: Cell[][] = [
    ["Parâmetro", "Valor"],
    ["Relatório", report.title],
    ["O que é este relatório", report.purpose],
    ...report.sources.map((source) => [source.label, source.value]),
    ["Saldos negativos fora do relatório", report.negativeItems],
    ["Outros tipos com saldo positivo, fora do relatório", report.excludedOtherPositiveItems],
    ...(report.factoryCostUnavailableReason ? [["Custo fabril", report.factoryCostUnavailableReason] as Cell[]] : []),
    ...(report.materialCostUnavailableReason
      ? [["Custo de matéria-prima", report.materialCostUnavailableReason] as Cell[]]
      : []),
    [],
    ["Metodologia", ""],
    ...report.methodology.map((line, index) => [`${index + 1}`, line]),
  ];
  const methodologySheet = XLSX.utils.aoa_to_sheet(methodology);
  methodologySheet["!cols"] = [{ wch: 52 }, { wch: 120 }];
  methodologySheet["!rows"] = [{ hpt: 22 }];
  XLSX.utils.book_append_sheet(wb, methodologySheet, INVENTORY_COST_COMPOSITION_SHEETS[2]);

  return wb;
}

/* ------------------------------------------------------------------ *
 * Pós-processamento OOXML: freeze da linha 1 e cabeçalho em negrito
 * ------------------------------------------------------------------ */

const BOLD_FONT_XML = '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>';

/**
 * Acrescenta uma fonte em negrito e, para cada cellXf existente, um clone com
 * essa fonte. Devolve o mapa xfId original → xfId em negrito, para que a linha
 * de cabeçalho preserve número/alinhamento e só ganhe o negrito.
 */
export function injectBoldHeaderStyles(stylesXml: string): { xml: string; boldXfByXf: Map<number, number> } {
  const fontsMatch = /<fonts count="(\d+)"[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml);
  const xfsMatch = /<cellXfs count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!fontsMatch || !xfsMatch) return { xml: stylesXml, boldXfByXf: new Map() };

  const fontCount = Number(fontsMatch[1]);
  const boldFontId = fontCount;
  let xml = stylesXml.replace(
    fontsMatch[0],
    `<fonts count="${fontCount + 1}">${fontsMatch[2]}${BOLD_FONT_XML}</fonts>`
  );

  const xfTags = xfsMatch[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  const boldXfByXf = new Map<number, number>();
  const clones = xfTags.map((tag, index) => {
    boldXfByXf.set(index, xfTags.length + index);
    const withFont = /fontId="\d+"/.test(tag)
      ? tag.replace(/fontId="\d+"/, `fontId="${boldFontId}"`)
      : tag.replace(/<xf\b/, `<xf fontId="${boldFontId}"`);
    return /applyFont="\d"/.test(withFont)
      ? withFont.replace(/applyFont="\d"/, 'applyFont="1"')
      : withFont.replace(/<xf\b/, '<xf applyFont="1"');
  });
  xml = xml.replace(
    xfsMatch[0],
    `<cellXfs count="${xfTags.length * 2}">${xfsMatch[2]}${clones.join("")}</cellXfs>`
  );
  return { xml, boldXfByXf };
}

export function injectHeaderPresentation(
  sheetXml: string,
  boldXfByXf: ReadonlyMap<number, number>,
  freeze: boolean
): string {
  let next = sheetXml;
  if (freeze) {
    next = next.replace(
      /<sheetViews><sheetView workbookViewId="0"\s*\/>\s*<\/sheetViews>/,
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    );
  }
  const rowMatch = /<row r="1"[^>]*>[\s\S]*?<\/row>/.exec(next);
  if (rowMatch) {
    const boldRow = rowMatch[0].replace(/<c r="([A-Z]+1)"([^>]*?)(\/?)>/g, (_match, ref: string, attrs: string, selfClose: string) => {
      const current = /\bs="(\d+)"/.exec(attrs);
      const currentXf = current ? Number(current[1]) : 0;
      const boldXf = boldXfByXf.get(currentXf);
      if (boldXf == null) return `<c r="${ref}"${attrs}${selfClose}>`;
      const cleaned = attrs.replace(/\s*\bs="\d+"/, "");
      return `<c r="${ref}"${cleaned} s="${boldXf}"${selfClose}>`;
    });
    next = next.replace(rowMatch[0], boldRow);
  }
  return next;
}

function parseWorkbookSheetTargets(workbookXml: string, relsXml: string): Array<{ name: string; path: string }> {
  const idByName = new Map<string, string>();
  const sheetRe = /<sheet\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = sheetRe.exec(workbookXml))) {
    const name = /name="([^"]+)"/.exec(match[0])?.[1];
    const rid = /r:id="([^"]+)"/.exec(match[0])?.[1];
    if (name && rid) idByName.set(name, rid);
  }
  const targetById = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*>/g;
  while ((match = relRe.exec(relsXml))) {
    const id = /Id="([^"]+)"/.exec(match[0])?.[1];
    const target = /Target="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) targetById.set(id, target);
  }
  const sheets: Array<{ name: string; path: string }> = [];
  for (const [name, rid] of idByName) {
    const target = targetById.get(rid);
    if (!target) continue;
    sheets.push({ name, path: `xl/${target.replace(/^\//, "").replace(/^xl\//, "")}` });
  }
  return sheets;
}

async function applyPresentation(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  const stylesFile = zip.file("xl/styles.xml");
  if (!workbookFile || !relsFile || !stylesFile) return buffer;

  const styles = injectBoldHeaderStyles(await stylesFile.async("string"));
  zip.file("xl/styles.xml", styles.xml);

  const sheets = parseWorkbookSheetTargets(await workbookFile.async("string"), await relsFile.async("string"));
  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    if (!file) continue;
    const freeze = sheet.name !== INVENTORY_COST_COMPOSITION_SHEETS[2];
    zip.file(sheet.path, injectHeaderPresentation(await file.async("string"), styles.boldXfByXf, freeze));
  }
  const generated = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return Buffer.from(generated);
}

export async function buildInventoryCostCompositionXlsx(report: InventoryCostCompositionReport): Promise<Buffer> {
  const raw = XLSX.write(buildInventoryCostCompositionWorkbook(report), {
    type: "buffer",
    bookType: "xlsx",
    bookSST: true,
    cellStyles: false,
  }) as Buffer;
  return applyPresentation(raw);
}

export function inventoryCostCompositionFilename(generatedAtIso: string): string {
  return `estoque-composicao-custo-${generatedAtIso.slice(0, 10)}.xlsx`;
}
