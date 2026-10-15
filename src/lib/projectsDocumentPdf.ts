/**
 * Projetos — PDF da Proposta Cliente a partir do conteúdo emitido (servidor).
 *
 * Usa o motor de PDF da Política Comercial (Helvetica/WinAnsi com métricas reais, quebra de
 * linha, tabelas com cabeçalho repetido, "Página X de Y") + logo das Configurações de Marca
 * (JPEG/PNG via pdfImage). Sem dependência nova. Nunca recalcula valores: imprime o envelope.
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
  WIDTH,
} from "./commercialPolicy/commercialPolicyControlledCopyPdf.js";
import { escapePdfText } from "./commercialPolicy/commercialPolicyPdf.js";
import { pdfImageFromDataUrl } from "./pdf/pdfImage.js";
import { formatDocumentDateTime, type ProjectDocumentEnvelope } from "./projectsDocumentHeader.js";
import { COMMERCIAL_TERM_UNDEFINED } from "./projectsCommercialTerms.js";
import {
  PROJECT_CLIENT_REPORT_MONTHLY_VALUE_LABEL,
  PROJECT_CLIENT_REPORT_MONTHLY_VOLUME_LABEL,
  type ProjectClientReportPayload,
} from "./projectsClientReportShared.js";
import { clientReportPdfContainsInternalTerms } from "./projectsClientReport.js";

const brl = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? COMMERCIAL_TERM_UNDEFINED : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const or = (v: string | null | undefined, fallback = COMMERCIAL_TERM_UNDEFINED) => (v && v.trim() ? v.trim() : fallback);
const dateBr = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : null;

export const PROJECT_PROPOSAL_PDF_PREVIEW_STAMP = "PRÉVIA — SEM VALOR DE EMISSÃO";

function previewWatermark(): string[] {
  const cos = 0.8192;
  const sin = 0.5736;
  return [
    "q",
    "0 Tw",
    `BT /F2 40 Tf 0.9 g ${cos} ${sin} -${sin} ${cos} 110 250 Tm (${escapePdfText(sanitize(PROJECT_PROPOSAL_PDF_PREVIEW_STAMP))}) Tj ET`,
    "Q",
  ];
}

export function buildProjectProposalPdf(
  envelope: ProjectDocumentEnvelope<ProjectClientReportPayload>,
  options: { sha256?: string | null } = {},
): Buffer {
  const { header, body } = envelope;
  const issued = header.status === "ISSUED";
  const logo = pdfImageFromDataUrl(header.issuer.logoDataUrl);

  const flow = new Flow(742);
  // ── Identificação ──
  flow.paragraph(header.documentTitle.toUpperCase(), { font: "F2", size: 18, leading: 22, color: NAVY });
  flow.paragraph(`${header.project.code} — ${header.project.title}`, { font: "F2", size: 10.5, color: AMBER, gapAfter: 4 });
  if (!issued) flow.paragraph(PROJECT_PROPOSAL_PDF_PREVIEW_STAMP, { font: "F2", size: 9, color: RED, gapAfter: 2 });

  const registry = header.customer.registry;
  const customerAddress = registry
    ? [registry.address, [registry.city, registry.state].filter(Boolean).join("/"), registry.zipCode ? `CEP ${registry.zipCode}` : null]
        .filter(Boolean)
        .join(" — ")
    : null;
  flow.label("Cliente");
  flow.table(
    [
      ["Razão social", or(registry?.companyName ?? header.customer.name, "—")],
      ["CNPJ/CPF", or(header.customer.document, "Não informado")],
      ...(registry?.stateTaxId ? [["Inscrição estadual", registry.stateTaxId]] : []),
      ...(customerAddress ? [["Endereço", customerAddress]] : []),
      ...(registry?.contactName || registry?.email || registry?.phone
        ? [["Contato", [registry?.contactName, registry?.email, registry?.phone].filter(Boolean).join(" · ")]]
        : []),
    ],
    { header: false, boldFirstColumn: true },
  );

  flow.label("Documento");
  flow.table(
    [
      ["Número / revisão", issued ? `${header.documentNumber} · revisão ${header.revision}` : "Prévia (não emitido)"],
      [issued ? "Emissão" : "Gerado", `${formatDocumentDateTime(header.issuedAt)} por ${header.issuedBy.name}`],
      ["Responsável comercial", or(body.project.commercialResponsibleName, "Não informado")],
      ["Validade", body.project.validUntil ? `até ${dateBr(body.project.validUntil)}` : COMMERCIAL_TERM_UNDEFINED],
      ["Base de valores", `${header.values.modeLabel}${header.values.pricingSavedAt ? ` (${formatDocumentDateTime(header.values.pricingSavedAt)})` : ""}`],
    ],
    { header: false, boldFirstColumn: true },
  );

  // ── Itens ──
  flow.label("Produtos / peças");
  flow.table(
    [
      ["Item", "Código", "Descrição", "Qtd./conj.", "Un.", "Preço unitário", "Total"],
      ...body.products.map((p, i) => [
        String(i + 1),
        or(p.sku, "—"),
        p.name,
        String(p.quantityPerSet),
        p.unit,
        brl(p.finalUnitPrice),
        brl(p.finalTotalPrice),
      ]),
    ],
    { header: true },
  );
  flow.table(
    [
      [body.summary.finalSetPriceLabel, brl(body.summary.finalSetPrice)],
      ...(body.summary.estimatedQuantity != null
        ? [
            [PROJECT_CLIENT_REPORT_MONTHLY_VOLUME_LABEL, body.summary.estimatedQuantity.toLocaleString("pt-BR")],
            [PROJECT_CLIENT_REPORT_MONTHLY_VALUE_LABEL, brl(body.summary.totalProposalValue)],
          ]
        : []),
    ],
    { header: false, boldFirstColumn: true },
  );

  // ── Condições comerciais (não definidas aparecem "A definir") ──
  const t = body.commercialTerms;
  flow.label("Condições comerciais");
  flow.table(
    [
      ["Validade da proposta", or(t.proposalValidity)],
      ["Condição de pagamento", or(t.paymentTerms)],
      ["Entrega", or(t.deliveryTerms)],
      ["Frete", or(t.freightTerms)],
    ],
    { header: false, boldFirstColumn: true },
  );
  if (t.notes) {
    flow.label("Observações");
    flow.paragraph(t.notes, { justify: true, gapAfter: 4 });
  }
  flow.gap(6);
  flow.paragraph(body.disclaimer, { size: 8.5, leading: 12, color: MUTED, justify: true });

  // ── Cabeçalho e rodapé em todas as páginas ──
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
  const docRef = header.documentNumber ? `${header.documentNumber}` : "PRÉVIA";
  const verification = options.sha256 ? `Verificação SHA-256: ${options.sha256.slice(0, 16)}…` : "Prévia: sem registro de emissão";

  const streams = pages.map((page, index) => {
    const chrome: string[] = [];
    if (logo) chrome.push(`q ${n(logoW)} 0 0 ${n(logoH)} ${n(LEFT)} ${n(808 - logoH / 2 - 2)} cm /Im1 Do Q`);
    drawText(chrome, textX, 812, fitText(sanitize(issuerName), "F2", 10, 300), "F2", 10, NAVY);
    if (header.issuer.address) drawText(chrome, textX, 801, fitText(sanitize(header.issuer.address), "F1", 7, 300), "F1", 7, MUTED);
    if (issuerLine) drawText(chrome, textX, 791, fitText(sanitize(issuerLine), "F1", 7, 300), "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 812, sanitize(header.documentTitle), "F2", 9, NAVY);
    drawTextRight(chrome, RIGHT, 801, sanitize(docRef), "F2", 8, AMBER);
    drawLine(chrome, LEFT, 782, RIGHT, 782, NAVY, 1.2);

    drawLine(chrome, LEFT, 74, RIGHT, 74, RULE, 0.6);
    const issuedLine = issued
      ? `Documento ${docRef} · revisão ${header.revision} · emitido em ${formatDocumentDateTime(header.issuedAt)} por ${header.issuedBy.name}`
      : `${PROJECT_PROPOSAL_PDF_PREVIEW_STAMP} · gerado em ${formatDocumentDateTime(header.issuedAt)}`;
    drawText(chrome, LEFT, 63, fitText(sanitize(issuedLine), "F1", 7, WIDTH - 70), "F1", 7, MUTED);
    drawText(chrome, LEFT, 53, fitText(sanitize(verification), "F1", 7, WIDTH - 70), "F1", 7, MUTED);
    drawTextRight(chrome, RIGHT, 63, `Página ${index + 1} de ${pages.length}`, "F1", 8, NAVY);
    const watermark = issued ? [] : previewWatermark();
    return [...page.bg, ...watermark, ...chrome, ...page.fg].join("\n");
  });

  // Verifica o texto das páginas (não os bytes do logo) antes de montar o arquivo.
  if (clientReportPdfContainsInternalTerms(streams.join("\n"))) {
    throw new Error("PDF da proposta contém termos internos proibidos.");
  }
  return assemblePdf(streams, `${docRef} — ${header.documentTitle}`, logo ? [logo] : []);
}

export function buildProjectProposalPdfFilename(envelope: ProjectDocumentEnvelope): string {
  const base = envelope.header.documentNumber ?? `${envelope.header.project.code}-PC-PREVIA`;
  return `${base.replace(/[^\w.-]+/g, "_")}.pdf`;
}
