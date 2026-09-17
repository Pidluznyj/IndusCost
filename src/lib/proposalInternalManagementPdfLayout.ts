/**
 * Gerador PDF formatado (tabelas + WinAnsi) para relatório gerencial interno.
 * Evita texto puro do minimalPdfWriter e corrige R$? (NBSP do Intl).
 *
 * Primitivos extras (masthead, KPIs, meta, tabela navy/zebra) são aditivos:
 * consumidores antigos continuam com o visual original.
 */

/** Remove chars fora de Latin-1 (WinAnsi) — evita glifos quebrados no Helvetica. */
export function toPdfWinAnsiText(value: string): string {
  return Array.from(value)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 0x2014 || code === 0x2013) return "-";
      if (code === 0x00a0) return " ";
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

export type PdfTone = "neutral" | "success" | "warning" | "danger" | "muted" | "info";

export type PdfKpiItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: PdfTone;
};

export type PdfMetaColumn = { label: string; value: string };

export type PdfLine =
  | { type: "title"; text: string }
  | { type: "subtitle"; text: string }
  | { type: "banner"; text: string }
  | { type: "text"; text: string }
  | { type: "spacer" }
  | { type: "rule" }
  | { type: "kv"; label: string; value: string }
  | { type: "masthead"; kicker: string; title: string; subtitle?: string }
  | { type: "kpis"; items: PdfKpiItem[] }
  | { type: "meta"; columns: PdfMetaColumn[] }
  | { type: "callout"; text: string }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
      colWidths?: number[];
      wrapCells?: boolean;
      zebra?: boolean;
      headerStyle?: "default" | "navy";
      accentColumn?: number;
      rowAccents?: Array<PdfTone | "none">;
    }
  | { type: "pagebreak" };

export type PdfDocumentChrome = {
  kicker: string;
  title: string;
  companyName?: string;
  slogan?: string;
  taxId?: string;
  addressLine?: string;
  email?: string;
};

export type PdfPageOrientation = "portrait" | "landscape";

type PageGeometry = {
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  textMaxChars: number;
  pageBudget: number;
};

type Rgb = readonly [number, number, number];

const NAVY: Rgb = [0.12, 0.22, 0.38];
const NAVY_DEEP: Rgb = [0.09, 0.16, 0.28];
const ACCENT: Rgb = [0.055, 0.647, 0.914];
const WHITE: Rgb = [1, 1, 1];
const CHROME_MUTED: Rgb = [0.78, 0.84, 0.92];
const INK: Rgb = [0.12, 0.14, 0.18];
const MUTED: Rgb = [0.4, 0.44, 0.5];
const RULE: Rgb = [0.82, 0.85, 0.9];
const HEADER_GRAY: Rgb = [0.82, 0.86, 0.92];
const ZEBRA: Rgb = [0.965, 0.972, 0.98];
const CARD: Rgb = [0.97, 0.975, 0.982];

const TONE_FILL: Record<PdfTone, Rgb> = {
  neutral: CARD,
  info: [0.9, 0.94, 0.98],
  success: [0.88, 0.95, 0.9],
  warning: [0.99, 0.95, 0.86],
  danger: [0.98, 0.9, 0.9],
  muted: [0.94, 0.94, 0.95],
};

const TONE_INK: Record<PdfTone, Rgb> = {
  neutral: INK,
  info: [0.12, 0.32, 0.52],
  success: [0.12, 0.42, 0.28],
  warning: [0.55, 0.34, 0.04],
  danger: [0.62, 0.16, 0.16],
  muted: [0.35, 0.38, 0.42],
};

function geometryFor(orientation: PdfPageOrientation): PageGeometry {
  const margin = 36;
  if (orientation === "portrait") {
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
  return Math.max(4, Math.floor((widthPt - 8) / PDF_TABLE_CHAR_WIDTH_PT));
}

export function wrapPdfTableCells(cells: readonly string[], widths: readonly number[]): string[][] {
  return cells.map((cell, index) => wrapPdfPlainText(String(cell ?? ""), pdfTableCellMaxChars(widths[index] ?? 80)));
}

export function pdfTableRowLineCount(cells: readonly string[], widths: readonly number[]): number {
  return Math.max(1, ...wrapPdfTableCells(cells, widths).map((lines) => lines.length));
}

function rgb(color: Rgb): string {
  return `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg`;
}

function buildPageContent(
  lines: PdfLine[],
  pageIndex: number,
  pageCount: number,
  geo: PageGeometry,
  footerNote?: string,
  chrome?: PdfDocumentChrome
): string {
  const { pageW, pageH, margin, contentW, textMaxChars } = geo;
  const ops: string[] = [];
  let inText = false;
  const footerReserve = chrome ? 28 : 20;
  const institutional = Boolean(chrome?.companyName);
  let y = chrome ? (institutional ? pageH - 74 : pageH - 44) : pageH - margin;

  const beginText = () => {
    if (!inText) {
      ops.push("BT");
      inText = true;
    }
  };
  const endText = () => {
    if (inText) {
      ops.push("ET");
      inText = false;
    }
  };
  const fillRect = (x: number, yy: number, w: number, h: number, color: Rgb) => {
    endText();
    ops.push(rgb(color));
    ops.push(`${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const strokeRect = (x: number, yy: number, w: number, h: number, color: Rgb = RULE, width = 0.5) => {
    endText();
    ops.push(`${width} w`);
    ops.push(`${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG`);
    ops.push(`${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };
  const hLine = (x1: number, x2: number, yy: number, color: Rgb = RULE) => {
    endText();
    ops.push("0.6 w");
    ops.push(`${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG`);
    ops.push(`${x1.toFixed(2)} ${yy.toFixed(2)} m ${x2.toFixed(2)} ${yy.toFixed(2)} l S`);
  };
  const moveTo = (x: number, yy: number) => {
    beginText();
    ops.push(`1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm`);
  };
  const show = (text: string, fontSize: number, opts: { bold?: boolean; color?: Rgb } = {}) => {
    beginText();
    ops.push(rgb(opts.color ?? INK));
    ops.push(`/${opts.bold ? "F2" : "F1"} ${fontSize} Tf`);
    ops.push(`(${escapePdfString(text)}) Tj`);
  };
  const ensureSpace = (need: number) => y - need >= margin + footerReserve;

  if (chrome) {
    if (institutional) {
      const bandH = 56;
      fillRect(0, pageH - bandH, pageW, bandH, NAVY_DEEP);
      fillRect(0, pageH - bandH - 3, pageW, 3, ACCENT);
      const splitX = margin + contentW * 0.62;
      endText();
      ops.push("0.5 w");
      ops.push(`${CHROME_MUTED[0]} ${CHROME_MUTED[1]} ${CHROME_MUTED[2]} RG`);
      ops.push(
        `${splitX.toFixed(2)} ${(pageH - bandH + 10).toFixed(2)} m ${splitX.toFixed(2)} ${(pageH - 10).toFixed(2)} l S`
      );
      moveTo(margin, pageH - 16);
      show(chrome.companyName ?? "", 13, { bold: true, color: WHITE });
      if (chrome.slogan) {
        moveTo(margin, pageH - 28);
        show(chrome.slogan, 8, { color: CHROME_MUTED });
      }
      const companyMeta = [chrome.taxId ? `CNPJ ${chrome.taxId}` : "", chrome.addressLine ?? ""]
        .filter(Boolean)
        .join("   ·   ");
      if (companyMeta) {
        moveTo(margin, pageH - 42);
        show(companyMeta, 7, { color: CHROME_MUTED });
      }
      if (chrome.email) {
        moveTo(margin, pageH - 52);
        show(`E-mail: ${chrome.email}`, 7, { color: CHROME_MUTED });
      }
      const rightX = splitX + 14;
      moveTo(rightX, pageH - 18);
      show(chrome.title, 11, { bold: true, color: WHITE });
      moveTo(rightX, pageH - 32);
      show(chrome.kicker, 8, { color: CHROME_MUTED });
    } else {
      fillRect(0, pageH - 28, pageW, 28, NAVY_DEEP);
      moveTo(margin, pageH - 18);
      show(chrome.kicker, 8, { bold: true, color: WHITE });
      const right = chrome.title;
      moveTo(pageW - margin - Math.min(right.length * 4.4, 360), pageH - 18);
      show(right, 8, { color: [0.85, 0.89, 0.94] });
    }
  }

  for (const line of lines) {
    if (line.type === "pagebreak") continue;
    if (line.type === "spacer") {
      y -= 10;
      continue;
    }
    if (line.type === "rule") {
      hLine(margin, pageW - margin, y, RULE);
      y -= 12;
      continue;
    }
    if (line.type === "masthead") {
      if (!ensureSpace(58)) break;
      moveTo(margin, y);
      show(line.kicker, 8, { bold: true, color: NAVY });
      y -= 16;
      moveTo(margin, y);
      show(line.title, 18, { bold: true, color: NAVY_DEEP });
      y -= 20;
      if (line.subtitle) {
        for (const part of wrapPdfPlainText(line.subtitle, textMaxChars)) {
          if (!ensureSpace(12)) break;
          moveTo(margin, y);
          show(part, 10, { color: MUTED });
          y -= 13;
        }
      }
      fillRect(margin, y - 2, 72, 3, NAVY);
      y -= 16;
      continue;
    }
    if (line.type === "kpis") {
      const items = line.items.slice(0, 6);
      if (items.length === 0) continue;
      const gap = 8;
      const cardH = 54;
      if (!ensureSpace(cardH + 8)) break;
      const cardW = (contentW - gap * (items.length - 1)) / items.length;
      items.forEach((item, index) => {
        const x = margin + index * (cardW + gap);
        const tone = item.tone ?? "neutral";
        fillRect(x, y - cardH + 6, cardW, cardH, TONE_FILL[tone]);
        strokeRect(x, y - cardH + 6, cardW, cardH, RULE, 0.4);
        fillRect(x, y - cardH + 6, 3, cardH, TONE_INK[tone]);
        moveTo(x + 10, y - 8);
        show(item.label, 7, { bold: true, color: MUTED });
        moveTo(x + 10, y - 24);
        show(item.value, 13, { bold: true, color: TONE_INK[tone] });
        if (item.hint) {
          const hintLines = wrapPdfPlainText(
            item.hint,
            Math.max(8, Math.floor((cardW - 16) / 4.4))
          ).slice(0, 2);
          hintLines.forEach((part, lineIndex) => {
            moveTo(x + 10, y - 38 - lineIndex * 9);
            show(part, 7, { color: MUTED });
          });
        }
      });
      y -= cardH + 10;
      continue;
    }
    if (line.type === "meta") {
      const cols = Math.min(4, Math.max(1, line.columns.length));
      const colW = contentW / cols;
      const wrapped = line.columns.map((column) => ({
        ...column,
        values: wrapPdfPlainText(column.value, Math.max(12, Math.floor((colW - 8) / 5))),
      }));
      const maxLines = Math.max(1, ...wrapped.map((column) => column.values.length));
      const blockH = 14 + maxLines * 11;
      if (!ensureSpace(blockH + 4)) break;
      wrapped.forEach((column, index) => {
        const x = margin + index * colW;
        moveTo(x, y);
        show(column.label, 7, { bold: true, color: MUTED });
        column.values.forEach((part, lineIndex) => {
          moveTo(x, y - 13 - lineIndex * 11);
          show(part, 9, { color: INK });
        });
      });
      y -= blockH + 6;
      continue;
    }
    if (line.type === "callout") {
      const parts = wrapPdfPlainText(line.text, textMaxChars - 6);
      const h = 14 + parts.length * 11;
      if (!ensureSpace(h + 6)) break;
      fillRect(margin, y - h + 8, contentW, h, TONE_FILL.info);
      fillRect(margin, y - h + 8, 3, h, TONE_INK.info);
      parts.forEach((part, index) => {
        moveTo(margin + 12, y - 6 - index * 11);
        show(part, 9, { color: TONE_INK.info });
      });
      y -= h + 8;
      continue;
    }
    if (line.type === "banner") {
      const parts = wrapPdfPlainText(line.text, textMaxChars - 4);
      const h = 16 + parts.length * 11;
      if (!ensureSpace(h)) break;
      fillRect(margin, y - h + 8, contentW, h, HEADER_GRAY);
      parts.forEach((part, index) => {
        moveTo(margin + 10, y - 6 - index * 11);
        show(part, 10, { color: INK });
      });
      y -= h + 6;
      continue;
    }
    if (line.type === "title") {
      if (!ensureSpace(22)) break;
      moveTo(margin, y);
      show(line.text, 16, { bold: true, color: INK });
      y -= 20;
      continue;
    }
    if (line.type === "subtitle") {
      if (!ensureSpace(18)) break;
      fillRect(margin, y - 4, 3, 12, NAVY);
      moveTo(margin + 10, y);
      show(line.text, 11, { bold: true, color: NAVY_DEEP });
      y -= 16;
      continue;
    }
    if (line.type === "text") {
      const wrapped = wrapPdfPlainText(line.text, textMaxChars);
      for (const w of wrapped) {
        if (!ensureSpace(12)) break;
        moveTo(margin, y);
        show(w, 9, { color: INK });
        y -= 12;
      }
      continue;
    }
    if (line.type === "kv") {
      if (!ensureSpace(12)) break;
      moveTo(margin, y);
      show(`${line.label}: `, 9, { bold: true, color: MUTED });
      const labelW = Math.min(220, line.label.length * 5 + 12);
      moveTo(margin + labelW, y);
      show(line.value, 9, { color: INK });
      y -= 12;
      continue;
    }
    if (line.type === "table") {
      const cols = line.headers.length;
      const widths =
        line.colWidths && line.colWidths.length === cols
          ? line.colWidths
          : Array.from({ length: cols }, () => contentW / cols);
      const wrap = line.wrapCells === true;
      const textLineH = wrap ? 10 : 14;
      const navy = line.headerStyle === "navy";
      const drawRow = (cells: string[], header: boolean, bodyIndex: number) => {
        const wrapped = wrap
          ? wrapPdfTableCells(cells, widths)
          : cells.map((cell, index) => [
              String(cell ?? "").slice(0, pdfTableCellMaxChars(widths[index] ?? 80)),
            ]);
        const nLines = Math.max(1, ...wrapped.map((parts) => parts.length));
        const rowH = wrap ? 8 + nLines * textLineH : 14;
        if (!ensureSpace(rowH + 2)) return false;
        const bottom = y - rowH + 4;
        if (header && navy) fillRect(margin, bottom, contentW, rowH, NAVY);
        else if (header) fillRect(margin, bottom, contentW, rowH, HEADER_GRAY);
        else if (line.zebra && bodyIndex % 2 === 1) fillRect(margin, bottom, contentW, rowH, ZEBRA);
        const accent = !header && line.accentColumn != null ? line.rowAccents?.[bodyIndex] : undefined;
        if (accent && accent !== "none" && line.accentColumn != null) {
          let xAccent = margin;
          for (let i = 0; i < line.accentColumn; i += 1) xAccent += widths[i]!;
          fillRect(xAccent, bottom, widths[line.accentColumn]!, rowH, TONE_FILL[accent]);
        }
        strokeRect(margin, bottom, contentW, rowH, RULE, 0.45);
        let x = margin;
        for (let i = 1; i < cols; i += 1) {
          x += widths[i - 1]!;
          endText();
          ops.push("0.4 w");
          ops.push(`${RULE[0]} ${RULE[1]} ${RULE[2]} RG`);
          ops.push(`${x.toFixed(2)} ${bottom.toFixed(2)} m ${x.toFixed(2)} ${(bottom + rowH).toFixed(2)} l S`);
        }
        x = margin;
        const headerColor = header && navy ? WHITE : INK;
        for (let i = 0; i < cols; i += 1) {
          const parts = wrapped[i] ?? [""];
          parts.forEach((part, lineIndex) => {
            moveTo(x + 5, y - 9 - lineIndex * textLineH);
            show(part, header ? 8 : 8, { bold: header, color: headerColor });
          });
          x += widths[i]!;
        }
        y -= rowH;
        return true;
      };
      if (!drawRow(line.headers, true, 0)) break;
      let drawn = 0;
      for (const row of line.rows) {
        if (!drawRow(row, false, drawn)) break;
        drawn += 1;
      }
      y -= 10;
    }
  }

  const pageLabel = `Página ${pageIndex + 1} de ${pageCount}`;
  const prefixBudget = Math.max(0, textMaxChars - pageLabel.length - 3);
  const prefix = footerNote
    ? footerNote.length > prefixBudget
      ? `${footerNote.slice(0, Math.max(0, prefixBudget - 1))}…`
      : footerNote
    : "";
  const footer = prefix ? `${prefix}  ·  ${pageLabel}` : pageLabel;
  hLine(margin, pageW - margin, margin + 10, RULE);
  moveTo(margin, margin - 4);
  show(footer, 8, { color: MUTED });
  endText();
  return ops.join("\n");
}

function paginate(lines: PdfLine[], pageBudget: number): PdfLine[][] {
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
    if (line.type === "masthead") cost = 6;
    if (line.type === "kpis") cost = 5;
    if (line.type === "meta") cost = 3;
    if (line.type === "callout") cost = 3;
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
  footerNote?: string;
  chrome?: PdfDocumentChrome;
}): Buffer {
  const geo = geometryFor(input.orientation);
  const pages = paginate(input.lines, geo.pageBudget);
  const contentStreams = pages.map((pageLines, idx) =>
    buildPageContent(pageLines, idx, pages.length, geo, input.footerNote, input.chrome)
  );

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids: string[] = [];
  let nextObj = 3;
  const fontRegular = 3 + pages.length * 2;
  const fontBold = fontRegular + 1;
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
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${geo.pageW} ${geo.pageH}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentObj} 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  }

  objects.push(
    `${fontRegular} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`
  );
  objects.push(
    `${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`
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
  chrome?: PdfDocumentChrome;
}): Buffer {
  return buildFormattedPdf({ ...input, orientation: "landscape" });
}

/** A4 retrato (595 x 842) — folha de pé. */
export function buildFormattedPortraitPdf(input: {
  title: string;
  lines: PdfLine[];
  footerNote?: string;
  chrome?: PdfDocumentChrome;
}): Buffer {
  return buildFormattedPdf({ ...input, orientation: "portrait" });
}
