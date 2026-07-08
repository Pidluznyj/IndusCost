/**
 * Monitoramento de matéria-prima — Inteligência de Mercado (Suprimentos).
 */

export const MATERIAL_MARKET_CRITICALITY_VALUES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type MaterialMarketCriticality = (typeof MATERIAL_MARKET_CRITICALITY_VALUES)[number];

export const DEFAULT_MATERIAL_MARKET_CRITICALITY: MaterialMarketCriticality = "MEDIUM";
export const DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS = 7;

export const MATERIAL_MARKET_CRITICALITY_LABELS: Record<MaterialMarketCriticality, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export type MaterialMarketMonitoringFields = {
  isMarketMonitored: boolean;
  marketCriticality: MaterialMarketCriticality | null;
  marketMonitoringFrequencyDays: number | null;
  marketNotes: string | null;
};

export type MaterialMarketMonitoringInput = {
  isMarketMonitored?: unknown;
  marketCriticality?: unknown;
  marketMonitoringFrequencyDays?: unknown;
  marketNotes?: unknown;
};

export function isMaterialMarketCriticality(value: unknown): value is MaterialMarketCriticality {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_CRITICALITY_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketMonitoringInput(
  input: MaterialMarketMonitoringInput
):
  | { ok: true; value: MaterialMarketMonitoringFields }
  | { ok: false; message: string; field?: string } {
  const isMarketMonitored = input.isMarketMonitored === true;

  if (!isMarketMonitored) {
    return {
      ok: true,
      value: {
        isMarketMonitored: false,
        marketCriticality: null,
        marketMonitoringFrequencyDays: null,
        marketNotes: normalizeMarketNotes(input.marketNotes),
      },
    };
  }

  const criticalityRaw = input.marketCriticality;
  const marketCriticality = isMaterialMarketCriticality(criticalityRaw)
    ? criticalityRaw
    : DEFAULT_MATERIAL_MARKET_CRITICALITY;

  const frequencyRaw = input.marketMonitoringFrequencyDays;
  let marketMonitoringFrequencyDays = DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS;
  if (frequencyRaw != null && frequencyRaw !== "") {
    const n = typeof frequencyRaw === "number" ? frequencyRaw : Number(frequencyRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        field: "marketMonitoringFrequencyDays",
        message: "Frequência de monitoramento deve ser um número inteiro positivo (dias).",
      };
    }
    marketMonitoringFrequencyDays = n;
  }

  return {
    ok: true,
    value: {
      isMarketMonitored: true,
      marketCriticality,
      marketMonitoringFrequencyDays,
      marketNotes: normalizeMarketNotes(input.marketNotes),
    },
  };
}

function normalizeMarketNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function materialMarketCriticalityBadgeClass(
  criticality: MaterialMarketCriticality
): string {
  switch (criticality) {
    case "LOW":
      return "bg-slate-500/10 text-slate-700";
    case "MEDIUM":
      return "bg-blue-500/10 text-blue-700";
    case "HIGH":
      return "bg-amber-500/10 text-amber-800";
    case "CRITICAL":
      return "bg-red-500/10 text-red-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function serializeMaterialForApi(material: {
  isMarketMonitored?: boolean | null;
  marketCriticality?: string | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
}): MaterialMarketMonitoringFields {
  const isMarketMonitored = material.isMarketMonitored === true;
  return {
    isMarketMonitored,
    marketCriticality: isMarketMonitored
      ? isMaterialMarketCriticality(material.marketCriticality)
        ? material.marketCriticality
        : DEFAULT_MATERIAL_MARKET_CRITICALITY
      : null,
    marketMonitoringFrequencyDays: isMarketMonitored
      ? material.marketMonitoringFrequencyDays ?? DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS
      : null,
    marketNotes: material.marketNotes?.trim() || null,
  };
}
