import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import { computeProjectGuidedCosts } from "@/src/lib/projectsGuidedFlow";
import type { ProjectDetail } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

export function ProjectGuidedCostsTab({ detail }: Props) {
  const guided = computeProjectGuidedCosts(detail);
  const cost = detail.costBreakdown;
  const { snapshotGroups } = buildProjectStructureSnapshotGroups(detail.structureLines, {
    simulatedProducts: detail.simulatedProducts,
  });

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Custos do Projeto</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumo financeiro da simulação — custo unitário, investimentos e custos adicionais separados.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Custo unitário estimado"
          value={formatMoney(guided.estimatedUnitCost)}
          hint="Produtos e engenharia simulada (recorrente)"
        />
        <StatCard
          label="Investimento inicial"
          value={formatMoney(guided.initialInvestment)}
          hint="Moldes cobrados separadamente"
        />
        <StatCard
          label="Outros custos do projeto"
          value={formatMoney(guided.otherProjectCosts)}
          hint="Desenvolvimento, testes, frete etc."
        />
        <StatCard
          label="Custo total do projeto"
          value={formatMoney(guided.totalProjectCost)}
          hint="Soma para visão de projeto (não unitiza molde automaticamente)"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Custo MP (unitário)" value={formatMoney(cost.rawMaterialCost)} />
        <StatCard label="Custo componentes" value={formatMoney(cost.componentCost)} />
        <StatCard label="Custo processo / roteiro" value={formatMoney(cost.serviceCost)} />
        <StatCard label="Margem alvo" value={formatPercent(cost.targetMarginPercent)} />
        <StatCard label="Preço sugerido" value={formatMoney(cost.suggestedPrice)} />
        <StatCard label="Itens pendentes de custo" value={String(guided.pendingCount)} />
      </div>

      {snapshotGroups.length > 0 ? (
        <div className="space-y-3">
          <h5 className="font-medium">Comparativo — itens clonados</h5>
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
          <h5 className="font-medium">Alertas</h5>
          {detail.alerts.map((a) => (
            <div
              key={`${a.code}-${a.message}`}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                a.severity === "warning" ? "bg-amber-50 text-amber-900" : "bg-muted"
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
