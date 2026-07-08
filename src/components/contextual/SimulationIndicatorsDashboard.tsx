import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
import type { SimulationListRow, NewProductSimulationSummary } from "@/src/lib/simulationIndicatorsStats";
import { avgScenarioAdjustments, newProductSnapshotCounts } from "@/src/lib/simulationIndicatorsStats";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "./ContextualDashboardKpiGrid";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";

export function SimulationIndicatorsDashboard() {
  const [simRows, setSimRows] = useState<SimulationListRow[] | null>(null);
  const [npRows, setNpRows] = useState<NewProductSimulationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, n] = await Promise.all([
          fetchJsonOk("/api/simulations"),
          fetchJsonOk("/api/new-product-simulations"),
        ]);
        if (!cancelled) {
          setSimRows(Array.isArray(s) ? s : []);
          setNpRows(Array.isArray(n) ? n : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar simulações.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avg = useMemo(() => (simRows ? avgScenarioAdjustments(simRows) : null), [simRows]);
  const np = useMemo(() => (npRows ? newProductSnapshotCounts(npRows) : null), [npRows]);

  const empty =
    simRows &&
    npRows &&
    simRows.length === 0 &&
    npRows.length === 0;

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Simulações — indicadores" backPath="/simulations">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (simRows === null || npRows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Simulações — indicadores" backPath="/simulations">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (empty) {
    return (
      <ContextualDashboardLayout moduleLabel="Simulações — indicadores" backPath="/simulations">
        <ContextualDashboardEmpty message="Não há cenários what-if nem simulações de novo produto salvas. Os indicadores aparecerão quando houver registros." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Simulações — indicadores" backPath="/simulations">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Cenários e sandbox</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Agrega cenários de produto (simulações) e registros de novo produto (sandbox) já persistidos — sem recalcular custos.
        </p>
      </div>

      <ContextualDashboardKpiGrid>
        <ContextualDashboardKpiCard label="Cenários what-if" value={String(simRows.length)} />
        <ContextualDashboardKpiCard label="Simulações novo produto" value={String(np!.total)} />
        <ContextualDashboardKpiCard label="Snapshots congelados" value={String(np!.saved)} />
        <ContextualDashboardKpiCard label="Rascunhos (novo produto)" value={String(np!.draft)} />
      </ContextualDashboardKpiGrid>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Ajustes médios nos cenários what-if (%)
        </h4>
        <p className="text-xs text-muted-foreground">
          Média simples dos campos materialAdj, laborAdj, indirectAdj, efficiencyAdj e marginAdj na lista de cenários.
        </p>
        <ContextualDashboardKpiGrid minColumnWidth={140}>
          <ContextualDashboardKpiCard label="MP" value={`${formatNumber(avg!.mp, 2)}%`} />
          <ContextualDashboardKpiCard label="HH" value={`${formatNumber(avg!.hh, 2)}%`} />
          <ContextualDashboardKpiCard label="HM" value={`${formatNumber(avg!.hm, 2)}%`} />
          <ContextualDashboardKpiCard label="Eficiência" value={`${formatNumber(avg!.eff, 2)}%`} />
          <ContextualDashboardKpiCard label="Margem" value={`${formatNumber(avg!.margin, 2)}%`} />
        </ContextualDashboardKpiGrid>
      </div>
    </ContextualDashboardLayout>
  );
}
