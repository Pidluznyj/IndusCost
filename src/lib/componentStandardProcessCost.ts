/**
 * Custo de processo padrão de componente — mesma regra do motor oficial (STANDARD_PROCESS).
 */

export type ProcessHourCostsCache = {
  globalHhCost: number;
  energyCost: number;
  workingHours: number;
  hhSource?: "AUTO" | "MANUAL";
};

export type DefaultProcessHourCosts = {
  globalHhCostPerHour: number;
  machineHourCostPerHour: number;
  hhSource: "AUTO" | "MANUAL";
  available: boolean;
};

export type StandardProcessCostInput = {
  cycleTimeSeconds: number;
  cavities: number;
  efficiencyExpectedPercent: number;
  setupTimeMin: number;
  lotSize: number;
  globalHhCostPerHour: number;
  machineHourCostPerHour: number;
};

export type StandardProcessCostSuccess = {
  ok: true;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalStepCost: number;
  unitTransform: number;
  setupCost: number;
  netPph: number;
  cellHourCost: number;
  machineHourCostPerHour: number;
  globalHhCostPerHour: number;
};

export type StandardProcessCostFailure = {
  ok: false;
  errorCode: string;
  message: string;
};

export type StandardProcessCostResult = StandardProcessCostSuccess | StandardProcessCostFailure;

export type SimulatedComponentProcessInputs = {
  useDefaultHourCosts: boolean;
  cycleTimeSeconds?: number;
  cavities?: number;
  efficiencyExpectedPercent?: number;
  setupTimeMin?: number;
  lotSize?: number;
  manualHh?: number;
  manualHm?: number;
};

export function resolveDefaultProcessHourCostsFromAnalysisCache(
  cache: ProcessHourCostsCache
): DefaultProcessHourCosts {
  const workingHours = Number(cache.workingHours);
  const energyCost = Number(cache.energyCost);
  const globalHhCostPerHour = Number(cache.globalHhCost);
  const machineHourCostPerHour =
    Number.isFinite(workingHours) && workingHours > 0 ? energyCost / workingHours : NaN;

  const available =
    Number.isFinite(globalHhCostPerHour) &&
    globalHhCostPerHour >= 0 &&
    Number.isFinite(machineHourCostPerHour) &&
    machineHourCostPerHour >= 0;

  return {
    globalHhCostPerHour: available ? globalHhCostPerHour : 0,
    machineHourCostPerHour: available ? machineHourCostPerHour : 0,
    hhSource: cache.hhSource ?? "AUTO",
    available,
  };
}

export type OfficialDefaultIndustrialCostsReference = {
  hhDefault: number;
  hmDefault: number;
  injectionHourlyCostDefault: number;
  hhSource: "AUTO" | "MANUAL";
  source: "GENERAL_SETTINGS";
  available: boolean;
};

export function buildOfficialDefaultIndustrialCostsReference(
  cache: ProcessHourCostsCache
): OfficialDefaultIndustrialCostsReference {
  const costs = resolveDefaultProcessHourCostsFromAnalysisCache(cache);
  if (!costs.available) {
    return {
      hhDefault: 0,
      hmDefault: 0,
      injectionHourlyCostDefault: 0,
      hhSource: costs.hhSource,
      source: "GENERAL_SETTINGS",
      available: false,
    };
  }

  const injectionHourlyCostDefault = costs.globalHhCostPerHour + costs.machineHourCostPerHour;

  return {
    hhDefault: costs.globalHhCostPerHour,
    hmDefault: costs.machineHourCostPerHour,
    injectionHourlyCostDefault: Number.isFinite(injectionHourlyCostDefault)
      ? injectionHourlyCostDefault
      : 0,
    hhSource: costs.hhSource,
    source: "GENERAL_SETTINGS",
    available: true,
  };
}

export function compareSimulatedInjectionHourlyToOfficial(input: {
  simulatedInjectionHourlyCost: number | null;
  officialReference: Pick<
    OfficialDefaultIndustrialCostsReference,
    "injectionHourlyCostDefault" | "available"
  > | null;
}): {
  official: number;
  simulated: number;
  difference: number;
  differencePct: number;
} | null {
  if (!input.officialReference?.available) return null;
  const official = Number(input.officialReference.injectionHourlyCostDefault);
  const simulated = input.simulatedInjectionHourlyCost;
  if (simulated == null || !Number.isFinite(official) || !Number.isFinite(simulated)) {
    return null;
  }
  const difference = simulated - official;
  const differencePct = official !== 0 ? (difference / official) * 100 : 0;
  if (!Number.isFinite(difference) || !Number.isFinite(differencePct)) return null;
  return { official, simulated, difference, differencePct };
}

export function computeStandardProcessUnitCosts(
  input: StandardProcessCostInput
): StandardProcessCostResult {
  const cycle = Number(input.cycleTimeSeconds);
  const cav = Number(input.cavities);
  const eff = Number(input.efficiencyExpectedPercent);
  const setup = Number(input.setupTimeMin);
  const lotSize = Number(input.lotSize) || 1;
  const machineHourCost = Number(input.machineHourCostPerHour);
  const globalHhCost = Number(input.globalHhCostPerHour);

  if (!Number.isFinite(cycle) || cycle <= 0) {
    return {
      ok: false,
      errorCode: "INVALID_CYCLE",
      message: "Informe ciclo em segundos maior que zero.",
    };
  }
  if (!Number.isFinite(cav) || cav < 1) {
    return {
      ok: false,
      errorCode: "INVALID_CAVITIES",
      message: "Informe cavidades boas maiores ou iguais a 1.",
    };
  }
  if (!Number.isFinite(eff) || eff <= 0) {
    return {
      ok: false,
      errorCode: "INVALID_EFFICIENCY",
      message: "Informe eficiência esperada maior que 0%.",
    };
  }
  if (!Number.isFinite(setup) || setup < 0) {
    return {
      ok: false,
      errorCode: "INVALID_SETUP",
      message: "Setup inválido.",
    };
  }
  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    return {
      ok: false,
      errorCode: "INVALID_LOT_SIZE",
      message: "Lote padrão deve ser maior que zero.",
    };
  }
  if (!Number.isFinite(machineHourCost) || !Number.isFinite(globalHhCost)) {
    return {
      ok: false,
      errorCode: "MISSING_HOUR_COSTS",
      message: "Não foi possível carregar o custo default de HH/HM. Verifique Configurações Gerais.",
    };
  }

  const effDecimal = eff / 100;
  const cellHourCost = machineHourCost + globalHhCost;
  const netPph = (3600 / cycle) * cav * effDecimal;

  if (!Number.isFinite(netPph) || netPph <= 0) {
    return {
      ok: false,
      errorCode: "INVALID_THROUGHPUT",
      message: "Informe os dados necessários para calcular.",
    };
  }

  const unitTransform = cellHourCost / netPph;
  const setupH = setup / 60;
  const setupCost = (setupH * cellHourCost) / lotSize;
  const totalStepCost = unitTransform + setupCost;

  const hhRatio = cellHourCost > 0 ? globalHhCost / cellHourCost : 0;
  const hmRatio = cellHourCost > 0 ? machineHourCost / cellHourCost : 0;

  return {
    ok: true,
    totalHH_Unit: totalStepCost * hhRatio,
    totalHM_Unit: totalStepCost * hmRatio,
    totalStepCost,
    unitTransform,
    setupCost,
    netPph,
    cellHourCost,
    machineHourCostPerHour: machineHourCost,
    globalHhCostPerHour: globalHhCost,
  };
}

export function resolveSimulatedComponentHhHm(input: {
  useDefaultHourCosts: boolean;
  manualHh: number;
  manualHm: number;
  process?: {
    cycleTimeSeconds: number;
    cavities: number;
    efficiencyExpectedPercent: number;
    setupTimeMin: number;
    lotSize: number;
  };
  defaultHourCosts?: DefaultProcessHourCosts | null;
}): { hh: number; hm: number; error: string | null; source: "DEFAULT" | "MANUAL" } {
  if (input.useDefaultHourCosts) {
    if (!input.defaultHourCosts?.available) {
      return {
        hh: 0,
        hm: 0,
        error: "Não foi possível carregar o custo default de HH/HM. Verifique Configurações Gerais.",
        source: "DEFAULT",
      };
    }
    if (!input.process) {
      return {
        hh: 0,
        hm: 0,
        error: "Informe ciclo e cavidades para calcular HH/HM.",
        source: "DEFAULT",
      };
    }
    const computed = computeStandardProcessUnitCosts({
      ...input.process,
      globalHhCostPerHour: input.defaultHourCosts.globalHhCostPerHour,
      machineHourCostPerHour: input.defaultHourCosts.machineHourCostPerHour,
    });
    if (!computed.ok) {
      return { hh: 0, hm: 0, error: computed.message, source: "DEFAULT" };
    }
    return { hh: computed.totalHH_Unit, hm: computed.totalHM_Unit, error: null, source: "DEFAULT" };
  }

  return {
    hh: Number(input.manualHh) || 0,
    hm: Number(input.manualHm) || 0,
    error: null,
    source: "MANUAL",
  };
}
