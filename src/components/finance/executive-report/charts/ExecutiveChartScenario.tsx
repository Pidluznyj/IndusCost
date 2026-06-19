import React from "react";

export function ExecutiveChartScenario({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div className="executive-chart-scenario" data-testid="executive-chart-scenario">
      <strong>Leitura do cenário:</strong> <span>{text}</span>
    </div>
  );
}
