/**
 * Mapa de Atuação — a tela do mapa em si (Leaflet imperativo).
 *
 * O React só entrega dados prontos e recebe eventos; camadas, zoom e pan ficam
 * com o Leaflet, para não recriar marcadores a cada render. Três estágios, uma
 * camada de dados por vez:
 *   overview  → coroplético por UF + heatmap dos municípios
 *   cities    → bolhas por município
 *   customers → clientes individuais em clusters (buscados pela área visível)
 */

import React, { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "./customer-activity-map.css";
import { BRAZIL_STATES_GEOJSON } from "./brazilStates.geo";
import {
  customerActivityMapApi,
  isAbortError,
  type MapCity,
  type MapCustomer,
  type MapFilters,
  type MapOverview,
  type MapState,
} from "./customerActivityMapApi";
import {
  bubbleRadius,
  clusterByScreenDistance,
  formatBounds,
  MAP_EMPTY_FILL,
  MAP_HEAT_GRADIENT,
  maxMetric,
  resolveMapStage,
  resolveTileConfig,
  sequentialColor,
  visualIntensity,
  type MapMetric,
  type MapStage,
} from "./customerActivityMapVisual";
import { loadLeafletRuntime, type LeafletRuntime } from "./leafletRuntime";

export type MapFocusRequest =
  | { kind: "city"; lat: number; lng: number; nonce: number }
  | { kind: "state"; uf: string; nonce: number }
  | { kind: "reset"; nonce: number };

export type MapViewInfo = {
  stage: MapStage;
  /** Só no estágio de clientes. */
  customersLoading: boolean;
  customersShown: number;
  customersTotal: number;
  customersTruncated: boolean;
  customersError: boolean;
};

type Props = {
  overview: MapOverview;
  metric: MapMetric;
  filters: MapFilters;
  focus: MapFocusRequest | null;
  onOpenCustomer: (customerId: string) => void;
  onViewChange: (info: MapViewInfo) => void;
};

const BRAZIL_BOUNDS: [[number, number], [number, number]] = [
  [-33.8, -73.99],
  [5.3, -34.8],
];
const CITY_FOCUS_ZOOM = 11;
/** Distância mínima (px) entre centros de bolhas no estágio de municípios. */
const CITY_BUBBLE_MIN_DISTANCE_PX = 46;
const CUSTOMER_FETCH_DEBOUNCE_MS = 250;
/** Até aqui, clientes no mesmo ponto abrem em leque; acima disso, em lista. */
const SPIDERFY_MAX_CUSTOMERS = 12;

type CustomerMarker = Leaflet.Marker & { camCustomer?: MapCustomer };

type Engine = {
  L: LeafletRuntime;
  map: Leaflet.Map;
  statesLayer: Leaflet.GeoJSON;
  heatLayer: Leaflet.Layer & { setLatLngs: (points: Array<[number, number, number]>) => void };
  /** Pontos do heatmap — aplicados só com a camada no mapa (fora dele o plugin quebra). */
  heatPoints: Array<[number, number, number]>;
  citiesLayer: Leaflet.LayerGroup;
  clusterLayer: Leaflet.MarkerClusterGroup;
  stage: MapStage;
  fitted: boolean;
  fetchTimer: ReturnType<typeof setTimeout> | null;
  fetchAbort: AbortController | null;
  /** Área já carregada (para não refazer a busca a cada pequeno pan). */
  loaded: { bounds: Leaflet.LatLngBounds; filtersKey: string; truncated: boolean } | null;
};

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Card de tooltip/popup montado por DOM (textContent) — nome de cliente nunca vira HTML. */
function buildCard(input: {
  title: string;
  subtitle?: string;
  rows: Array<[label: string, value: string | HTMLElement]>;
  note?: string;
}): HTMLElement {
  const card = el("div", "cam-card");
  card.append(el("div", "cam-card__title", input.title));
  if (input.subtitle) card.append(el("div", "cam-card__subtitle", input.subtitle));
  const list = el("dl", "cam-card__rows");
  for (const [label, value] of input.rows) {
    list.append(el("dt", "", label));
    const dd = el("dd", "");
    if (typeof value === "string") dd.textContent = value;
    else dd.append(value);
    list.append(dd);
  }
  card.append(list);
  if (input.note) card.append(el("div", "cam-card__note", input.note));
  return card;
}

const int = (value: number) => value.toLocaleString("pt-BR");

function countRows(counts: {
  customers: number;
  activeCustomers: number;
  orders: number;
  newCustomers: number;
}): Array<[string, string]> {
  return [
    ["Clientes", int(counts.customers)],
    ["Ativos", int(counts.activeCustomers)],
    ["Pedidos", int(counts.orders)],
    ["Novos (30 dias)", int(counts.newCustomers)],
  ];
}

function stateCard(state: MapState): HTMLElement {
  return buildCard({
    title: state.name,
    rows: [...countRows(state), ["Cidades", int(state.cities)]],
    note:
      state.stateOnlyCustomers > 0
        ? `${int(state.stateOnlyCustomers)} sem cidade reconhecida (contam só na UF).`
        : undefined,
  });
}

function cityCard(city: MapCity): HTMLElement {
  return buildCard({ title: `${city.city} / ${city.uf}`, rows: countRows(city) });
}

function customerCard(customer: MapCustomer, onOpen: (id: string) => void): HTMLElement {
  const active = customer.status === "ACTIVE";
  const status = el(
    "span",
    `cam-status ${active ? "cam-status--active" : "cam-status--inactive"}`,
    active ? "Ativo" : "Inativo"
  );
  const card = buildCard({
    title: customer.companyName,
    subtitle: [customer.city, customer.state].filter(Boolean).join(" / ") || undefined,
    rows: [
      ["Status", status],
      ["Responsável", customer.ownerName ?? "—"],
      ["Pedidos", int(customer.orderCount)],
      [
        "Última compra",
        customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString("pt-BR") : "—",
      ],
    ],
    note: "Posição aproximada: centro do município.",
  });
  const action = el("button", "cam-card__action", "Ver cliente") as HTMLButtonElement;
  action.type = "button";
  action.addEventListener("click", () => onOpen(customer.id));
  card.append(action);
  return card;
}

/**
 * Lista dos clientes de um mesmo ponto (todos no centro do município). Um
 * leque com dezenas de marcadores seria ilegível; a lista chega a cada cliente.
 */
function customerListCard(
  customers: MapCustomer[],
  onSelect: (customer: MapCustomer) => void
): HTMLElement {
  const first = customers[0];
  const place = first ? [first.city, first.state].filter(Boolean).join(" / ") : "";
  const card = el("div", "cam-card");
  card.append(el("div", "cam-card__title", place || "Clientes neste ponto"));
  card.append(
    el("div", "cam-card__subtitle", `${int(customers.length)} clientes · centro do município`)
  );
  const list = el("ul", "cam-list");
  for (const customer of customers) {
    const item = el("li", "");
    const button = el("button", "cam-list__item") as HTMLButtonElement;
    button.type = "button";
    button.append(
      el("span", `cam-list__dot${customer.status === "ACTIVE" ? "" : " cam-list__dot--inactive"}`),
      el("span", "cam-list__name", customer.companyName)
    );
    button.addEventListener("click", () => onSelect(customer));
    item.append(button);
    list.append(item);
  }
  card.append(list);
  return card;
}

export function CustomerActivityLeafletMap(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Funções de desenho vivem em ref: são chamadas por eventos do Leaflet e
  // precisam enxergar sempre as props mais recentes.
  const api = useRef({
    emit(partial: Partial<MapViewInfo> = {}) {
      const engine = engineRef.current;
      if (!engine) return;
      propsRef.current.onViewChange({
        stage: engine.stage,
        customersLoading: false,
        customersShown: 0,
        customersTotal: 0,
        customersTruncated: false,
        customersError: false,
        ...partial,
      });
    },

    drawStates() {
      const engine = engineRef.current;
      if (!engine) return;
      const { overview, metric } = propsRef.current;
      const byUf = new Map<string, MapState>();
      for (const state of overview.states) byUf.set(state.uf, state);
      const max = maxMetric(overview.states, metric);
      const overviewStage = engine.stage === "overview";
      engine.statesLayer.eachLayer((layer) => {
        const feature = (layer as Leaflet.Path & { feature?: { properties: { uf: string; name: string } } })
          .feature;
        if (!feature) return;
        const state = byUf.get(feature.properties.uf);
        (layer as Leaflet.Path).setStyle({
          color: overviewStage ? "#ffffff" : "#94a3b8",
          weight: overviewStage ? 1 : 0.8,
          fillColor: state ? sequentialColor(state[metric], max) : MAP_EMPTY_FILL,
          fillOpacity: overviewStage ? 0.5 : 0.05,
        });
        const tooltip = state
          ? stateCard(state)
          : buildCard({ title: feature.properties.name, rows: [["Clientes", "0"]] });
        (layer as Leaflet.Path).unbindTooltip();
        (layer as Leaflet.Path).bindTooltip(tooltip, { sticky: true, className: "cam-tooltip", opacity: 1 });
      });
    },

    drawHeat() {
      const engine = engineRef.current;
      if (!engine) return;
      const { overview, metric } = propsRef.current;
      const max = maxMetric(overview.cities, metric);
      const points: Array<[number, number, number]> = [];
      for (const city of overview.cities) {
        const intensity = visualIntensity(city[metric], max);
        if (intensity > 0) points.push([city.lat, city.lng, intensity]);
      }
      engine.heatPoints = points;
      if (engine.map.hasLayer(engine.heatLayer)) engine.heatLayer.setLatLngs(points);
    },

    drawCities() {
      const engine = engineRef.current;
      if (!engine) return;
      const { L, map, citiesLayer } = engine;
      citiesLayer.clearLayers();
      if (engine.stage !== "cities") return;
      const { overview, metric } = propsRef.current;
      const max = maxMetric(overview.cities, metric);
      const bounds = map.getBounds().pad(0.15);
      const visible = overview.cities.filter(
        (city) => city[metric] > 0 && bounds.contains([city.lat, city.lng])
      );
      // Municípios que se sobreporiam na tela viram uma bolha só, com a soma.
      const groups = clusterByScreenDistance<MapCity>(
        visible.map((city) => {
          const point = map.latLngToLayerPoint([city.lat, city.lng]);
          return { item: city, x: point.x, y: point.y, weight: city[metric] };
        }),
        CITY_BUBBLE_MIN_DISTANCE_PX
      );
      // Maiores por último = por cima; pequenas continuam clicáveis.
      for (const group of groups.reverse()) {
        const city = group.anchor;
        const merged = group.members.length > 1;
        const total = group.members.reduce(
          (sum, member) => ({
            customers: sum.customers + member.customers,
            activeCustomers: sum.activeCustomers + member.activeCustomers,
            orders: sum.orders + member.orders,
            newCustomers: sum.newCustomers + member.newCustomers,
          }),
          { customers: 0, activeCustomers: 0, orders: 0, newCustomers: 0 }
        );
        const radius = bubbleRadius(total[metric], max);
        const value = int(total[metric]);
        const name = merged
          ? `${city.city} / ${city.uf} + ${group.members.length - 1} ${group.members.length === 2 ? "município" : "municípios"}`
          : `${city.city} / ${city.uf}`;
        const marker = L.marker([city.lat, city.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="cam-bubble${radius < 16 ? " cam-bubble--small" : ""}" style="width:${radius * 2}px;height:${radius * 2}px">${value}</div>`,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius],
          }),
          title: `${name}: ${value}`,
          alt: `${name}: ${value}`,
          keyboard: true,
          riseOnHover: true,
        });
        const card = merged
          ? buildCard({
              title: name,
              rows: countRows(total),
              note: "Aproxime para separar os municípios.",
            })
          : cityCard(city);
        marker.bindTooltip(card, { className: "cam-tooltip", opacity: 1, direction: "top", offset: [0, -radius] });
        marker.on("click keypress", () => {
          if (!merged) {
            map.flyTo([city.lat, city.lng], CITY_FOCUS_ZOOM, { duration: 0.6 });
            return;
          }
          // Grupo: aproxima até caberem os municípios dele.
          map.fitBounds(
            L.latLngBounds(group.members.map((member) => [member.lat, member.lng] as [number, number])),
            { padding: [60, 60], maxZoom: CITY_FOCUS_ZOOM }
          );
        });
        citiesLayer.addLayer(marker);
      }
    },

    scheduleCustomers(immediate = false) {
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.fetchTimer) clearTimeout(engine.fetchTimer);
      engine.fetchTimer = setTimeout(
        () => void api.current.loadCustomers(),
        immediate ? 0 : CUSTOMER_FETCH_DEBOUNCE_MS
      );
    },

    async loadCustomers() {
      const engine = engineRef.current;
      if (!engine || engine.stage !== "customers") return;
      const { L, map, clusterLayer } = engine;
      const { filters, onOpenCustomer } = propsRef.current;
      const filtersKey = JSON.stringify(filters);
      const viewport = map.getBounds();

      if (
        engine.loaded &&
        engine.loaded.filtersKey === filtersKey &&
        !engine.loaded.truncated &&
        engine.loaded.bounds.contains(viewport)
      ) {
        return;
      }

      engine.fetchAbort?.abort();
      const controller = new AbortController();
      engine.fetchAbort = controller;
      const area = viewport.pad(0.35);
      api.current.emit({ customersLoading: true, customersShown: clusterLayer.getLayers().length });

      try {
        const detail = await customerActivityMapApi.customers(
          filters,
          {
            bbox: formatBounds({
              west: Math.max(-180, area.getWest()),
              south: Math.max(-90, area.getSouth()),
              east: Math.min(180, area.getEast()),
              north: Math.min(90, area.getNorth()),
            }),
          },
          controller.signal
        );
        if (controller.signal.aborted || engineRef.current !== engine) return;

        const markers = detail.customers
          .filter((customer) => customer.lat != null && customer.lng != null)
          .map((customer) => {
            const marker = L.marker([customer.lat!, customer.lng!], {
              icon: L.divIcon({
                className: "",
                html: `<div class="cam-pin${customer.status === "ACTIVE" ? "" : " cam-pin--inactive"}" style="width:16px;height:16px"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              }),
              title: customer.companyName,
              alt: customer.companyName,
              keyboard: true,
            });
            (marker as CustomerMarker).camCustomer = customer;
            // Conteúdo montado só quando o popup abre.
            marker.bindPopup(() => customerCard(customer, onOpenCustomer), { maxWidth: 300 });
            return marker;
          });

        clusterLayer.clearLayers();
        clusterLayer.addLayers(markers);
        engine.loaded = { bounds: area, filtersKey, truncated: detail.truncated };
        api.current.emit({
          customersShown: markers.length,
          customersTotal: detail.total,
          customersTruncated: detail.truncated,
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
        api.current.emit({ customersError: true });
      }
    },

    /** Liga/desliga camadas conforme o zoom — uma camada de dados por estágio. */
    syncStage() {
      const engine = engineRef.current;
      if (!engine) return;
      const { map, heatLayer, citiesLayer, clusterLayer } = engine;
      const next = resolveMapStage(map.getZoom());
      const changed = next !== engine.stage;
      engine.stage = next;

      const toggle = (layer: Leaflet.Layer, on: boolean) => {
        if (on && !map.hasLayer(layer)) map.addLayer(layer);
        if (!on && map.hasLayer(layer)) map.removeLayer(layer);
      };
      const heatWasOff = !map.hasLayer(heatLayer);
      toggle(heatLayer, next === "overview");
      if (next === "overview" && heatWasOff) heatLayer.setLatLngs(engine.heatPoints);
      toggle(citiesLayer, next === "cities");
      toggle(clusterLayer, next === "customers");

      if (changed) api.current.drawStates();
      if (next === "cities") api.current.drawCities();
      if (next === "customers") {
        api.current.scheduleCustomers(changed);
      } else {
        engine.fetchAbort?.abort();
        if (changed) api.current.emit();
      }
    },

    fitToPortfolio(animate: boolean) {
      const engine = engineRef.current;
      if (!engine) return;
      const { L, map } = engine;
      const cities = propsRef.current.overview.cities;
      const bounds = cities.length
        ? L.latLngBounds(cities.map((city) => [city.lat, city.lng] as [number, number])).pad(0.04)
        : L.latLngBounds(BRAZIL_BOUNDS);
      // Visão inicial é sempre macro: nunca abre já no nível de cliente.
      map.fitBounds(bounds, { animate, maxZoom: 5.5, padding: [8, 8] });
    },
  });

  // ── Montagem do mapa (uma vez) ─────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    loadLeafletRuntime()
      .then((L) => {
        if (disposed || !containerRef.current) return;

        const map = L.map(container, {
          minZoom: 4,
          maxZoom: 16,
          zoomSnap: 0.5,
          zoomControl: true,
          scrollWheelZoom: false, // só após interação — não sequestra o scroll da página
          maxBounds: [
            [-60, -110],
            [25, -10],
          ],
          maxBoundsViscosity: 0.6,
        });
        map.attributionControl.setPrefix(false);

        const tiles = resolveTileConfig((import.meta as unknown as { env?: Record<string, unknown> }).env);
        if (tiles.url) {
          L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(map);
        }

        const statesLayer = L.geoJSON(BRAZIL_STATES_GEOJSON as never, {
          style: { color: "#ffffff", weight: 1, fillColor: MAP_EMPTY_FILL, fillOpacity: 0.6 },
          onEachFeature: (_feature, layer) => {
            layer.on("click", () => {
              map.fitBounds((layer as Leaflet.Polygon).getBounds(), { padding: [20, 20] });
            });
            layer.on("mouseover", () => (layer as Leaflet.Path).setStyle({ weight: 2.2, color: "#1d4ed8" }));
            layer.on("mouseout", () => api.current.drawStates());
          },
        }).addTo(map);

        const heatLayer = (
          L as unknown as {
            heatLayer: (points: unknown[], options: Record<string, unknown>) => Engine["heatLayer"];
          }
        ).heatLayer([], {
          radius: 17,
          blur: 19,
          maxZoom: 4, // intensidade cheia já na visão Brasil
          // pontos vizinhos somam: teto acima de 1 evita saturar regiões densas
          max: 2.4,
          minOpacity: 0.22,
          gradient: MAP_HEAT_GRADIENT,
        });

        const clusterLayer = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 48,
          spiderfyOnMaxZoom: true,
          zoomToBoundsOnClick: false, // tratado em "clusterclick" (zoom, leque ou lista)
          chunkedLoading: true,
          iconCreateFunction: (cluster) => {
            const count = cluster.getChildCount();
            const size = count >= 100 ? 52 : count >= 10 ? 44 : 38;
            return L.divIcon({
              className: "",
              html: `<div class="cam-cluster" style="width:${size}px;height:${size}px" aria-label="${count} clientes">${int(count)}</div>`,
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            });
          },
        });

        clusterLayer.on("clusterclick", (event: Leaflet.LeafletEvent) => {
          const cluster = (event as unknown as { layer: Leaflet.MarkerCluster }).layer;
          const bounds = cluster.getBounds();
          const samePoint = bounds.getSouthWest().equals(bounds.getNorthEast());
          if (!samePoint) {
            cluster.zoomToBounds({ padding: [30, 30] });
            return;
          }
          const customers = (cluster.getAllChildMarkers() as CustomerMarker[])
            .map((marker) => marker.camCustomer)
            .filter((customer): customer is MapCustomer => customer != null);
          if (customers.length <= SPIDERFY_MAX_CUSTOMERS) {
            cluster.spiderfy();
            return;
          }
          const popup = L.popup({ maxWidth: 320 }).setLatLng(cluster.getLatLng());
          // Troca de conteúdo sempre DEPOIS do clique terminar: se o botão clicado
          // sai do DOM durante o evento, o Leaflet entende "clique no mapa" e fecha o popup.
          const later = (action: () => void) => () => setTimeout(action, 0);
          const showList = () =>
            popup.setContent(
              customerListCard(customers, (customer) => {
                const card = customerCard(customer, (id) => propsRef.current.onOpenCustomer(id));
                const back = el("button", "cam-card__back", "← Voltar à lista") as HTMLButtonElement;
                back.type = "button";
                back.addEventListener("click", later(showList));
                card.prepend(back);
                setTimeout(() => popup.setContent(card), 0);
              })
            );
          showList();
          popup.openOn(map);
        });

        engineRef.current = {
          L,
          map,
          statesLayer,
          heatLayer,
          heatPoints: [],
          citiesLayer: L.layerGroup(),
          clusterLayer,
          stage: "overview",
          fitted: false,
          fetchTimer: null,
          fetchAbort: null,
          loaded: null,
        };

        map.on("zoomend moveend", () => api.current.syncStage());
        map.on("click focus", () => map.scrollWheelZoom.enable());
        container.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());

        map.fitBounds(BRAZIL_BOUNDS);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setLoadError(true);
      });

    return () => {
      disposed = true;
      const engine = engineRef.current;
      if (engine) {
        if (engine.fetchTimer) clearTimeout(engine.fetchTimer);
        engine.fetchAbort?.abort();
        engine.map.remove();
        engineRef.current = null;
      }
    };
  }, []);

  // ── Dados/métrica/filtros mudaram: redesenha só as camadas ─────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (!ready || !engine) return;
    if (!engine.fitted) {
      engine.fitted = true;
      api.current.fitToPortfolio(false);
    }
    engine.loaded = null;
    api.current.drawStates();
    api.current.drawHeat();
    api.current.syncStage();
    if (engine.stage === "customers") api.current.scheduleCustomers(true);
    else api.current.emit();
  }, [ready, props.overview, props.metric, props.filters]);

  // ── Foco pedido de fora (ranking, "enquadrar carteira") ────────────────
  useEffect(() => {
    const engine = engineRef.current;
    const focus = props.focus;
    if (!ready || !engine || !focus) return;
    if (focus.kind === "reset") {
      api.current.fitToPortfolio(true);
    } else if (focus.kind === "city") {
      engine.map.flyTo([focus.lat, focus.lng], CITY_FOCUS_ZOOM, { duration: 0.7 });
    } else {
      engine.statesLayer.eachLayer((layer) => {
        const feature = (layer as Leaflet.Polygon & { feature?: { properties: { uf: string } } }).feature;
        if (feature?.properties.uf === focus.uf) {
          engine.map.fitBounds((layer as Leaflet.Polygon).getBounds(), { padding: [20, 20] });
        }
      });
    }
  }, [ready, props.focus]);

  return (
    <div className="cam-map" data-testid="customer-activity-map">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Mapa de atuação: distribuição geográfica dos clientes. Use o ranking ao lado para navegar pelo teclado."
      />
      {!ready && !loadError ? (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-muted/40 text-sm text-muted-foreground">
          Carregando mapa de atuação...
        </div>
      ) : null}
      {loadError ? (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-card p-6 text-center text-sm text-destructive">
          Não foi possível carregar o componente de mapa. Recarregue a página.
        </div>
      ) : null}
    </div>
  );
}

export default CustomerActivityLeafletMap;
