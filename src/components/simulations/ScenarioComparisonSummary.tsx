import React from "react";
import { AlertCircle } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import type { ScenarioComparison, ScenarioDelta } from "@/src/lib/simulationScenario";

type Props = { comparison: ScenarioComparison };

function formatDeltaPct(delta: ScenarioDelta): string {
  if (delta.pct == null) return "—";
  return `${delta.pct > 0 ? "+" : ""}${formatNumber(delta.pct, 2)}%`;
}

/**
 * BASE × CENÁRIO de um produto existente: origem da base, MP/HH/HM/processo/total com
 * variação absoluta e percentual, e avisos explícitos (nunca número inventado).
 */
export function ScenarioComparisonSummary({ comparison }: Props) {
  const { baseline, breakdown, deltas } = comparison;
  const rows: Array<{ label: string; base: number; simulated: number; delta: ScenarioDelta; strong?: boolean }> = [
    { label: "Matéria-prima (MP)", base: breakdown.base.mp, simulated: breakdown.simulated.mp, delta: deltas.mp },
    { label: "Mão de obra (HH)", base: breakdown.base.hh, simulated: breakdown.simulated.hh, delta: deltas.hh },
    { label: "Máquina (HM)", base: breakdown.base.hm, simulated: breakdown.simulated.hm, delta: deltas.hm },
    {
      label: "Processo (HH + HM)",
      base: breakdown.base.hh + breakdown.base.hm,
      simulated: breakdown.simulated.hh + breakdown.simulated.hm,
      delta: deltas.process,
    },
    {
      label: "Custo total (MP + HH + HM)",
      base: breakdown.base.costBase,
      simulated: breakdown.simulated.costBase,
      delta: deltas.total,
      strong: true,
    },
  ];

  return (
    <div className="space-y-3" data-testid="scenario-comparison-summary">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-accent/10 p-3 text-xs">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Base da simulação
        </span>
        <span
          data-testid="scenario-baseline-badge"
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
            baseline.source === "PUBLISHED"
              ? "bg-emerald-500/15 text-emerald-800"
              : baseline.source === "LIVE"
                ? "bg-amber-500/15 text-amber-800"
                : "bg-slate-500/15 text-slate-700"
          )}
        >
          {baseline.badge}
        </span>
        <span className="text-muted-foreground">
          {baseline.source === "PUBLISHED"
            ? `Versão ${baseline.productionCostVersionCode ?? "—"} · rev. ${baseline.productionCostRevision ?? "—"} · vigência ${baseline.effectiveDate ?? "—"}`
            : baseline.calculatedAt
              ? `Calculado em ${new Date(baseline.calculatedAt).toLocaleString("pt-BR")}`
              : baseline.label}
        </span>
        {baseline.capturedAt ? (
          <span className="text-muted-foreground">
            · base congelada em {new Date(baseline.capturedAt).toLocaleString("pt-BR")}
          </span>
        ) : null}
      </div>

      {comparison.costIssue ? (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {comparison.costIssue.message}
        </p>
      ) : null}
      {baseline.warnings.map((warning) => (
        <p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {warning}
        </p>
      ))}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-accent/40 text-[10px] uppercase text-muted-foreground">
              <th className="p-2.5 font-bold">Componente do custo</th>
              <th className="p-2.5 text-right font-bold">Base</th>
              <th className="p-2.5 text-right font-bold">Cenário (simulado)</th>
              <th className="p-2.5 text-right font-bold">Variação (R$)</th>
              <th className="p-2.5 text-right font-bold">Variação (%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={cn("border-t border-border", row.strong && "bg-primary/5 font-bold")}>
                <td className="p-2.5">{row.label}</td>
                <td className="p-2.5 text-right tabular-nums">{formatCurrency(row.base, 5)}</td>
                <td className="p-2.5 text-right tabular-nums">{formatCurrency(row.simulated, 5)}</td>
                <td
                  className={cn(
                    "p-2.5 text-right tabular-nums",
                    row.delta.abs > 0 ? "text-red-600" : row.delta.abs < 0 ? "text-green-600" : ""
                  )}
                >
                  {row.delta.abs > 0 ? "+" : ""}
                  {formatCurrency(row.delta.abs, 5)}
                </td>
                <td className="p-2.5 text-right tabular-nums">{formatDeltaPct(row.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {comparison.efficiencyApplied
          ? "Eficiência aplicada somente à transformação do processo próprio; setup e componentes filhos não mudam."
          : "Sem ajuste de eficiência neste cenário."}{" "}
        O resultado é custo simulado — não altera custo publicado, rascunho oficial nem preço.
      </p>
    </div>
  );
}
