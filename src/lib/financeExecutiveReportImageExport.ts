/**
 * Exportação do Relatório Presidencial como imagens (PNG) — parte pura e
 * testável sob Node (sem `html2canvas` nem import `?raw` do Vite, que só
 * resolvem no bundler do navegador). A captura em si vive em
 * `financeExecutiveReportImageCapture.ts`.
 */
import JSZip from "jszip";

const PAGE_LABELS: Record<string, string> = {
  cover: "capa",
  summary: "resumo",
  "sales-orders": "pedidos-de-venda",
  "billing-comparison": "faturamento",
  "accounts-receivable": "contas-a-receber",
  "accounts-payable": "contas-a-pagar",
  "cash-flow": "fluxo-de-caixa",
  "cost-center-spending": "centros-de-custo",
  "cash-flow-monthly-timeline": "fluxo-de-caixa-mensal",
  "cash-radar": "radar-diario-caixa",
};

export function executiveReportPageLabel(pageId: string): string {
  return PAGE_LABELS[pageId] ?? pageId;
}

/**
 * Extrai o conteúdo (sem o cabeçalho `@media print {` nem a chave de
 * fechamento) de todos os blocos `@media print { ... }` de um texto CSS,
 * respeitando aninhamento de chaves. Ignora `@page` e `@media screen`
 * (o segundo esconde cabeçalho/rodapé de impressão — o oposto do que a
 * captura precisa).
 */
export function extractMediaPrintBlocks(css: string): string {
  const marker = "@media print";
  const blocks: string[] = [];
  let searchFrom = 0;

  while (true) {
    const idx = css.indexOf(marker, searchFrom);
    if (idx === -1) break;
    const braceStart = css.indexOf("{", idx);
    if (braceStart === -1) break;

    let depth = 1;
    let i = braceStart + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    if (depth !== 0) break; // chaves desbalanceadas — não injeta CSS quebrado.

    blocks.push(css.slice(braceStart + 1, i - 1));
    searchFrom = i;
  }

  return blocks.join("\n");
}

export type ExecutiveReportPageImage = {
  pageId: string;
  index: number;
  blob: Blob;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export async function buildExecutiveReportImagesZip(
  images: ExecutiveReportPageImage[]
): Promise<Blob> {
  const zip = new JSZip();
  for (const image of images) {
    const filename = `${pad2(image.index + 1)}-${executiveReportPageLabel(image.pageId)}.png`;
    zip.file(filename, image.blob);
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildExecutiveReportImagesZipFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `relatorio-presidencial-imagens-${y}-${m}-${d}.zip`;
}
