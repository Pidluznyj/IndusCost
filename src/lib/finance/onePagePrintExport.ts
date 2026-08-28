/**
 * One Page — exportação A4 (JPEG multipágina e PDF paginado). Browser-only.
 *
 * Mesmo motor de captura oficial das telas de Tesouraria (html-to-image SOB
 * DEMANDA — nunca html2canvas, que quebra com as cores oklch do tema): a
 * folha off-screen de 794px é capturada UMA vez a 300 DPI e depois fatiada
 * em páginas de proporção A4 exata, quebrando entre as seções marcadas com
 * `data-print-block` (nunca no meio de um card). A última página é
 * completada com branco — todo arquivo preenche a folha na impressão.
 *
 *  - JPEG: 1 arquivo por página (uma página = um arquivo, sem sufixo;
 *    várias = "-pagina-N-de-M").
 *  - PDF: um único arquivo com todas as páginas A4 (montado em
 *    onePagePrint.ts, sem dependência nova).
 */

import {
  ONE_PAGE_A4_HEIGHT_PX,
  buildOnePageA4PdfBytes,
  buildOnePagePrintFileName,
  computeOnePagePrintSlices,
  type OnePagePdfPage,
  type OnePagePrintBlock,
} from "./onePagePrint.js";

/** 300 DPI a partir dos 96 CSS px/polegada (mesmo fator da Tesouraria). */
export const ONE_PAGE_PRINT_SCALE = 300 / 96;
export const ONE_PAGE_PRINT_JPEG_QUALITY = 0.95;

export type OnePagePrintFormat = "jpeg" | "pdf";

function collectPrintBlocks(element: HTMLElement): OnePagePrintBlock[] {
  const rootTop = element.getBoundingClientRect().top;
  return Array.from(element.querySelectorAll<HTMLElement>("[data-print-block]")).map(
    (node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top - rootTop, height: rect.height };
    }
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function triggerDownload(href: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captura a folha e baixa o resultado ajustado ao A4.
 * Devolve quantas páginas foram geradas (o chamador informa o usuário).
 */
export async function exportOnePageElementToA4(
  element: HTMLElement,
  format: OnePagePrintFormat,
  filePrefix: string
): Promise<{ pages: number }> {
  // Sob demanda — chunk separado, nada no bundle inicial.
  const { toCanvas } = await import("html-to-image");
  const canvas = await toCanvas(element, {
    pixelRatio: ONE_PAGE_PRINT_SCALE,
    backgroundColor: "#ffffff",
  });
  if (!canvas.width || !canvas.height) {
    throw new Error("Não foi possível capturar o relatório para impressão.");
  }

  const logicalWidth = element.getBoundingClientRect().width;
  // Fator REAL aplicado pela captura (imune a arredondamentos internos).
  const scale = canvas.width / logicalWidth;
  const logicalHeight = canvas.height / scale;

  const slices = computeOnePagePrintSlices(
    collectPrintBlocks(element),
    logicalHeight,
    ONE_PAGE_A4_HEIGHT_PX
  );
  if (slices.length === 0) {
    throw new Error("Relatório vazio — nada para exportar.");
  }

  // Toda página tem a MESMA altura A4: proporção exata da folha, com o
  // excedente da última página pintado de branco.
  const pageHeightDevice = Math.round(ONE_PAGE_A4_HEIGHT_PX * scale);
  const pageCanvases = slices.map((slice) => {
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = pageHeightDevice;
    const ctx = page.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível neste navegador.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.width, page.height);
    const sourceY = Math.round(slice.startY * scale);
    const sourceH = Math.min(
      Math.round((slice.endY - slice.startY) * scale),
      canvas.height - sourceY
    );
    if (sourceH > 0) {
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceH,
        0,
        0,
        canvas.width,
        sourceH
      );
    }
    return page;
  });

  if (format === "jpeg") {
    for (let i = 0; i < pageCanvases.length; i += 1) {
      const dataUrl = pageCanvases[i]!.toDataURL(
        "image/jpeg",
        ONE_PAGE_PRINT_JPEG_QUALITY
      );
      triggerDownload(
        dataUrl,
        buildOnePagePrintFileName(filePrefix, "jpg", {
          page: i + 1,
          totalPages: pageCanvases.length,
        })
      );
      // Downloads em rajada no mesmo tick podem ser descartados pelo browser.
      if (i < pageCanvases.length - 1) await delay(350);
    }
    return { pages: pageCanvases.length };
  }

  const pdfPages: OnePagePdfPage[] = pageCanvases.map((page) => ({
    jpeg: dataUrlToBytes(page.toDataURL("image/jpeg", ONE_PAGE_PRINT_JPEG_QUALITY)),
    widthPx: page.width,
    heightPx: page.height,
  }));
  const pdfBytes = buildOnePageA4PdfBytes(pdfPages);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, buildOnePagePrintFileName(filePrefix, "pdf"));
  } finally {
    // Revogação adiada: o download precisa começar antes de soltar o blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { pages: pdfPages.length };
}
