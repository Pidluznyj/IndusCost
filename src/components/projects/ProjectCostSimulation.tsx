import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import type { ProjectCostBreakdown, ProjectDetail } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type Props = {
  detail: ProjectDetail;
};

export function ProjectCostSimulation({ detail }: Props) {
  const cost = detail.costBreakdown;
  const { snapshotGroups } = useMemo(
    () =>
      buildProjectStructureSnapshotGroups(detail.structureLines, {
        simulatedProducts: detail.simulatedProducts,
      }),
    [detail.structureLines, detail.simulatedProducts]
  );

  const localItemsCost = useMemo(() => {
    let total = 0;
    for (const line of detail.structureLines) {
      if (line.sourceType === "SIMULATED_ITEM" || line.sourceType === "MANUAL") {
        total += line.totalCost;
      }
    }
    for (const item of detail.simulatedItems) {
      total += item.quotedUnitCost ?? item.estimatedUnitCost ?? 0;
    }
    return total;
  }, [detail.structureLines, detail.simulatedItems]);

  const itemsWithoutCost = detail.structureLines.filter(
    (l) => l.isMissingCost || l.unitCostSnapshot <= 0
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Simulação de Custos</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Analise o custo projetado com base na engenharia local do projeto.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Custo total simulado" value={formatMoney(cost.unitCost)} />
        <StatCard label="Custo de materiais oficiais" value={formatMoney(cost.rawMaterialCost)} />
        <StatCard
          label="Custo de componentes oficiais reutilizados"
          value={formatMoney(cost.componentCost)}
        />
        <StatCard label="Custo de itens locais" value={formatMoney(localItemsCost)} />
        <StatCard label="Custo de processo / roteiro" value={formatMoney(cost.serviceCost)} />
        <StatCard label="Custo de serviços / acabamentos" value={formatMoney(cost.packagingCost)} />
        <StatCard label="Molde amortizado / un." value={formatMoney(cost.amortizedMoldCostPerUnit)} />
        <StatCard label="Molde separado" value={formatMoney(cost.separateMoldCost)} />
        <StatCard label="Itens sem custo" value={String(itemsWithoutCost)} />
        <StatCard label="Margem alvo" value={formatPercent(cost.targetMarginPercent)} />
        <StatCard label="Preço sugerido" value={formatMoney(cost.suggestedPrice)} />
        <StatCard label="Preço alvo" value={formatMoney(cost.targetPrice)} />
      </div>

      {snapshotGroups.length > 0 ? (
        <div className="space-y-3">
          <h5 className="font-medium">Comparativo — itens clonados de oficiais</h5>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Custo original</th>
                  <th className="px-3 py-2">Custo simulado</th>
                  <th className="px-3 py-2">Diferença R$</th>
                  <th className="px-3 py-2">Variação %</th>
                </tr>
              </thead>
              <tbody>
                {snapshotGroups.map((g) => (
                  <tr key={g.groupKey} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      {g.rootCode} — {g.rootDescription}
                    </td>
                    <td className="px-3 py-2">{formatMoney(g.officialCost)}</td>
                    <td className="px-3 py-2">{formatMoney(g.simulatedCost)}</td>
                    <td className="px-3 py-2">{formatMoney(g.differenceAmount)}</td>
                    <td className="px-3 py-2">{formatPercent(g.differencePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {detail.alerts.length > 0 ? (
        <div className="space-y-2">
          <h5 className="font-medium">Alertas de inconsistência</h5>
          {detail.alerts.map((a) => (
            <div
              key={`${a.code}-${a.message}`}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                a.severity === "warning"
                  ? "bg-amber-50 text-amber-900"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {a.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
