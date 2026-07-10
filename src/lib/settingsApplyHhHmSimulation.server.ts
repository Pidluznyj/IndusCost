/**
 * Aplica simulação HH/HM aos IndirectCost GLOBAL_PARAM existentes.
 */
import type { PrismaClient } from "@prisma/client";
import { getTransformationHhHmCostSimulationById } from "./transformationHhHmSimulationHistory.server.js";
import {
  planApplyHhHmSimulationToOfficialParams,
  type ApplyHhHmSimulationPlan,
  type OfficialHhHmRatesSnapshot,
} from "./settingsApplyHhHmSimulation.js";

type IndirectCostClient = Pick<PrismaClient, "indirectCost">;

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

async function findGlobalParam(db: IndirectCostClient, description: string) {
  return db.indirectCost.findFirst({
    where: { category: "GLOBAL_PARAM", description },
  });
}

async function upsertGlobalParam(
  db: IndirectCostClient,
  input: {
    description: string;
    monthlyValue: number;
    allocationCriteria: string;
    existingId?: string | null;
  }
) {
  if (input.existingId) {
    return db.indirectCost.update({
      where: { id: input.existingId },
      data: {
        monthlyValue: input.monthlyValue,
        category: "GLOBAL_PARAM",
        description: input.description,
        status: "ACTIVE",
        costCenter: "Geral",
        allocationCriteria: input.allocationCriteria,
      },
    });
  }
  return db.indirectCost.create({
    data: {
      description: input.description,
      category: "GLOBAL_PARAM",
      monthlyValue: input.monthlyValue,
      costCenter: "Geral",
      allocationCriteria: input.allocationCriteria,
      status: "ACTIVE",
    },
  });
}

export type ApplyHhHmSimulationResult =
  | {
      ok: true;
      simulationId: string;
      simulationType: string;
      plan: ApplyHhHmSimulationPlan;
      before: OfficialHhHmRatesSnapshot;
      after: OfficialHhHmRatesSnapshot;
      message: string;
    }
  | { ok: false; status: number; code: string; message: string };

export async function applyHhHmSimulationToOfficialParams(
  prisma: PrismaClient,
  simulationId: string
): Promise<ApplyHhHmSimulationResult> {
  const simulation = await getTransformationHhHmCostSimulationById(prisma, simulationId);
  if (!simulation) {
    return {
      ok: false,
      status: 404,
      code: "SIMULATION_NOT_FOUND",
      message: "Simulação HH/HM não encontrada.",
    };
  }

  const [hhOverrideRow, energyRow, hoursRow] = await Promise.all([
    findGlobalParam(prisma, "HH_VALUE_OVERRIDE"),
    findGlobalParam(prisma, "ENERGY_COST"),
    findGlobalParam(prisma, "WORKING_HOURS"),
  ]);

  const planned = planApplyHhHmSimulationToOfficialParams({
    hhEffectiveRate: simulation.hhEffectiveRate,
    hmEffectiveRate: simulation.hmEffectiveRate,
    currentHhOverride: toNum(hhOverrideRow?.monthlyValue),
    currentEnergyCost: toNum(energyRow?.monthlyValue),
    currentWorkingHours: toNum(hoursRow?.monthlyValue),
  });

  if (!planned.ok) {
    return {
      ok: false,
      status: 400,
      code: planned.code,
      message: planned.message,
    };
  }

  const { plan } = planned;

  await prisma.$transaction(async (tx) => {
    if (plan.updateHhOverride && plan.hhOverrideValue != null) {
      await upsertGlobalParam(tx, {
        description: "HH_VALUE_OVERRIDE",
        monthlyValue: plan.hhOverrideValue,
        allocationCriteria: "Override",
        existingId: hhOverrideRow?.id ?? null,
      });
    }
    if (plan.updateEnergyCost && plan.energyCostValue != null) {
      await upsertGlobalParam(tx, {
        description: "ENERGY_COST",
        monthlyValue: plan.energyCostValue,
        allocationCriteria: "Geral",
        existingId: energyRow?.id ?? null,
      });
    }
  });

  console.info(
    "[settings] apply-hh-hm-simulation",
    JSON.stringify({
      simulationId: simulation.id,
      type: simulation.type,
      before: plan.before,
      after: plan.after,
    })
  );

  return {
    ok: true,
    simulationId: simulation.id,
    simulationType: simulation.type,
    plan,
    before: plan.before,
    after: plan.after,
    message: "Simulação aplicada aos parâmetros oficiais de HH/HM com sucesso.",
  };
}
