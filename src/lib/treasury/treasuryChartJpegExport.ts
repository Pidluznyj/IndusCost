/**
 * Exportação de telas de gráfico da Tesouraria como JPEG de alta resolução.
 *
 * Por que JPEG e não window.print(): a impressão do navegador rasteriza no
 * motor de PDF com qualidade imprevisível; uma imagem com DPI explícito
 * (300/96, o MESMO fator do Relatório Presidencial) imprime nítida e o
 * usuário controla o aproveitamento da página.
 *
 * `html2canvas` já é dependência do projeto (Relatório Presidencial) e é
 * carregada SOB DEMANDA aqui também — nada entra no bundle inicial.
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
 * Captura o elemento como JPEG e dispara o download.
 * Browser-only; lança erro legível quando a captura falha.
 */
export async function exportTreasuryElementToJpeg(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  // Carregamento sob demanda — mesma estratégia do Relatório Presidencial.
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    scale: TREASURY_JPEG_EXPORT_SCALE,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", TREASURY_JPEG_QUALITY)
  );
  if (!blob) {
    throw new Error("Não foi possível gerar a imagem para impressão.");
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
