import React from "react";
import { financeBiCardMutedClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function ExecutiveChartScenario({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div
      className={cn(
        financeBiCardMutedClass,
        "executive-chart-scenario px-3 py-2.5 text-sm leading-relaxed text-[#6B7280]"
      )}
      data-testid="executive-chart-scenario"
    >
      <strong className="font-semibold text-[#111827]">Leitura do cenário:</strong>{" "}
      <span>{text}</span>
    </div>
  );
}
