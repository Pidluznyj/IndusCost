/**
 * Planilha do relatório de saldos de estoque. Só formata o payload de
 * `buildInventoryBalanceReport`; não calcula nada.
 *
 * SheetJS community não grava fonte, preenchimento nem borda. Para a planilha
 * sair formatada (faixa de título, cabeçalho colorido, linhas zebradas, datas e
 * quantidades com formato numérico, congelamento, filtro e impressão ajustada à
 * largura), o OOXML é escrito direto com `jszip`. As cores são as do PDF.
 */
import JSZip from "jszip";
import type { InventoryBalanceReport, InventoryBalanceReportRow } from "./inventoryBalanceReport.js";

export const INVENTORY_BALANCE_REPORT_SHEETS = ["Saldos", "Sobre o relatório"] as const;

export const INVENTORY_BALANCE_REPORT_COLUMNS = [
  "Código",
  "Descrição",
  "Tipo",
  "Unidade",
  "Saldo",
  "Última contagem",
  "Última movimentação",
] as const;

/** Larguras com folga para a seta do filtro não cobrir o título da coluna. */
const COLUMN_WIDTHS = [18, 54, 26, 13, 16, 22, 25];
/** Linha do cabeçalho da tabela (1-based); acima ficam título, emissão e filtros. */
const HEADER_ROW = 5;
const REPORT_TIME_ZONE = "America/Sao_Paulo";

/** Índices de `cellXfs` em {@link STYLES_XML}. */
const S = {
  title: 1,
  subtitle: 2,
  headLeft: 3,
  headRight: 4,
  headCenter: 5,
  text: 6,
  textAlt: 7,
  center: 8,
  centerAlt: 9,
  quantity: 10,
  quantityAlt: 11,
  date: 12,
  dateAlt: 13,
  total: 14,
  label: 15,
  wrap: 16,
} as const;

const BORDER =
  '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>';

const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;

const xf = (attrs: string, alignment = "") =>
  alignment ? `<xf xfId="0" ${attrs}><alignment ${alignment}/></xf>` : `<xf xfId="0" ${attrs}/>`;

const STYLES_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<numFmts count="2">',
  '<numFmt numFmtId="164" formatCode="#,##0.00##;[Red]\\-#,##0.00##"/>',
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/>',
  "</numFmts>",
  '<fonts count="5">',
  '<font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
  '<font><sz val="9"/><color rgb="FF475569"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="10"/><color rgb="FF0F2744"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>',
  "</fonts>",
  '<fills count="6">',
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  solid("0F2744"),
  solid("D6E0EA"),
  solid("F8FAFC"),
  solid("EEF3F8"),
  "</fills>",
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${BORDER}</borders>`,
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="17">',
  xf('numFmtId="0" fontId="0" fillId="0" borderId="0"'),
  xf('numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"', 'horizontal="left" vertical="center" indent="1"'),
  xf('numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1"', 'horizontal="left" vertical="center" indent="1"'),
  xf('numFmtId="0" fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="left" vertical="center" wrapText="1"'),
  xf('numFmtId="0" fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="right" vertical="center" wrapText="1"'),
  xf('numFmtId="0" fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="center" vertical="center" wrapText="1"'),
  xf('numFmtId="49" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"', 'vertical="center"'),
  xf('numFmtId="49" fontId="0" fillId="4" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'vertical="center"'),
  xf('numFmtId="49" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"', 'horizontal="center" vertical="center"'),
  xf('numFmtId="49" fontId="0" fillId="4" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="center" vertical="center"'),
  xf('numFmtId="164" fontId="4" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"', 'horizontal="right" vertical="center"'),
  xf('numFmtId="164" fontId="4" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="right" vertical="center"'),
  xf('numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"', 'horizontal="center" vertical="center"'),
  xf('numFmtId="165" fontId="0" fillId="4" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="center" vertical="center"'),
  xf('numFmtId="0" fontId="4" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"', 'horizontal="left" vertical="center"'),
  xf('numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1" applyAlignment="1"', 'vertical="top"'),
  xf('numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"', 'vertical="top" wrapText="1"'),
  "</cellXfs>",
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  "</styleSheet>",
].join("");

function escapeXml(value: string): string {
  return value
    // Caracteres de controle não são válidos em XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function textCell(ref: string, value: string, style: number): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function emptyCell(ref: string, style: number): string {
  return `<c r="${ref}" s="${style}"/>`;
}

const wallClockFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Número de série do Excel no horário de Brasília (o Excel não guarda fuso). */
export function excelSerialFromIso(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    wallClockFormat.formatToParts(date).map((part) => [part.type, Number(part.value)])
  );
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wallClock / 86_400_000 + 25_569) * 1e6) / 1e6;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { timeZone: REPORT_TIME_ZONE, dateStyle: "short", timeStyle: "short" });
}

function dateCell(ref: string, iso: string | null, alt: boolean): string {
  const serial = iso ? excelSerialFromIso(iso) : null;
  if (serial == null) return textCell(ref, "—", alt ? S.centerAlt : S.center);
  return numberCell(ref, serial, alt ? S.dateAlt : S.date);
}

function dataRow(row: InventoryBalanceReportRow, rowNumber: number, alt: boolean): string {
  const text = alt ? S.textAlt : S.text;
  const cells = [
    textCell(`A${rowNumber}`, row.itemCode, text),
    textCell(`B${rowNumber}`, row.description, text),
    textCell(`C${rowNumber}`, row.itemTypeLabel, text),
    textCell(`D${rowNumber}`, row.unit, alt ? S.centerAlt : S.center),
    numberCell(`E${rowNumber}`, row.physicalQuantity, alt ? S.quantityAlt : S.quantity),
    dateCell(`F${rowNumber}`, row.lastCountAt, alt),
    dateCell(`G${rowNumber}`, row.lastMovementAt, alt),
  ];
  return `<row r="${rowNumber}" ht="16" customHeight="1">${cells.join("")}</row>`;
}

function filterSummary(report: InventoryBalanceReport): string {
  return report.filters.map((filter) => `${filter.label}: ${filter.value}`).join("  ·  ");
}

function balancesSheetXml(report: InventoryBalanceReport): string {
  const lastColumn = columnLetter(INVENTORY_BALANCE_REPORT_COLUMNS.length - 1);
  const firstDataRow = HEADER_ROW + 1;
  const lastDataRow = HEADER_ROW + report.rows.length;
  const totalRow = lastDataRow + 1;
  const banner = (rowNumber: number, value: string, style: number, height: number) =>
    `<row r="${rowNumber}" ht="${height}" customHeight="1">${textCell(`A${rowNumber}`, value, style)}${INVENTORY_BALANCE_REPORT_COLUMNS.slice(1)
      .map((_, index) => emptyCell(`${columnLetter(index + 1)}${rowNumber}`, style))
      .join("")}</row>`;

  const headerStyles = [S.headLeft, S.headLeft, S.headLeft, S.headCenter, S.headCenter, S.headCenter, S.headCenter];
  const header = `<row r="${HEADER_ROW}" ht="22" customHeight="1">${INVENTORY_BALANCE_REPORT_COLUMNS.map(
    (label, index) => textCell(`${columnLetter(index)}${HEADER_ROW}`, label, headerStyles[index])
  ).join("")}</row>`;

  const totals = [
    `${report.itemCount} itens`,
    report.zeroItems > 0 ? `${report.zeroItems} zerados` : null,
    report.negativeItems > 0 ? `${report.negativeItems} negativos` : null,
  ].filter((part): part is string => part != null);

  const rows = [
    banner(1, report.title, S.title, 28),
    banner(2, `Emitido em ${formatDateTime(report.generatedAt)}  ·  Ordenado do maior saldo para o menor`, S.subtitle, 16),
    banner(3, filterSummary(report), S.subtitle, 16),
    header,
    ...report.rows.map((row, index) => dataRow(row, firstDataRow + index, index % 2 === 1)),
    banner(totalRow, `Total  ·  ${totals.join("  ·  ")}`, S.total, 18),
  ];

  const merges = [1, 2, 3, totalRow].map((rowNumber) => `<mergeCell ref="A${rowNumber}:${lastColumn}${rowNumber}"/>`);

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
    `<dimension ref="A1:${lastColumn}${totalRow}"/>`,
    `<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${firstDataRow}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${firstDataRow}" sqref="A${firstDataRow}"/></sheetView></sheetViews>`,
    '<sheetFormatPr defaultRowHeight="15"/>',
    `<cols>${COLUMN_WIDTHS.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`,
    `<sheetData>${rows.join("")}</sheetData>`,
    `<autoFilter ref="A${HEADER_ROW}:${lastColumn}${Math.max(lastDataRow, HEADER_ROW)}"/>`,
    `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`,
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>',
    '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>',
    `<headerFooter><oddFooter>&amp;L${escapeXml(report.title)}&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter>`,
    "</worksheet>",
  ].join("");
}

function aboutSheetXml(report: InventoryBalanceReport): string {
  const lines: Array<[string, string]> = [
    ["Relatório", report.title],
    ["O que é este relatório", report.purpose],
    ["Emitido em", formatDateTime(report.generatedAt)],
    ["Itens", String(report.itemCount)],
    ...report.filters.map((filter): [string, string] => [`Filtro · ${filter.label}`, filter.value]),
    ...report.notes.map((note, index): [string, string] => [index === 0 ? "Como ler" : "", note]),
  ];
  const rows = lines.map(
    ([label, value], index) =>
      `<row r="${index + 1}">${textCell(`A${index + 1}`, label, S.label)}${textCell(`B${index + 1}`, value, S.wrap)}</row>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:B${Math.max(lines.length, 1)}"/>`,
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/>',
    '<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/></cols>',
    `<sheetData>${rows.join("")}</sheetData>`,
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>',
    "</worksheet>",
  ].join("");
}

function workbookXml(report: InventoryBalanceReport): string {
  const sheet = `'${INVENTORY_BALANCE_REPORT_SHEETS[0]}'`;
  const lastColumn = columnLetter(INVENTORY_BALANCE_REPORT_COLUMNS.length - 1);
  const lastDataRow = Math.max(HEADER_ROW + report.rows.length, HEADER_ROW);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<bookViews><workbookView activeTab="0"/></bookViews>',
    "<sheets>",
    `<sheet name="${escapeXml(INVENTORY_BALANCE_REPORT_SHEETS[0])}" sheetId="1" r:id="rId1"/>`,
    `<sheet name="${escapeXml(INVENTORY_BALANCE_REPORT_SHEETS[1])}" sheetId="2" r:id="rId2"/>`,
    "</sheets>",
    "<definedNames>",
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${sheet}!$A$${HEADER_ROW}:$${lastColumn}$${lastDataRow}</definedName>`,
    // Cabeçalho da tabela repetido em cada página impressa.
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">${sheet}!$${HEADER_ROW}:$${HEADER_ROW}</definedName>`,
    "</definedNames>",
    "</workbook>",
  ].join("");
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

function corePropsXml(report: InventoryBalanceReport): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(report.title)}</dc:title><dc:creator>IndusCost</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(report.generatedAt)}</dcterms:created></cp:coreProperties>`;
}

export async function buildInventoryBalanceReportXlsx(report: InventoryBalanceReport): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("docProps/core.xml", corePropsXml(report));
  zip.file("xl/workbook.xml", workbookXml(report));
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS_XML);
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", balancesSheetXml(report));
  zip.file("xl/worksheets/sheet2.xml", aboutSheetXml(report));
  const generated = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return Buffer.from(generated);
}
