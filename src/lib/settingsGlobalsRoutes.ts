import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import type { AnalysisCache } from "@/src/lib/productCostAnalysisEngine.server.js";
import {
  APPLY_HH_HM_SIMULATION_API,
  parseApplyHhHmSimulationBody,
} from "./settingsApplyHhHmSimulation.js";
import { applyHhHmSimulationToOfficialParams } from "./settingsApplyHhHmSimulation.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireBootstrapOrAnyPermission: (permissions: string[]) => RequestHandler;
};

type Deps = {
  initAnalysisCache: () => Promise<AnalysisCache>;
  isUuid: (value: unknown) => value is string;
};

export const SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS = [
  "settings.global_params.view",
  "settings.view",
] as const;

export const SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS = [
  "settings.global_params.edit",
  "users.manage",
] as const;

export const SETTINGS_BRANDING_VIEW_PERMISSIONS = [
  "settings.branding.view",
  "settings.view",
] as const;

export const SETTINGS_BRANDING_EDIT_PERMISSIONS = [
  "settings.branding.edit",
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

  const editGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS]),
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

  app.post(APPLY_HH_HM_SIMULATION_API, ...editGuard, async (req, res) => {
    try {
      const parsed = parseApplyHhHmSimulationBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.code, message: parsed.message });
      }
      if (!deps.isUuid(parsed.simulationId)) {
        return res.status(400).json({
          error: "INVALID_SIMULATION_ID",
          message: "Identificador da simulação inválido.",
        });
      }

      const result = await applyHhHmSimulationToOfficialParams(prisma, parsed.simulationId);
      if (!result.ok) {
        return res.status(result.status).json({
          error: result.code,
          message: result.message,
        });
      }

      const globals = await buildSettingsGlobalsPayload(deps.initAnalysisCache);
      return res.json({
        message: result.message,
        simulationId: result.simulationId,
        simulationType: result.simulationType,
        before: result.before,
        after: result.after,
        globals,
      });
    } catch (error) {
      console.error("POST apply-hh-hm-simulation", error);
      return res.status(500).json({
        error: "APPLY_HH_HM_SIMULATION_FAILED",
        message: "Não foi possível aplicar a simulação aos parâmetros oficiais.",
      });
    }
  });

  const brandingViewGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_BRANDING_VIEW_PERMISSIONS]),
  ] as const;

  const brandingEditGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_BRANDING_EDIT_PERMISSIONS]),
  ] as const;

  app.get("/api/branding-settings", ...brandingViewGuard, async (_req, res) => {
    try {
      const { getBrandingSettingsDto } = await import("./brandingSettings.server.js");
      const settings = await getBrandingSettingsDto();
      return res.json(settings);
    } catch (error) {
      console.error("GET /api/branding-settings", error);
      return res.status(500).json({ error: "Erro ao carregar identidade visual." });
    }
  });

  app.put("/api/branding-settings", ...brandingEditGuard, async (req, res) => {
    try {
      const {
        companyName,
        tradeName,
        slogan,
        document,
        logoUrl,
        logoBase64,
        primaryColor,
        secondaryColor,
        accentColor,
        systemCompactLogoDataUrl,
        systemExpandedLogoDataUrl,
        proposalLogoDataUrl,
        darkLogoDataUrl,
        faviconDataUrl,
        proposalCoverDataUrl,
        proposalSideImageDataUrl,
        watermarkDataUrl,
        address,
        phone,
        email,
        website,
        proposalFooterText,
        commercialContactName,
        commercialContactEmail,
        commercialContactPhone
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
      if (accentColor && !hexRegex.test(accentColor)) {
        return res.status(400).json({ error: "VALIDATION_FAILED", message: "Cor de destaque inválida. Deve ser um código hexadecimal." });
      }

      const { updateBrandingSettings, toBrandingSettingsDto } = await import(
        "./brandingSettings.server.js"
      );
      const settings = await updateBrandingSettings({
        companyName: companyName.trim(),
        tradeName: tradeName?.trim() || companyName.trim(),
        slogan: slogan?.trim() || null,
        document: document?.trim() || null,
        logoUrl: logoUrl?.trim() || null,
        logoBase64: logoBase64 || null,
        primaryColor: primaryColor || "#0EA5E9",
        secondaryColor: secondaryColor || "#1D4ED8",
        accentColor: accentColor || "#3b82f6",
        systemCompactLogoDataUrl: systemCompactLogoDataUrl || null,
        systemExpandedLogoDataUrl: systemExpandedLogoDataUrl || null,
        proposalLogoDataUrl: proposalLogoDataUrl || null,
        darkLogoDataUrl: darkLogoDataUrl || null,
        faviconDataUrl: faviconDataUrl || null,
        proposalCoverDataUrl: proposalCoverDataUrl || null,
        proposalSideImageDataUrl: proposalSideImageDataUrl || null,
        watermarkDataUrl: watermarkDataUrl || null,
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        website: website?.trim() || null,
        proposalFooterText: proposalFooterText?.trim() || null,
        commercialContactName: commercialContactName?.trim() || null,
        commercialContactEmail: commercialContactEmail?.trim() || null,
        commercialContactPhone: commercialContactPhone?.trim() || null,
      });

      return res.json(toBrandingSettingsDto(settings));
    } catch (error) {
      console.error("PUT /api/branding-settings", error);
      return res.status(500).json({ error: "Erro ao salvar identidade visual." });
    }
  });
}

