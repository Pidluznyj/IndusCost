/**
 * Gerador de Comunicados — modelo puro (sem React, sem DOM).
 * Formatos, temas e medidas vêm do protótipo aprovado; a arte é desenhada em
 * pixels reais (1080 de largura) e reduzida só na pré-visualização.
 */

export const ANNOUNCEMENT_FORMATS = {
  quadrado: { width: 1080, height: 1080, label: "Quadrado", size: "1080×1080" },
  retrato: { width: 1080, height: 1350, label: "Retrato", size: "1080×1350" },
  stories: { width: 1080, height: 1920, label: "Stories", size: "1080×1920" },
} as const;
export type AnnouncementFormat = keyof typeof ANNOUNCEMENT_FORMATS;

export const ANNOUNCEMENT_LAYOUTS = { impacto: "Layout impacto", classico: "Layout clássico" } as const;
export type AnnouncementLayout = keyof typeof ANNOUNCEMENT_LAYOUTS;

export const ANNOUNCEMENT_THEME_LABELS = { claro: "Fundo branco", azul: "Fundo azul" } as const;
export type AnnouncementTheme = keyof typeof ANNOUNCEMENT_THEME_LABELS;

export const ANNOUNCEMENT_TITLE_SIZES = { P: 64, M: 80, G: 100 } as const;
export type AnnouncementTitleSize = keyof typeof ANNOUNCEMENT_TITLE_SIZES;

export const ANNOUNCEMENT_FITS = { cover: "Preencher", contain: "Ajustar" } as const;
export type AnnouncementFit = keyof typeof ANNOUNCEMENT_FITS;

export type AnnouncementColors = {
  bg: string;
  impactBg: string;
  ink: string;
  muted: string;
  body: string;
  accent: string;
  rule: string;
  chipBg: string;
  chipFg: string;
  hlBg: string;
  hlFg: string;
  footBg: string;
  imgBg: string;
  stripe: string;
  logo: string;
  heroBg: string;
  cardBg: string;
  cardInk: string;
};

export const ANNOUNCEMENT_THEMES: Record<AnnouncementTheme, AnnouncementColors> = {
  claro: {
    bg: "#FFFFFF",
    impactBg: "#EDF2F5",
    ink: "#343434",
    muted: "#5E6670",
    body: "#343434",
    accent: "#1254E0",
    rule: "#DDE5EA",
    chipBg: "#1254E0",
    chipFg: "#FFFFFF",
    hlBg: "#1254E0",
    hlFg: "#FFFFFF",
    footBg: "#343434",
    imgBg: "#EDF2F5",
    stripe: "#D3DDE3",
    logo: "#1254E0",
    heroBg: "#1254E0",
    cardBg: "#FFFFFF",
    cardInk: "#343434",
  },
  azul: {
    bg: "#1254E0",
    impactBg: "#1254E0",
    ink: "#FFFFFF",
    muted: "#EDF2F5",
    body: "#FFFFFF",
    accent: "#9EE3FF",
    rule: "rgba(255,255,255,.3)",
    chipBg: "#FFFFFF",
    chipFg: "#1254E0",
    hlBg: "#FFFFFF",
    hlFg: "#343434",
    footBg: "#343434",
    imgBg: "#0A87F0",
    stripe: "rgba(255,255,255,.2)",
    logo: "#FFFFFF",
    heroBg: "#343434",
    cardBg: "#FFFFFF",
    cardInk: "#343434",
  },
};

export type AnnouncementData = {
  format: AnnouncementFormat;
  layout: AnnouncementLayout;
  theme: AnnouncementTheme;
  titleSize: AnnouncementTitleSize;
  fit: AnnouncementFit;
  eyebrow: string;
  number: string;
  date: string;
  title: string;
  titleAccent: string;
  subtitle: string;
  body: string;
  showImage: boolean;
  /** Data URL da imagem enviada. */
  image: string;
  showHighlight: boolean;
  hlLabel: string;
  hlText: string;
  showSign: boolean;
  signName: string;
  signRole: string;
  phone: string;
  email: string;
  site: string;
  tagline: string;
  /** Data URL do logo enviado para fundo claro / para fundo azul. Vazio = logo padrão. */
  customLogoDark: string;
  customLogoLight: string;
};

export const ANNOUNCEMENT_TEXT_FIELDS = [
  "eyebrow",
  "number",
  "date",
  "title",
  "titleAccent",
  "subtitle",
  "body",
  "hlLabel",
  "hlText",
  "signName",
  "signRole",
  "phone",
  "email",
  "site",
  "tagline",
] as const satisfies readonly (keyof AnnouncementData)[];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Conteúdo de exemplo, com número e data do dia em que a tela é aberta. */
export function createDefaultAnnouncement(now: Date = new Date()): AnnouncementData {
  return {
    format: "retrato",
    layout: "impacto",
    theme: "claro",
    titleSize: "M",
    fit: "contain",
    eyebrow: "Comunicado importante",
    number: `Nº 001/${now.getFullYear()}`,
    date: `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`,
    title: "Recesso de fim de ano:",
    titleAccent: "programe seus pedidos.",
    subtitle: "Garanta o abastecimento da sua linha em dezembro e janeiro.",
    body:
      "Pedidos recebidos após 12 de dezembro serão faturados a partir de 06 de janeiro, em razão do recesso coletivo.\n\nNossa equipe comercial está à disposição para planejar volumes e prazos.",
    showImage: true,
    image: "",
    showHighlight: true,
    hlLabel: "Último dia para pedidos",
    hlText: "12 de dezembro",
    showSign: true,
    signName: "Equipe Comercial",
    signRole: "Lazarios Koppetel",
    phone: "(41) 98524-5568",
    email: "contato@lazarios.com.br",
    site: "lazarios.com.br",
    tagline: "Desde 1993 · Curitiba, PR · ISO 9001:2015",
    customLogoDark: "",
    customLogoLight: "",
  };
}

function oneOf<T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(options, value) ? (value as T) : fallback;
}

/** Só imagem embutida: o que foi salvo nunca aponta para um endereço externo. */
function imageDataUrl(value: unknown): string {
  return typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) ? value : "";
}

/** Rascunho salvo no navegador → dados válidos. Campo ausente ou inválido volta ao padrão. */
export function restoreAnnouncement(saved: unknown, defaults: AnnouncementData): AnnouncementData {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
  const raw = saved as Record<string, unknown>;
  const out: AnnouncementData = { ...defaults };
  for (const key of ANNOUNCEMENT_TEXT_FIELDS) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, 4000);
  }
  for (const key of ["showImage", "showHighlight", "showSign"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  out.format = oneOf(raw.format, ANNOUNCEMENT_FORMATS, defaults.format);
  out.layout = oneOf(raw.layout, ANNOUNCEMENT_LAYOUTS, defaults.layout);
  out.theme = oneOf(raw.theme, ANNOUNCEMENT_THEMES, defaults.theme);
  out.titleSize = oneOf(raw.titleSize, ANNOUNCEMENT_TITLE_SIZES, defaults.titleSize);
  out.fit = oneOf(raw.fit, ANNOUNCEMENT_FITS, defaults.fit);
  out.image = imageDataUrl(raw.image);
  out.customLogoDark = imageDataUrl(raw.customLogoDark);
  out.customLogoLight = imageDataUrl(raw.customLogoLight);
  return out;
}

/** Linha em branco separa parágrafos. */
export function announcementParagraphs(body: string): string[] {
  return (body || "")
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);
}

/** Layout impacto e tema azul têm fundo escuro atrás do logo: pedem a versão clara. */
export function announcementUsesLightLogo(data: Pick<AnnouncementData, "layout" | "theme">): boolean {
  return data.theme === "azul" || data.layout !== "classico";
}

export type AnnouncementView = {
  width: number;
  height: number;
  colors: AnnouncementColors;
  isImpact: boolean;
  artBackground: string;
  paragraphs: string[];
  usesLightLogo: boolean;
  /** Logo enviado para a variante em uso; vazio = usar o logo padrão. */
  customLogo: string;
  titlePx: number;
  heroTitlePx: number;
  heroPadding: string;
  bodyPx: number;
  /** A área da imagem aparece; sem imagem enviada mostra o convite para enviar. */
  showImage: boolean;
  hasImage: boolean;
  showCard: boolean;
  cardImageWidth: string;
  cardMinHeight: number;
  /** No clássico, sem imagem o espaço livre empurra a assinatura para o fim. */
  classicSpacer: boolean;
};

/**
 * Medidas e cores derivadas. Na exportação, a área de imagem sem imagem enviada
 * some: o convite "clique para enviar" é só da pré-visualização.
 */
export function buildAnnouncementView(data: AnnouncementData, options: { exporting?: boolean } = {}): AnnouncementView {
  const format = ANNOUNCEMENT_FORMATS[data.format];
  const colors = ANNOUNCEMENT_THEMES[data.theme];
  const isImpact = data.layout !== "classico";
  const usesLightLogo = announcementUsesLightLogo(data);
  const titlePx = ANNOUNCEMENT_TITLE_SIZES[data.titleSize];
  const hasImage = Boolean(data.image);
  const showImage = data.showImage && (hasImage || !options.exporting);
  const byFormat = <T,>(quadrado: T, stories: T, retrato: T): T =>
    data.format === "quadrado" ? quadrado : data.format === "stories" ? stories : retrato;
  return {
    width: format.width,
    height: format.height,
    colors,
    isImpact,
    artBackground: isImpact ? colors.impactBg : colors.bg,
    paragraphs: announcementParagraphs(data.body),
    usesLightLogo,
    customLogo: usesLightLogo ? data.customLogoLight : data.customLogoDark,
    titlePx,
    heroTitlePx: Math.round(titlePx * byFormat(0.85, 1.15, 0.95)),
    heroPadding: byFormat("56px 80px 104px", "96px 80px 140px", "64px 80px 116px"),
    bodyPx: byFormat(25, 30, 27),
    showImage,
    hasImage,
    showCard: data.showHighlight || showImage,
    cardImageWidth: data.showHighlight ? "360px" : "100%",
    cardMinHeight: byFormat(170, 340, 220),
    classicSpacer: !showImage,
  };
}

/** Nome do arquivo exportado: lazarios-<tipo>-<número>.jpg, sem acentos. */
export function announcementFileName(data: Pick<AnnouncementData, "eyebrow" | "number">): string {
  const slug = `${data.eyebrow}-${data.number}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `lazarios-${slug || "comunicado"}.jpg`;
}

/** Escala da pré-visualização: nunca amplia além do tamanho real. */
export function announcementPreviewScale(stageWidth: number, artWidth: number): number {
  const available = Math.max(240, stageWidth);
  return Math.min(available / artWidth, 1);
}
