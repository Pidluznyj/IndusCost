/**
 * Simulador puro de custo de transformação — sem Prisma, sem custo oficial.
 */

export const TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE =
  "Informe os dados necessários para calcular";

export type TransformationCostSimulatorFormValues = {
  monthlyPayroll: string;
  productivePeople: string;
  hoursPerPerson: string;
  laborEfficiencyPercent: string;
  monthlyEnergy: string;
  machines: string;
  hoursPerMachine: string;
  machineEfficiencyPercent: string;
  simulationName: string;
  cycleSeconds: string;
  cavities: string;
  operators: string;
  scrapPercent: string;
};

export const DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES: TransformationCostSimulatorFormValues =
  {
    monthlyPayroll: "160000",
    productivePeople: "60",
    hoursPerPerson: "180",
    laborEfficiencyPercent: "80",
    monthlyEnergy: "25000",
    machines: "13",
    hoursPerMachine: "180",
    machineEfficiencyPercent: "80",
    simulationName: "Peça exemplo",
    cycleSeconds: "64",
    cavities: "24",
    operators: "1",
    scrapPercent: "0",
  };

export const EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES: TransformationCostSimulatorFormValues =
  {
    monthlyPayroll: "",
    productivePeople: "",
    hoursPerPerson: "",
    laborEfficiencyPercent: "",
    monthlyEnergy: "",
    machines: "",
    hoursPerMachine: "",
    machineEfficiencyPercent: "",
    simulationName: "",
    cycleSeconds: "",
    cavities: "",
    operators: "",
    scrapPercent: "",
  };

export const TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY =
  "induscost.transformation-cost-simulator.v1";

export type TransformationCostSimulatorLaborBlock = {
  theoreticalLaborHours: number | null;
  theoreticalHH: number | null;
  adjustedLaborHours: number | null;
  adjustedHH: number | null;
};

export type TransformationCostSimulatorEnergyBlock = {
  theoreticalMachineHours: number | null;
  theoreticalHM: number | null;
  adjustedMachineHours: number | null;
  adjustedHM: number | null;
};

export type TransformationCostSimulatorProductBlock = {
  transformationCostPerHour: number | null;
  cyclesPerHour: number | null;
  theoreticalPiecesPerHour: number | null;
  goodPiecesPerHour: number | null;
  estimatedTransformationCostPerPiece: number | null;
};

export type TransformationCostSimulatorResult = {
  labor: TransformationCostSimulatorLaborBlock;
  energy: TransformationCostSimulatorEnergyBlock;
  product: TransformationCostSimulatorProductBlock;
  fieldErrors: Partial<Record<keyof TransformationCostSimulatorFormValues, string>>;
};

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function isPositive(value: number | null): value is number {
  return value != null && value > 0;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function parseEfficiencyPercent(raw: string): { value: number | null; error?: string } {
  const parsed = parseNumber(raw);
  if (parsed == null) return { value: null };
  if (parsed <= 0) return { value: null, error: "Eficiência deve ser maior que 0%." };
  if (parsed > 100) return { value: null, error: "Eficiência não pode ser maior que 100%." };
  return { value: parsed };
}

function parseScrapPercent(raw: string): { value: number | null; error?: string } {
  const parsed = parseNumber(raw);
  if (parsed == null) return { value: null };
  if (parsed < 0) return { value: null, error: "Refugo não pode ser negativo." };
  if (parsed > 100) return { value: null, error: "Refugo não pode ser maior que 100%." };
  return { value: parsed };
}

export function computeTransformationCostSimulator(
  input: TransformationCostSimulatorFormValues
): TransformationCostSimulatorResult {
  const fieldErrors: TransformationCostSimulatorResult["fieldErrors"] = {};

  const monthlyPayroll = parseNumber(input.monthlyPayroll);
  const productivePeople = parseNumber(input.productivePeople);
  const hoursPerPerson = parseNumber(input.hoursPerPerson);
  const laborEfficiency = parseEfficiencyPercent(input.laborEfficiencyPercent);
  if (laborEfficiency.error) fieldErrors.laborEfficiencyPercent = laborEfficiency.error;

  const monthlyEnergy = parseNumber(input.monthlyEnergy);
  const machines = parseNumber(input.machines);
  const hoursPerMachine = parseNumber(input.hoursPerMachine);
  const machineEfficiency = parseEfficiencyPercent(input.machineEfficiencyPercent);
  if (machineEfficiency.error) fieldErrors.machineEfficiencyPercent = machineEfficiency.error;

  const cycleSeconds = parseNumber(input.cycleSeconds);
  if (cycleSeconds != null && cycleSeconds <= 0) {
    fieldErrors.cycleSeconds = "Ciclo deve ser maior que zero.";
  }

  const cavities = parseNumber(input.cavities);
  if (cavities != null && cavities <= 0) {
    fieldErrors.cavities = "Cavidades devem ser maiores que zero.";
  }

  const operators = parseNumber(input.operators);
  if (operators != null && operators < 0) {
    fieldErrors.operators = "Operadores não podem ser negativos.";
  }

  const scrap = parseScrapPercent(input.scrapPercent);
  if (scrap.error) fieldErrors.scrapPercent = scrap.error;

  const theoreticalLaborHours =
    isPositive(productivePeople) && isPositive(hoursPerPerson)
      ? productivePeople * hoursPerPerson
      : null;

  const theoreticalHH =
    monthlyPayroll != null && isPositive(theoreticalLaborHours)
      ? safeDivide(monthlyPayroll, theoreticalLaborHours)
      : null;

  const adjustedLaborHours =
    isPositive(theoreticalLaborHours) && laborEfficiency.value != null
      ? theoreticalLaborHours * (laborEfficiency.value / 100)
      : null;

  const adjustedHH =
    monthlyPayroll != null && isPositive(adjustedLaborHours)
      ? safeDivide(monthlyPayroll, adjustedLaborHours)
      : null;

  const theoreticalMachineHours =
    isPositive(machines) && isPositive(hoursPerMachine) ? machines * hoursPerMachine : null;

  const theoreticalHM =
    monthlyEnergy != null && isPositive(theoreticalMachineHours)
      ? safeDivide(monthlyEnergy, theoreticalMachineHours)
      : null;

  const adjustedMachineHours =
    isPositive(theoreticalMachineHours) && machineEfficiency.value != null
      ? theoreticalMachineHours * (machineEfficiency.value / 100)
      : null;

  const adjustedHM =
    monthlyEnergy != null && isPositive(adjustedMachineHours)
      ? safeDivide(monthlyEnergy, adjustedMachineHours)
      : null;

  const operatorCount = operators ?? null;
  const transformationCostPerHour =
    adjustedHM != null && operatorCount != null && adjustedHH != null
      ? adjustedHM + adjustedHH * operatorCount
      : null;

  const validCycle = cycleSeconds != null && cycleSeconds > 0 ? cycleSeconds : null;
  const cyclesPerHour = validCycle != null ? safeDivide(3600, validCycle) : null;

  const validCavities = cavities != null && cavities > 0 ? cavities : null;
  const theoreticalPiecesPerHour =
    cyclesPerHour != null && validCavities != null ? cyclesPerHour * validCavities : null;

  const scrapFactor =
    scrap.value != null ? Math.max(0, Math.min(1, 1 - scrap.value / 100)) : null;

  const goodPiecesPerHour =
    theoreticalPiecesPerHour != null && scrapFactor != null
      ? theoreticalPiecesPerHour * scrapFactor
      : null;

  const estimatedTransformationCostPerPiece =
    transformationCostPerHour != null && isPositive(goodPiecesPerHour)
      ? safeDivide(transformationCostPerHour, goodPiecesPerHour)
      : null;

  return {
    labor: {
      theoreticalLaborHours,
      theoreticalHH,
      adjustedLaborHours,
      adjustedHH,
    },
    energy: {
      theoreticalMachineHours,
      theoreticalHM,
      adjustedMachineHours,
      adjustedHM,
    },
    product: {
      transformationCostPerHour,
      cyclesPerHour,
      theoreticalPiecesPerHour,
      goodPiecesPerHour,
      estimatedTransformationCostPerPiece,
    },
    fieldErrors,
  };
}

export function computeTransformationCostPerHourFromRates(input: {
  adjustedHH: number;
  adjustedHM: number;
  operators: number;
}): number {
  return input.adjustedHM + input.adjustedHH * input.operators;
}
