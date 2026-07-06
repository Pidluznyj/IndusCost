import pptxgen from "pptxgenjs";

export interface PPTXTheme {
  primaryColor: string; // e.g., "0B3C5D" (no #)
  secondaryColor: string; // e.g., "328CC1"
  textColor: string; // e.g., "1E293B"
  bgFill: string; // e.g., "F8FAFC"
  successColor: string; // "15803D"
  accentColor: string; // "D97706"
  companyName: string;
  logoBase64?: string | null;
}

export function createTheme(branding: any): PPTXTheme {
  const sanitizeColor = (color: string | null, fallback: string) => {
    if (!color) return fallback;
    return color.replace("#", "").trim();
  };

  return {
    primaryColor: sanitizeColor(branding?.primaryColor, "0B3C5D"),
    secondaryColor: sanitizeColor(branding?.secondaryColor, "328CC1"),
    textColor: "1E293B",
    bgFill: "F8FAFC",
    successColor: "15803D",
    accentColor: "D97706",
    companyName: branding?.companyName || "IndusCost",
    logoBase64: branding?.logoBase64 || null,
  };
}

export function applyStandardSlideTemplate(
  slide: pptxgen.Slide,
  theme: PPTXTheme,
  title: string,
  projectCode: string,
  clientName: string
) {
  // Background
  slide.background = { fill: theme.bgFill };

  // Header Title
  slide.addText(title, {
    x: 0.8,
    y: 0.4,
    w: 8.4,
    h: 0.5,
    fontSize: 22,
    fontFace: "Inter",
    color: theme.primaryColor,
    bold: true,
    valign: "middle"
  });

  // Header Separator Line
  slide.addShape("line", {
    x: 0.8,
    y: 0.9,
    w: 8.4,
    h: 0,
    line: { color: theme.secondaryColor, width: 1 }
  });

  // Footer Line
  slide.addShape("line", {
    x: 0.8,
    y: 5.1,
    w: 8.4,
    h: 0,
    line: { color: "E2E8F0", width: 1 }
  });

  // Footer Company Name & Logo Fallback
  if (theme.logoBase64) {
    slide.addImage({
      data: theme.logoBase64,
      x: 0.8,
      y: 5.15,
      w: 0.8,
      h: 0.35,
      sizing: { type: "contain" }
    });
  } else {
    slide.addText(theme.companyName, {
      x: 0.8,
      y: 5.15,
      w: 2.0,
      h: 0.35,
      fontSize: 9,
      fontFace: "Inter",
      color: theme.primaryColor,
      bold: true,
      valign: "middle"
    });
  }

  // Footer Project Code and Client
  slide.addText(`${projectCode} | Proposta Cliente: ${clientName}`, {
    x: 3.0,
    y: 5.15,
    w: 5.0,
    h: 0.35,
    fontSize: 8,
    fontFace: "Inter",
    color: "64748B",
    valign: "middle",
    align: "right"
  });
}
