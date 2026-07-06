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
}
