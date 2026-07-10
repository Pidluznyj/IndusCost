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

type PdfLine =
  | { type: "title"; text: string }
  | { type: "subtitle"; text: string }
  | { type: "banner"; text: string }
  | { type: "text"; text: string }
  | { type: "spacer" }
  | { type: "rule" }
  | { type: "kv"; label: string; value: string }
  | { type: "table"; headers: string[]; rows: string[][]; colWidths?: number[] };

const PAGE_W = 842; // landscape A4
const PAGE_H = 595;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;

function wrapText(text: string, maxChars: number): string[] {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return [""];
  if (raw.length <= maxChars) return [raw];
  const words = raw.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function buildPageContent(lines: PdfLine[], pageIndex: number, pageCount: number): string {
  const ops: string[] = ["BT"];
  let y = PAGE_H - MARGIN;
  const lineH = 12;

  const ensureSpace = (need: number) => {
    if (y - need < MARGIN + 20) {
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
    if (line.type === "spacer") {
      y -= 8;
      continue;
    }
    if (line.type === "rule") {
      ops.push("ET");
      ops.push("0.7 w");
      ops.push(`${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
      ops.push("BT");
      y -= 10;
      continue;
    }
    if (line.type === "banner") {
      if (!ensureSpace(28)) break;
      ops.push("ET");
      ops.push("0.85 0.88 0.92 rg");
      ops.push(`${MARGIN} ${y - 18} ${CONTENT_W} 22 re f`);
      ops.push("0 0 0 rg");
      ops.push("BT");
      moveTo(MARGIN + 8, y - 12);
      show(line.text, 10);
      y -= 28;
      continue;
    }
    if (line.type === "title") {
      if (!ensureSpace(22)) break;
      moveTo(MARGIN, y);
      show(line.text, 16);
      y -= 20;
      continue;
    }
    if (line.type === "subtitle") {
      if (!ensureSpace(16)) break;
      moveTo(MARGIN, y);
      show(line.text, 11);
      y -= 14;
      continue;
    }
    if (line.type === "text") {
      const wrapped = wrapText(line.text, 120);
      for (const w of wrapped) {
        if (!ensureSpace(lineH)) break;
        moveTo(MARGIN, y);
        show(w, 9);
        y -= lineH;
      }
      continue;
    }
    if (line.type === "kv") {
      if (!ensureSpace(lineH)) break;
      moveTo(MARGIN, y);
      show(`${line.label}: ${line.value}`, 9);
      y -= lineH;
      continue;
    }
    if (line.type === "table") {
      const cols = line.headers.length;
      const widths =
        line.colWidths && line.colWidths.length === cols
          ? line.colWidths
          : Array.from({ length: cols }, () => CONTENT_W / cols);
      const rowH = 14;
      const drawRow = (cells: string[], header: boolean) => {
        if (!ensureSpace(rowH + 2)) return false;
        ops.push("ET");
        if (header) {
          ops.push("0.82 0.86 0.92 rg");
          ops.push(`${MARGIN} ${y - rowH + 3} ${CONTENT_W} ${rowH} re f`);
          ops.push("0 0 0 rg");
        }
        ops.push("0.6 w");
        ops.push(`${MARGIN} ${y - rowH + 3} ${CONTENT_W} ${rowH} re S`);
        let x = MARGIN;
        for (let i = 0; i < cols; i += 1) {
          if (i > 0) {
            ops.push(`${x} ${y - rowH + 3} m ${x} ${y + 3} l S`);
          }
          x += widths[i]!;
        }
        ops.push("BT");
        x = MARGIN;
        for (let i = 0; i < cols; i += 1) {
          const cell = String(cells[i] ?? "").slice(0, Math.max(4, Math.floor(widths[i]! / 5.2)));
          moveTo(x + 3, y - 7);
          show(cell, header ? 8 : 7);
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

  moveTo(MARGIN, MARGIN - 8);
  show(`Pagina ${pageIndex + 1} de ${pageCount}`, 8);
  ops.push("ET");
  return ops.join("\n");
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  // Heurística simples: quebra por blocos table/title para não estourar uma página.
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let budget = 38;

  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
    budget = 38;
  };

  for (const line of lines) {
    let cost = 1;
    if (line.type === "table") cost = 2 + line.rows.length;
    if (line.type === "title") cost = 2;
    if (line.type === "banner") cost = 2;
    if (budget - cost < 0 && current.length) flush();
    current.push(line);
    budget -= cost;
  }
  flush();
  return pages.length ? pages : [[]];
}

export function buildFormattedLandscapePdf(input: {
  title: string;
  lines: PdfLine[];
}): Buffer {
  const pages = paginate(input.lines);
  const contentStreams = pages.map((pageLines, idx) =>
    buildPageContent(pageLines, idx, pages.length)
  );

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids: string[] = [];
  const pageObjectNumbers: number[] = [];
  let nextObj = 3;
  // We'll assign: 2=Pages, then for each page: pageObj, contentObj, and shared font at end

  const fontObjNum = 3 + pages.length * 2;
  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = nextObj++;
    const contentObj = nextObj++;
    pageObjectNumbers.push(pageObj, contentObj);
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
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>\nendobj\n`
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

export type { PdfLine };
