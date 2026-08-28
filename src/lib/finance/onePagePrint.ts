/**
 * One Page — paginação A4 e montagem de PDF (PURO: sem DOM, sem I/O).
 *
 * Problema real: a captura antiga saía como UMA imagem alta; na impressão o
 * driver encolhia tudo para caber numa folha e o relatório "ficava pequeno".
 * A solução divide a captura em PÁGINAS A4 exatas (794×1123 px lógicos a
 * 96dpi — proporção idêntica à folha), quebrando SEMPRE entre seções
 * (nunca no meio de um card) e completando a última página com fundo branco.
 * Cada arquivo tem a proporção exata do A4: imprimir em "ajustar à página"
 * preenche a folha inteira sem distorcer o layout.
 *
 * O PDF é montado aqui mesmo (PDF 1.4 mínimo com uma imagem JPEG/DCTDecode
 * por página) — sem dependência nova, testável em Node byte a byte.
 */

// A4 retrato em px lógicos de 96dpi (210×297 mm).
export const ONE_PAGE_A4_WIDTH_PX = 794;
export const ONE_PAGE_A4_HEIGHT_PX = 1123;
// A4 em pontos PDF (72 pt/polegada).
export const ONE_PAGE_A4_WIDTH_PT = 595.28;
export const ONE_PAGE_A4_HEIGHT_PT = 841.89;

export type OnePagePrintBlock = {
  /** Distância do topo da folha lógica (px CSS). */
  top: number;
  height: number;
};

export type OnePagePrintSlice = {
  startY: number;
  endY: number;
};

/**
 * Divide a folha lógica em páginas A4 quebrando ENTRE blocos (seções):
 *  - bloco que não cabe no restante da página abre página nova;
 *  - bloco maior que uma página inteira é fatiado em altura de página
 *    (fallback — nenhum layout se perde, só não há onde quebrar melhor);
 *  - a última página termina no fim do conteúdo (o chamador pinta o
 *    restante de branco para fechar a proporção A4).
 */
export function computeOnePagePrintSlices(
  blocks: readonly OnePagePrintBlock[],
  totalHeight: number,
  pageHeight: number = ONE_PAGE_A4_HEIGHT_PX
): OnePagePrintSlice[] {
  const total = Math.max(0, Math.ceil(totalHeight));
  if (total === 0 || pageHeight <= 0) return [];

  const sorted = [...blocks]
    .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.height) && b.height > 0)
    .sort((a, b) => a.top - b.top);

  const breaks: number[] = [0];
  let pageStart = 0;
  for (const block of sorted) {
    const blockEnd = block.top + block.height;
    if (blockEnd - pageStart <= pageHeight) continue; // cabe na página atual
    if (block.top > pageStart) {
      // Quebra ANTES do bloco: a seção inteira desce para a próxima página.
      pageStart = Math.floor(block.top);
      breaks.push(pageStart);
    }
    // Seção maior que a própria página: fatia dura por altura de página.
    while (blockEnd - pageStart > pageHeight) {
      pageStart += pageHeight;
      breaks.push(pageStart);
    }
  }
  while (total - pageStart > pageHeight) {
    pageStart += pageHeight;
    breaks.push(pageStart);
  }

  const slices: OnePagePrintSlice[] = [];
  for (let i = 0; i < breaks.length; i += 1) {
    const startY = breaks[i]!;
    const endY = Math.min(total, i + 1 < breaks.length ? breaks[i + 1]! : total);
    if (endY > startY) slices.push({ startY, endY });
  }
  return slices;
}

/** Nome do arquivo: prefixo + data civil local (+ página quando há várias). */
export function buildOnePagePrintFileName(
  prefix: string,
  extension: "jpg" | "pdf",
  options?: { page?: number; totalPages?: number; now?: Date }
): string {
  const now = options?.now ?? new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const safePrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const pageSuffix =
    options?.page != null && (options.totalPages ?? 1) > 1
      ? `-pagina-${options.page}-de-${options.totalPages}`
      : "";
  return `${safePrefix || "relatorio"}-${y}-${m}-${d}${pageSuffix}.${extension}`;
}

// ─── PDF 1.4 mínimo (uma imagem JPEG por página A4) ─────────────────────────

export type OnePagePdfPage = {
  /** Bytes crus do JPEG (DCTDecode) — exatamente como saem do canvas. */
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
};

const PDF_ENCODER = new TextEncoder();

function pdfNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Monta um PDF A4 retrato com uma página por imagem: a imagem ocupa a
 * LARGURA inteira da folha, ancorada no topo (nossas páginas já têm a
 * proporção exata do A4, então preenchem a folha por completo).
 */
export function buildOnePageA4PdfBytes(pages: readonly OnePagePdfPage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error("PDF sem páginas — nada para montar.");
  }
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = []; // por número de objeto (1-based)

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushText = (text: string) => push(PDF_ENCODER.encode(text));
  const beginObj = (num: number) => {
    offsets[num] = offset;
    pushText(`${num} 0 obj\n`);
  };

  pushText("%PDF-1.4\n%âãÏÓ\n");

  // Objetos: 1=Catalog, 2=Pages, depois por página i: page=3+3i,
  // content=4+3i, image=5+3i.
  const pageObjNum = (i: number) => 3 + i * 3;
  const contentObjNum = (i: number) => 4 + i * 3;
  const imageObjNum = (i: number) => 5 + i * 3;
  const totalObjs = 2 + pages.length * 3;

  beginObj(1);
  pushText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  beginObj(2);
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");
  pushText(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    // Imagem na largura da folha, proporção preservada, ancorada no topo.
    const drawWidth = ONE_PAGE_A4_WIDTH_PT;
    const drawHeight = (page.heightPx / page.widthPx) * drawWidth;
    const drawY = ONE_PAGE_A4_HEIGHT_PT - drawHeight;

    beginObj(pageObjNum(i));
    pushText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(ONE_PAGE_A4_WIDTH_PT)} ${pdfNumber(ONE_PAGE_A4_HEIGHT_PT)}] ` +
        `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im${i} ${imageObjNum(i)} 0 R >> >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>\nendobj\n`
    );

    const content = `q\n${pdfNumber(drawWidth)} 0 0 ${pdfNumber(drawHeight)} 0 ${pdfNumber(drawY)} cm\n/Im${i} Do\nQ\n`;
    const contentBytes = PDF_ENCODER.encode(content);
    beginObj(contentObjNum(i));
    pushText(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    pushText("endstream\nendobj\n");

    beginObj(imageObjNum(i));
    pushText(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    pushText("\nendstream\nendobj\n");
  });

  const xrefStart = offset;
  pushText(`xref\n0 ${totalObjs + 1}\n`);
  pushText("0000000000 65535 f \n");
  for (let num = 1; num <= totalObjs; num += 1) {
    pushText(`${String(offsets[num] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  pushText(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
