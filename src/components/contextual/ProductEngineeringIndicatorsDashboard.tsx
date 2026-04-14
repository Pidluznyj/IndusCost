import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
import type { Product } from "@/src/types/product";
import { productEngineeringRollup } from "@/src/lib/productEngineeringIndicatorsStats";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";

export function ProductEngineeringIndicatorsDashboard() {
  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonOk("/api/products");
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar produtos.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const roll = useMemo(() => (rows ? productEngineeringRollup(rows) : null), [rows]);

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Engenharia — indicadores" backPath="/products">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Engenharia — indicadores" backPath="/products">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Engenharia — indicadores" backPath="/products">
        <ContextualDashboardEmpty message="Não há itens de engenharia cadastrados." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Engenharia — indicadores" backPath="/products">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Estrutura e cadastro</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Contagens a partir da lista de produtos/componentes/MPs (GET /api/products), sem recálculo de custo industrial.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ContextualDashboardKpiCard label="Itens no cadastro" value={String(roll!.total)} />
        <ContextualDashboardKpiCard label="Linhas de BOM (total)" value={String(roll!.bomLines)} />
        <ContextualDashboardKpiCard label="Operações de roteiro (total)" value={String(roll!.routingOps)} />
        <ContextualDashboardKpiCard
          label="Produto/componente sem BOM"
          value={String(roll!.manufacturedWithoutBom)}
          hint="Itens fabricados (não MP) com lista vazia."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Mix por tipo</h4>
          <div className="space-y-3">
            {(
              [
                { k: "PRODUCT" as const, label: "Produto acabado" },
                { k: "COMPONENT" as const, label: "Componente" },
                { k: "MATERIAL" as const, label: "Matéria-prima (cadastro)" },
              ] as const
            ).map(({ k, label }) => {
              const v = roll!.byType[k];
              const pct = roll!.total > 0 ? (v / roll!.total) * 100 : 0;
              return (
                <div key={k} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{label}</span>
                    <span className="font-semibold tabular-nums">
                      {v} ({formatNumber(pct, 1)}%)
                    </span>
                  </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-600 print:bg-slate-600"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Alertas estruturais</h4>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li>
              <span className="font-semibold text-foreground">{roll!.manufacturedWithoutRouting}</span> produtos/componentes
              sem operação de roteiro cadastrada.
            </li>
            <li>
              Indicadores de custo parcial ou excluídos do cálculo ficam na análise de custo do item, não neste painel.
            </li>
          </ul>
        </div>
      </div>
    </ContextualDashboardLayout>
  );
}
