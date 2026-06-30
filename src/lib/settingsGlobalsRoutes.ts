import type express from "express";
import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
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

function parseFiniteNumberFromUnknown(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOptionalSimulationText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDecimal6(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

export function buildProductionHourFormulaText(input: {
  payrollCostMonth: number;
  energyCostMonth: number;
  otherProductiveCostsMonth: number;
  productiveHoursMonth: number;
  totalProductionHourCost: number;
}): string {
  return [
    "Valor hora = (Custo folha produção + Custo energia + Outros custos produtivos) / Horas produtivas disponíveis",
    `Valor hora = (${input.payrollCostMonth.toFixed(6)} + ${input.energyCostMonth.toFixed(6)} + ${input.otherProductiveCostsMonth.toFixed(6)}) / ${input.productiveHoursMonth.toFixed(6)} = ${input.totalProductionHourCost.toFixed(6)}`,
  ].join("\n");
}

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

  app.get("/api/settings/production-hour-cost-simulations", ...viewGuard, async (_req, res) => {
    try {
      const rows = await prisma.productionHourCostSimulation.findMany({
        orderBy: [{ createdAt: "desc" }],
      });
      return res.json(rows);
    } catch (error) {
      console.error("GET /api/settings/production-hour-cost-simulations", error);
      return res.status(500).json({ error: "Erro ao listar simulações de custo hora." });
    }
  });

  app.get("/api/settings/production-hour-cost-simulations/:id", ...viewGuard, async (req, res) => {
    try {
      const row = await prisma.productionHourCostSimulation.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!row) {
        return res.status(404).json({ error: "Simulação não encontrada." });
      }
      return res.json(row);
    } catch (error) {
      console.error("GET /api/settings/production-hour-cost-simulations/:id", error);
      return res.status(500).json({ error: "Erro ao carregar simulação de custo hora." });
    }
  });

  app.post("/api/settings/production-hour-cost-simulations", ...editGuard, async (req, res) => {
    try {
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return res.status(400).json({ error: "Nome da simulação é obrigatório." });
      }

      const payrollCostMonth = parseFiniteNumberFromUnknown(body.payrollCostMonth, 0);
      const energyCostMonth = parseFiniteNumberFromUnknown(body.energyCostMonth, 0);
      const otherProductiveCostsMonth = parseFiniteNumberFromUnknown(body.otherProductiveCostsMonth, 0);
      const productiveHoursMonth = parseFiniteNumberFromUnknown(body.productiveHoursMonth, 0);

      if (productiveHoursMonth <= 0) {
        return res.status(400).json({ error: "Horas produtivas devem ser maiores que zero." });
      }
      if (payrollCostMonth < 0 || energyCostMonth < 0 || otherProductiveCostsMonth < 0) {
        return res.status(400).json({ error: "Custos mensais não podem ser negativos." });
      }

      const payrollCostPerHour = payrollCostMonth / productiveHoursMonth;
      const energyCostPerHour = energyCostMonth / productiveHoursMonth;
      const otherCostPerHour = otherProductiveCostsMonth / productiveHoursMonth;
      const totalProductionHourCost =
        (payrollCostMonth + energyCostMonth + otherProductiveCostsMonth) / productiveHoursMonth;

      if (
        !Number.isFinite(payrollCostPerHour) ||
        !Number.isFinite(energyCostPerHour) ||
        !Number.isFinite(otherCostPerHour) ||
        !Number.isFinite(totalProductionHourCost)
      ) {
        return res.status(400).json({ error: "Não foi possível calcular valores válidos para a simulação." });
      }

      const created = await prisma.productionHourCostSimulation.create({
        data: {
          name,
          payrollCostMonth: toDecimal6(payrollCostMonth),
          payrollCostComment: normalizeOptionalSimulationText(body.payrollCostComment),
          energyCostMonth: toDecimal6(energyCostMonth),
          energyCostComment: normalizeOptionalSimulationText(body.energyCostComment),
          otherProductiveCostsMonth: toDecimal6(otherProductiveCostsMonth),
          otherProductiveCostsComment: normalizeOptionalSimulationText(body.otherProductiveCostsComment),
          productiveHoursMonth: toDecimal6(productiveHoursMonth),
          productiveHoursComment: normalizeOptionalSimulationText(body.productiveHoursComment),
          payrollCostPerHour: toDecimal6(payrollCostPerHour),
          energyCostPerHour: toDecimal6(energyCostPerHour),
          otherCostPerHour: toDecimal6(otherCostPerHour),
          totalProductionHourCost: toDecimal6(totalProductionHourCost),
          formulaText: buildProductionHourFormulaText({
            payrollCostMonth,
            energyCostMonth,
            otherProductiveCostsMonth,
            productiveHoursMonth,
            totalProductionHourCost,
          }),
          notes: normalizeOptionalSimulationText(body.notes),
        },
      });

      return res.status(201).json(created);
    } catch (error) {
      console.error("POST /api/settings/production-hour-cost-simulations", error);
      return res.status(500).json({ error: "Erro ao salvar simulação de custo hora." });
    }
  });

  app.delete("/api/settings/production-hour-cost-simulations/:id", ...editGuard, async (req, res) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.productionHourCostSimulation.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "Simulação não encontrada." });
      }
      await prisma.productionHourCostSimulation.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/settings/production-hour-cost-simulations/:id", error);
      return res.status(500).json({ error: "Erro ao excluir simulação de custo hora." });
    }
  });
}
