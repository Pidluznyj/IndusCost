import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import type { AnalysisCache } from "@/src/lib/productCostAnalysisEngine.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireBootstrapOrAnyPermission: (permissions: string[]) => RequestHandler;
};

type Deps = {
  initAnalysisCache: () => Promise<AnalysisCache>;
};

export const SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS = [
  "settings.global_params.view",
  "settings.view",
] as const;

export const SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS = [
  "settings.global_params.edit",
  "users.manage",
] as const;

export async function buildSettingsGlobalsPayload(
  initAnalysisCache: () => Promise<AnalysisCache>
) {
  const indirects = await prisma.indirectCost.findMany({ where: { category: "GLOBAL_PARAM" } });

  const energy = indirects.find((c) => c.description === "ENERGY_COST");
  const hours = indirects.find((c) => c.description === "WORKING_HOURS");
  const factoryH = indirects.find((c) => c.description === "FACTORY_HOURS_MONTHLY");
  const hhOverride = indirects.find((c) => c.description === "HH_VALUE_OVERRIDE");

  const overrideVal = hhOverride ? Number(hhOverride.monthlyValue) : NaN;

  let calculated: { hhAuto: number; hhSource: "AUTO" | "MANUAL" } = {
    hhAuto: 0,
    hhSource: "AUTO",
  };

  try {
    const cache = await initAnalysisCache();
    calculated = {
      hhAuto: cache.autoHhCost ?? 0,
      hhSource: cache.hhSource ?? "AUTO",
    };
  } catch (error) {
    console.warn("GET /api/settings/globals: initAnalysisCache parcial", error);
  }

  return {
    values: {
      energyCost: energy ? Number(energy.monthlyValue) : 0,
      workingHours: hours ? Number(hours.monthlyValue) : 176,
      factoryHours: factoryH ? Number(factoryH.monthlyValue) : 8448,
      hhOverride: Number.isFinite(overrideVal) && overrideVal > 0 ? overrideVal : null,
    },
    ids: {
      energyId: energy?.id,
      hoursId: hours?.id,
      factoryId: factoryH?.id,
      hhOverrideId: hhOverride?.id,
    },
    calculated,
  };
}

export function registerSettingsGlobalsRoutes(
  app: express.Express,
  auth: AuthGuards,
  deps: Deps
) {
  const { requireAppAuth, requireBootstrapOrAnyPermission } = auth;
  const viewGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS]),
  ] as const;

  app.get("/api/settings/globals", ...viewGuard, async (_req, res) => {
    try {
      const payload = await buildSettingsGlobalsPayload(deps.initAnalysisCache);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/settings/globals", error);
      return res.status(500).json({ error: "Erro ao carregar configurações globais." });
    }
  });

  const editGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS]),
  ] as const;

  app.get("/api/branding-settings", ...viewGuard, async (_req, res) => {
    try {
      let settings = await prisma.brandingSettings.findFirst();
      if (!settings) {
        settings = await prisma.brandingSettings.create({
          data: {
            companyName: "Lazarios Koppetel",
            slogan: "Soluções e qualidade em plásticos",
            primaryColor: "#0EA5E9",
            secondaryColor: "#1D4ED8",
          }
        });
      }
      return res.json(settings);
    } catch (error) {
      console.error("GET /api/branding-settings", error);
      return res.status(500).json({ error: "Erro ao carregar identidade visual." });
    }
  });

  app.put("/api/branding-settings", ...editGuard, async (req, res) => {
    try {
      const {
        companyName,
        slogan,
        primaryColor,
        secondaryColor,
        systemCompactLogoDataUrl,
        systemExpandedLogoDataUrl,
        proposalLogoDataUrl,
        darkLogoDataUrl,
        faviconDataUrl,
        proposalCoverDataUrl,
        proposalSideImageDataUrl,
        watermarkDataUrl
      } = req.body;

      if (!companyName || typeof companyName !== "string" || companyName.trim() === "") {
        return res.status(400).json({ error: "VALIDATION_FAILED", message: "Nome da empresa é obrigatório." });
      }

      const hexRegex = /^#([0-9a-fA-F]{3}){1,2}$/;
      if (primaryColor && !hexRegex.test(primaryColor)) {
        return res.status(400).json({ error: "VALIDATION_FAILED", message: "Cor primária inválida. Deve ser um código hexadecimal." });
      }
      if (secondaryColor && !hexRegex.test(secondaryColor)) {
        return res.status(400).json({ error: "VALIDATION_FAILED", message: "Cor secundária inválida. Deve ser um código hexadecimal." });
      }

      let settings = await prisma.brandingSettings.findFirst();
      if (settings) {
        settings = await prisma.brandingSettings.update({
          where: { id: settings.id },
          data: {
            companyName: companyName.trim(),
            slogan: slogan?.trim() || null,
            primaryColor: primaryColor || "#0EA5E9",
            secondaryColor: secondaryColor || "#1D4ED8",
            systemCompactLogoDataUrl: systemCompactLogoDataUrl || null,
            systemExpandedLogoDataUrl: systemExpandedLogoDataUrl || null,
            proposalLogoDataUrl: proposalLogoDataUrl || null,
            darkLogoDataUrl: darkLogoDataUrl || null,
            faviconDataUrl: faviconDataUrl || null,
            proposalCoverDataUrl: proposalCoverDataUrl || null,
            proposalSideImageDataUrl: proposalSideImageDataUrl || null,
            watermarkDataUrl: watermarkDataUrl || null,
          }
        });
      } else {
        settings = await prisma.brandingSettings.create({
          data: {
            companyName: companyName.trim(),
            slogan: slogan?.trim() || null,
            primaryColor: primaryColor || "#0EA5E9",
            secondaryColor: secondaryColor || "#1D4ED8",
            systemCompactLogoDataUrl: systemCompactLogoDataUrl || null,
            systemExpandedLogoDataUrl: systemExpandedLogoDataUrl || null,
            proposalLogoDataUrl: proposalLogoDataUrl || null,
            darkLogoDataUrl: darkLogoDataUrl || null,
            faviconDataUrl: faviconDataUrl || null,
            proposalCoverDataUrl: proposalCoverDataUrl || null,
            proposalSideImageDataUrl: proposalSideImageDataUrl || null,
            watermarkDataUrl: watermarkDataUrl || null,
          }
        });
      }

      return res.json(settings);
    } catch (error) {
      console.error("PUT /api/branding-settings", error);
      return res.status(500).json({ error: "Erro ao salvar identidade visual." });
    }
  });
}

