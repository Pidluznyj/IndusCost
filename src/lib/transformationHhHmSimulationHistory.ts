/**
 * Histórico de simulações HH/HM do Simulador de Custo de Injeção.
 * Camada pura — sem Prisma. Snapshots preservam entrada + resultado no momento da gravação.
 */

export const TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API =
  "/api/transformation-simulator/hh-hm-simulations" as const;

export const TRANSFORMATION_HH_HM_SIMULATION_TYPES = ["CUSTO_MANUAL", "CUSTO_CC"] as const;
export type TransformationHhHmCostSimulationType =
  (typeof TRANSFORMATION_HH_HM_SIMULATION_TYPES)[number];

export const TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS: Record<
  TransformationHhHmCostSimulationType,
  string
> = {
  CUSTO_MANUAL: "Custo manual",
  CUSTO_CC: "Custo CC",
};

export type TransformationHhHmSimulationCreateInput = {
  type: TransformationHhHmCostSimulationType;
  observation?: string | null;
  periodLabel?: string | null;
  dateAxis?: string | null;
  hhEffectiveRate?: number | null;
  hmEffectiveRate?: number | null;
  finalHhHmRate?: number | null;
  inputSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
};

export type TransformationHhHmSimulationListItem = {
  id: string;
  type: TransformationHhHmCostSimulationType;
  typeLabel: string;
  observation: string | null;
  periodLabel: string | null;
  dateAxis: string | null;
  hhEffectiveRate: number | null;
  hmEffectiveRate: number | null;
  finalHhHmRate: number | null;
  inputSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TransformationHhHmSimulationListResponse = {
  items: TransformationHhHmSimulationListItem[];
  total: number;
};

export type ParseCreateResult =
  | { ok: true; value: TransformationHhHmSimulationCreateInput }
  | { ok: false; code: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseOptionalNumber(
  value: unknown,
  field: string
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) {
    return { ok: false, message: `Campo ${field} inválido.` };
  }
  return { ok: true, value: n };
}

function parseNonNegativeOptional(
  value: unknown,
  field: string
): { ok: true; value: number | null } | { ok: false; message: string } {
  const parsed = parseOptionalNumber(value, field);
  if (!parsed.ok) return parsed;
  if (parsed.value != null && parsed.value < 0) {
    return { ok: false, message: `${field} não pode ser negativo.` };
  }
  return parsed;
}

function collectEfficiencyCandidates(snapshot: Record<string, unknown>): unknown[] {
  const nested: unknown[] = [];
  for (const key of ["hh", "hm"] as const) {
    const side = snapshot[key];
    if (isPlainObject(side)) {
      nested.push(side.efficiencyPercent, side.hhEfficiencyPercent, side.hmEfficiencyPercent);
    }
  }
  return [
    snapshot.hhEfficiencyPercent,
    snapshot.hmEfficiencyPercent,
    snapshot.laborEfficiencyPercent,
    snapshot.machineEfficiencyPercent,
    snapshot.efficiencyPercent,
    ...nested,
  ];
}

function parseNonNegativeHoursInSnapshot(snapshot: Record<string, unknown>): string | null {
  const hourKeys = [
    "theoreticalLaborHours",
    "adjustedLaborHours",
    "theoreticalMachineHours",
    "adjustedMachineHours",
    "theoreticalHours",
    "adjustedHours",
    "hoursPerPerson",
    "hoursPerMachine",
    "hoursPerUnit",
  ];
  const values: unknown[] = hourKeys.map((key) => snapshot[key]);
  for (const key of ["hh", "hm"] as const) {
    const side = snapshot[key];
    if (isPlainObject(side)) {
      for (const hourKey of hourKeys) values.push(side[hourKey]);
    }
  }
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(n)) continue;
    if (n < 0) return "Horas não podem ser negativas.";
  }
  return null;
}

function parseEfficiencyInSnapshot(snapshot: Record<string, unknown>): string | null {
  for (const candidate of collectEfficiencyCandidates(snapshot)) {
    if (candidate == null || candidate === "") continue;
    const n = typeof candidate === "number" ? candidate : Number(String(candidate).replace(",", "."));
    if (!Number.isFinite(n)) return "Eficiência inválida no snapshot.";
    if (n < 0 || n > 100) return "Eficiência deve estar entre 0 e 100.";
  }
  return null;
}

export function parseTransformationHhHmSimulationType(
  raw: unknown
): TransformationHhHmCostSimulationType | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  return (TRANSFORMATION_HH_HM_SIMULATION_TYPES as readonly string[]).includes(value)
    ? (value as TransformationHhHmCostSimulationType)
    : null;
}

export function parseTransformationHhHmSimulationCreateBody(
  body: unknown
): ParseCreateResult {
  if (!isPlainObject(body)) {
    return { ok: false, code: "INVALID_BODY", message: "Payload inválido." };
  }

  const type = parseTransformationHhHmSimulationType(body.type);
  if (!type) {
    return {
      ok: false,
      code: "INVALID_TYPE",
      message: "Tipo obrigatório: CUSTO_MANUAL ou CUSTO_CC.",
    };
  }

  if (!isPlainObject(body.inputSnapshot)) {
    return {
      ok: false,
      code: "INVALID_INPUT_SNAPSHOT",
      message: "inputSnapshot é obrigatório.",
    };
  }
  if (!isPlainObject(body.resultSnapshot)) {
    return {
      ok: false,
      code: "INVALID_RESULT_SNAPSHOT",
      message: "resultSnapshot é obrigatório.",
    };
  }

  const efficiencyError = parseEfficiencyInSnapshot(body.inputSnapshot);
  if (efficiencyError) {
    return { ok: false, code: "INVALID_EFFICIENCY", message: efficiencyError };
  }

  const hoursError =
    parseNonNegativeHoursInSnapshot(body.inputSnapshot) ??
    parseNonNegativeHoursInSnapshot(body.resultSnapshot);
  if (hoursError) {
    return { ok: false, code: "INVALID_HOURS", message: hoursError };
  }

  const hhRate = parseNonNegativeOptional(body.hhEffectiveRate, "hhEffectiveRate");
  if (!hhRate.ok) return { ok: false, code: "INVALID_HH_RATE", message: hhRate.message };
  const hmRate = parseNonNegativeOptional(body.hmEffectiveRate, "hmEffectiveRate");
  if (!hmRate.ok) return { ok: false, code: "INVALID_HM_RATE", message: hmRate.message };
  const finalRate = parseNonNegativeOptional(body.finalHhHmRate, "finalHhHmRate");
  if (!finalRate.ok) return { ok: false, code: "INVALID_FINAL_RATE", message: finalRate.message };

  if (hhRate.value == null && hmRate.value == null) {
    return {
      ok: false,
      code: "MISSING_RATES",
      message: "Informe ao menos uma taxa HH ou HM válida para salvar.",
    };
  }

  const expectedFinal =
    hhRate.value != null || hmRate.value != null
      ? (hhRate.value ?? 0) + (hmRate.value ?? 0)
      : null;

  if (
    finalRate.value != null &&
    expectedFinal != null &&
    Math.abs(finalRate.value - expectedFinal) > 0.02
  ) {
    return {
      ok: false,
      code: "INCOHERENT_FINAL_RATE",
      message: "Taxa final HH+HM inconsistente com as taxas efetivas.",
    };
  }

  const observation =
    typeof body.observation === "string"
      ? body.observation.trim() || null
      : body.observation == null
        ? null
        : null;

  return {
    ok: true,
    value: {
      type,
      observation,
      periodLabel:
        typeof body.periodLabel === "string" ? body.periodLabel.trim() || null : null,
      dateAxis: typeof body.dateAxis === "string" ? body.dateAxis.trim() || null : null,
      hhEffectiveRate: hhRate.value,
      hmEffectiveRate: hmRate.value,
      finalHhHmRate: finalRate.value ?? expectedFinal,
      inputSnapshot: body.inputSnapshot,
      resultSnapshot: body.resultSnapshot,
    },
  };
}

export function buildManualHhHmSimulationPayload(input: {
  observation?: string;
  form: {
    monthlyPayroll: string;
    productivePeople: string;
    hoursPerPerson: string;
    laborEfficiencyPercent: string;
    monthlyEnergy: string;
    machines: string;
    hoursPerMachine: string;
    machineEfficiencyPercent: string;
  };
  labor: {
    theoreticalLaborHours: number | null;
    adjustedLaborHours: number | null;
    adjustedHH: number | null;
  };
  energy: {
    theoreticalMachineHours: number | null;
    adjustedMachineHours: number | null;
    adjustedHM: number | null;
  };
}): TransformationHhHmSimulationCreateInput | { error: string } {
  const hh = input.labor.adjustedHH;
  const hm = input.energy.adjustedHM;
  if (hh == null && hm == null) {
    return { error: "Calcule ao menos a taxa HH ou HM antes de salvar." };
  }
  const final = (hh ?? 0) + (hm ?? 0);
  return {
    type: "CUSTO_MANUAL",
    observation: input.observation?.trim() || null,
    periodLabel: null,
    dateAxis: null,
    hhEffectiveRate: hh,
    hmEffectiveRate: hm,
    finalHhHmRate: final,
    inputSnapshot: {
      monthlyPayroll: input.form.monthlyPayroll,
      productivePeople: input.form.productivePeople,
      hoursPerPerson: input.form.hoursPerPerson,
      laborEfficiencyPercent: input.form.laborEfficiencyPercent,
      monthlyEnergy: input.form.monthlyEnergy,
      machines: input.form.machines,
      hoursPerMachine: input.form.hoursPerMachine,
      machineEfficiencyPercent: input.form.machineEfficiencyPercent,
    },
    resultSnapshot: {
      theoreticalLaborHours: input.labor.theoreticalLaborHours,
      adjustedLaborHours: input.labor.adjustedLaborHours,
      adjustedHH: hh,
      theoreticalMachineHours: input.energy.theoreticalMachineHours,
      adjustedMachineHours: input.energy.adjustedMachineHours,
      adjustedHM: hm,
      finalHhHmRate: final,
    },
  };
}

export function buildCostCenterHhHmSimulationPayload(input: {
  observation?: string;
  periodLabelHh?: string | null;
  periodLabelHm?: string | null;
  hh: {
    averagePeriod: string;
    selectedCostCenterIds: string[];
    selectedCostCenterLabels: string;
    productiveCount: string;
    hoursPerUnit: string;
    efficiencyPercent: string;
    useManualRate: boolean;
    manualRatePerHour: string;
    monthlyAverageAmount: number | null;
    theoreticalHours: number | null;
    adjustedHours: number | null;
    calculatedRatePerHour: number | null;
    effectiveRatePerHour: number | null;
  };
  hm: {
    averagePeriod: string;
    selectedCostCenterIds: string[];
    selectedCostCenterLabels: string;
    productiveCount: string;
    hoursPerUnit: string;
    efficiencyPercent: string;
    useManualRate: boolean;
    manualRatePerHour: string;
    monthlyAverageAmount: number | null;
    theoreticalHours: number | null;
    adjustedHours: number | null;
    calculatedRatePerHour: number | null;
    effectiveRatePerHour: number | null;
  };
}): TransformationHhHmSimulationCreateInput | { error: string } {
  const hhRate = input.hh.effectiveRatePerHour;
  const hmRate = input.hm.effectiveRatePerHour;
  if (hhRate == null && hmRate == null) {
    return { error: "Calcule ao menos a taxa HH ou HM antes de salvar." };
  }
  const final = (hhRate ?? 0) + (hmRate ?? 0);
  const periodParts = [input.periodLabelHh, input.periodLabelHm].filter(Boolean);
  return {
    type: "CUSTO_CC",
    observation: input.observation?.trim() || null,
    periodLabel: periodParts.length > 0 ? periodParts.join(" | ") : null,
    dateAxis: "DUE_DATE",
    hhEffectiveRate: hhRate,
    hmEffectiveRate: hmRate,
    finalHhHmRate: final,
    inputSnapshot: {
      dateAxis: "DUE_DATE",
      metricsScope: "Valores por data de vencimento (Contas a Pagar)",
      hh: {
        averagePeriod: input.hh.averagePeriod,
        selectedCostCenterIds: input.hh.selectedCostCenterIds,
        selectedCostCenterLabels: input.hh.selectedCostCenterLabels,
        productiveCount: input.hh.productiveCount,
        hoursPerUnit: input.hh.hoursPerUnit,
        efficiencyPercent: input.hh.efficiencyPercent,
        useManualRate: input.hh.useManualRate,
        manualRatePerHour: input.hh.manualRatePerHour,
      },
      hm: {
        averagePeriod: input.hm.averagePeriod,
        selectedCostCenterIds: input.hm.selectedCostCenterIds,
        selectedCostCenterLabels: input.hm.selectedCostCenterLabels,
        productiveCount: input.hm.productiveCount,
        hoursPerUnit: input.hm.hoursPerUnit,
        efficiencyPercent: input.hm.efficiencyPercent,
        useManualRate: input.hm.useManualRate,
        manualRatePerHour: input.hm.manualRatePerHour,
      },
    },
    resultSnapshot: {
      hh: {
        monthlyAverageAmount: input.hh.monthlyAverageAmount,
        theoreticalHours: input.hh.theoreticalHours,
        adjustedHours: input.hh.adjustedHours,
        calculatedRatePerHour: input.hh.calculatedRatePerHour,
        effectiveRatePerHour: hhRate,
      },
      hm: {
        monthlyAverageAmount: input.hm.monthlyAverageAmount,
        theoreticalHours: input.hm.theoreticalHours,
        adjustedHours: input.hm.adjustedHours,
        calculatedRatePerHour: input.hm.calculatedRatePerHour,
        effectiveRatePerHour: hmRate,
      },
      finalHhHmRate: final,
    },
  };
}

export function normalizeTransformationHhHmSimulationListPayload(
  payload: unknown
): TransformationHhHmSimulationListResponse {
  if (!isPlainObject(payload)) return { items: [], total: 0 };
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload)
      ? payload
      : [];
  const items = rawItems
    .filter(isPlainObject)
    .map((row) => normalizeListItem(row))
    .filter((row): row is TransformationHhHmSimulationListItem => row != null);
  const total =
    typeof payload.total === "number" && Number.isFinite(payload.total)
      ? payload.total
      : items.length;
  return { items, total };
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const n = Number(String((value as { toString(): string }).toString()));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeListItem(row: Record<string, unknown>): TransformationHhHmSimulationListItem | null {
  const type = parseTransformationHhHmSimulationType(row.type);
  if (!type || typeof row.id !== "string") return null;
  return {
    id: row.id,
    type,
    typeLabel: TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS[type],
    observation: typeof row.observation === "string" ? row.observation : null,
    periodLabel: typeof row.periodLabel === "string" ? row.periodLabel : null,
    dateAxis: typeof row.dateAxis === "string" ? row.dateAxis : null,
    hhEffectiveRate: decimalToNumber(row.hhEffectiveRate),
    hmEffectiveRate: decimalToNumber(row.hmEffectiveRate),
    finalHhHmRate: decimalToNumber(row.finalHhHmRate),
    inputSnapshot: isPlainObject(row.inputSnapshot) ? row.inputSnapshot : {},
    resultSnapshot: isPlainObject(row.resultSnapshot) ? row.resultSnapshot : {},
    createdByUserId: typeof row.createdByUserId === "string" ? row.createdByUserId : null,
    createdByName: typeof row.createdByName === "string" ? row.createdByName : null,
    createdAt:
      typeof row.createdAt === "string"
        ? row.createdAt
        : row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : "",
    updatedAt:
      typeof row.updatedAt === "string"
        ? row.updatedAt
        : row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : "",
  };
}
