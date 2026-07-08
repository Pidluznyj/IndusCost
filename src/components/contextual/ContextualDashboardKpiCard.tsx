import React from "react";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";

export function ContextualDashboardKpiCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: SystemTotalizerTone;
  /** Mantido por compatibilidade — tipografia executiva não usa override local. */
  valueClassName?: string;
}) {
  return (
    <SystemTotalizerCard
      className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
      label={label}
      value={value}
      subtitle={hint}
      tone={tone}
      valueSize={value.length > 14 ? "text" : "default"}
    />
  );
}
