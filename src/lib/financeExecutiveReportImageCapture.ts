/**
 * Captura das páginas do Relatório Presidencial como PNG em alta resolução —
 * parte que só roda no navegador (html2canvas + import `?raw` do Vite).
 * Lógica pura/testável fica em `financeExecutiveReportImageExport.ts`.
 *
 * Motivação: `window.print()` delega a rasterização ao motor de PDF do
 * navegador/impressora, que às vezes produz qualidade inferior à de uma
 * imagem gerada com DPI explícito. Esta captura re-lê o CSS de impressão
 * (`finance-executive-report-print.css`) do próprio arquivo fonte e o
 * injeta como um `<style>` comum (fora de `@media print`) durante a
 * captura, para que a página renderize em tela EXATAMENTE com o layout
 * paginado A4 paisagem que normalmente só existe ao imprimir. Não há
 * duplicação de regras: o texto vem do mesmo arquivo usado na impressão
 * real, extraído em tempo de execução via `extractMediaPrintBlocks`.
 */
import html2canvas from "html2canvas";
import executiveReportPrintCssRaw from "@/src/components/finance/executive-report/finance-executive-report-print.css?raw";
import {
  extractMediaPrintBlocks,
  type ExecutiveReportPageImage,
} from "@/src/lib/financeExecutiveReportImageExport";

/** 300 DPI equivalente a partir da base de 96 CSS px/polegada do navegador. */
const CAPTURE_SCALE = 300 / 96;

/** Largura útil A4 paisagem menos margem @page (297mm - 2×6mm). */
const PAGE_WIDTH_MM = 285;

const CAPTURE_STYLE_ELEMENT_ID = "executive-report-image-capture-style";

/**
 * Injeta o CSS de impressão extraído + o ajuste de largura que normalmente
 * vem de graça do contexto `@page` real (que não existe fora de impressão).
 * Retorna uma função de limpeza — SEMPRE chamar em `finally`.
 */
function activateCaptureStyles(): () => void {
  const style = document.createElement("style");
  style.id = CAPTURE_STYLE_ELEMENT_ID;
  const extracted = extractMediaPrintBlocks(executiveReportPrintCssRaw);
  style.textContent = `${extracted}
/* Largura da página — fora de impressão real não há contexto @page para
   fornecer isso automaticamente; overriding o width:100% herdado acima. */
.executive-report-print-root,
.finance-executive-report-document.executive-report-print-root {
  width: ${PAGE_WIDTH_MM}mm !important;
  max-width: ${PAGE_WIDTH_MM}mm !important;
}`;
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}

/**
 * Captura cada `.executive-print-page` como um PNG em alta resolução.
 * Pressupõe que o chamador já deixou o relatório em modo impressão
 * (pdfMode + `prepareExecutiveReportForPrint`/`waitForExecutiveReportChartsReady`
 * — mesma preparação usada antes de `window.print()`).
 */
export async function captureExecutiveReportPageImages(): Promise<ExecutiveReportPageImage[]> {
  const deactivate = activateCaptureStyles();
  try {
    // Duas frames para o navegador recalcular layout com o CSS injetado
    // (páginas ganham altura/largura fixas, gráficos redimensionam via CSS).
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => window.setTimeout(resolve, 250));

    const pages = Array.from(
      document.querySelectorAll<HTMLElement>(".executive-print-page")
    );
    if (pages.length === 0) {
      throw new Error("Nenhuma página do relatório encontrada para exportar.");
    }

    const images: ExecutiveReportPageImage[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      const pageId = page.getAttribute("data-print-page") ?? `pagina-${index + 1}`;
      const canvas = await html2canvas(page, {
        scale: CAPTURE_SCALE,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) {
        throw new Error(`Falha ao gerar imagem da página "${pageId}".`);
      }
      images.push({ pageId, index, blob });
    }
    return images;
  } finally {
    deactivate();
  }
}
