/**
 * Maiores concentrações — ranking pela métrica selecionada. Também é o caminho
 * de teclado para navegar o mapa: cada linha leva ao município ou à UF.
 */

import React, { useState } from "react";
import { cn } from "@/src/lib/utils";
import type { MapCity, MapOverview, MapState } from "./customerActivityMapApi";
import { maxMetric, metricOption, rankByMetric, type MapMetric } from "./customerActivityMapVisual";

const RANKING_SIZE = 8;

export function CustomerActivityMapRanking(props: {
  overview: MapOverview;
  metric: MapMetric;
  onFocusCity: (city: MapCity) => void;
  onFocusState: (state: MapState) => void;
}) {
  const { overview, metric } = props;
  const [level, setLevel] = useState<"cities" | "states">("cities");

  const rows =
    level === "cities"
      ? rankByMetric(overview.cities, metric, RANKING_SIZE).map((city) => ({
          key: String(city.ibgeCode),
          label: `${city.city} / ${city.uf}`,
          value: city[metric],
          onClick: () => props.onFocusCity(city),
        }))
      : rankByMetric(overview.states, metric, RANKING_SIZE).map((state) => ({
          key: state.uf,
          label: state.name,
          value: state[metric],
          onClick: () => props.onFocusState(state),
        }));
  const max = maxMetric(level === "cities" ? overview.cities : overview.states, metric);

  return (
    <aside
      className="flex flex-col rounded-xl border border-border bg-accent/10 p-4"
      aria-label="Maiores concentrações"
      data-testid="customer-activity-map-ranking"
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Maiores concentrações
        </h5>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-[11px] font-semibold">
          {(
            [
              ["cities", "Cidades"],
              ["states", "Estados"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={level === id}
              onClick={() => setLevel(id)}
              className={cn(
                "rounded px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                level === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Por {metricOption(metric).legend}.</p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Sem dados para esta métrica.</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {rows.map((row, position) => (
            <li key={row.key}>
              <button
                type="button"
                onClick={row.onClick}
                title={`Ver ${row.label} no mapa`}
                className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">
                      {position + 1}.
                    </span>
                    <span className="font-medium group-hover:text-primary">{row.label}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {row.value.toLocaleString("pt-BR")}
                  </span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${max > 0 ? Math.max(4, (row.value / max) * 100) : 0}%` }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
