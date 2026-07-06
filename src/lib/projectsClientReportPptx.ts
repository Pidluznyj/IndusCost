import pptxgenModule from "pptxgenjs";
import JSZip from "jszip";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding.js";
import {
  mergePrintBranding,
  resolveBrandingAccentColor,
  resolveBrandingPrimaryColor,
  resolvePrintLogoSrc,
  resolveProposalInstitutionalCoverLogoSrc,
} from "./printBranding.js";
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
const MARGIN_X = 0.6;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;
const FOOTER_Y = 5.18;

const COLOR_BG = "F8FAFC";
const COLOR_TEXT = "0F172A";
const COLOR_MUTED = "64748B";
const COLOR_WHITE = "FFFFFF";
const COLOR_BORDER = "E2E8F0";
const COLOR_CARD = "FFFFFF";
const COLOR_CARD_TINT = "EFF6FF";

const FONT_FACE = "Segoe UI";
const TBD = "A definir";

type PptxGenConstructor = new () => PptxGenJS;
type ExecutiveCard = { label: string; value: string; sub?: string | null };
type BrandTheme = { primary: string; accent: string; light: string };

function createPptxGen(): PptxGenJS {
  const ctor = ((pptxgenModule as { default?: PptxGenConstructor }).default ??
    pptxgenModule) as PptxGenConstructor;
  return new ctor();
}

function buildTheme(branding: BrandingSettingsDTO): BrandTheme {
  const primary = resolveBrandingPrimaryColor(branding);
  const accent = resolveBrandingAccentColor(branding);
  return { primary, accent, light: COLOR_CARD_TINT };
}

function parseImageDataUrl(dataUrl: string | null): string | null {
  if (!dataUrl?.trim().toLowerCase().startsWith("data:image/")) return null;
  return dataUrl.trim();
}

function shortOr(value: string | null | undefined, fallback = TBD): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function addInstitutionalFooter(slide: PptxGenJS.Slide, payload: ProjectClientReportPayload, theme: BrandTheme) {
  slide.addShape("rect", {
    x: 0,
    y: FOOTER_Y - 0.08,
    w: SLIDE_W,
    h: 0.55,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
  });
  slide.addText(
    `${payload.project.code}  ·  ${formatClientReportDate(payload.project.issuedAt)}  ·  ${payload.project.customerName}`,
    {
      x: MARGIN_X,
      y: FOOTER_Y,
      w: CONTENT_W,
      h: 0.28,
      fontFace: FONT_FACE,
      fontSize: 8,
      color: COLOR_WHITE,
      margin: 0,
    }
  );
}

function addSlideShell(
  slide: PptxGenJS.Slide,
  title: string,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
): number {
  slide.background = { color: COLOR_BG };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.1,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
  });
  slide.addShape("rect", {
    x: MARGIN_X,
    y: 0.52,
    w: 1.35,
    h: 0.055,
    fill: { color: theme.accent },
    line: { color: theme.accent, width: 0 },
  });
  slide.addText(title, {
    x: MARGIN_X,
    y: 0.34,
    w: CONTENT_W - 1.6,
    h: 0.42,
    fontFace: FONT_FACE,
    fontSize: 24,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });

  const headerLogo = parseImageDataUrl(resolvePrintLogoSrc(branding));
  if (headerLogo) {
    slide.addImage({
      data: headerLogo,
      x: SLIDE_W - MARGIN_X - 1.25,
      y: 0.22,
      w: 1.15,
      h: 0.38,
    });
  } else {
    slide.addText(truncate(branding.companyName || "Lazarios · IndusCost", 28), {
      x: SLIDE_W - MARGIN_X - 2.5,
      y: 0.28,
      w: 2.45,
      h: 0.28,
      fontFace: FONT_FACE,
      fontSize: 9,
      bold: true,
      color: theme.primary,
      align: "right",
      margin: 0,
    });
  }

  return 1.02;
}

function addExecutiveCard(
  slide: PptxGenJS.Slide,
  card: ExecutiveCard,
  box: { x: number; y: number; w: number; h: number },
  theme: BrandTheme
) {
  slide.addShape("roundRect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER, width: 0.75 },
    rectRadius: 0.08,
  });
  slide.addShape("rect", {
    x: box.x,
    y: box.y,
    w: 0.08,
    h: box.h,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
  });
  slide.addText(card.label.toUpperCase(), {
    x: box.x + 0.18,
    y: box.y + 0.14,
    w: box.w - 0.28,
    h: 0.22,
    fontFace: FONT_FACE,
    fontSize: 8,
    color: COLOR_MUTED,
    margin: 0,
  });
  slide.addText(truncate(card.value, 42), {
    x: box.x + 0.18,
    y: box.y + 0.36,
    w: box.w - 0.28,
    h: 0.55,
    fontFace: FONT_FACE,
    fontSize: card.value.length > 18 ? 14 : 18,
    bold: true,
    color: theme.primary,
    margin: 0,
    valign: "top",
  });
  if (card.sub?.trim()) {
    slide.addText(truncate(card.sub, 56), {
      x: box.x + 0.18,
      y: box.y + box.h - 0.34,
      w: box.w - 0.28,
      h: 0.22,
      fontFace: FONT_FACE,
      fontSize: 8,
      color: COLOR_MUTED,
      margin: 0,
    });
  }
}

function addCardGrid(
  slide: PptxGenJS.Slide,
  cards: ExecutiveCard[],
  startY: number,
  theme: BrandTheme,
  opts?: { columns?: number; cardH?: number }
) {
  const visible = cards.filter((card) => card.label.trim() && card.value.trim());
  if (visible.length === 0) return;
  const columns = Math.min(opts?.columns ?? 2, 4, visible.length);
  const rows = Math.ceil(visible.length / columns);
  const gapX = 0.22;
  const gapY = 0.2;
  const cardW = (CONTENT_W - gapX * (columns - 1)) / columns;
  const cardH = opts?.cardH ?? 1.18;

  visible.slice(0, 8).forEach((card, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    addExecutiveCard(
      slide,
      card,
      {
        x: MARGIN_X + col * (cardW + gapX),
        y: startY + row * (cardH + gapY),
        w: cardW,
        h: cardH,
      },
      theme
    );
  });

  return startY + rows * (cardH + gapY) + 0.1;
}

function buildCoverSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  slide.background = { color: COLOR_BG };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 3.35,
    h: SLIDE_H,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
  });
  slide.addShape("rect", {
    x: 3.35,
    y: 0,
    w: SLIDE_W - 3.35,
    h: SLIDE_H,
    fill: { color: COLOR_WHITE },
    line: { color: COLOR_WHITE, width: 0 },
  });

  const coverLogo = parseImageDataUrl(resolveProposalInstitutionalCoverLogoSrc(branding));
  if (coverLogo) {
    slide.addImage({
      data: coverLogo,
      x: 0.55,
      y: 0.75,
      w: 2.25,
      h: 1.15,
    });
  } else {
    slide.addText(branding.companyName || "Lazarios · IndusCost", {
      x: 0.55,
      y: 1.05,
      w: 2.25,
      h: 0.55,
      fontFace: FONT_FACE,
      fontSize: 18,
      bold: true,
      color: COLOR_WHITE,
      align: "center",
      margin: 0,
    });
  }

  slide.addText(branding.slogan || "Soluções industriais", {
    x: 0.45,
    y: 4.55,
    w: 2.45,
    h: 0.35,
    fontFace: FONT_FACE,
    fontSize: 8,
    color: COLOR_WHITE,
    align: "center",
    margin: 0,
  });

  slide.addText("Proposta Comercial", {
    x: 3.75,
    y: 0.85,
    w: 5.7,
    h: 0.65,
    fontFace: FONT_FACE,
    fontSize: 34,
    bold: true,
    color: theme.primary,
    margin: 0,
  });
  slide.addText(truncate(payload.project.name, 64), {
    x: 3.75,
    y: 1.55,
    w: 5.7,
    h: 0.45,
    fontFace: FONT_FACE,
    fontSize: 18,
    color: COLOR_TEXT,
    margin: 0,
  });

  const metaCards: ExecutiveCard[] = [
    { label: "Cliente", value: payload.project.customerName },
    { label: "Projeto", value: payload.project.code },
    { label: "Data", value: formatClientReportDate(payload.project.issuedAt) },
    {
      label: "Responsável comercial",
      value: shortOr(payload.project.commercialResponsibleName, PROJECT_CLIENT_REPORT_NOT_INFORMED),
    },
  ];

  metaCards.forEach((card, index) => {
    const y = 2.35 + index * 0.72;
    slide.addShape("roundRect", {
      x: 3.75,
      y,
      w: 5.55,
      h: 0.58,
      fill: { color: index % 2 === 0 ? COLOR_CARD_TINT : COLOR_BG },
      line: { color: COLOR_BORDER, width: 0.5 },
      rectRadius: 0.06,
    });
    slide.addText(card.label.toUpperCase(), {
      x: 3.95,
      y: y + 0.1,
      w: 1.6,
      h: 0.2,
      fontFace: FONT_FACE,
      fontSize: 8,
      color: COLOR_MUTED,
      margin: 0,
    });
    slide.addText(truncate(card.value, 48), {
      x: 5.45,
      y: y + 0.08,
      w: 3.65,
      h: 0.35,
      fontFace: FONT_FACE,
      fontSize: 13,
      bold: true,
      color: COLOR_TEXT,
      align: "right",
      margin: 0,
    });
  });

  slide.addShape("rect", {
    x: 0,
    y: SLIDE_H - 0.42,
    w: SLIDE_W,
    h: 0.42,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
  });
  slide.addText(
    `${branding.companyName || payload.project.issuerName}  ·  ${payload.project.issuerName}`,
    {
      x: MARGIN_X,
      y: SLIDE_H - 0.32,
      w: CONTENT_W,
      h: 0.22,
      fontFace: FONT_FACE,
      fontSize: 9,
      color: COLOR_WHITE,
      margin: 0,
    }
  );
}

function buildExecutiveSummarySlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Resumo executivo", branding, theme);
  addCardGrid(
    slide,
    [
      { label: "Cliente", value: payload.project.customerName },
      { label: "Projeto", value: `${payload.project.code} — ${truncate(payload.project.name, 28)}` },
      {
        label: payload.summary.finalSetPriceLabel,
        value: formatClientReportMoney(payload.summary.finalSetPrice),
      },
      { label: "Itens no conjunto", value: String(payload.summary.productsCount) },
      {
        label: "Condição / amortização",
        value: shortOr(
          payload.commercialTerms.paymentTerms ??
            (payload.commercialTerms.notes ? truncate(payload.commercialTerms.notes, 36) : null),
          "Valores finais já incluem composição do projeto"
        ),
      },
    ],
    bodyY + 0.2,
    theme,
    { columns: 2, cardH: 1.28 }
  );
  addInstitutionalFooter(slide, payload, theme);
}

function buildSolutionSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Solução proposta", branding, theme);
  const productCards: ExecutiveCard[] =
    payload.products.length > 0
      ? payload.products.slice(0, 4).map((product) => ({
          label: product.sku ? `SKU ${product.sku}` : "Componente",
          value: truncate(product.name, 32),
          sub: `${product.quantityPerSet} ${product.unit}  ·  ${formatClientReportMoney(product.finalTotalPrice)}`,
        }))
      : [{ label: "Componente", value: TBD }];

  addCardGrid(slide, productCards, bodyY + 0.25, theme, {
    columns: payload.products.length <= 2 ? 2 : 2,
    cardH: 1.45,
  });
  addInstitutionalFooter(slide, payload, theme);
}

function buildCompositionSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Composição do conjunto", branding, theme);

  const headerStyle = {
    bold: true,
    color: COLOR_WHITE,
    fill: { color: theme.primary },
    fontFace: FONT_FACE,
    fontSize: 9,
    align: "center" as const,
    valign: "middle" as const,
  };
  const cellStyle = {
    fontFace: FONT_FACE,
    fontSize: 9,
    color: COLOR_TEXT,
    valign: "middle" as const,
  };

  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "Item", options: headerStyle },
      { text: "SKU", options: headerStyle },
      { text: "Qtd/conj.", options: headerStyle },
      { text: "Preço unit.", options: headerStyle },
      { text: "Total", options: headerStyle },
    ],
  ];

  if (payload.products.length === 0) {
    rows.push([{ text: TBD, options: { ...cellStyle, colspan: 5 } }]);
  } else {
    for (const [index, product] of payload.products.entries()) {
      rows.push([
        { text: `${index + 1}. ${truncate(product.name, 28)}`, options: cellStyle },
        { text: product.sku ?? "—", options: { ...cellStyle, align: "center" } },
        {
          text: `${product.quantityPerSet} ${product.unit}`,
          options: { ...cellStyle, align: "center" },
        },
        {
          text: formatClientReportMoney(product.finalUnitPrice),
          options: { ...cellStyle, align: "right" },
        },
        {
          text: formatClientReportMoney(product.finalTotalPrice),
          options: { ...cellStyle, align: "right", bold: true, color: theme.primary },
        },
      ]);
    }
  }

  const tableY = bodyY + 0.15;
  slide.addTable(rows, {
    x: MARGIN_X,
    y: tableY,
    w: CONTENT_W,
    colW: [2.55, 1.05, 1.1, 1.35, 1.35],
    border: { type: "solid", color: COLOR_BORDER, pt: 0.5 },
    autoPage: false,
    rowH: 0.42,
  });

  const totalY = Math.min(tableY + 0.5 + payload.products.length * 0.42 + 0.25, 4.35);
  slide.addShape("roundRect", {
    x: SLIDE_W - MARGIN_X - 2.65,
    y: totalY,
    w: 2.65,
    h: 0.62,
    fill: { color: theme.light },
    line: { color: theme.primary, width: 0.75 },
    rectRadius: 0.06,
  });
  slide.addText(payload.summary.finalSetPriceLabel.toUpperCase(), {
    x: SLIDE_W - MARGIN_X - 2.5,
    y: totalY + 0.1,
    w: 2.35,
    h: 0.18,
    fontFace: FONT_FACE,
    fontSize: 8,
    color: COLOR_MUTED,
    align: "right",
    margin: 0,
  });
  slide.addText(formatClientReportMoney(payload.summary.finalSetPrice), {
    x: SLIDE_W - MARGIN_X - 2.5,
    y: totalY + 0.28,
    w: 2.35,
    h: 0.28,
    fontFace: FONT_FACE,
    fontSize: 16,
    bold: true,
    color: theme.primary,
    align: "right",
    margin: 0,
  });

  addInstitutionalFooter(slide, payload, theme);
}

function buildInvestmentSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Investimento", branding, theme);

  slide.addShape("roundRect", {
    x: MARGIN_X,
    y: bodyY + 0.1,
    w: CONTENT_W,
    h: 1.35,
    fill: { color: theme.primary },
    line: { color: theme.primary, width: 0 },
    rectRadius: 0.1,
  });
  slide.addText(payload.summary.finalSetPriceLabel.toUpperCase(), {
    x: MARGIN_X + 0.35,
    y: bodyY + 0.28,
    w: 3.5,
    h: 0.22,
    fontFace: FONT_FACE,
    fontSize: 10,
    color: COLOR_WHITE,
    margin: 0,
  });
  slide.addText(formatClientReportMoney(payload.summary.finalSetPrice), {
    x: MARGIN_X + 0.35,
    y: bodyY + 0.52,
    w: 5.5,
    h: 0.72,
    fontFace: FONT_FACE,
    fontSize: 40,
    bold: true,
    color: COLOR_WHITE,
    margin: 0,
  });
  if (payload.summary.totalProposalValue != null) {
    slide.addText(
      `Total estimado (${payload.summary.estimatedQuantity ?? "—"} un.): ${formatClientReportMoney(payload.summary.totalProposalValue)}`,
      {
        x: MARGIN_X + 0.35,
        y: bodyY + 1.12,
        w: 8.5,
        h: 0.22,
        fontFace: FONT_FACE,
        fontSize: 10,
        color: COLOR_WHITE,
        margin: 0,
      }
    );
  }

  addCardGrid(
    slide,
    [
      {
        label: "Subtotal do conjunto",
        value: formatClientReportMoney(payload.summary.finalSetPrice),
      },
      {
        label: "Total estimado",
        value:
          payload.summary.totalProposalValue != null
            ? formatClientReportMoney(payload.summary.totalProposalValue)
            : TBD,
      },
      {
        label: "Premissas",
        value: truncate(payload.executiveSummary, 40),
      },
      {
        label: "Observações",
        value: shortOr(payload.commercialTerms.notes, "Conforme escopo da proposta"),
      },
    ],
    bodyY + 1.7,
    theme,
    { columns: 2, cardH: 1.05 }
  );
  addInstitutionalFooter(slide, payload, theme);
}

function buildCommercialTermsSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Condições comerciais", branding, theme);
  addCardGrid(
    slide,
    [
      {
        label: "Validade",
        value: shortOr(
          payload.commercialTerms.proposalValidity ??
            (payload.project.validUntil ? formatClientReportDate(payload.project.validUntil) : null)
        ),
      },
      { label: "Prazo", value: shortOr(payload.commercialTerms.deliveryTerms) },
      { label: "Exclusividade", value: shortOr(payload.commercialTerms.exclusivity, "Não informada") },
      {
        label: "Amortização",
        value: shortOr(payload.commercialTerms.paymentTerms, "Incluída no preço final"),
      },
      {
        label: "Volume estimado",
        value:
          payload.summary.estimatedQuantity != null
            ? `${payload.summary.estimatedQuantity} un.`
            : TBD,
      },
    ].slice(0, 4),
    bodyY + 0.25,
    theme,
    { columns: 2, cardH: 1.35 }
  );

  if (payload.commercialTerms.freightTerms) {
    slide.addShape("roundRect", {
      x: MARGIN_X,
      y: 4.05,
      w: CONTENT_W,
      h: 0.62,
      fill: { color: COLOR_CARD },
      line: { color: COLOR_BORDER, width: 0.5 },
      rectRadius: 0.06,
    });
    slide.addText(`Frete / Incoterm: ${payload.commercialTerms.freightTerms}`, {
      x: MARGIN_X + 0.2,
      y: 4.22,
      w: CONTENT_W - 0.4,
      h: 0.28,
      fontFace: FONT_FACE,
      fontSize: 11,
      color: COLOR_TEXT,
      margin: 0,
    });
  }

  addInstitutionalFooter(slide, payload, theme);
}

function buildBenefitsSlide(
  slide: PptxGenJS.Slide,
  _payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Benefícios para o cliente", branding, theme);
  const benefits = [
    { icon: "◎", title: "Previsibilidade", text: "Custos e fornecimento claros" },
    { icon: "◆", title: "Redução de risco", text: "Engenharia e validação integradas" },
    { icon: "◇", title: "Parceria técnica", text: "Acompanhamento comercial dedicado" },
    { icon: "▣", title: "Fornecimento industrial", text: "Capacidade e continuidade produtiva" },
  ];

  const cardW = (CONTENT_W - 0.22) / 2;
  const cardH = 1.55;
  benefits.forEach((benefit, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN_X + col * (cardW + 0.22);
    const y = bodyY + 0.2 + row * (cardH + 0.22);

    slide.addShape("roundRect", {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: COLOR_CARD },
      line: { color: COLOR_BORDER, width: 0.75 },
      rectRadius: 0.08,
    });
    slide.addShape("ellipse", {
      x: x + 0.22,
      y: y + 0.28,
      w: 0.48,
      h: 0.48,
      fill: { color: theme.light },
      line: { color: theme.accent, width: 0.75 },
    });
    slide.addText(benefit.icon, {
      x: x + 0.22,
      y: y + 0.34,
      w: 0.48,
      h: 0.36,
      fontFace: FONT_FACE,
      fontSize: 16,
      color: theme.primary,
      align: "center",
      margin: 0,
    });
    slide.addText(benefit.title, {
      x: x + 0.85,
      y: y + 0.3,
      w: cardW - 1,
      h: 0.3,
      fontFace: FONT_FACE,
      fontSize: 14,
      bold: true,
      color: COLOR_TEXT,
      margin: 0,
    });
    slide.addText(benefit.text, {
      x: x + 0.85,
      y: y + 0.62,
      w: cardW - 1,
      h: 0.55,
      fontFace: FONT_FACE,
      fontSize: 10,
      color: COLOR_MUTED,
      margin: 0,
    });
  });
  addInstitutionalFooter(slide, _payload, theme);
}

function buildTimelineSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  const bodyY = addSlideShell(slide, "Próximos passos", branding, theme);
  const steps = [
    "Aprovação",
    "Ferramental",
    "Amostras",
    "Fornecimento",
  ];
  const startX = MARGIN_X + 0.15;
  const stepW = (CONTENT_W - 0.3) / steps.length;
  const lineY = bodyY + 1.05;

  slide.addShape("rect", {
    x: startX + stepW * 0.5,
    y: lineY + 0.18,
    w: stepW * (steps.length - 1),
    h: 0.06,
    fill: { color: theme.accent },
    line: { color: theme.accent, width: 0 },
  });

  steps.forEach((step, index) => {
    const cx = startX + stepW * index + stepW * 0.5;
    slide.addShape("ellipse", {
      x: cx - 0.22,
      y: lineY,
      w: 0.44,
      h: 0.44,
      fill: { color: theme.primary },
      line: { color: theme.primary, width: 0 },
    });
    slide.addText(String(index + 1), {
      x: cx - 0.22,
      y: lineY + 0.07,
      w: 0.44,
      h: 0.3,
      fontFace: FONT_FACE,
      fontSize: 12,
      bold: true,
      color: COLOR_WHITE,
      align: "center",
      margin: 0,
    });
    slide.addText(step, {
      x: cx - stepW * 0.45,
      y: lineY + 0.62,
      w: stepW * 0.9,
      h: 0.35,
      fontFace: FONT_FACE,
      fontSize: 12,
      bold: true,
      color: COLOR_TEXT,
      align: "center",
      margin: 0,
    });
  });

  addInstitutionalFooter(slide, payload, theme);
}

function buildClosingSlide(
  slide: PptxGenJS.Slide,
  payload: ProjectClientReportPayload,
  branding: BrandingSettingsDTO,
  theme: BrandTheme
) {
  slide.background = { color: COLOR_BG };
  slide.addShape("rect", {
    x: MARGIN_X,
    y: 0.85,
    w: CONTENT_W,
    h: 3.95,
    fill: { color: COLOR_WHITE },
    line: { color: COLOR_BORDER, width: 0.75 },
    rectRadius: 0.1,
  });

  const logo = parseImageDataUrl(resolveProposalInstitutionalCoverLogoSrc(branding));
  if (logo) {
    slide.addImage({
      data: logo,
      x: MARGIN_X + 0.55,
      y: 1.25,
      w: 2.4,
      h: 0.85,
    });
  } else {
    slide.addText(branding.companyName || "Lazarios · IndusCost", {
      x: MARGIN_X + 0.55,
      y: 1.45,
      w: 4,
      h: 0.4,
      fontFace: FONT_FACE,
      fontSize: 20,
      bold: true,
      color: theme.primary,
      margin: 0,
    });
  }

  slide.addText("Vamos avançar juntos", {
    x: MARGIN_X + 0.55,
    y: 2.35,
    w: CONTENT_W - 1.1,
    h: 0.45,
    fontFace: FONT_FACE,
    fontSize: 26,
    bold: true,
    color: theme.primary,
    margin: 0,
  });

  slide.addText(
    [
      `Contato: ${shortOr(payload.project.commercialResponsibleName, PROJECT_CLIENT_REPORT_NOT_INFORMED)}`,
      branding.companyName || payload.project.issuerName,
    ].join("\n"),
    {
      x: MARGIN_X + 0.55,
      y: 2.95,
      w: CONTENT_W - 1.1,
      h: 0.8,
      fontFace: FONT_FACE,
      fontSize: 12,
      color: COLOR_MUTED,
      margin: 0,
      lineSpacingMultiple: 1.3,
    }
  );

  addInstitutionalFooter(slide, payload, theme);
}

/** Extrai textos dos slides para validação em testes (PPTX = ZIP + XML). */
export async function extractProjectClientProposalPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const chunks: string[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (!name.startsWith("ppt/slides/slide") || !name.endsWith(".xml")) continue;
    const xml = await file.async("string");
    chunks.push(xml.replace(/<[^>]+>/g, " "));
  }
  return chunks.join(" ").replace(/\s+/g, " ");
}

/** Conta imagens embutidas no PPTX (logo da identidade visual). */
export async function projectClientProposalPptxEmbeddedImageCount(buffer: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter(
    (name) => name.startsWith("ppt/media/") && !zip.files[name]!.dir
  ).length;
}

/** Confirma presença de mídia embutida (logo da identidade visual). */
export async function projectClientProposalPptxHasEmbeddedMedia(buffer: Buffer): Promise<boolean> {
  return (await projectClientProposalPptxEmbeddedImageCount(buffer)) > 0;
}

export async function buildProjectClientProposalPptxBuffer(
  payload: ProjectClientReportPayload,
  brandingInput?: BrandingSettingsDTO
): Promise<Buffer> {
  assertProjectClientReportPayloadIsSafe(payload);
  const branding = mergePrintBranding(brandingInput ?? DEFAULT_BRANDING, DEFAULT_BRANDING);
  const theme = buildTheme(branding);

  const pptx = createPptxGen();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = branding.companyName || payload.project.issuerName;
  pptx.company = payload.project.issuerName;
  pptx.subject = payload.title;
  pptx.title = `${payload.project.code} — Proposta Comercial`;

  buildCoverSlide(pptx.addSlide(), payload, branding, theme);
  buildExecutiveSummarySlide(pptx.addSlide(), payload, branding, theme);
  buildSolutionSlide(pptx.addSlide(), payload, branding, theme);
  buildCompositionSlide(pptx.addSlide(), payload, branding, theme);
  buildInvestmentSlide(pptx.addSlide(), payload, branding, theme);
  buildCommercialTermsSlide(pptx.addSlide(), payload, branding, theme);
  buildBenefitsSlide(pptx.addSlide(), payload, branding, theme);
  buildTimelineSlide(pptx.addSlide(), payload, branding, theme);
  buildClosingSlide(pptx.addSlide(), payload, branding, theme);

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
