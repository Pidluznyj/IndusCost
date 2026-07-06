import pptxgenModule from "pptxgenjs";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding.js";
import { mergePrintBranding, resolvePrintLogoSrc } from "./printBranding.js";
import {
  assertProjectClientReportPayloadIsSafe,
  formatClientReportDate,
  formatClientReportMoney,
} from "./projectsClientReport.js";
import {
  PROJECT_CLIENT_REPORT_NOT_INFORMED,
  buildProjectClientProposalPptxFilename,
  type ProjectClientReportPayload,
} from "./projectsClientReportShared.js";

export { buildProjectClientProposalPptxFilename } from "./projectsClientReportShared.js";

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN_X = 0.55;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;

const COLOR_PRIMARY = "1D4ED8";
const COLOR_PRIMARY_LIGHT = "EFF6FF";
const COLOR_ACCENT = "0EA5E9";
const COLOR_TEXT = "0F172A";
const COLOR_MUTED = "64748B";
const COLOR_WHITE = "FFFFFF";
const COLOR_BORDER = "CBD5E1";

const FONT_FACE = "Segoe UI";

const TBD = "A definir";

type PptxGenConstructor = new () => PptxGenJS;
type SlideLayout = {
  titleY?: number;
  bodyY?: number;
};

function createPptxGen(): PptxGenJS {
  const ctor = ((pptxgenModule as { default?: PptxGenConstructor }).default ??
    pptxgenModule) as PptxGenConstructor;
  return new ctor();
}

function defineOr(value: string | null | undefined, fallback = TBD): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function parseLogoDataUrl(dataUrl: string | null): { data: string; ext: "png" | "jpeg" } | null {
  if (!dataUrl?.trim().toLowerCase().startsWith("data:image/")) return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const ext = match[1]!.toLowerCase().startsWith("j") ? "jpeg" : "png";
  return { data: dataUrl.trim(), ext };
}

function addSlideChrome(
  slide: PptxGenJS.Slide,
  title: string,
  branding: BrandingSettingsDTO,
  layout: SlideLayout = {}
) {
  const titleY = layout.titleY ?? 0.38;
  const bodyY = layout.bodyY ?? 1.05;

  slide.background = { color: "F8FAFC" };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.12,
    fill: { color: COLOR_PRIMARY },
    line: { color: COLOR_PRIMARY, width: 0 },
  });
  slide.addShape("rect", {
    x: MARGIN_X,
    y: titleY + 0.42,
    w: 1.1,
    h: 0.05,
    fill: { color: COLOR_ACCENT },
    line: { color: COLOR_ACCENT, width: 0 },
  });
  slide.addText(title, {
    x: MARGIN_X,
    y: titleY,
    w: CONTENT_W,
    h: 0.45,
    fontFace: FONT_FACE,
    fontSize: 22,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });

  const logo = parseLogoDataUrl(resolvePrintLogoSrc(branding));
  if (logo) {
    slide.addImage({
      data: logo.data,
      x: SLIDE_W - MARGIN_X - 1.15,
      y: 0.18,
      w: 1.05,
      h: 0.42,
    });
  } else {
    slide.addText(branding.companyName || "Lazarios · IndusCost", {
      x: SLIDE_W - MARGIN_X - 2.4,
      y: 0.22,
      w: 2.35,
      h: 0.3,
      fontFace: FONT_FACE,
      fontSize: 9,
      bold: true,
      color: COLOR_PRIMARY,
      align: "right",
      margin: 0,
    });
  }

  return bodyY;
}

function addBulletBlock(
  slide: PptxGenJS.Slide,
  items: string[],
  opts: { x?: number; y: number; w?: number; h?: number; fontSize?: number }
) {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  if (filtered.length === 0) return;
  slide.addText(
    filtered.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    {
      x: opts.x ?? MARGIN_X,
      y: opts.y,
      w: opts.w ?? CONTENT_W,
      h: opts.h ?? 3.8,
      fontFace: FONT_FACE,
      fontSize: opts.fontSize ?? 13,
      color: COLOR_TEXT,
      valign: "top",
      paraSpaceAfter: 6,
      margin: 0,
    }
  );
}

function addInfoCards(slide: PptxGenJS.Slide, cards: Array<{ label: string; value: string }>, y: number) {
  const visible = cards.filter((card) => card.value.trim());
  if (visible.length === 0) return;
  const cardW = Math.min(2.2, CONTENT_W / visible.length - 0.12);
  const gap = 0.14;
  visible.forEach((card, index) => {
    const x = MARGIN_X + index * (cardW + gap);
    slide.addShape("roundRect", {
      x,
      y,
      w: cardW,
      h: 0.95,
      fill: { color: COLOR_PRIMARY_LIGHT },
      line: { color: COLOR_BORDER, width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addText(card.label.toUpperCase(), {
      x: x + 0.12,
      y: y + 0.12,
      w: cardW - 0.24,
      h: 0.2,
      fontFace: FONT_FACE,
      fontSize: 8,
      color: COLOR_MUTED,
      margin: 0,
    });
    slide.addText(card.value, {
      x: x + 0.12,
      y: y + 0.34,
      w: cardW - 0.24,
      h: 0.5,
      fontFace: FONT_FACE,
      fontSize: 14,
      bold: true,
      color: COLOR_PRIMARY,
      margin: 0,
    });
  });
}

function buildCoverSlide(pptx: PptxGenJS, payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_PRIMARY };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLOR_PRIMARY, transparency: 0 },
    line: { color: COLOR_PRIMARY, width: 0 },
  });
  slide.addShape("rect", {
    x: MARGIN_X,
    y: 1.05,
    w: CONTENT_W,
    h: 3.55,
    fill: { color: COLOR_WHITE, transparency: 6 },
    line: { color: COLOR_WHITE, width: 0 },
    rectRadius: 0.08,
  });

  const logo = parseLogoDataUrl(resolvePrintLogoSrc(branding));
  if (logo) {
    slide.addImage({
      data: logo.data,
      x: MARGIN_X + 0.35,
      y: 0.42,
      w: 2.2,
      h: 0.55,
    });
  } else {
    slide.addText(branding.companyName || "Lazarios · IndusCost", {
      x: MARGIN_X + 0.35,
      y: 0.48,
      w: 4,
      h: 0.4,
      fontFace: FONT_FACE,
      fontSize: 16,
      bold: true,
      color: COLOR_WHITE,
      margin: 0,
    });
  }

  slide.addText("Proposta Comercial", {
    x: MARGIN_X + 0.35,
    y: 1.35,
    w: CONTENT_W - 0.7,
    h: 0.55,
    fontFace: FONT_FACE,
    fontSize: 30,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });
  slide.addText(payload.project.name, {
    x: MARGIN_X + 0.35,
    y: 1.95,
    w: CONTENT_W - 0.7,
    h: 0.45,
    fontFace: FONT_FACE,
    fontSize: 18,
    color: COLOR_PRIMARY,
    margin: 0,
  });

  const metaLines = [
    `Cliente: ${payload.project.customerName}`,
    `Projeto: ${payload.project.code}`,
    `Data: ${formatClientReportDate(payload.project.issuedAt)}`,
    `Empresa: ${payload.project.issuerName}`,
  ];
  slide.addText(metaLines.join("\n"), {
    x: MARGIN_X + 0.35,
    y: 2.55,
    w: CONTENT_W - 0.7,
    h: 1.5,
    fontFace: FONT_FACE,
    fontSize: 13,
    color: COLOR_MUTED,
    margin: 0,
    lineSpacingMultiple: 1.2,
  });
}

function buildObjectiveSlide(
  slide: PptxGenJS,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO
) {
  const bodyY = addSlideChrome(slide, "Objetivo da proposta", branding);
  const bullets = [
    payload.executiveSummary,
    `Produto/projeto: ${payload.project.name}`,
    `Cliente: ${payload.project.customerName}`,
    payload.commercialTerms.notes
      ? `Contexto comercial: ${payload.commercialTerms.notes}`
      : "Contexto comercial: desenvolvimento técnico e fornecimento conforme escopo do projeto.",
    "Objetivo comercial: apresentar solução, investimento e condições para decisão do cliente.",
    "Benefícios: previsibilidade de fornecimento, parceria técnica e solução alinhada à necessidade industrial.",
  ];
  addBulletBlock(slide, bullets, { y: bodyY, h: 4.2, fontSize: 12.5 });
}

function buildScopeSlide(slide: PptxGenJS, payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const bodyY = addSlideChrome(slide, "Escopo do projeto", branding);
  const productLines =
    payload.products.length > 0
      ? payload.products.map(
          (product, index) =>
            `${index + 1}. ${product.name} — ${product.quantityPerSet} ${product.unit}/conjunto` +
            (product.notes ? ` (${product.notes})` : "")
        )
      : [TBD];

  const bullets = [
    "Itens inclusos na proposta:",
    ...productLines,
    payload.summary.productsCount > 1
      ? `Conjunto com ${payload.summary.productsCount} produtos/componentes.`
      : "Produto/componente único na proposta.",
    payload.commercialTerms.deliveryTerms
      ? `Prazo de entrega: ${payload.commercialTerms.deliveryTerms}`
      : null,
    payload.commercialTerms.freightTerms
      ? `Frete / Incoterm: ${payload.commercialTerms.freightTerms}`
      : null,
    "Itens fora do escopo: customizações não descritas nesta proposta e alterações após aprovação.",
  ].filter((line): line is string => Boolean(line));

  addBulletBlock(slide, bullets, { y: bodyY, h: 4.2, fontSize: 12 });
}

function buildSolutionSlide(slide: PptxGenJS, payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const bodyY = addSlideChrome(slide, "Solução proposta", branding);
  const bullets: string[] = [
    "Visão técnica: desenvolvimento e fornecimento industrial conforme especificação do projeto.",
    `Produto proposto: ${payload.project.name}`,
  ];

  if (payload.products.length > 0) {
    for (const product of payload.products) {
      bullets.push(
        `${product.name}${product.sku ? ` (${product.sku})` : ""}: ${product.description}` +
          (product.notes ? ` — ${product.notes}` : "")
      );
    }
  } else {
    bullets.push(TBD);
  }

  bullets.push(
    "Principais diferenciais: engenharia integrada, qualidade industrial e acompanhamento comercial dedicado.",
    payload.commercialTerms.exclusivity
      ? `Exclusividade: ${payload.commercialTerms.exclusivity}`
      : "Observações: valores e condições conforme composição comercial desta proposta."
  );

  addBulletBlock(slide, bullets, { y: bodyY, h: 4.2, fontSize: 12 });
}

function buildCommercialCompositionSlide(
  slide: PptxGenJS,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO
) {
  const bodyY = addSlideChrome(slide, "Composição comercial", branding);

  const headerStyle = {
    bold: true,
    color: COLOR_WHITE,
    fill: { color: COLOR_PRIMARY },
    fontFace: FONT_FACE,
    fontSize: 10,
    align: "center" as const,
    valign: "middle" as const,
  };
  const cellStyle = {
    fontFace: FONT_FACE,
    fontSize: 10,
    color: COLOR_TEXT,
    valign: "middle" as const,
  };

  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "Item", options: headerStyle },
      { text: "Qtd", options: headerStyle },
      { text: "Un.", options: headerStyle },
      { text: "Preço unit.", options: headerStyle },
      { text: "Preço total", options: headerStyle },
    ],
  ];

  if (payload.products.length === 0) {
    rows.push([
      { text: TBD, options: { ...cellStyle, colspan: 5 } },
      { text: "" },
      { text: "" },
      { text: "" },
      { text: "" },
    ]);
  } else {
    for (const [index, product] of payload.products.entries()) {
      rows.push([
        { text: `${index + 1}. ${product.name}`, options: cellStyle },
        { text: String(product.quantityPerSet), options: { ...cellStyle, align: "center" } },
        { text: product.unit, options: { ...cellStyle, align: "center" } },
        { text: formatClientReportMoney(product.finalUnitPrice), options: { ...cellStyle, align: "right" } },
        { text: formatClientReportMoney(product.finalTotalPrice), options: { ...cellStyle, align: "right", bold: true } },
      ]);
    }
  }

  slide.addTable(rows, {
    x: MARGIN_X,
    y: bodyY,
    w: CONTENT_W,
    colW: [3.1, 0.65, 0.65, 1.35, 1.35],
    border: { type: "solid", color: COLOR_BORDER, pt: 0.5 },
    autoPage: false,
    rowH: 0.34,
  });

  const footerY = Math.min(bodyY + 0.38 + payload.products.length * 0.34 + 0.25, 4.55);
  const footerLines = [
    `${payload.summary.finalSetPriceLabel}: ${formatClientReportMoney(payload.summary.finalSetPrice)}`,
    payload.commercialTerms.exclusivity
      ? `Exclusividade: ${payload.commercialTerms.exclusivity}`
      : null,
    payload.summary.estimatedQuantity != null
      ? `Quantidade estimada: ${payload.summary.estimatedQuantity}`
      : null,
  ].filter((line): line is string => Boolean(line));

  if (footerLines.length > 0) {
    slide.addText(footerLines.join("   ·   "), {
      x: MARGIN_X,
      y: footerY,
      w: CONTENT_W,
      h: 0.35,
      fontFace: FONT_FACE,
      fontSize: 11,
      bold: true,
      color: COLOR_PRIMARY,
      margin: 0,
    });
  }
}

function buildInvestmentSlide(slide: PptxGenJS, payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const bodyY = addSlideChrome(slide, "Investimento / precificação", branding);

  addInfoCards(
    slide,
    [
      { label: payload.summary.finalSetPriceLabel, value: formatClientReportMoney(payload.summary.finalSetPrice) },
      {
        label: "Valor total estimado",
        value:
          payload.summary.totalProposalValue != null
            ? formatClientReportMoney(payload.summary.totalProposalValue)
            : TBD,
      },
      {
        label: "Quantidade estimada",
        value:
          payload.summary.estimatedQuantity != null
            ? String(payload.summary.estimatedQuantity)
            : TBD,
      },
    ],
    bodyY
  );

  const terms: string[] = [];
  if (payload.commercialTerms.paymentTerms) {
    terms.push(`Condição de pagamento: ${payload.commercialTerms.paymentTerms}`);
  }
  if (payload.commercialTerms.deliveryTerms) {
    terms.push(`Prazo de entrega: ${payload.commercialTerms.deliveryTerms}`);
  }
  if (payload.commercialTerms.proposalValidity) {
    terms.push(`Validade da proposta: ${payload.commercialTerms.proposalValidity}`);
  } else if (payload.project.validUntil) {
    terms.push(`Validade da proposta: ${formatClientReportDate(payload.project.validUntil)}`);
  }
  if (payload.commercialTerms.freightTerms) {
    terms.push(`Frete / Incoterm: ${payload.commercialTerms.freightTerms}`);
  }
  if (payload.commercialTerms.notes) {
    terms.push(`Observações financeiras: ${payload.commercialTerms.notes}`);
  }

  const bullets =
    terms.length > 0
      ? terms
      : [
          "Condições comerciais: conforme alinhamento comercial após aprovação da proposta.",
          `Forma de amortização: valores comerciais finais já refletem a composição acordada do projeto.`,
          `Validade da proposta: ${TBD}`,
        ];

  addBulletBlock(slide, bullets, { y: bodyY + 1.15, h: 3.2, fontSize: 12 });
}

function buildBenefitsSlide(slide: PptxGenJS, _payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const bodyY = addSlideChrome(slide, "Vantagens para o cliente", branding);
  addBulletBlock(
    slide,
    [
      "Menor investimento inicial com solução industrial integrada.",
      "Previsibilidade de custos e fornecimento ao longo do projeto.",
      "Redução de risco com engenharia, validação e acompanhamento técnico.",
      "Parceria técnica com equipe comercial e industrial dedicada.",
      "Ganho operacional com padronização, qualidade e continuidade de fornecimento.",
    ],
    { y: bodyY, h: 4.2, fontSize: 13 }
  );
}

function buildNextStepsSlide(slide: PptxGenJS, _payload: ProjectClientReportPayload, branding: BrandingSettingsDTO) {
  const bodyY = addSlideChrome(slide, "Próximos passos", branding);
  addBulletBlock(
    slide,
    [
      "Aprovação da proposta comercial pelo cliente.",
      "Detalhamento técnico e planejamento de desenvolvimento/ferramental.",
      "Validação de amostras e ajustes finais de especificação.",
      "Início do fornecimento conforme cronograma acordado.",
    ],
    { y: bodyY, h: 4.2, fontSize: 13 }
  );
}

function buildClosingSlide(
  slide: PptxGenJS,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO
) {
  slide.background = { color: "F8FAFC" };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLOR_PRIMARY_LIGHT },
    line: { color: COLOR_PRIMARY_LIGHT, width: 0 },
  });
  slide.addShape("rect", {
    x: MARGIN_X,
    y: 1.2,
    w: CONTENT_W,
    h: 3.2,
    fill: { color: COLOR_WHITE },
    line: { color: COLOR_BORDER, width: 0.75 },
    rectRadius: 0.08,
  });

  const logo = parseLogoDataUrl(resolvePrintLogoSrc(branding));
  if (logo) {
    slide.addImage({
      data: logo.data,
      x: MARGIN_X + 0.45,
      y: 1.55,
      w: 2,
      h: 0.5,
    });
  }

  slide.addText("Obrigado pela oportunidade de parceria", {
    x: MARGIN_X + 0.45,
    y: 2.2,
    w: CONTENT_W - 0.9,
    h: 0.45,
    fontFace: FONT_FACE,
    fontSize: 22,
    bold: true,
    color: COLOR_PRIMARY,
    margin: 0,
  });

  const contactLines = [
    `Contato comercial: ${defineOr(payload.project.commercialResponsibleName, PROJECT_CLIENT_REPORT_NOT_INFORMED)}`,
    `Empresa: ${branding.companyName || payload.project.issuerName}`,
    branding.slogan ? branding.slogan : "Soluções e qualidade em plásticos",
    `Documento gerado em ${formatClientReportDate(payload.generatedAt)}`,
  ];

  slide.addText(contactLines.join("\n"), {
    x: MARGIN_X + 0.45,
    y: 2.75,
    w: CONTENT_W - 0.9,
    h: 1.2,
    fontFace: FONT_FACE,
    fontSize: 12,
    color: COLOR_MUTED,
    margin: 0,
    lineSpacingMultiple: 1.25,
  });
}

export async function buildProjectClientProposalPptxBuffer(
  payload: ProjectClientReportPayload,
  brandingInput?: BrandingSettingsDTO
): Promise<Buffer> {
  assertProjectClientReportPayloadIsSafe(payload);
  const branding = mergePrintBranding(brandingInput ?? DEFAULT_BRANDING, DEFAULT_BRANDING);

  const pptx = createPptxGen();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = branding.companyName || payload.project.issuerName;
  pptx.company = payload.project.issuerName;
  pptx.subject = payload.title;
  pptx.title = `${payload.project.code} — Proposta Comercial`;

  buildCoverSlide(pptx, payload, branding);
  buildObjectiveSlide(pptx.addSlide(), payload, branding);
  buildScopeSlide(pptx.addSlide(), payload, branding);
  buildSolutionSlide(pptx.addSlide(), payload, branding);
  buildCommercialCompositionSlide(pptx.addSlide(), payload, branding);
  buildInvestmentSlide(pptx.addSlide(), payload, branding);
  buildBenefitsSlide(pptx.addSlide(), payload, branding);
  buildNextStepsSlide(pptx.addSlide(), payload, branding);
  buildClosingSlide(pptx.addSlide(), payload, branding);

  const output = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  if (buffer.length < 1000) {
    throw new Error("PPTX gerado é inválido ou vazio.");
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("PPTX gerado não possui assinatura ZIP válida.");
  }
  return buffer;
}
