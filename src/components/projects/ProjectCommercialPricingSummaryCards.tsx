import React from "react";
import {
  formatProjectCommercialPricingSummaryMoney,
  type ProjectCommercialPricingSummary,
} from "@/src/lib/projectsPricing";

function SummaryCard({
  label,
  value,
  hint,
  tooltip,
}: {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      title={tooltip}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type Props = {
  summary: ProjectCommercialPricingSummary;
};

export function ProjectCommercialPricingSummaryCards({ summary }: Props) {
  const money = (value: number | null | undefined) =>
    formatProjectCommercialPricingSummaryMoney(value, summary);

  return (
    <div className="space-y-2">
      <h5 className="font-medium">Resumo da precificação comercial</h5>
      <p className="text-xs text-muted-foreground">{summary.aggregationHint}</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <SummaryCard
          label="Custo base médio"
          value={money(summary.averageBaseUnitCost)}
          tooltip="Média dos custos base unitários dos itens calculados, antes da amortização."
        />
        <SummaryCard
          label="Amortização média"
          value={money(summary.averageUnitAmortization)}
          tooltip="Média da amortização unitária repassada aos itens do projeto."
        />
        <SummaryCard
          label="Custo final médio"
          value={money(summary.averageFinalUnitCost)}
          tooltip="Custo final unitário = custo base unitário + amortização unitária."
        />
        <SummaryCard
          label="Margem alvo"
          value={summary.targetMarginLabel}
          hint={
            summary.hasMultipleMargins
              ? "Itens com margens diferentes — veja o grid."
              : undefined
          }
          tooltip={
            summary.hasMultipleMargins
              ? "Os itens usam margens distintas. O grid detalha cada linha."
              : "Margem desejada aplicada na formação de preço."
          }
        />
        <SummaryCard
          label="Preço médio s/ amortização"
          value={money(summary.averageSuggestedPriceWithoutAmortization)}
          tooltip="Preço sugerido médio usando custo base unitário, regra fiscal e margem alvo."
        />
        <SummaryCard
          label="Preço médio c/ amortização"
          value={money(summary.averageSuggestedPriceWithAmortization)}
          hint={
            summary.averageAmortizationPriceDelta != null &&
            Math.abs(summary.averageAmortizationPriceDelta) > 0.000001
              ? `+${money(summary.averageAmortizationPriceDelta)} vs s/ amort.`
              : undefined
          }
          tooltip="Calculado com base nos preços sugeridos dos itens, usando custo final unitário com amortização, regra fiscal e margem alvo."
        />
        <SummaryCard
          label="Itens pendentes"
          value={
            summary.hasItems
              ? String(summary.pendingItems)
              : "Sem itens"
          }
          tooltip="Itens sem custo, regra fiscal, margem ou preço sugerido calculado."
        />
        {summary.hasMultipleTaxRules ? (
          <SummaryCard
            label="Regras fiscais"
            value="Múltiplas"
            tooltip="Os itens usam regras fiscais diferentes — veja o grid."
          />
        ) : null}
      </div>
    </div>
  );
}
