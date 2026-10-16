/**
 * Impressão dos certificados emitidos: documento HTML isolado num iframe (sem o CSS do app),
 * A4 paisagem, uma página por certificado. O conteúdo é o congelado na emissão.
 *
 * Fontes Lato e Ubuntu (subconjunto latino) embutidas no sistema — as de 400/500/700 são as
 * mesmas da arte de Comunicados; 300 (título e nome) ficam em `./assets`.
 */
import { fetchTrainingCertificatesDocument } from "@/src/lib/competencies/competencyClient";
import { renderTrainingCertificatesHtml } from "@/src/lib/competencies/trainingCertificate";
import lato300 from "./assets/lato-300.woff2";
import ubuntu300 from "./assets/ubuntu-300.woff2";
import lato400 from "../../commercial/announcements/assets/lato-400.woff2";
import lato700 from "../../commercial/announcements/assets/lato-700.woff2";
import ubuntu400 from "../../commercial/announcements/assets/ubuntu-400.woff2";
import ubuntu500 from "../../commercial/announcements/assets/ubuntu-500.woff2";
import ubuntu700 from "../../commercial/announcements/assets/ubuntu-700.woff2";

const FONTS: { family: string; weight: number; url: string }[] = [
  { family: "Lato", weight: 300, url: lato300 },
  { family: "Lato", weight: 400, url: lato400 },
  { family: "Lato", weight: 700, url: lato700 },
  { family: "Ubuntu", weight: 300, url: ubuntu300 },
  { family: "Ubuntu", weight: 400, url: ubuntu400 },
  { family: "Ubuntu", weight: 500, url: ubuntu500 },
  { family: "Ubuntu", weight: 700, url: ubuntu700 },
];

export function certificateFontFaceCss(base: string = window.location.href): string {
  return FONTS.map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;src:url("${new URL(f.url, base).href}") format('woff2');}`,
  ).join("\n");
}

export class CertificateIntegrityError extends Error {}

/** Busca o conteúdo congelado e confere a integridade antes de imprimir. */
export async function loadCertificatesHtml(trainingId: string, ids: string[] | null, title: string): Promise<string> {
  const doc = await fetchTrainingCertificatesDocument(trainingId, ids);
  const broken = doc.certificates.filter((c) => !c.integrity.verified).map((c) => c.number);
  if (broken.length > 0) {
    throw new CertificateIntegrityError(
      `Certificado(s) ${broken.join(", ")} não confere(m) com o registro de emissão. Impressão bloqueada — acione o suporte.`,
    );
  }
  if (doc.certificates.length === 0) throw new Error("Nenhum certificado emitido para imprimir.");
  return renderTrainingCertificatesHtml(
    doc.certificates.map((c) => c.payload),
    { title, fontFaceCss: certificateFontFaceCss() },
  );
}

/** Imprime num iframe oculto; espera fontes e imagens para não sair com fonte de fallback. */
export async function printCertificatesHtml(html: string): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error("Não foi possível preparar a impressão.");
    await doc.fonts?.ready;
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete ? Promise.resolve() : new Promise<void>((r) => ((img.onload = () => r()), (img.onerror = () => r()))),
      ),
    );
    win.focus();
    win.print();
  } finally {
    // O diálogo de impressão é síncrono na maioria dos navegadores; remove depois.
    window.setTimeout(() => frame.remove(), 1000);
  }
}

export async function printTrainingCertificates(trainingId: string, ids: string[] | null, title: string): Promise<void> {
  await printCertificatesHtml(await loadCertificatesHtml(trainingId, ids, title));
}
