/**
 * Card KPI da aba Performance — SystemTotalizerCard (design system) com
 * tooltip obrigatório de fórmula/escopo/fonte. O valor já vem formatado.
 */
import React from "react";
import { SystemTotalizerCard, type SystemTotalizerTone } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";

export type SupplierPerformanceKpiCardProps = {
  label: string;
  value: string;
  /** Texto completo (title) quando o valor exibido é compacto. */
  valueTitle?: string | null;
  hint?: string;
  tooltip?: string;
  tone?: SystemTotalizerTone;
  testId?: string;
  loading?: boolean;
  /** Indicador sem fonte: mostra o motivo, nunca 0. */
  unavailableReason?: string | null;
};

export function SupplierPerformanceKpiCard({
  label,
  value,
  valueTitle,
  hint,
  tooltip,
  tone = "neutral",
  testId,
  loading = false,
  unavailableReason,
}: SupplierPerformanceKpiCardProps) {
  const unavailable = Boolean(unavailableReason);
  return (
    <SystemTotalizerCard
      testId={testId}
      label={label}
      value={unavailable ? "Indisponível" : value}
      valueTitle={unavailable ? unavailableReason : valueTitle ?? undefined}
      valueSize={unavailable || value.length > 14 ? "text" : "default"}
      subtitle={unavailable ? unavailableReason ?? undefined : hint}
      tone={unavailable ? "neutral" : tone}
      loading={loading}
      labelAccessory={tooltip ? <FinanceBiCalcTooltip rule={tooltip} /> : undefined}
    />
  );
}
