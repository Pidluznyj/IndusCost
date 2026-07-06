import type { BrandingSettings } from "@prisma/client";
import { prisma } from "./prisma.js";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding.js";

const DEFAULT_CREATE_DATA = {
  companyName: "Lazarios Koppetel",
  tradeName: "Lazarios",
  slogan: "Soluções e qualidade em plásticos",
  primaryColor: "#0EA5E9",
  secondaryColor: "#1D4ED8",
  accentColor: "#3b82f6",
};

export function toBrandingSettingsDto(row: BrandingSettings): BrandingSettingsDTO {
  return {
    companyName:
      typeof row.companyName === "string" && row.companyName.trim()
        ? row.companyName.trim()
        : DEFAULT_BRANDING.companyName,
    slogan:
      typeof row.slogan === "string" && row.slogan.trim()
        ? row.slogan.trim()
        : DEFAULT_BRANDING.slogan,
    primaryColor:
      typeof row.primaryColor === "string" && row.primaryColor.trim()
        ? row.primaryColor.trim()
        : DEFAULT_BRANDING.primaryColor,
    secondaryColor:
      typeof row.secondaryColor === "string" && row.secondaryColor.trim()
        ? row.secondaryColor.trim()
        : DEFAULT_BRANDING.secondaryColor,
    systemCompactLogoDataUrl: row.systemCompactLogoDataUrl ?? null,
    systemExpandedLogoDataUrl: row.systemExpandedLogoDataUrl ?? null,
    proposalLogoDataUrl: row.proposalLogoDataUrl ?? null,
    darkLogoDataUrl: row.darkLogoDataUrl ?? null,
    faviconDataUrl: row.faviconDataUrl ?? null,
    proposalCoverDataUrl: row.proposalCoverDataUrl ?? null,
    proposalSideImageDataUrl: row.proposalSideImageDataUrl ?? null,
    watermarkDataUrl: row.watermarkDataUrl ?? null,
  };
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  let settings = await prisma.brandingSettings.findFirst();
  if (!settings) {
    settings = await prisma.brandingSettings.create({
      data: DEFAULT_CREATE_DATA,
    });
  }
  return settings;
}

export async function getBrandingSettingsDto(): Promise<BrandingSettingsDTO> {
  return toBrandingSettingsDto(await getBrandingSettings());
}

export async function updateBrandingSettings(data: Record<string, unknown>): Promise<BrandingSettings> {
  const existing = await prisma.brandingSettings.findFirst();
  if (existing) {
    return prisma.brandingSettings.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.brandingSettings.create({
    data: {
      ...DEFAULT_CREATE_DATA,
      ...data,
    },
  });
}
