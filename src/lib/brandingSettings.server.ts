import { prisma } from "./prisma.js";

export async function getBrandingSettings() {
  let settings = await prisma.brandingSettings.findFirst();
  if (!settings) {
    settings = await prisma.brandingSettings.create({
      data: {
        companyName: "Lazarios Koppetel",
        tradeName: "Lazarios",
        slogan: "Soluções e qualidade em plásticos",
        primaryColor: "#0EA5E9",
        secondaryColor: "#1D4ED8",
        accentColor: "#3b82f6",
      }
    });
  }
  return settings;
}

export async function updateBrandingSettings(data: any) {
  const existing = await prisma.brandingSettings.findFirst();
  if (existing) {
    return await prisma.brandingSettings.update({
      where: { id: existing.id },
      data
    });
  } else {
    return await prisma.brandingSettings.create({
      data
    });
  }
}
