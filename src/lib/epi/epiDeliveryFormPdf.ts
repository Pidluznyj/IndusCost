/**
 * PDF da Ficha de Entrega de EPI / Uniforme (um EVENTO, um ou mais itens) — gerado no servidor a partir do
 * conteúdo congelado. Reaproveita o motor de PDF institucional (Política Comercial / Projetos: Helvetica/WinAnsi,
 * tabelas com cabeçalho repetido, logo das Configurações de Marca, "Página X de Y", verificação SHA-256).
 * Sem dependência nova. Número da ficha no cabeçalho de TODAS as páginas.
 */
import {
  AMBER,
  assemblePdf,
  drawLine,
  drawText,
  drawTextRight,
  fitText,
  Flow,
  LEFT,
  MUTED,
  n,
  NAVY,
  RED,
  RIGHT,
  RULE,
  sanitize,
  TEXT,
  WIDTH,
} from "../commercialPolicy/commercialPolicyControlledCopyPdf.js";
import { escapePdfText } from "../commercialPolicy/commercialPolicyPdf.js";
import { pdfImageFromDataUrl } from "../pdf/pdfImage.js";
import { EPI_FORM_TITLE, epiFormQrPayload, type EpiFormPayload } from "./epiForm.js";
import { EPI_ITEM_TYPE_LABELS, EPI_UNIT_LABELS, isEpiItemType, isEpiUnit } from "./epiRules.js";
import { qrPdfCommands } from "./epiQr.server.js";

const dateBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const dateTimeBr = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const or = (v: string | null | undefined, fallback = "—") => (v && String(v).trim() ? String(v).trim() : fallback);

export const EPI_FORM_SUPERSEDED_STAMP = "REVISÃO SUBSTITUÍDA";

function supersededWatermark(): string[] {
  const cos = 0.8192;
  const sin = 0.5736;
  return [
    "q",
    `BT /F2 44 Tf 0.9 g ${cos} ${sin} -${sin} ${cos} 120 260 Tm (${escapePdfText(sanitize(EPI_FORM_SUPERSEDED_STAMP))}) Tj ET`,
    "Q",
  ];
}

export function buildEpiDeliveryFormPdf(
  payload: EpiFormPayload,
  options: { sha256: string; superseded?: boolean; activeDocumentNumber?: string | null },
): Buffer {
  const { header, body } = payload;
  const logo = pdfImageFromDataUrl(header.issuer.logoDataUrl);
  const qrSide = 78;
  const flow = new Flow(742);
  const textWidth = WIDTH - qrSide - 16;

  // ── Título + QR (canto superior direito da 1ª página) ──
  const qrTop = 742;
  flow.paragraph(EPI_FORM_TITLE, { font: "F2", size: 16, leading: 20, color: NAVY, width: textWidth });
  flow.paragraph(`Nº ${header.documentNumber}`, { font: "F2", size: 11, color: AMBER, width: textWidth });
  flow.paragraph(`Emissão: ${dateTimeBr(header.issuedAt)}${header.issuedByName ? ` por ${header.issuedByName}` : ""}`, {
    size: 9.5,
    color: MUTED,
    width: textWidth,
  });
  if (header.previousDocumentNumber) {
    flow.paragraph(`Revisão ${header.revision}: substitui ${header.previousDocumentNumber} (dados da entrega corrigidos).`, {
      size: 9.5,
      color: MUTED,
      width: textWidth,
    });
  }
  if (options.superseded) {
    flow.paragraph(
      `Esta revisão foi substituída${options.activeDocumentNumber ? ` por ${options.activeDocumentNumber}` : ""}. Não colha assinatura nela.`,
      { font: "F2", size: 9.5, color: RED, width: textWidth },
    );
  }
  flow.y = Math.min(flow.y, qrTop - qrSide - 14);
  flow.page.fg.push(...qrPdfCommands(epiFormQrPayload(header.documentNumber, header.formId), RIGHT - qrSide, qrTop, qrSide));
  drawTextRight(flow.page.fg, RIGHT, qrTop - qrSide - 10, sanitize(header.documentNumber), "F1", 7, MUTED);

  // ── Colaborador e entrega ──
  flow.label("Identificação do colaborador");
  flow.table(
    [
      ["Nome completo", body.employee.name, "Data da entrega", dateBr(body.event.deliveredOn)],
      ["Cargo / função", or(body.employee.role), "Departamento / setor", or(body.employee.department)],
      ["Matrícula (código interno)", body.employee.registration, "Responsável pela entrega", or(body.event.responsibleName)],
    ],
    { header: false, boldColumns: [0, 2] },
  );

  // ── Itens (retrato gravado em cada item da entrega) ──
  flow.label(`Itens entregues (${body.items.length})`);
  flow.table(
    [
      ["Código", "Descrição", "Tipo", "Qtd.", "Unidade", "CA", "Próxima troca"],
      ...body.items.map((it) => [
        or(it.itemCode),
        it.size ? `${it.item} (tam. ${it.size})` : it.item,
        isEpiItemType(it.itemType) ? EPI_ITEM_TYPE_LABELS[it.itemType] : or(it.itemType),
        String(it.quantity),
        isEpiUnit(it.unit) ? EPI_UNIT_LABELS[it.unit] : or(it.unit),
        or(it.caNumber, "Não se aplica"),
        it.replacementDueDate ? dateBr(it.replacementDueDate) : "Sem troca programada",
      ]),
    ],
    { header: true },
  );
  if (body.event.notes) {
    flow.label("Observações da entrega");
    flow.paragraph(body.event.notes, { size: 10, justify: true });
  }
  flow.paragraph("Próxima troca: periodicidade definida pela empresa para cada item. O CA identifica o EPI aprovado e não indica validade.", {
    size: 8,
    leading: 10,
    color: MUTED,
  });

  // ── Declaração ──
  flow.label("Declaração de recebimento");
  flow.paragraph(body.declaration, { size: 11, leading: 16, justify: true, gapAfter: 4 });

  // ── Assinaturas (bloco inteiro na mesma página, ≈140 pt) ──
  flow.ensure(135);
  flow.gap(32);
  const colW = (WIDTH - 40) / 2;
  const sigY = flow.y;
  drawLine(flow.page.fg, LEFT, sigY, LEFT + colW, sigY, TEXT, 0.8);
  drawLine(flow.page.fg, LEFT + colW + 40, sigY, RIGHT, sigY, TEXT, 0.8);
  drawText(flow.page.fg, LEFT, sigY - 13, "Assinatura do colaborador", "F2", 9.5, TEXT);
  drawText(flow.page.fg, LEFT, sigY - 26, fitText(sanitize(body.employee.name), "F1", 9, colW), "F1", 9, MUTED);
  drawText(flow.page.fg, LEFT + colW + 40, sigY - 13, "Assinatura do responsável pela entrega", "F2", 9.5, TEXT);
  drawText(flow.page.fg, LEFT + colW + 40, sigY - 26, fitText(sanitize(or(body.event.responsibleName, "")), "F1", 9, colW), "F1", 9, MUTED);
  flow.y = sigY - 50;
  drawText(flow.page.fg, LEFT, flow.y, "Data do recebimento:  ______ / ______ / ____________", "F1", 10.5, TEXT);
  flow.gap(16);
  flow.paragraph(
    `Depois de assinada, digitalize esta ficha e anexe-a no IndusCost informando o número ${header.documentNumber} (ou lendo o QR Code). A ficha impressa sem assinatura não comprova o recebimento.`,
    { size: 8.5, leading: 12, color: MUTED, justify: true },
  );

  // ── Cabeçalho institucional e rodapé em todas as páginas ──
  const pages = flow.pages;
  const issuerName = or(header.issuer.legalName, "Emitente não configurado");
  const issuerLine = [header.issuer.document ? `CNPJ ${header.issuer.document}` : null, header.issuer.phone, header.issuer.email, header.issuer.website]
    .filter(Boolean)
    .join("  ·  ");
  const logoBox = { w: 96, h: 34 };
  let logoW = 0;
  let logoH = 0;
  if (logo) {
    const scale = Math.min(logoBox.w / logo.width, logoBox.h / logo.height);
    logoW = logo.width * scale;
    logoH = logo.height * scale;
  }
  const textX = logo ? LEFT + logoW + 10 : LEFT;
  const streams = pages.map((page, index) => {
    const chrome: string[] = [];
    if (logo) chrome.push(`q ${n(logoW)} 0 0 ${n(logoH)} ${n(LEFT)} ${n(808 - logoH / 2 - 2)} cm /Im1 Do Q`);
    drawText(chrome, textX, 812, fitText(sanitize(issuerName), "F2", 10, 300), "F2", 10, NAVY);
    if (header.issuer.address) drawText(chrome, textX, 801, fitText(sanitize(header.issuer.address), "F1", 7, 300), "F1", 7, MUTED);
    if (issuerLine) drawText(chrome, textX, 791, fitText(sanitize(issuerLine), "F1", 7, 300), "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 812, sanitize("Ficha de entrega de EPI / uniforme"), "F2", 9, NAVY);
    drawTextRight(chrome, RIGHT, 801, sanitize(header.documentNumber), "F2", 8, AMBER);
    drawLine(chrome, LEFT, 782, RIGHT, 782, NAVY, 1.2);
    drawLine(chrome, LEFT, 74, RIGHT, 74, RULE, 0.6);
    const issued = `Documento ${header.documentNumber} · revisão ${header.revision} · emitido em ${dateTimeBr(header.issuedAt)}${
      header.issuedByName ? ` por ${header.issuedByName}` : ""
    }`;
    drawText(chrome, LEFT, 63, fitText(sanitize(issued), "F1", 7, WIDTH - 70), "F1", 7, MUTED);
    drawText(chrome, LEFT, 53, fitText(sanitize(`Verificação SHA-256: ${options.sha256.slice(0, 16)}…`), "F1", 7, WIDTH - 70), "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 63, `Página ${index + 1} de ${pages.length}`, "F1", 8, NAVY);
    return [...page.bg, ...(options.superseded ? supersededWatermark() : []), ...chrome, ...page.fg].join("\n");
  });
  return assemblePdf(streams, `${header.documentNumber} — ${EPI_FORM_TITLE}`, logo ? [logo] : []);
}

export function epiDeliveryFormPdfFilename(documentNumber: string, employeeName: string): string {
  const who = employeeName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${documentNumber}${who ? `-${who}` : ""}.pdf`;
}
