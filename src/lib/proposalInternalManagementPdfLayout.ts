/**
 * Gerador PDF formatado (tabelas + WinAnsi) para relatório gerencial interno.
 * Evita texto puro do minimalPdfWriter e corrige R$? (NBSP do Intl).
 */

/** Remove chars fora de Latin-1 (WinAnsi) — evita glifos quebrados no Helvetica. */
export function toPdfWinAnsiText(value: string): string {
  return Array.from(value)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 0x2014 || code === 0x2013) return "-"; // em/en dash
      if (code === 0x00a0) return " "; // NBSP
      if (code <= 0xff) return ch;
      return "?";
    })
    .join("");
}

function escapePdfString(value: string): string {
  return toPdfWinAnsiText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Moeda ASCII-safe para PDF Helvetica/WinAnsi — nunca usa NBSP nem R$?. */
export function formatPdfMoneyBr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [intPart, dec = "00"] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${dec}`;
}

export function formatPdfPercentBr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2).replace(".", ",")}%`;
}

export function formatPdfNumberBr(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits).replace(".", ",");
}

export type PdfLine =
  | { type: "title"; text: string }
  | { type: "subtitle"; text: string }
  | { type: "banner"; text: string }
  | { type: "text"; text: string }
  | { type: "spacer" }
  | { type: "rule" }
  | { type: "kv"; label: string; value: string }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
      colWidths?: number[];
      /** Quebra o texto na largura da coluna e cresce a linha — não trunca em silêncio. */
      wrapCells?: boolean;
    }
  /** Quebra determinística: fecha a página atual. Ignorada na renderização. */
  | { type: "pagebreak" };

export type PdfPageOrientation = "portrait" | "landscape";

type PageGeometry = {
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  textMaxChars: number;
  pageBudget: number;
};

function geometryFor(orientation: PdfPageOrientation): PageGeometry {
  const margin = 36;
  if (orientation === "portrait") {
    // A4 portrait (de pé): 595 x 842 pt
    const pageW = 595;
    const pageH = 842;
    return {
      pageW,
      pageH,
      margin,
      contentW: pageW - margin * 2,
      textMaxChars: 78,
      pageBudget: 52,
    };
  }
  // A4 landscape (deitada): 842 x 595 pt
  const pageW = 842;
  const pageH = 595;
  return {
    pageW,
    pageH,
    margin,
    contentW: pageW - margin * 2,
    textMaxChars: 120,
    pageBudget: 38,
  };
}

/** Quebra de texto sem descartar caracteres — palavras longas seguem na linha seguinte. */
export function wrapPdfPlainText(text: string, maxChars: number): string[] {
  const raw = text.replace(/\s+/g, " ").trim();
  const limit = Math.max(1, maxChars);
  if (!raw) return [""];
  if (raw.length <= limit) return [raw];
  const words = raw.split(" ");
  const lines: string[] = [];
  let current = "";
  const flushLongToken = (token: string) => {
    let rest = token;
    while (rest.length > limit) {
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= limit) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (word.length > limit) flushLongToken(word);
      else current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const PDF_TABLE_CHAR_WIDTH_PT = 5.2;

export function pdfTableCellMaxChars(widthPt: number): number {
  return Math.max(4, Math.floor((widthPt - 6) / PDF_TABLE_CHAR_WIDTH_PT));
}

export function wrapPdfTableCells(cells: readonly string[], widths: readonly number[]): string[][] {
  return cells.map((cell, index) => wrapPdfPlainText(String(cell ?? ""), pdfTableCellMaxChars(widths[index] ?? 80)));
}

export function pdfTableRowLineCount(cells: readonly string[], widths: readonly number[]): number {
  return Math.max(1, ...wrapPdfTableCells(cells, widths).map((lines) => lines.length));
}

function buildPageContent(
  lines: PdfLine[],
  pageIndex: number,
  pageCount: number,
  geo: PageGeometry,
  footerNote?: string
): string {
  const { pageW, pageH, margin, contentW, textMaxChars } = geo;
  const ops: string[] = ["BT"];
  let y = pageH - margin;
  const lineH = 12;

  const ensureSpace = (need: number) => {
    if (y - need < margin + 20) {
      return false;
    }
    return true;
  };

  const moveTo = (x: number, yy: number) => {
    ops.push(`1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm`);
  };

  const show = (text: string, fontSize: number) => {
    ops.push(`/F1 ${fontSize} Tf`);
    ops.push(`(${escapePdfString(text)}) Tj`);
  };

  for (const line of lines) {
    if (line.type === "pagebreak") continue;
    if (line.type === "spacer") {
      y -= 8;
      continue;
    }
    if (line.type === "rule") {
      ops.push("ET");
      ops.push("0.7 w");
      ops.push(`${margin} ${y} m ${pageW - margin} ${y} l S`);
      ops.push("BT");
      y -= 10;
      continue;
    }
    if (line.type === "banner") {
      if (!ensureSpace(28)) break;
      ops.push("ET");
      ops.push("0.85 0.88 0.92 rg");
      ops.push(`${margin} ${y - 18} ${contentW} 22 re f`);
      ops.push("0 0 0 rg");
      ops.push("BT");
      moveTo(margin + 8, y - 12);
      show(line.text, 10);
      y -= 28;
      continue;
    }
    if (line.type === "title") {
      if (!ensureSpace(22)) break;
      moveTo(margin, y);
      show(line.text, 16);
      y -= 20;
      continue;
    }
    if (line.type === "subtitle") {
      if (!ensureSpace(16)) break;
      moveTo(margin, y);
      show(line.text, 11);
      y -= 14;
      continue;
    }
    if (line.type === "text") {
      const wrapped = wrapPdfPlainText(line.text, textMaxChars);
      for (const w of wrapped) {
        if (!ensureSpace(lineH)) break;
        moveTo(margin, y);
        show(w, 9);
        y -= lineH;
      }
      continue;
    }
    if (line.type === "kv") {
      if (!ensureSpace(lineH)) break;
      moveTo(margin, y);
      show(`${line.label}: ${line.value}`, 9);
      y -= lineH;
      continue;
    }
    if (line.type === "table") {
      const cols = line.headers.length;
      const widths =
        line.colWidths && line.colWidths.length === cols
          ? line.colWidths
          : Array.from({ length: cols }, () => contentW / cols);
      const wrap = line.wrapCells === true;
      const lineH = wrap ? 9 : 14;
      const drawRow = (cells: string[], header: boolean) => {
        const wrapped = wrap
          ? wrapPdfTableCells(cells, widths)
          : cells.map((cell, index) => [
              String(cell ?? "").slice(0, pdfTableCellMaxChars(widths[index] ?? 80)),
            ]);
        const nLines = Math.max(1, ...wrapped.map((parts) => parts.length));
        const rowH = wrap ? 6 + nLines * lineH : 14;
        if (!ensureSpace(rowH + 2)) return false;
        ops.push("ET");
        if (header) {
          ops.push("0.82 0.86 0.92 rg");
          ops.push(`${margin} ${y - rowH + 3} ${contentW} ${rowH} re f`);
          ops.push("0 0 0 rg");
        }
        ops.push("0.6 w");
        ops.push(`${margin} ${y - rowH + 3} ${contentW} ${rowH} re S`);
        let x = margin;
        for (let i = 0; i < cols; i += 1) {
          if (i > 0) {
            ops.push(`${x} ${y - rowH + 3} m ${x} ${y + 3} l S`);
          }
          x += widths[i]!;
        }
        ops.push("BT");
        x = margin;
        for (let i = 0; i < cols; i += 1) {
          const parts = wrapped[i] ?? [""];
          parts.forEach((part, lineIndex) => {
            moveTo(x + 3, y - 8 - lineIndex * lineH);
            show(part, header ? 8 : 7);
          });
          x += widths[i]!;
        }
        y -= rowH;
        return true;
      };
      if (!drawRow(line.headers, true)) break;
      for (const row of line.rows) {
        if (!drawRow(row, false)) break;
      }
      y -= 6;
    }
  }

  const pageLabel = `Página ${pageIndex + 1} de ${pageCount}`;
  const prefixBudget = Math.max(0, textMaxChars - pageLabel.length - 3);
  const prefix = footerNote
    ? footerNote.length > prefixBudget
      ? `${footerNote.slice(0, Math.max(0, prefixBudget - 1))}…`
      : footerNote
    : "";
  const footer = prefix ? `${prefix} — ${pageLabel}` : pageLabel;
  moveTo(margin, margin - 8);
  show(footer, 8);
  ops.push("ET");
  return ops.join("\n");
}

function paginate(lines: PdfLine[], pageBudget: number): PdfLine[][] {
  // Heurística simples: quebra por blocos table/title para não estourar uma página.
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let budget = pageBudget;

  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
    budget = pageBudget;
  };

  for (const line of lines) {
    if (line.type === "pagebreak") {
      flush();
      continue;
    }
    let cost = 1;
    if (line.type === "table") {
      if (line.wrapCells && line.colWidths && line.colWidths.length === line.headers.length) {
        const headerLines = pdfTableRowLineCount(line.headers, line.colWidths);
        const bodyLines = line.rows.reduce((sum, row) => sum + pdfTableRowLineCount(row, line.colWidths!), 0);
        cost = 2 + headerLines + bodyLines;
      } else {
        cost = 2 + line.rows.length;
      }
    }
    if (line.type === "title") cost = 2;
    if (line.type === "banner") cost = 2;
    if (budget - cost < 0 && current.length) flush();
    current.push(line);
    budget -= cost;
  }
  flush();
  return pages.length ? pages : [[]];
}

function buildFormattedPdf(input: {
  title: string;
  lines: PdfLine[];
  orientation: PdfPageOrientation;
  /** Identificação do documento no rodapé, antes de "Página X de Y". */
  footerNote?: string;
}): Buffer {
  const geo = geometryFor(input.orientation);
  const pages = paginate(input.lines, geo.pageBudget);
  const contentStreams = pages.map((pageLines, idx) =>
    buildPageContent(pageLines, idx, pages.length, geo, input.footerNote)
  );

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids: string[] = [];
  let nextObj = 3;
  // We'll assign: 2=Pages, then for each page: pageObj, contentObj, and shared font at end

  const fontObjNum = 3 + pages.length * 2;
  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = nextObj++;
    nextObj++;
    kids.push(`${pageObj} 0 R`);
  }

  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );

  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    const stream = contentStreams[i]!;
    const streamLength = Buffer.byteLength(stream, "latin1");
    objects.push(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${geo.pageW} ${geo.pageH}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentObj} 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  }

  objects.push(
    `${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += object;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** A4 paisagem (842 x 595) — uso legado (relatório gerencial interno). */
export function buildFormattedLandscapePdf(input: {
  title: string;
  lines: PdfLine[];
  footerNote?: string;
}): Buffer {
  return buildFormattedPdf({ ...input, orientation: "landscape" });
}

/** A4 retrato (595 x 842) — folha de pé. */
export function buildFormattedPortraitPdf(input: {
  title: string;
  lines: PdfLine[];
}): Buffer {
  return buildFormattedPdf({ ...input, orientation: "portrait" });
}
