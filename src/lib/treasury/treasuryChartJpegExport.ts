/**
 * Exportação de telas de gráfico da Tesouraria como JPEG de alta resolução.
 *
 * Por que JPEG e não window.print(): a impressão do navegador rasteriza no
 * motor de PDF com qualidade imprevisível; uma imagem com DPI explícito
 * (300/96, o MESMO fator do Relatório Presidencial) imprime nítida e o
 * usuário controla o aproveitamento da página.
 *
 * Por que `html-to-image` e NÃO `html2canvas`: o html2canvas reimplementa o
 * parser de CSS e NÃO entende as cores `oklch()` dos tokens de tema do
 * Tailwind — na homologação a captura falhava com "Attempting to parse an
 * unsupported color function \"oklch\"" e nenhum arquivo era gerado. O
 * html-to-image serializa o DOM em SVG (foreignObject) e deixa o PRÓPRIO
 * navegador rasterizar — qualquer CSS que a tela renderiza sai igual na
 * imagem. Carregado SOB DEMANDA — nada entra no bundle inicial.
 * (O Relatório Presidencial continua no html2canvas: o CSS de impressão
 * dele não usa oklch e já está validado.)
 *
 * JPEG não tem canal alfa: o fundo é SEMPRE pintado de branco, senão as
 * áreas transparentes sairiam pretas na impressão.
 */

/** 300 DPI equivalente a partir da base de 96 CSS px/polegada do navegador. */
export const TREASURY_JPEG_EXPORT_SCALE = 300 / 96;

/** Qualidade JPEG — 0.95 preserva textos finos dos eixos sem inflar o arquivo. */
export const TREASURY_JPEG_QUALITY = 0.95;

/** Nome do arquivo: prefixo + data civil local (AAAA-MM-DD). */
export function buildTreasuryJpegFileName(
  prefix: string,
  now: Date = new Date()
): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const safePrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safePrefix || "grafico"}-${y}-${m}-${d}.jpg`;
}

/**
 * Captura o elemento como JPEG e SALVA o arquivo na máquina (Downloads) —
 * o usuário abre a imagem e imprime de lá.
 * Browser-only; lança erro legível quando a captura falha.
 */
export async function exportTreasuryElementToJpeg(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  // Carregamento sob demanda — chunk separado, fora do bundle inicial.
  const { toJpeg } = await import("html-to-image");
  const dataUrl = await toJpeg(element, {
    quality: TREASURY_JPEG_QUALITY,
    pixelRatio: TREASURY_JPEG_EXPORT_SCALE,
    backgroundColor: "#ffffff",
  });
  if (!dataUrl || !dataUrl.startsWith("data:image/jpeg")) {
    throw new Error("Não foi possível gerar a imagem para impressão.");
  }
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}
