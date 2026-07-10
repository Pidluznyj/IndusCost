/**
 * Aplicação de simulação HH/HM salva aos parâmetros oficiais existentes (GLOBAL_PARAM).
 * Sem migration / sem campo novo: HH → HH_VALUE_OVERRIDE; HM → ENERGY_COST = HM × WORKING_HOURS.
 */

export const APPLY_HH_HM_SIMULATION_API =
  "/api/settings/global-parameters/apply-hh-hm-simulation" as const;

export type OfficialHhHmRatesSnapshot = {
  hhDefault: number | null;
  hmDefault: number | null;
  injectionHourlyCostDefault: number | null;
  energyCost: number | null;
  workingHours: number | null;
  hhOverride: number | null;
};

export type ApplyHhHmSimulationPlan = {
  hhOverrideValue: number | null;
  energyCostValue: number | null;
  workingHoursValue: number | null;
  updateHhOverride: boolean;
  updateEnergyCost: boolean;
  keepWorkingHours: boolean;
  before: OfficialHhHmRatesSnapshot;
  after: OfficialHhHmRatesSnapshot;
};

export type ApplyHhHmSimulationPlanResult =
  | { ok: true; plan: ApplyHhHmSimulationPlan }
  | { ok: false; code: string; message: string };

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function computeOfficialHmFromEnergyHours(
  energyCost: number | null,
  workingHours: number | null
): number | null {
  if (energyCost == null || workingHours == null || workingHours <= 0) return null;
  const hm = energyCost / workingHours;
  return Number.isFinite(hm) ? hm : null;
}

export function buildOfficialRatesSnapshot(input: {
  hhOverride: number | null;
  energyCost: number | null;
  workingHours: number | null;
}): OfficialHhHmRatesSnapshot {
  const hhDefault =
    input.hhOverride != null && input.hhOverride > 0 ? input.hhOverride : null;
  const hmDefault = computeOfficialHmFromEnergyHours(input.energyCost, input.workingHours);
  const injection =
    hhDefault != null || hmDefault != null
      ? (hhDefault ?? 0) + (hmDefault ?? 0)
      : null;
  return {
    hhDefault,
    hmDefault,
    injectionHourlyCostDefault: injection,
    energyCost: input.energyCost,
    workingHours: input.workingHours,
    hhOverride: input.hhOverride,
  };
}

/**
 * Planeja atualização dos GLOBAL_PARAM existentes a partir das taxas da simulação.
 * - HH → HH_VALUE_OVERRIDE
 * - HM → ENERGY_COST = HM × WORKING_HOURS (WORKING_HOURS preservado)
 */
export function planApplyHhHmSimulationToOfficialParams(input: {
  hhEffectiveRate: number | null;
  hmEffectiveRate: number | null;
  currentHhOverride: number | null;
  currentEnergyCost: number | null;
  currentWorkingHours: number | null;
}): ApplyHhHmSimulationPlanResult {
  const hh = finiteOrNull(input.hhEffectiveRate);
  const hm = finiteOrNull(input.hmEffectiveRate);

  if (hh == null && hm == null) {
    return {
      ok: false,
      code: "MISSING_RATES",
      message: "A simulação não possui taxa HH nem HM válida para aplicar.",
    };
  }
  if (hh != null && hh < 0) {
    return { ok: false, code: "INVALID_HH", message: "Taxa HH da simulação inválida." };
  }
  if (hm != null && hm < 0) {
    return { ok: false, code: "INVALID_HM", message: "Taxa HM da simulação inválida." };
  }

  const workingHours = finiteOrNull(input.currentWorkingHours);
  if (hm != null) {
    if (workingHours == null || workingHours <= 0) {
      return {
        ok: false,
        code: "WORKING_HOURS_REQUIRED",
        message:
          "Configure Horas Máquina Disponíveis (WORKING_HOURS) antes de aplicar a taxa HM da simulação.",
      };
    }
  }

  const before = buildOfficialRatesSnapshot({
    hhOverride: finiteOrNull(input.currentHhOverride),
    energyCost: finiteOrNull(input.currentEnergyCost),
    workingHours,
  });

  const updateHhOverride = hh != null;
  const updateEnergyCost = hm != null;
  const hhOverrideValue = updateHhOverride ? hh : before.hhOverride;
  const energyCostValue = updateEnergyCost
    ? Number((hm! * workingHours!).toFixed(6))
    : before.energyCost;

  const after = buildOfficialRatesSnapshot({
    hhOverride: hhOverrideValue,
    energyCost: energyCostValue,
    workingHours: workingHours,
  });

  return {
    ok: true,
    plan: {
      hhOverrideValue: updateHhOverride ? hh : null,
      energyCostValue: updateEnergyCost ? energyCostValue : null,
      workingHoursValue: workingHours,
      updateHhOverride,
      updateEnergyCost,
      keepWorkingHours: true,
      before,
      after,
    },
  };
}

export function parseApplyHhHmSimulationBody(
  body: unknown
):
  | { ok: true; simulationId: string; confirm: true }
  | { ok: false; code: string; message: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "INVALID_BODY", message: "Payload inválido." };
  }
  const raw = body as Record<string, unknown>;
  const simulationId =
    typeof raw.simulationId === "string" ? raw.simulationId.trim() : "";
  if (!simulationId) {
    return {
      ok: false,
      code: "MISSING_SIMULATION_ID",
      message: "Informe o identificador da simulação.",
    };
  }
  if (raw.confirm !== true) {
    return {
      ok: false,
      code: "CONFIRM_REQUIRED",
      message: "Confirme explicitamente a aplicação (confirm: true).",
    };
  }
  return { ok: true, simulationId, confirm: true };
}
