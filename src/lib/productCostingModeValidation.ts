import type { ItemType, ProductCostingMode } from "@/src/types/product";

export const PRODUCT_COSTING_MODE_VALUES = [
  "OWN_PROCESS",
  "BOM_ONLY",
  "FINISHING_SERVICE",
] as const satisfies readonly ProductCostingMode[];

export function normalizeProductCostingMode(
  value: unknown,
  fallback: ProductCostingMode = "OWN_PROCESS"
): ProductCostingMode {
  return typeof value === "string" &&
    (PRODUCT_COSTING_MODE_VALUES as readonly string[]).includes(value)
    ? (value as ProductCostingMode)
    : fallback;
}

/** Modos que não exigem nem aplicam processo próprio neste nível. */
export function shouldSkipOwnProcessValidation(costingMode: ProductCostingMode): boolean {
  return costingMode !== "OWN_PROCESS";
}

export function shouldSkipOwnProcessInCosting(costingMode: ProductCostingMode): boolean {
  return shouldSkipOwnProcessValidation(costingMode);
}

export type StandardProcessFieldValues = {
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
};

export function parseOptionalProcessNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseStandardProcessFields(input: {
  cycleTimeSeconds?: unknown;
  cavities?: unknown;
  setupTimeMin?: unknown;
  efficiencyExpected?: unknown;
}): StandardProcessFieldValues {
  return {
    cycleTimeSeconds: parseOptionalProcessNumber(input.cycleTimeSeconds),
    cavities: parseOptionalProcessNumber(input.cavities),
    setupTimeMin: parseOptionalProcessNumber(input.setupTimeMin),
    efficiencyExpected: parseOptionalProcessNumber(input.efficiencyExpected),
  };
}

export function hasAnyStandardProcessField(fields: StandardProcessFieldValues): boolean {
  return (
    fields.cycleTimeSeconds !== null ||
    fields.cavities !== null ||
    fields.setupTimeMin !== null ||
    fields.efficiencyExpected !== null
  );
}

export type StandardProcessValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/** Validação compartilhada (API) do processo padrão de COMPONENT. */
export function validateStandardProcessFields(
  fields: StandardProcessFieldValues,
  options: {
    itemType: ItemType;
    costingMode: ProductCostingMode;
  }
): StandardProcessValidationResult {
  if (options.itemType !== "COMPONENT") {
    if (hasAnyStandardProcessField(fields)) {
      return {
        ok: false,
        error:
          "Processo Padrão (cycleTimeSeconds/cavities/setupTimeMin/efficiencyExpected) só é permitido para itens do tipo COMPONENT.",
      };
    }
    return { ok: true };
  }

  if (shouldSkipOwnProcessValidation(options.costingMode)) {
    return { ok: true };
  }

  if (!hasAnyStandardProcessField(fields)) {
    return { ok: true };
  }

  const { cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected } = fields;

  if (cycleTimeSeconds === null || !Number.isFinite(cycleTimeSeconds) || cycleTimeSeconds <= 0) {
    return {
      ok: false,
      error: "Processo Padrão: cycleTimeSeconds é obrigatório e deve ser > 0.",
    };
  }
  if (cavities === null || !Number.isFinite(cavities) || cavities < 1) {
    return {
      ok: false,
      error: "Processo Padrão: cavities é obrigatório e deve ser >= 1.",
    };
  }
  if (setupTimeMin === null || !Number.isFinite(setupTimeMin) || setupTimeMin < 0) {
    return {
      ok: false,
      error: "Processo Padrão: setupTimeMin é obrigatório e deve ser >= 0.",
    };
  }
  if (
    efficiencyExpected === null ||
    !Number.isFinite(efficiencyExpected) ||
    efficiencyExpected <= 0 ||
    efficiencyExpected > 100
  ) {
    return {
      ok: false,
      error: "Processo Padrão: efficiencyExpected é obrigatório e deve ser > 0 e <= 100.",
    };
  }

  return { ok: true };
}

/** Mensagens amigáveis para o formulário de engenharia (aba Informações). */
export function validateStandardProcessFieldsForForm(
  input: {
    cycleTimeSeconds?: unknown;
    cavities?: unknown;
    setupTimeMin?: unknown;
    efficiencyExpected?: unknown;
  },
  options: {
    itemType: ItemType;
    costingMode: ProductCostingMode;
  }
): string | null {
  if (options.itemType !== "COMPONENT" || shouldSkipOwnProcessValidation(options.costingMode)) {
    return null;
  }

  const fields = parseStandardProcessFields(input);
  if (!hasAnyStandardProcessField(fields)) {
    return null;
  }

  if (fields.cycleTimeSeconds === null || fields.cycleTimeSeconds <= 0) {
    return "Processo Padrão: Ciclo (segundos) deve ser um número válido maior que zero.";
  }
  if (fields.cavities === null || fields.cavities < 1) {
    return "Processo Padrão: Cavidades é obrigatório quando o Ciclo está preenchido.";
  }
  if (fields.setupTimeMin === null || fields.setupTimeMin < 0) {
    return "Processo Padrão: Setup (minutos) é obrigatório quando o Ciclo está preenchido.";
  }
  if (fields.efficiencyExpected === null || fields.efficiencyExpected <= 0 || fields.efficiencyExpected > 100) {
    return "Processo Padrão: Eficiência deve ser > 0 e <= 100 quando o Ciclo está preenchido.";
  }

  return null;
}

export const BOM_ONLY_COSTING_HINT =
  "Este modo usa apenas a composição da BOM. Processo próprio, HH/HM e tempo de ciclo não serão adicionados ao custo deste item." as const;
