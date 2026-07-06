/** Resposta de GET/PUT /api/branding-settings (sem expor campos internos além dos definidos). */
export type BrandingSettingsDTO = {
  companyName: string;
  slogan: string;
  primaryColor: string;
  secondaryColor: string;
  systemCompactLogoDataUrl: string | null;
  systemExpandedLogoDataUrl: string | null;
  proposalLogoDataUrl: string | null;
  darkLogoDataUrl: string | null;
  faviconDataUrl: string | null;
  proposalCoverDataUrl: string | null;
  proposalSideImageDataUrl: string | null;
  watermarkDataUrl: string | null;
};

export const DEFAULT_BRANDING: BrandingSettingsDTO = {
  companyName: "Lazarios Koppetel",
  slogan: "Soluções e qualidade em plásticos",
  primaryColor: "#0EA5E9",
  secondaryColor: "#1D4ED8",
  systemCompactLogoDataUrl: null,
  systemExpandedLogoDataUrl: null,
  proposalLogoDataUrl: null,
  darkLogoDataUrl: null,
  faviconDataUrl: null,
  proposalCoverDataUrl: null,
  proposalSideImageDataUrl: null,
  watermarkDataUrl: null,
};
