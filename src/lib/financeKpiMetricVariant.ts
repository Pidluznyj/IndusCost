import type { MetricCardVariant } from "@/src/components/ui/MetricCard";
import type { FinanceKpiTone } from "@/src/components/finance/shared/FinanceKpiCard";

const TONE_TO_VARIANT: Record<FinanceKpiTone, MetricCardVariant> = {
  neutral: "neutral",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

export function financeKpiToneToVariant(tone: FinanceKpiTone = "neutral"): MetricCardVariant {
  return TONE_TO_VARIANT[tone];
}

/** Mapeia colorClass legado do FinanceBiKpiCard para variante MetricCard. */
export function financeColorClassToVariant(colorClass = "text-[#111827]"): MetricCardVariant {
  if (colorClass.includes("#DC2626")) return "danger";
  if (colorClass.includes("#059669")) return "success";
  if (colorClass.includes("#D97706")) return "warning";
  if (colorClass.includes("#2563EB")) return "info";
  return "neutral";
}
