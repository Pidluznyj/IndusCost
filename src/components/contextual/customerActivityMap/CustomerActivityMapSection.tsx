/**
 * Clientes › Indicadores › Mapa de Atuação.
 *
 * Bloco de leitura: mostra ONDE está a carteira e ONDE houve atividade, sobre
 * as regras comerciais que já existem (o backend entrega tudo agregado).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LocateFixed, MapPinOff, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { ContextualDashboardKpiCard } from "../ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "../ContextualDashboardKpiGrid";
import {
  customerActivityMapApi,
  DEFAULT_MAP_FILTERS,
  isAbortError,
  MAP_NO_OWNER_KEY,
  MAP_ORDER_PERIOD_LABELS,
  type MapFilters,
  type MapOverview,
} from "./customerActivityMapApi";
import {
  MAP_METRIC_OPTIONS,
  MAP_SEQUENTIAL_SCALE,
  MAP_STAGE_LABELS,
  metricOption,
  type MapMetric,
} from "./customerActivityMapVisual";
import type { MapFocusRequest, MapViewInfo } from "./CustomerActivityLeafletMap";
import { CustomerActivityMapErrorBoundary } from "./CustomerActivityMapErrorBoundary";
import { CustomerActivityMapRanking } from "./CustomerActivityMapRanking";
import { CustomerActivityMapUnresolvedOverlay } from "./CustomerActivityMapUnresolvedOverlay";

// Leaflet fica fora do bundle principal: só carrega quando o mapa aparece.
const CustomerActivityLeafletMap = React.lazy(() => import("./CustomerActivityLeafletMap"));

const SELECT_CLASS =
  "h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const int = (value: number) => value.toLocaleString("pt-BR");

function MapSkeleton() {
  return (
    <div
      className="flex h-[clamp(380px,62vh,640px)] w-full animate-pulse items-center justify-center rounded-xl bg-muted/50 text-sm text-muted-foreground"
      role="status"
    >
      Carregando mapa de atuação...
    </div>
  );
}

export function CustomerActivityMapSection() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_MAP_FILTERS);
  const [metric, setMetric] = useState<MapMetric>("customers");
  const [overview, setOverview] = useState<MapOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [focus, setFocus] = useState<MapFocusRequest | null>(null);
  const [view, setView] = useState<MapViewInfo | null>(null);
  const [unresolvedOpen, setUnresolvedOpen] = useState(false);
  const focusNonce = useRef(0);

  useEffect(() => {
    // Filtro mudou rápido: a resposta antiga é cancelada e nunca sobrescreve a nova.
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    customerActivityMapApi
      .overview(filters, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setOverview(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [filters, reloadToken]);

  const requestFocus = useCallback((request: Omit<MapFocusRequest, "nonce">) => {
    focusNonce.current += 1;
    setFocus({ ...request, nonce: focusNonce.current } as MapFocusRequest);
  }, []);

  const openCustomer = useCallback(
    (customerId: string) => navigate(`/customers/${customerId}/intelligence`),
    [navigate]
  );

  const updateFilter = <K extends keyof MapFilters>(key: K, value: MapFilters[K]) =>
    setFilters((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));

  const option = metricOption(metric);
  const summary = overview?.summary ?? null;
  const incompleteCount = summary ? summary.stateOnlyCustomers + summary.unmappedCustomers : 0;
  const hasFilters =
    filters.status !== "" || filters.ownerKey !== "" || filters.orderPeriod !== "all";

  const viewStatus = useMemo(() => {
    if (!view) return null;
    if (view.stage !== "customers") return MAP_STAGE_LABELS[view.stage];
    if (view.customersError) return "Não foi possível carregar os clientes desta área";
    if (view.customersLoading) return "Carregando clientes desta área…";
    if (view.customersTruncated) {
      return `Mostrando ${int(view.customersShown)} de ${int(view.customersTotal)} clientes — aproxime para ver todos`;
    }
    return `${int(view.customersShown)} ${view.customersShown === 1 ? "cliente" : "clientes"} nesta área`;
  }, [view]);

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 space-y-4"
      aria-labelledby="customer-activity-map-title"
      data-testid="customer-activity-map-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4
            id="customer-activity-map-title"
            className="text-sm font-bold uppercase tracking-wide text-muted-foreground"
          >
            Mapa de Atuação
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Distribuição geográfica da carteira de clientes e atividade comercial.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Visualizar por
          </span>
          <div
            className="inline-flex flex-wrap rounded-lg border border-border bg-accent/30 p-0.5"
            role="radiogroup"
            aria-label="Métrica do mapa"
          >
            {MAP_METRIC_OPTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={metric === entry.id}
                onClick={() => setMetric(entry.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  metric === entry.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Responsável comercial
          <select
            className={SELECT_CLASS}
            value={filters.ownerKey}
            onChange={(event) => updateFilter("ownerKey", event.target.value)}
          >
            <option value="">Todos</option>
            <option value={MAP_NO_OWNER_KEY}>Sem responsável</option>
            {(overview?.filters.owners ?? []).map((owner) => (
              <option key={owner.key} value={owner.key}>
                {owner.name} ({int(owner.customers)})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Situação
          <select
            className={SELECT_CLASS}
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value as MapFilters["status"])}
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Ativos</option>
            <option value="INACTIVE">Inativos</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos no período
          <select
            className={SELECT_CLASS}
            value={filters.orderPeriod}
            onChange={(event) =>
              updateFilter("orderPeriod", event.target.value as MapFilters["orderPeriod"])
            }
            title="O período muda a contagem de pedidos. Os clientes continuam no mapa mesmo sem compra no período."
          >
            {Object.entries(MAP_ORDER_PERIOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {hasFilters ? (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_MAP_FILTERS)}
            className="h-9 rounded-lg px-3 text-sm font-medium text-primary hover:underline"
          >
            Limpar filtros
          </button>
        ) : null}

        {loading && overview ? (
          <span className="inline-flex h-9 items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Atualizando…
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center"
          role="alert"
        >
          <p className="text-sm font-medium text-destructive">
            Não foi possível carregar o Mapa de Atuação.
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        </div>
      ) : !overview || !summary ? (
        <MapSkeleton />
      ) : summary.customers === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
          <MapPinOff className="mb-3 h-9 w-9 text-muted-foreground opacity-60" />
          <p className="text-sm font-medium text-foreground">
            Nenhum cliente localizado para os filtros aplicados.
          </p>
        </div>
      ) : (
        <>
          <ContextualDashboardKpiGrid testId="customer-activity-map-kpis">
            <ContextualDashboardKpiCard
              label="Clientes mapeados"
              value={int(summary.mappedCustomers)}
              hint={`de ${int(summary.customers)} ${hasFilters ? "no filtro" : "cadastrados"}`}
            />
            <ContextualDashboardKpiCard label="Estados atendidos" value={int(summary.states)} />
            <ContextualDashboardKpiCard label="Cidades atendidas" value={int(summary.cities)} />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Sem localização precisa"
              value={int(incompleteCount)}
              subtitle={`${int(summary.stateOnlyCustomers)} só com UF · ${int(summary.unmappedCustomers)} sem localização`}
              tone={incompleteCount > 0 ? "warning" : "neutral"}
              footer={
                incompleteCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setUnresolvedOpen(true)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Ver registros
                  </button>
                ) : undefined
              }
            />
          </ContextualDashboardKpiGrid>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative min-w-0">
              <CustomerActivityMapErrorBoundary>
                <Suspense fallback={<MapSkeleton />}>
                  <CustomerActivityLeafletMap
                    overview={overview}
                    metric={metric}
                    filters={filters}
                    focus={focus}
                    onOpenCustomer={openCustomer}
                    onViewChange={setView}
                  />
                </Suspense>
              </CustomerActivityMapErrorBoundary>

              <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => requestFocus({ kind: "reset" })}
                  aria-label="Enquadrar toda a carteira no mapa"
                  className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 text-xs font-semibold shadow-sm hover:bg-accent"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  Enquadrar carteira
                </button>
                {viewStatus ? (
                  <span
                    className="pointer-events-auto rounded-lg border border-border bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm"
                    role="status"
                    aria-live="polite"
                    data-testid="customer-activity-map-status"
                  >
                    {viewStatus}
                  </span>
                ) : null}
              </div>
            </div>

            <CustomerActivityMapRanking
              overview={overview}
              metric={metric}
              onFocusCity={(city) => requestFocus({ kind: "city", lat: city.lat, lng: city.lng })}
              onFocusState={(state) => requestFocus({ kind: "state", uf: state.uf })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <span>
                  Intensidade: <strong className="text-foreground">{option.legend}</strong>
                </span>
                <span>Baixa</span>
                <span
                  className="h-2.5 w-28 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${MAP_SEQUENTIAL_SCALE.join(", ")})` }}
                  aria-hidden="true"
                />
                <span>Alta</span>
              </div>
              {view?.stage === "customers" ? (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                    Ativo
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" aria-hidden="true" />
                    Inativo
                  </span>
                </div>
              ) : null}
            </div>
            <p className="max-w-xl text-[11px] leading-snug">
              {overview.semantics.locationRule} Aproxime para passar de concentração a municípios e
              a clientes; clique no mapa para usar o zoom pela roda do mouse.
            </p>
          </div>
        </>
      )}

      {unresolvedOpen && overview ? (
        <CustomerActivityMapUnresolvedOverlay
          filters={filters}
          reasons={overview.summary.unresolvedByReason}
          onClose={() => setUnresolvedOpen(false)}
          onOpenCustomer={openCustomer}
        />
      ) : null}
    </section>
  );
}
