/**
 * Configuração de limiares de alertas de mercado — global e por matéria-prima.
 */

export const MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID = "GLOBAL" as const;

export const DEFAULT_MATERIAL_MARKET_ALERT_CONFIG = {
  risePercentThreshold: 10,
  fallPercentThreshold: 10,
  daysWithoutQuote: 90,
  alertsEnabled: true,
} as const;

export type MaterialMarketAlertConfigFields = {
  risePercentThreshold: number;
  fallPercentThreshold: number;
  daysWithoutQuote: number;
  alertsEnabled: boolean;
};

export type MaterialMarketAlertConfigPartial = {
  risePercentThreshold?: number | null;
  fallPercentThreshold?: number | null;
  daysWithoutQuote?: number | null;
  alertsEnabled?: boolean | null;
};

export type EffectiveAlertConfig = MaterialMarketAlertConfigFields & {
  usesGlobalConfig: boolean;
  materialOverrides: Partial<MaterialMarketAlertConfigFields>;
};

export type MaterialMarketAlertConfigApiItem = MaterialMarketAlertConfigFields & {
  materialId?: string;
  usesGlobalConfig?: boolean;
  materialOverrides?: Partial<MaterialMarketAlertConfigFields>;
  updatedAt?: string;
  updatedBy?: string | null;
};

export type MaterialMarketAlertConfigAuditApiItem = {
  id: string;
  scope: "GLOBAL" | "MATERIAL";
  materialId: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  updatedBy: string | null;
  createdAt: string;
};

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseOptionalPercent(value: unknown, field: string):
  | { ok: true; value: number | null }
  | { ok: false; field: string; message: string } {
  if (value === undefined) return { ok: true, value: undefined as unknown as null };
  if (value === null) return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, field, message: `${field} deve ser um número não negativo.` };
  }
  return { ok: true, value: roundPercent(n) };
}

function parseOptionalInt(value: unknown, field: string):
  | { ok: true; value: number | null }
  | { ok: false; field: string; message: string } {
  if (value === undefined) return { ok: true, value: undefined as unknown as null };
  if (value === null) return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    return { ok: false, field, message: `${field} deve ser um inteiro positivo.` };
  }
  return { ok: true, value: n };
}

function parseOptionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function normalizeMaterialMarketAlertConfigFields(
  input: Partial<MaterialMarketAlertConfigFields>
): MaterialMarketAlertConfigFields {
  return {
    risePercentThreshold: roundPercent(
      input.risePercentThreshold ?? DEFAULT_MATERIAL_MARKET_ALERT_CONFIG.risePercentThreshold
    ),
    fallPercentThreshold: roundPercent(
      input.fallPercentThreshold ?? DEFAULT_MATERIAL_MARKET_ALERT_CONFIG.fallPercentThreshold
    ),
    daysWithoutQuote:
      input.daysWithoutQuote ?? DEFAULT_MATERIAL_MARKET_ALERT_CONFIG.daysWithoutQuote,
    alertsEnabled: input.alertsEnabled ?? DEFAULT_MATERIAL_MARKET_ALERT_CONFIG.alertsEnabled,
  };
}

export function resolveAlertConfig(
  global: MaterialMarketAlertConfigFields,
  material?: MaterialMarketAlertConfigPartial | null
): EffectiveAlertConfig {
  const materialOverrides: Partial<MaterialMarketAlertConfigFields> = {};

  if (material?.risePercentThreshold != null) {
    materialOverrides.risePercentThreshold = roundPercent(Number(material.risePercentThreshold));
  }
  if (material?.fallPercentThreshold != null) {
    materialOverrides.fallPercentThreshold = roundPercent(Number(material.fallPercentThreshold));
  }
  if (material?.daysWithoutQuote != null) {
    materialOverrides.daysWithoutQuote = Number(material.daysWithoutQuote);
  }
  if (material?.alertsEnabled != null) {
    materialOverrides.alertsEnabled = Boolean(material.alertsEnabled);
  }

  return {
    risePercentThreshold:
      materialOverrides.risePercentThreshold ?? global.risePercentThreshold,
    fallPercentThreshold:
      materialOverrides.fallPercentThreshold ?? global.fallPercentThreshold,
    daysWithoutQuote: materialOverrides.daysWithoutQuote ?? global.daysWithoutQuote,
    alertsEnabled: materialOverrides.alertsEnabled ?? global.alertsEnabled,
    usesGlobalConfig: Object.keys(materialOverrides).length === 0,
    materialOverrides,
  };
}

export function parseMaterialMarketAlertGlobalConfigInput(body: unknown):
  | { ok: true; value: MaterialMarketAlertConfigFields }
  | { ok: false; field?: string; message: string } {
  const input = typeof body === "object" && body != null ? (body as Record<string, unknown>) : {};

  const rise = parseOptionalPercent(input.risePercentThreshold, "risePercentThreshold");
  if (rise.ok === false) return rise;
  const fall = parseOptionalPercent(input.fallPercentThreshold, "fallPercentThreshold");
  if (fall.ok === false) return fall;
  const days = parseOptionalInt(input.daysWithoutQuote, "daysWithoutQuote");
  if (days.ok === false) return days;

  const alertsEnabledRaw = parseOptionalBoolean(input.alertsEnabled);
  if (alertsEnabledRaw === null) {
    return { ok: false, field: "alertsEnabled", message: "alertsEnabled deve ser booleano." };
  }

  return {
    ok: true,
    value: normalizeMaterialMarketAlertConfigFields({
      risePercentThreshold: rise.value ?? undefined,
      fallPercentThreshold: fall.value ?? undefined,
      daysWithoutQuote: days.value ?? undefined,
      alertsEnabled: alertsEnabledRaw ?? undefined,
    }),
  };
}

export function parseMaterialMarketAlertMaterialConfigInput(body: unknown):
  | { ok: true; value: MaterialMarketAlertConfigPartial; clearOverrides: boolean }
  | { ok: false; field?: string; message: string } {
  const input = typeof body === "object" && body != null ? (body as Record<string, unknown>) : {};

  if (input.clearOverrides === true) {
    return { ok: true, value: {}, clearOverrides: true };
  }

  const rise = parseOptionalPercent(input.risePercentThreshold, "risePercentThreshold");
  if (rise.ok === false) return rise;
  const fall = parseOptionalPercent(input.fallPercentThreshold, "fallPercentThreshold");
  if (fall.ok === false) return fall;
  const days = parseOptionalInt(input.daysWithoutQuote, "daysWithoutQuote");
  if (days.ok === false) return days;

  const alertsEnabledRaw = parseOptionalBoolean(input.alertsEnabled);
  if (alertsEnabledRaw === null && input.alertsEnabled !== undefined && input.alertsEnabled !== null) {
    return { ok: false, field: "alertsEnabled", message: "alertsEnabled deve ser booleano." };
  }

  const value: MaterialMarketAlertConfigPartial = {};
  if (rise.value !== undefined) value.risePercentThreshold = rise.value;
  if (fall.value !== undefined) value.fallPercentThreshold = fall.value;
  if (days.value !== undefined) value.daysWithoutQuote = days.value;
  if (alertsEnabledRaw !== undefined) value.alertsEnabled = alertsEnabledRaw;

  return { ok: true, value, clearOverrides: false };
}

export function serializeMaterialMarketAlertConfigForApi(
  effective: EffectiveAlertConfig,
  meta?: { materialId?: string; updatedAt?: Date | string; updatedBy?: string | null }
): MaterialMarketAlertConfigApiItem {
  return {
    ...effective,
    materialId: meta?.materialId,
    updatedAt: meta?.updatedAt ? new Date(meta.updatedAt).toISOString() : undefined,
    updatedBy: meta?.updatedBy ?? undefined,
  };
}

export function toEngineThresholdsFromEffectiveConfig(
  config: EffectiveAlertConfig
): {
  risePercentThreshold: number;
  fallPercentThreshold: number;
  noRecentQuoteDays: number;
} {
  return {
    risePercentThreshold: config.risePercentThreshold,
    fallPercentThreshold: config.fallPercentThreshold,
    noRecentQuoteDays: config.daysWithoutQuote,
  };
}
