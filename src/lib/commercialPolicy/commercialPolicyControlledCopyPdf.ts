/**
 * Cópia controlada da Política Comercial em layout de documento formal (A4).
 *
 * Regras da cópia controlada (todas as páginas):
 *  - marca d'água ATRÁS do texto com "CÓPIA CONTROLADA / NÃO DISTRIBUIR" e, em
 *    faixas repetidas, quem gerou a cópia (nome, usuário, data/hora e código);
 *  - cabeçalho com empresa, título, código, versão e classificação;
 *  - rodapé com a restrição de uso, quem gerou (usuário logado), quando, o
 *    código da cópia e a paginação "Página X de Y";
 *  - capa com identificação do documento, quadro de controle da cópia e o aviso
 *    de confidencialidade; sumário; texto integral, nunca truncado.
 *
 * PDF escrito à mão (Helvetica/WinAnsi, sem dependências), com métricas da
 * fonte para quebrar e justificar o texto por largura real.
 */
import { escapePdfText } from "./commercialPolicyPdf.js";
import { parsePolicyChapters, type PolicyBlock, type PolicyChapter } from "./policyDocumentFormat.js";
import { applyPolicyAutoFields, type PolicyAutoFieldContext } from "./policyAutoFields.js";

export type ControlledCopyPdfInput = {
  /** Conteúdo gravado na versão (marcação `# / ## / - / > / |` ou texto plano). */
  content: string;
  title: string;
  /** Rótulo documental ("1.0"), não o número interno. */
  versionLabel: string;
  code: string;
  company: string;
  cnpj: string;
  classification: string;
  contentHash: string;
  /** ISO; nulo = ainda não definida. */
  effectiveFrom: string | null;
  publishedAt: string | null;
  summaryRules: string[];
  /** Aviso de confidencialidade: a primeira linha é o título. */
  notice: string[];
  copyId: string;
  recipientName: string;
  recipientEmail: string;
  /** ISO do instante de emissão (relógio do servidor). */
  generatedAt: string;
  /** Carimbo adicional, ex.: "PRÉVIA — VERSÃO AINDA NÃO PUBLICADA". */
  stamp?: string | null;
  /** Preenche as lacunas do documento (datas, aprovação, termo de ciência) com dados reais. */
  autoFields?: PolicyAutoFieldContext;
};

// ── Métricas (AFM) de Helvetica e Helvetica-Bold, caracteres 32..126 ─────────
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];
/** [regular, bold] dos caracteres WinAnsi fora do ASCII que não são letra acentuada. */
const SPECIAL_WIDTHS: Record<string, [number, number]> = {
  "•": [350, 350],
  "–": [556, 556],
  "—": [1000, 1000],
  "…": [1000, 1000],
  "‘": [222, 278],
  "’": [222, 278],
  "“": [333, 500],
  "”": [333, 500],
  "§": [556, 556],
  "º": [365, 365],
  "ª": [370, 370],
  "·": [278, 278],
  "×": [584, 584],
  "€": [556, 556],
};
/** Caracteres sem glifo em WinAnsi viram equivalentes legíveis (nunca "?"). */
const SUBSTITUTIONS: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "→": "->",
  "／": "/",
  "‑": "-",
  "−": "-",
  " ": " ",
  "\t": " ",
};

type Font = "F1" | "F2";

function sanitize(text: string): string {
  let out = "";
  for (const char of text) out += SUBSTITUTIONS[char] ?? char;
  return out;
}

function charWidth(char: string, font: Font): number {
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  const special = SPECIAL_WIDTHS[char];
  if (special) return special[font === "F2" ? 1 : 0];
  // Letra acentuada tem a largura da letra base.
  const base = char.normalize("NFD").charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32];
  return 556;
}

export function pdfTextWidth(text: string, font: Font, size: number): number {
  let units = 0;
  for (const char of text) units += charWidth(char, font);
  return (units * size) / 1000;
}

/** Quebra por palavra na largura real; palavra maior que a linha é cortada por caractere. */
export function wrapPdfText(text: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const push = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let piece = word;
    while (pdfTextWidth(piece, font, size) > maxWidth) {
      push();
      let cut = piece.length - 1;
      while (cut > 1 && pdfTextWidth(piece.slice(0, cut), font, size) > maxWidth) cut -= 1;
      lines.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    const candidate = current ? `${current} ${piece}` : piece;
    if (pdfTextWidth(candidate, font, size) <= maxWidth) current = candidate;
    else {
      push();
      current = piece;
    }
  }
  push();
  return lines.length ? lines : [""];
}

function fitText(text: string, font: Font, size: number, maxWidth: number): string {
  if (pdfTextWidth(text, font, size) <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && pdfTextWidth(`${text.slice(0, cut)}…`, font, size) > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

// ── Página ───────────────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 56;
const RIGHT = 539;
const WIDTH = RIGHT - LEFT;
const TOP = 770;
const BOTTOM = 96;

const NAVY = "0.06 0.09 0.16";
const TEXT = "0.12 0.14 0.18";
const MUTED = "0.38 0.42 0.48";
const AMBER = "0.71 0.33 0.04";
const RED = "0.70 0.11 0.11";
const RULE = "0.80 0.83 0.87";
const SHADE = "0.93 0.94 0.96";

const n = (value: number) => (Math.round(value * 100) / 100).toString();

/** `bg` recebe preenchimentos (ficam atrás da marca d'água); `fg`, texto e traços. */
type Page = { bg: string[]; fg: string[] };

function drawText(target: string[], x: number, y: number, text: string, font: Font, size: number, color = TEXT, wordSpacing = 0): void {
  target.push(`BT /${font} ${n(size)} Tf ${color} rg ${n(wordSpacing)} Tw 1 0 0 1 ${n(x)} ${n(y)} Tm (${escapePdfText(text)}) Tj ET`);
}

function drawTextRight(target: string[], right: number, y: number, text: string, font: Font, size: number, color = TEXT): void {
  drawText(target, right - pdfTextWidth(text, font, size), y, text, font, size, color);
}

function drawLine(target: string[], x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  target.push(`${color} RG ${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
}

type ParagraphStyle = { font?: Font; size?: number; leading?: number; color?: string; indent?: number; justify?: boolean; gapAfter?: number; width?: number };

/** Fluxo vertical com quebra de página automática. */
class Flow {
  readonly pages: Page[] = [];
  y = TOP;

  constructor(private readonly top = TOP) {
    this.newPage();
  }

  get page(): Page {
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    this.pages.push({ bg: [], fg: [] });
    this.y = this.pages.length === 1 ? this.top : TOP;
  }

  /** Garante `height` livre na página atual (título não fica órfão no pé da página). */
  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(height: number): void {
    this.y -= height;
  }

  paragraph(raw: string, style: ParagraphStyle = {}): void {
    const font = style.font ?? "F1";
    const size = style.size ?? 10;
    const leading = style.leading ?? size * 1.42;
    const indent = style.indent ?? 0;
    const width = (style.width ?? WIDTH) - indent;
    const lines = wrapPdfText(sanitize(raw), font, size, width);
    lines.forEach((line, index) => {
      this.ensure(leading);
      this.y -= leading;
      let wordSpacing = 0;
      if (style.justify && index < lines.length - 1) {
        const spaces = line.split(" ").length - 1;
        const slack = width - pdfTextWidth(line, font, size);
        if (spaces > 0 && slack > 0 && slack / spaces < size * 0.45) wordSpacing = slack / spaces;
      }
      drawText(this.page.fg, LEFT + indent, this.y, line, font, size, style.color ?? TEXT, wordSpacing);
    });
    this.y -= style.gapAfter ?? 0;
  }

  bullet(raw: string): void {
    const size = 10;
    const leading = 14.2;
    const lines = wrapPdfText(sanitize(raw), "F1", size, WIDTH - 16);
    lines.forEach((line, index) => {
      this.ensure(leading);
      this.y -= leading;
      if (index === 0) drawText(this.page.fg, LEFT + 3, this.y, "•", "F1", size, AMBER);
      drawText(this.page.fg, LEFT + 16, this.y, line, "F1", size);
    });
    this.y -= 3;
  }

  chapterTitle(raw: string): void {
    this.ensure(96);
    this.y -= 22;
    const lines = wrapPdfText(sanitize(raw), "F2", 13, WIDTH);
    for (const line of lines) {
      this.y -= 17;
      drawText(this.page.fg, LEFT, this.y, line, "F2", 13, NAVY);
    }
    this.y -= 7;
    drawLine(this.page.fg, LEFT, this.y, RIGHT, this.y, RULE, 0.5);
    drawLine(this.page.fg, LEFT, this.y, LEFT + 44, this.y, AMBER, 1.6);
    this.y -= 6;
  }

  heading(raw: string): void {
    this.ensure(48);
    this.y -= 8;
    this.paragraph(raw, { font: "F2", size: 10.5, leading: 15, color: NAVY, gapAfter: 2 });
  }

  label(raw: string): void {
    this.ensure(40);
    this.y -= 18;
    drawText(this.page.fg, LEFT, this.y, sanitize(raw).toUpperCase(), "F2", 7.5, MUTED);
    this.y -= 5;
  }

  /** Tabela com bordas; células quebram por largura; o cabeçalho repete ao virar a página. */
  table(rows: string[][], options: { header: boolean; boldFirstColumn?: boolean }): void {
    const columns = Math.max(...rows.map((row) => row.length), 1);
    const size = 9;
    const leading = 11.6;
    const pad = 6;
    const clean = rows.map((row) => Array.from({ length: columns }, (_, index) => sanitize(row[index] ?? "")));
    const natural = Array.from({ length: columns }, (_, col) =>
      Math.max(...clean.map((row) => Math.min(pdfTextWidth(row[col], "F2", size), 250))) + pad * 2
    );
    const total = natural.reduce((sum, value) => sum + value, 0);
    let widths = natural.map((value) => Math.max((value / total) * WIDTH, Math.min(84, WIDTH / columns)));
    const scale = WIDTH / widths.reduce((sum, value) => sum + value, 0);
    widths = widths.map((value) => value * scale);

    const drawRow = (row: string[], isHeader: boolean) => {
      const fonts: Font[] = row.map((_, col) => (isHeader || (options.boldFirstColumn && col === 0) ? "F2" : "F1"));
      const cells = row.map((cell, col) => wrapPdfText(cell, fonts[col], size, widths[col] - pad * 2));
      const height = Math.max(...cells.map((lines) => lines.length)) * leading + pad + 3;
      if (this.y - height < BOTTOM) {
        this.newPage();
        this.y -= 6;
        if (options.header && !isHeader) drawRow(clean[0], true);
      }
      let x = LEFT;
      if (isHeader) this.page.bg.push(`${SHADE} rg ${n(LEFT)} ${n(this.y - height)} ${n(WIDTH)} ${n(height)} re f`);
      cells.forEach((lines, col) => {
        this.page.fg.push(`${RULE} RG 0.5 w ${n(x)} ${n(this.y - height)} ${n(widths[col])} ${n(height)} re S`);
        lines.forEach((line, index) => {
          drawText(this.page.fg, x + pad, this.y - pad - 6.5 - index * leading, line, fonts[col], size, isHeader ? NAVY : TEXT);
        });
        x += widths[col];
      });
      this.y -= height;
    };

    this.y -= 6;
    clean.forEach((row, index) => drawRow(row, options.header && index === 0));
    this.y -= 8;
  }

  block(block: PolicyBlock, tableHeader = true): void {
    if (block.type === "heading") this.heading(block.text);
    else if (block.type === "bullet") this.bullet(block.text);
    else if (block.type === "term") {
      this.ensure(34);
      this.y -= 3;
      this.paragraph(block.term, { font: "F2", size: 10, leading: 14, color: NAVY });
      this.paragraph(block.definition, { justify: true, gapAfter: 4 });
    } else if (block.type === "table") this.table(block.rows, { header: tableHeader, boldFirstColumn: block.rows[0]?.length === 2 });
    else this.paragraph(block.text, { justify: true, gapAfter: 5 });
  }
}

// ── Datas (relógio do servidor, exibidas no horário de Brasília) ─────────────
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(date);
  return `${text.replace(", ", " ")} (horário de Brasília)`;
}

function formatDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(date);
}

const normalizeForCompare = (text: string) => text.normalize("NFD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

/** Parágrafos iniciais da capa que só repetem o título não são impressos duas vezes. */
function coverBlocksWithoutTitle(chapter: PolicyChapter | undefined, title: string): PolicyBlock[] {
  if (!chapter) return [];
  const target = normalizeForCompare(title);
  let consumed = "";
  let skip = 0;
  for (const block of chapter.blocks) {
    if (block.type !== "paragraph") break;
    const next = consumed + normalizeForCompare(block.text);
    if (!target.startsWith(next)) break;
    consumed = next;
    skip += 1;
    if (consumed === target) return chapter.blocks.slice(skip);
  }
  return chapter.blocks;
}

function watermarkCommands(input: ControlledCopyPdfInput, issuedAt: string): string[] {
  const cos = 0.8192;
  const sin = 0.5736;
  const tile = sanitize(`${input.recipientName}  ·  ${input.recipientEmail}  ·  ${issuedAt}  ·  cópia ${input.copyId}`);
  let strip = tile;
  while (pdfTextWidth(strip, "F1", 8) < 1150) strip += `      ${tile}`;
  const commands = [
    "q",
    "0 Tw",
    `BT /F2 46 Tf 0.93 g ${cos} ${sin} -${sin} ${cos} 118 262 Tm (${escapePdfText("CÓPIA CONTROLADA")}) Tj ET`,
    `BT /F2 20 Tf 0.93 g ${cos} ${sin} -${sin} ${cos} 236 300 Tm (${escapePdfText("NÃO DISTRIBUIR")}) Tj ET`,
  ];
  for (let y = -420; y < PAGE_H; y += 118) {
    commands.push(`BT /F1 8 Tf 0.85 g ${cos} ${sin} -${sin} ${cos} -40 ${y} Tm (${escapePdfText(strip)}) Tj ET`);
  }
  commands.push("Q");
  return commands;
}

function assemblePdf(streams: string[], title: string): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  let nextId = 6;
  for (const stream of streams) {
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title (${escapePdfText(sanitize(title))}) /Creator (IndusCost) >>`;
  const lastId = nextId - 1;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id <= lastId; id += 1) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= lastId; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${lastId + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

export function buildControlledCopyPdf(input: ControlledCopyPdfInput): Buffer {
  const issuedAt = formatDateTime(input.generatedAt);
  const parsed = parsePolicyChapters(input.content);
  const chapters = input.autoFields ? applyPolicyAutoFields(parsed, input.autoFields) : parsed;
  const coverChapter = chapters.find((chapter) => chapter.id === "capa");
  const bodyChapters = chapters.filter((chapter) => chapter !== coverChapter);
  const documentId = `${input.code} · Versão ${input.versionLabel}`;

  // ── Corpo: texto integral, capítulo a capítulo ──
  const body = new Flow();
  body.y += 22;
  const entries: Array<{ title: string; page: number }> = [];
  for (const chapter of bodyChapters) {
    body.chapterTitle(chapter.title);
    entries.push({ title: sanitize(chapter.title), page: body.pages.length });
    for (const block of chapter.blocks) body.block(block);
  }
  if (input.summaryRules.length) {
    body.chapterTitle("Principais regras");
    entries.push({ title: "Principais regras", page: body.pages.length });
    input.summaryRules.forEach((rule, index) => body.paragraph(`${index + 1}. ${rule}`, { justify: true, gapAfter: 5 }));
  }

  // ── Capa, aviso de confidencialidade e sumário (a contagem de páginas não depende dos números impressos) ──
  const buildFront = (offset: number): Flow => {
    const cover = new Flow(760);
    const first = cover.page;
    drawText(first.fg, LEFT, 792, sanitize(input.company), "F2", 11, NAVY);
    drawText(first.fg, LEFT, 779, `CNPJ ${input.cnpj}`, "F1", 8.5, MUTED);
    first.fg.push(`${AMBER} RG 1.2 w ${n(RIGHT - 142)} 772 142 30 re S`);
    const stampCenter = RIGHT - 71;
    drawText(first.fg, stampCenter - pdfTextWidth("DOCUMENTO CONTROLADO", "F2", 8.5) / 2, 790, "DOCUMENTO CONTROLADO", "F2", 8.5, AMBER);
    drawText(first.fg, stampCenter - pdfTextWidth("USO INTERNO E RESTRITO", "F1", 7) / 2, 779, "USO INTERNO E RESTRITO", "F1", 7, AMBER);
    drawLine(first.fg, LEFT, 762, RIGHT, 762, NAVY, 2);

    cover.gap(58);
    cover.paragraph(documentId.toUpperCase(), { font: "F2", size: 10, color: AMBER, gapAfter: 6 });
    cover.paragraph(input.title, { font: "F2", size: 24, leading: 29, color: NAVY });
    cover.gap(12);
    drawLine(cover.page.fg, LEFT, cover.y, LEFT + 60, cover.y, AMBER, 2);
    cover.gap(8);
    cover.paragraph(input.classification, { font: "F2", size: 9, color: MUTED });
    if (input.stamp) cover.paragraph(input.stamp, { font: "F2", size: 9, color: RED });
    cover.gap(10);
    for (const block of coverBlocksWithoutTitle(coverChapter, input.title)) cover.block(block, false);

    cover.label("Controle desta cópia");
    cover.table(
      [
        ["Emitida para", input.recipientName],
        ["Usuário", input.recipientEmail],
        ["Emitida em", issuedAt],
        ["Código da cópia", input.copyId],
        ["Documento", documentId],
        ["Vigência", formatDate(input.effectiveFrom, "a definir na publicação")],
        ["Publicação", formatDate(input.publishedAt, "não publicada")],
        ["SHA-256 do conteúdo", input.contentHash || "—"],
      ],
      { header: false, boldFirstColumn: true }
    );
    const [noticeTitle, ...noticeBody] = input.notice;
    if (noticeTitle) cover.label(noticeTitle);
    for (const line of noticeBody) cover.paragraph(line, { size: 8.5, leading: 12, color: MUTED, justify: true, gapAfter: 3 });

    if (entries.length > 1) {
      cover.chapterTitle("Sumário");
      cover.gap(4);
      for (const entry of entries) {
        const number = String(entry.page + offset);
        const numberWidth = pdfTextWidth(number, "F1", 10);
        const lines = wrapPdfText(entry.title, "F1", 10, WIDTH - 44);
        lines.forEach((line, index) => {
          cover.ensure(14.5);
          cover.y -= 14.5;
          drawText(cover.page.fg, LEFT, cover.y, line, "F1", 10);
          if (index < lines.length - 1) return;
          const from = LEFT + pdfTextWidth(line, "F1", 10) + 5;
          const to = RIGHT - numberWidth - 5;
          if (to > from) cover.page.fg.push(`${RULE} RG 0.6 w [1 2.5] 0 d ${n(from)} ${n(cover.y + 1)} m ${n(to)} ${n(cover.y + 1)} l S [] 0 d`);
          drawTextRight(cover.page.fg, RIGHT, cover.y, number, "F1", 10);
        });
      }
    }
    return cover;
  };
  const front = buildFront(buildFront(0).pages.length);

  const pages = [...front.pages, ...body.pages];
  const watermark = watermarkCommands(input, issuedAt);
  const headerRight = sanitize(documentId);
  const issuedLine = sanitize(`Cópia emitida para ${input.recipientName} (${input.recipientEmail}) em ${issuedAt}`);
  const codeLine = sanitize(`Código da cópia: ${input.copyId}${input.stamp ? `  ·  ${input.stamp}` : ""}`);

  const streams = pages.map((page, index) => {
    const chrome: string[] = [];
    if (index > 0) {
      drawText(chrome, LEFT, 806, fitText(sanitize(input.company), "F2", 8, 300), "F2", 8, NAVY);
      drawText(chrome, LEFT, 796, fitText(sanitize(input.title), "F1", 7.5, 300), "F1", 7.5, MUTED);
      drawTextRight(chrome, RIGHT, 806, headerRight, "F2", 8, NAVY);
      drawTextRight(chrome, RIGHT, 796, fitText(sanitize(input.classification), "F1", 7, 170), "F1", 7, AMBER);
      drawLine(chrome, LEFT, 788, RIGHT, 788, RULE, 0.6);
    }
    drawLine(chrome, LEFT, 74, RIGHT, 74, RULE, 0.6);
    drawText(chrome, LEFT, 63, "DOCUMENTO CONTROLADO  ·  USO INTERNO E RESTRITO  ·  Proibida a divulgação ou reprodução não autorizada", "F2", 6.5, NAVY);
    drawText(chrome, LEFT, 53, fitText(issuedLine, "F1", 7, WIDTH), "F1", 7, MUTED);
    drawText(chrome, LEFT, 43, fitText(codeLine, "F1", 7, WIDTH), "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 63, `Página ${index + 1} de ${pages.length}`, "F1", 8, NAVY);
    // Ordem de pintura: preenchimentos → marca d'água → cabeçalho/rodapé → texto.
    return [...page.bg, ...watermark, ...chrome, ...page.fg].join("\n");
  });

  return assemblePdf(streams, `${input.code} v${input.versionLabel} — cópia controlada`);
}

// ── Certificado de aceite eletrônico ─────────────────────────────────────────

export type AcceptanceCertificatePdfInput = {
  acceptanceId: string;
  company: string;
  cnpj: string;
  /** Código documental ("POL-COM-001"); nulo para versões sem código. */
  code: string | null;
  title: string;
  versionLabel: string;
  signerName: string;
  signerEmail: string;
  /** Perfil já em texto de leitura ("Vendedor(a)"). */
  signerRole: string;
  externalSellerId: number | null;
  /** ISO do aceite (relógio do servidor). */
  acceptedAt: string;
  ipAddress: string | null;
  challengeId: string;
  declarations: string[];
  policyHash: string;
  normativeSnapshotHash?: string | null;
  changeSetHash?: string | null;
  photoHash: string;
  evidenceHash: string;
};

function drawTextCenter(target: string[], center: number, y: number, text: string, font: Font, size: number, color = TEXT): void {
  drawText(target, center - pdfTextWidth(text, font, size) / 2, y, text, font, size, color);
}

/** Círculo por quatro curvas de Bézier. */
function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return [
    `${n(cx + r)} ${n(cy)} m`,
    `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
    `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`,
    `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
    `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`,
  ].join(" ");
}

/**
 * Comprovante de aceite em formato de certificado (A4): moldura, identificação
 * do signatário, texto de certificação, quadro do aceite, declarações aceitas,
 * assinatura eletrônica com selo e hashes de integridade. A fotografia do
 * registro visual não é impressa.
 */
export function buildAcceptanceCertificatePdf(input: AcceptanceCertificatePdfInput): Buffer {
  const CENTER = PAGE_W / 2;
  const acceptedAt = formatDateTime(input.acceptedAt);
  const acceptedDate = formatDate(input.acceptedAt, "—");
  const documentId = [input.code, `Versão ${input.versionLabel}`].filter(Boolean).join(" · ");
  const title = sanitize(input.title);

  const flow = new Flow(640);
  const first = flow.page;

  // Cabeçalho do certificado.
  drawTextCenter(first.fg, CENTER, 774, sanitize(input.company).toUpperCase(), "F2", 10, NAVY);
  drawTextCenter(first.fg, CENTER, 762, `CNPJ ${input.cnpj}`, "F1", 8, MUTED);
  drawTextCenter(first.fg, CENTER, 724, "CERTIFICADO DE ACEITE ELETRÔNICO", "F2", 21, NAVY);
  drawLine(first.fg, CENTER - 110, 712, CENTER + 110, 712, RULE, 0.6);
  drawLine(first.fg, CENTER - 32, 712, CENTER + 32, 712, AMBER, 2);
  wrapPdfText(title, "F2", 11, WIDTH - 40)
    .slice(0, 2)
    .forEach((line, index) => drawTextCenter(first.fg, CENTER, 694 - index * 14, line, "F2", 11, TEXT));
  drawTextCenter(first.fg, CENTER, 664, sanitize(documentId), "F1", 9, AMBER);

  // Quem aceitou.
  drawTextCenter(first.fg, CENTER, flow.y - 6, "Certificamos que", "F1", 10, MUTED);
  flow.gap(34);
  drawTextCenter(first.fg, CENTER, flow.y, fitText(sanitize(input.signerName), "F2", 19, WIDTH), "F2", 19, NAVY);
  flow.gap(16);
  const identity = [input.signerEmail, input.signerRole, input.externalSellerId ? `Nomus ${input.externalSellerId}` : null].filter(Boolean).join("  ·  ");
  drawTextCenter(first.fg, CENTER, flow.y, fitText(sanitize(identity), "F1", 9, WIDTH), "F1", 9, MUTED);
  flow.gap(18);
  const statement = sanitize(
    `leu o documento na íntegra, foi aprovado(a) no teste de compreensão e aceitou eletronicamente a ${input.title}${input.code ? ` (${input.code})` : ""}, versão ${input.versionLabel}, em ${acceptedAt}, com confirmação de identidade por senha e registro visual do ato.`
  );
  for (const line of wrapPdfText(statement, "F1", 10.5, WIDTH - 50)) {
    flow.gap(15.5);
    drawTextCenter(first.fg, CENTER, flow.y, line, "F1", 10.5);
  }
  flow.gap(10);

  flow.label("Dados do aceite");
  flow.table(
    [
      ["Número do aceite", input.acceptanceId],
      ["Documento", [input.title, documentId].join(" — ")],
      ["Signatário", `${input.signerName} (${input.signerEmail})`],
      ["Data e hora do servidor", acceptedAt],
      ["IP observado pelo servidor", input.ipAddress ?? "—"],
      ["Teste de compreensão", "Aprovado"],
      ["Confirmação de identidade", `Reautenticação por senha — ${input.challengeId}`],
      ["Registro visual", "Realizado; imagem guardada em área restrita (não impressa neste certificado)"],
    ],
    { header: false, boldFirstColumn: true }
  );

  // Assinatura eletrônica e selo: bloco único, nunca partido entre páginas.
  flow.ensure(172);
  flow.gap(14);
  const signY = flow.y - 42;
  const page = flow.page;
  drawLine(page.fg, LEFT, signY, LEFT + 270, signY, NAVY, 0.8);
  drawText(page.fg, LEFT, signY + 6, fitText(sanitize(input.signerName), "F2", 11, 270), "F2", 11, NAVY);
  drawText(page.fg, LEFT, signY - 11, "Assinado eletronicamente no IndusCost", "F1", 8, MUTED);
  drawText(page.fg, LEFT, signY - 21, sanitize(`em ${acceptedAt}`), "F1", 8, MUTED);
  const sealX = RIGHT - 58;
  const sealY = signY - 2;
  page.fg.push(`${AMBER} RG 1.6 w ${circlePath(sealX, sealY, 46)} S`);
  page.fg.push(`${AMBER} RG 0.6 w ${circlePath(sealX, sealY, 41)} S`);
  drawTextCenter(page.fg, sealX, sealY + 15, "ACEITE", "F2", 10, AMBER);
  drawTextCenter(page.fg, sealX, sealY + 3, "REGISTRADO", "F2", 10, AMBER);
  drawLine(page.fg, sealX - 24, sealY - 4, sealX + 24, sealY - 4, AMBER, 0.5);
  drawTextCenter(page.fg, sealX, sealY - 15, acceptedDate, "F1", 8.5, AMBER);
  drawTextCenter(page.fg, sealX, sealY - 25, "IndusCost", "F1", 7, AMBER);
  flow.y = signY - 38;

  // Integridade: hashes que amarram este certificado ao documento e à evidência.
  const hashes: Array<[string, string]> = [
    ["SHA-256 do documento aceito", input.policyHash],
    ...(input.normativeSnapshotHash ? [["SHA-256 do snapshot normativo", input.normativeSnapshotHash] as [string, string]] : []),
    ...(input.changeSetHash ? [["SHA-256 do changeset", input.changeSetHash] as [string, string]] : []),
    ["SHA-256 do registro visual", input.photoHash],
    ["SHA-256 do pacote de evidências", input.evidenceHash],
  ];
  flow.label("Integridade");
  flow.gap(3);
  for (const [name, value] of hashes) {
    flow.gap(10);
    drawText(flow.page.fg, LEFT, flow.y, name, "F2", 7, MUTED);
    drawText(flow.page.fg, LEFT + 150, flow.y, fitText(value || "—", "F1", 7, WIDTH - 150), "F1", 7, TEXT);
  }

  // Declarações: depois do corpo do certificado, seguem para a página seguinte se não couberem.
  if (input.declarations.length) {
    flow.gap(8);
    flow.ensure(60);
    flow.label("Declarações aceitas pelo signatário");
    flow.gap(4);
    for (const line of input.declarations) flow.bullet(line);
  }

  const pages = flow.pages;
  const streams = pages.map((item, index) => {
    const chrome: string[] = [];
    // Moldura dupla em todas as páginas.
    chrome.push(`${NAVY} RG 1.4 w 26 26 ${n(PAGE_W - 52)} ${n(PAGE_H - 52)} re S`);
    chrome.push(`${AMBER} RG 0.5 w 31 31 ${n(PAGE_W - 62)} ${n(PAGE_H - 62)} re S`);
    if (index > 0) {
      drawText(chrome, LEFT, 796, "CERTIFICADO DE ACEITE ELETRÔNICO", "F2", 8, NAVY);
      drawTextRight(chrome, RIGHT, 796, fitText(sanitize(documentId), "F1", 8, 220), "F1", 8, MUTED);
      drawLine(chrome, LEFT, 788, RIGHT, 788, RULE, 0.6);
    }
    drawLine(chrome, LEFT, 74, RIGHT, 74, RULE, 0.6);
    drawText(chrome, LEFT, 63, "DOCUMENTO CONTROLADO  ·  USO INTERNO E RESTRITO", "F2", 6.5, NAVY);
    drawText(chrome, LEFT, 53, fitText(sanitize(`Certificado do aceite ${input.acceptanceId}, emitido pelo IndusCost a partir do registro eletrônico do aceite.`), "F1", 7, WIDTH), "F1", 7, MUTED);
    drawText(chrome, LEFT, 43, "A autenticidade é conferida pelo número do aceite e pelos hashes de integridade.", "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 63, `Página ${index + 1} de ${pages.length}`, "F1", 8, NAVY);
    return [...item.bg, ...chrome, ...item.fg].join("\n");
  });

  return assemblePdf(streams, `Certificado de aceite ${input.acceptanceId}`);
}
