/**
 * Compras → Performance — helpers de APRESENTAÇÃO (browser-safe).
 * Só formatação e rótulos. Nenhum cálculo de métrica acontece aqui.
 */

import { formatPurchaseOrderAmount, formatSupplierScore } from "./supplierPerformance";
import {
  SUPPLIER_PERFORMANCE_DASHBOARD_PERIOD_PRESETS,
  buildDashboardPeriodFromPreset,
  buildDashboardPeriodFromYear,
  type AdvancedMetricEntry,
  type AdvancedMetricStatus,
  type DashboardFinancialDataStatus,
  type DashboardKpiDefinition,
  type SupplierPerformanceDashboardPeriodPresetId,
} from "./supplierPerformanceDashboard";
import type { SupplierPerformancePeriod } from "./supplierPerformance";
import type { SupplierClassificationCode } from "./supplierClassificationPolicy";

export const DASHBOARD_EMPTY_VALUE = "—";

export function formatDashboardMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  return formatPurchaseOrderAmount(value, currency);
}

/** Moeda compacta para eixos/cards (mil / Mi) — só apresentação. */
export function formatDashboardMoneyCompact(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  const abs = Math.abs(value);
  const prefix = currency === "BRL" ? "R$" : currency;
  if (abs >= 1_000_000) return `${prefix} ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mi`;
  if (abs >= 10_000) return `${prefix} ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatPurchaseOrderAmount(value, currency);
}

export function formatDashboardPercent(fraction: number | null | undefined, fractionDigits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return DASHBOARD_EMPTY_VALUE;
  return `${(fraction * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

export function formatDashboardInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  return Math.trunc(value).toLocaleString("pt-BR");
}

export function formatDashboardDecimal(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatDashboardQuantity(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  const text = value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  return unit ? `${text} ${unit}` : text;
}

export function formatDashboardPrice(
  value: number | null | undefined,
  currency: string,
  unit: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  const code = currency.trim().toUpperCase();
  let text: string;
  try {
    text = value.toLocaleString("pt-BR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    text = `${code} ${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  return unit ? `${text}/${unit}` : text;
}

export function formatDashboardDate(iso: string | null | undefined): string {
  if (!iso) return DASHBOARD_EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASHBOARD_EMPTY_VALUE;
  return date.toLocaleDateString("pt-BR");
}

export function formatDashboardDateTime(iso: string | null | undefined): string {
  if (!iso) return DASHBOARD_EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASHBOARD_EMPTY_VALUE;
  return date.toLocaleString("pt-BR");
}

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** `2026-03` → `mar/26`. */
export function formatDashboardMonth(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const month = Number(match[2]);
  const label = MONTH_SHORT[month - 1];
  if (!label) return monthKey;
  return `${label}/${match[1].slice(2)}`;
}

export function formatDashboardScore(value: number | null | undefined, _scaleMax?: number | null): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  return formatSupplierScore(value, 2);
}

export function formatDashboardScoreWithScale(
  value: number | null | undefined,
  scaleMax: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return DASHBOARD_EMPTY_VALUE;
  const max = scaleMax ?? 5;
  return `${formatSupplierScore(value, 2)} / ${max}`;
}

export function formatDashboardCoverageContext(
  coverage: number | null | undefined,
  evaluated: number | null | undefined,
  total: number | null | undefined
): { percent: string; context: string | null } {
  return {
    percent: formatDashboardPercent(coverage),
    context:
      evaluated == null || total == null || !Number.isFinite(evaluated) || !Number.isFinite(total)
        ? null
        : `${formatDashboardInteger(evaluated)} de ${formatDashboardInteger(total)} pedidos`,
  };
}

export const FINANCIAL_DATA_STATUS_LABELS: Record<DashboardFinancialDataStatus, string> = {
  AVAILABLE: "Valores financeiros disponíveis",
  PARTIAL: "Valores financeiros parciais",
  UNAVAILABLE: "Valores financeiros indisponíveis para esta população",
};

export function formatDashboardPeriodLabel(period: SupplierPerformancePeriod): string {
  const from = period.from ? formatDashboardCivil(period.from) : null;
  const to = period.to ? formatDashboardCivil(period.to) : null;
  if (from && to) return `${from} a ${to}`;
  if (from) return `a partir de ${from}`;
  if (to) return `até ${to}`;
  return "todo o histórico";
}

function formatDashboardCivil(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export const ADVANCED_METRIC_STATUS_LABELS: Record<AdvancedMetricStatus, string> = {
  available: "Disponível",
  partial: "Parcial",
  unavailable: "Indisponível",
};

export const ADVANCED_METRIC_STATUS_TONES: Record<AdvancedMetricStatus, "emerald" | "amber" | "slate"> = {
  available: "emerald",
  partial: "amber",
  unavailable: "slate",
};

/** Texto do valor de um indicador avançado — nunca "0" para fonte inexistente. */
export function describeAdvancedMetricValue(entry: AdvancedMetricEntry): string {
  if (!entry.value) {
    return entry.status === "unavailable" ? "Sem dados" : DASHBOARD_EMPTY_VALUE;
  }
  const value = entry.value;
  switch (value.kind) {
    case "count":
      return value.of != null
        ? `${formatDashboardInteger(value.value)} de ${formatDashboardInteger(value.of)}`
        : Number.isInteger(value.value)
          ? formatDashboardInteger(value.value)
          : formatDashboardDecimal(value.value, 2);
    case "percent":
      return value.numerator != null && value.denominator != null
        ? `${formatDashboardPercent(value.value)} · ${formatDashboardInteger(value.numerator)}/${formatDashboardInteger(value.denominator)} linhas integrais`
        : formatDashboardPercent(value.value);
    case "days":
      return `${formatDashboardDecimal(value.value, 1)} dias · ${formatDashboardInteger(value.count)} pedidos`;
    case "distribution":
      return value.items.map((item) => `${item.label}: ${formatDashboardInteger(item.count)}`).join(" · ") +
        (value.unknownCount > 0 ? ` · não informado: ${formatDashboardInteger(value.unknownCount)}` : "");
    case "reference":
      return value.label;
    default:
      return DASHBOARD_EMPTY_VALUE;
  }
}

/** Tooltip canônico do KPI: o que mede, fórmula, escopo, fonte, limitações. */
export function describeDashboardKpi(definition: DashboardKpiDefinition | undefined): string {
  if (!definition) return "";
  const parts = [
    `${definition.label}: ${definition.description}`,
    `Fórmula: ${definition.formula}`,
    `Escopo: ${definition.scope}`,
    `Fonte: ${definition.source}`,
  ];
  if (definition.limitation) parts.push(`Limitação: ${definition.limitation}`);
  return parts.join("\n");
}

export function findDashboardKpiDefinition(
  definitions: readonly DashboardKpiDefinition[],
  key: string
): DashboardKpiDefinition | undefined {
  return definitions.find((definition) => definition.key === key);
}

export type DashboardPeriodSelection =
  | { mode: "preset"; preset: Exclude<SupplierPerformanceDashboardPeriodPresetId, "custom">; period: SupplierPerformancePeriod }
  | { mode: "year"; year: number; period: SupplierPerformancePeriod }
  | { mode: "custom"; period: SupplierPerformancePeriod };

export function periodSelectionFromPreset(
  preset: Exclude<SupplierPerformanceDashboardPeriodPresetId, "custom">,
  today: Date = new Date()
): DashboardPeriodSelection {
  return { mode: "preset", preset, period: buildDashboardPeriodFromPreset(preset, today) };
}

export function periodSelectionFromYear(year: number): DashboardPeriodSelection {
  return { mode: "year", year, period: buildDashboardPeriodFromYear(year) };
}

export function periodSelectionCustom(period: SupplierPerformancePeriod): DashboardPeriodSelection {
  return { mode: "custom", period };
}

export const DASHBOARD_PERIOD_PRESET_OPTIONS = SUPPLIER_PERFORMANCE_DASHBOARD_PERIOD_PRESETS.filter(
  (preset) => preset.id !== "custom"
);

export function describeDashboardPeriodSelection(selection: DashboardPeriodSelection): string {
  if (selection.mode === "year") return `Ano ${selection.year}`;
  if (selection.mode === "preset") {
    return DASHBOARD_PERIOD_PRESET_OPTIONS.find((preset) => preset.id === selection.preset)?.label ?? selection.preset;
  }
  return formatDashboardPeriodLabel(selection.period);
}

/* ------------------------------------------------------------------ *
 * Sub-abas de Compras → Performance (estado na URL)
 * ------------------------------------------------------------------ */

export const SUPPLIER_PERFORMANCE_VIEW_PARAM = "view";

export const SUPPLIER_PERFORMANCE_VIEWS = [
  { id: "overview", label: "Visão geral" },
  { id: "classification", label: "Classificação de fornecedores" },
] as const;

export type SupplierPerformanceViewId = (typeof SUPPLIER_PERFORMANCE_VIEWS)[number]["id"];

export const SUPPLIER_PERFORMANCE_DEFAULT_VIEW: SupplierPerformanceViewId = "overview";

/** Valor desconhecido/ausente cai na visão geral — deep link nunca quebra a tela. */
export function parseSupplierPerformanceViewParam(
  raw: string | null | undefined
): SupplierPerformanceViewId {
  const value = (raw ?? "").trim();
  const found = SUPPLIER_PERFORMANCE_VIEWS.find((view) => view.id === value);
  return found ? found.id : SUPPLIER_PERFORMANCE_DEFAULT_VIEW;
}

/* ------------------------------------------------------------------ *
 * Classificação de desempenho — tom do badge
 *
 * A cor é SECUNDÁRIA: o rótulo textual vem do domínio e é sempre exibido.
 * ------------------------------------------------------------------ */

export type ClassificationBadgeTone = "positive" | "attention" | "critical" | "neutral";

export const CLASSIFICATION_BADGE_TONES: Record<SupplierClassificationCode, ClassificationBadgeTone> = {
  APPROVED: "positive",
  CONDITIONAL: "attention",
  NOT_APPROVED: "critical",
  NOT_EVALUATED: "neutral",
  LEGACY_METHODOLOGY: "neutral",
};

export const CLASSIFICATION_BADGE_CLASSES: Record<ClassificationBadgeTone, string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  critical: "border-rose-200 bg-rose-50 text-rose-900",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};
