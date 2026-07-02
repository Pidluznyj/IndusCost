/**
 * Breakdown explicativo de injeção — mesma regra de capacidade do processo padrão oficial (netPph).
 */
import type { DefaultProcessHourCosts } from "./componentStandardProcessCost.js";

export type ComponentInjectionBreakdownInput = {
  cycleTimeSeconds: number | string | null | undefined;
  cavities: number | string | null | undefined;
  efficiencyExpectedPercent: number | string | null | undefined;
  hourCosts: Pick<
    DefaultProcessHourCosts,
    "globalHhCostPerHour" | "machineHourCostPerHour" | "available"
  > | null;
};

export type ComponentInjectionBreakdownSuccess = {
  ok: true;
  cycleTimeSeconds: number;
  cavities: number;
  efficiencyPercent: number;
  cyclesPerHour: number;
  theoreticalPiecesPerHour: number;
  goodPiecesPerHour: number;
  hhUsedPerHour: number;
  hmUsedPerHour: number;
  injectionHourlyCost: number;
  injectionCostPerPiece: number;
};

export type ComponentInjectionBreakdownFailure = {
  ok: false;
  message: string;
};

export type ComponentInjectionBreakdownResult =
  | ComponentInjectionBreakdownSuccess
  | ComponentInjectionBreakdownFailure;

function parsePositiveNumber(
  raw: number | string | null | undefined
): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function computeComponentInjectionCalculationBreakdown(
  input: ComponentInjectionBreakdownInput
): ComponentInjectionBreakdownResult {
  const cycle = parsePositiveNumber(input.cycleTimeSeconds);
  if (cycle == null || cycle <= 0) {
    return { ok: false, message: "Informe um ciclo válido para calcular." };
  }

  const cavities = parsePositiveNumber(input.cavities);
  if (cavities == null || cavities < 1) {
    return { ok: false, message: "Informe cavidades válidas para calcular." };
  }

  const efficiency = parsePositiveNumber(input.efficiencyExpectedPercent);
  if (efficiency == null || efficiency <= 0) {
    return { ok: false, message: "Informe eficiência válida para calcular." };
  }

  if (!input.hourCosts?.available) {
    return {
      ok: false,
      message: "Não foi possível carregar HH/HM default do sistema. Verifique Configurações Gerais.",
    };
  }

  const hhUsedPerHour = Number(input.hourCosts.globalHhCostPerHour);
  const hmUsedPerHour = Number(input.hourCosts.machineHourCostPerHour);
  if (!Number.isFinite(hhUsedPerHour) || !Number.isFinite(hmUsedPerHour)) {
    return {
      ok: false,
      message: "Não foi possível carregar HH/HM default do sistema. Verifique Configurações Gerais.",
    };
  }

  const cyclesPerHour = 3600 / cycle;
  const theoreticalPiecesPerHour = cyclesPerHour * cavities;
  const goodPiecesPerHour = theoreticalPiecesPerHour * (efficiency / 100);

  if (!Number.isFinite(cyclesPerHour) || cyclesPerHour <= 0) {
    return { ok: false, message: "Informe um ciclo válido para calcular." };
  }
  if (!Number.isFinite(goodPiecesPerHour) || goodPiecesPerHour <= 0) {
    return { ok: false, message: "Informe cavidades válidas para calcular." };
  }

  const injectionHourlyCost = hhUsedPerHour + hmUsedPerHour;
  const injectionCostPerPiece = injectionHourlyCost / goodPiecesPerHour;

  if (!Number.isFinite(injectionHourlyCost) || !Number.isFinite(injectionCostPerPiece)) {
    return {
      ok: false,
      message: "Não foi possível calcular o custo de injeção com os dados informados.",
    };
  }

  return {
    ok: true,
    cycleTimeSeconds: cycle,
    cavities,
    efficiencyPercent: efficiency,
    cyclesPerHour,
    theoreticalPiecesPerHour,
    goodPiecesPerHour,
    hhUsedPerHour,
    hmUsedPerHour,
    injectionHourlyCost,
    injectionCostPerPiece,
  };
}
