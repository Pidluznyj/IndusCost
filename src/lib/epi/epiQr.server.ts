/**
 * QR Code no servidor sem dependência nova: o `qrcode.react` (já usado nas impressões de RH)
 * renderiza o SVG; aqui os módulos do caminho viram retângulos para o PDF.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

export type QrMatrix = { size: number; rects: Array<{ x: number; y: number; w: number }> };

/** Módulos escuros da matriz (linha `y`, coluna `x`, largura `w` em módulos). */
export function qrMatrix(value: string): QrMatrix {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value, level: "M", marginSize: 0 }));
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!view) throw new Error("QR: viewBox ausente");
  const paths = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)];
  const dark = paths.find((p) => p[1].toUpperCase() !== "#FFFFFF");
  if (!dark) throw new Error("QR: módulos ausentes");
  const rects: QrMatrix["rects"] = [];
  for (const m of dark[2].matchAll(/M(\d+)[ ,](\d+)\s*h(\d+)v1H\d+z/g)) {
    rects.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) });
  }
  if (rects.length === 0) throw new Error("QR: caminho não reconhecido");
  return { size: Number(view[1]), rects };
}

/** Comandos PDF: QR com lado `side` pt, canto superior esquerdo em (x, top). */
export function qrPdfCommands(value: string, x: number, top: number, side: number): string[] {
  const { size, rects } = qrMatrix(value);
  const m = side / size;
  const r = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const out = ["q", "0 0 0 rg"];
  for (const rect of rects) {
    out.push(`${r(x + rect.x * m)} ${r(top - (rect.y + 1) * m)} ${r(rect.w * m)} ${r(m)} re f`);
  }
  out.push("Q");
  return out;
}
