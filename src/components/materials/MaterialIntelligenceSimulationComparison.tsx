import React from "react";
import { GitCompareArrows } from "lucide-react";
import type { MaterialSimulationComparison } from "@/src/lib/materialMarketSimulationComparison";
import { SummaryKpiCard } from "@/src/components/ui/SummaryKpiCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCurrency, formatNumber } from "@/src/lib/utils";

type Props = {
  comparison: MaterialSimulationComparison | null;
  unit: string;
};

function formatSignedCurrency(value: number | null): string {
  if (value == null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatCurrency(value)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value == null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)}%`;
}

function formatMargin(value: number | null): string {
  if (value == null) return "—";
  return `${formatNumber(value)}%`;
}

function toneToVariant(
  tone: "neutral" | "up" | "down" | "critical" | undefined
): "default" | "success" | "warning" | "danger" | undefined {
  switch (tone) {
    case "up":
      return "success";
    case "down":
      return "danger";
    case "critical":
      return "warning";
    default:
      return undefined;
  }
}

export function MaterialIntelligenceSimulationComparison({ comparison, unit }: Props) {
  if (!comparison) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
        data-testid="material-intelligence-simulation-comparison-empty"
      >
        <GitCompareArrows
          className="mb-2 h-7 w-7 text-muted-foreground opacity-60"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-muted-foreground">
          Execute uma simulação para comparar cenários
        </p>
      </div>
    );
  }

  const materialCard = comparison.cards.find((card) => card.id === "material-price");
  const marginCard = comparison.cards.find((card) => card.id === "avg-margin");
  const riskCard = comparison.cards.find((card) => card.id === "products-impacted");
  const impactCard = comparison.cards.find((card) => card.id === "total-cost-impact");

  return (
    <div className="space-y-4" data-testid="material-intelligence-simulation-comparison">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preço da matéria-prima
        </p>
        <SummaryKpiGrid testId="material-intelligence-simulation-comparison-material">
          <SummaryKpiCard
            label="Atual"
            value={formatCurrency(materialCard?.previous ?? null)}
            helperText={unit}
          />
          <SummaryKpiCard
            label="Simulado"
            value={formatCurrency(materialCard?.simulated ?? null)}
            helperText={unit}
          />
          <SummaryKpiCard
            label="Diferença"
            value={formatSignedCurrency(materialCard?.delta ?? null)}
            helperText={
              materialCard?.deltaPercent != null
                ? `${formatSignedPercent(materialCard.deltaPercent)} sobre o atual`
                : undefined
            }
            variant={toneToVariant(materialCard?.tone)}
          />
        </SummaryKpiGrid>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Margem média dos produtos impactados
        </p>
        <SummaryKpiGrid testId="material-intelligence-simulation-comparison-margin">
          <SummaryKpiCard label="Atual" value={formatMargin(marginCard?.previous ?? null)} />
          <SummaryKpiCard label="Simulado" value={formatMargin(marginCard?.simulated ?? null)} />
          <SummaryKpiCard
            label="Diferença"
            value={formatSignedPercent(marginCard?.delta ?? null)}
            helperText="Pontos percentuais"
            variant={toneToVariant(marginCard?.tone)}
          />
        </SummaryKpiGrid>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Produtos críticos
        </p>
        <SummaryKpiGrid testId="material-intelligence-simulation-comparison-risk">
          <SummaryKpiCard
            label="Atual"
            value={String(comparison.criticalCount)}
            helperText="Produtos críticos no cenário simulado"
          />
          <SummaryKpiCard
            label="Simulado"
            value={String(comparison.productsImpacted)}
            helperText="Produtos impactados pela simulação"
            variant={toneToVariant(riskCard?.tone)}
          />
          <SummaryKpiCard
            label="Diferença"
            value={formatSignedCurrency(impactCard?.delta ?? comparison.totalCostImpactBRL)}
            helperText={
              comparison.totalCostImpactBRL != null
                ? `Impacto total: ${formatSignedCurrency(comparison.totalCostImpactBRL)}`
                : undefined
            }
            variant={toneToVariant(impactCard?.tone)}
          />
        </SummaryKpiGrid>
      </div>
    </div>
  );
}
