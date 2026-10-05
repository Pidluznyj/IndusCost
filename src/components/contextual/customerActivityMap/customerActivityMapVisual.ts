/**
 * Mapa de Atuação — regras PURAS de apresentação (sem Leaflet, sem React).
 *
 * Nada aqui muda número: as transformações servem só para a intensidade
 * visual. Tooltips, ranking e cards mostram sempre o valor absoluto.
 */

export type MapMetric = "customers" | "activeCustomers" | "orders" | "newCustomers";

export type MapCounts = Record<MapMetric, number>;

export const MAP_METRIC_OPTIONS: ReadonlyArray<{
  id: MapMetric;
  label: string;
  /** Texto da legenda: o que a intensidade representa. */
  legend: string;
  unit: [singular: string, plural: string];
}> = [
  { id: "customers", label: "Clientes", legend: "quantidade de clientes", unit: ["cliente", "clientes"] },
  {
    id: "activeCustomers",
    label: "Ativos",
    legend: "quantidade de clientes ativos",
    unit: ["cliente ativo", "clientes ativos"],
  },
  { id: "orders", label: "Pedidos", legend: "quantidade de pedidos", unit: ["pedido", "pedidos"] },
  {
    id: "newCustomers",
    label: "Novos clientes",
    legend: "clientes cadastrados nos últimos 30 dias",
    unit: ["cliente novo", "clientes novos"],
  },
];

export function metricOption(metric: MapMetric) {
  return MAP_METRIC_OPTIONS.find((option) => option.id === metric) ?? MAP_METRIC_OPTIONS[0]!;
}

export function formatMetricValue(metric: MapMetric, value: number): string {
  const [singular, plural] = metricOption(metric).unit;
  return `${value.toLocaleString("pt-BR")} ${value === 1 ? singular : plural}`;
}

/**
 * Estágios do zoom — uma camada por vez, para heatmap e clusters não competirem:
 *   overview  → coroplético por UF + heatmap dos municípios
 *   cities    → bolhas por município (contagem)
 *   customers → clientes individuais agrupados em clusters
 */
export type MapStage = "overview" | "cities" | "customers";

export const MAP_STAGE_CITIES_MIN_ZOOM = 6;
export const MAP_STAGE_CUSTOMERS_MIN_ZOOM = 9;

export function resolveMapStage(zoom: number): MapStage {
  if (zoom >= MAP_STAGE_CUSTOMERS_MIN_ZOOM) return "customers";
  if (zoom >= MAP_STAGE_CITIES_MIN_ZOOM) return "cities";
  return "overview";
}

export const MAP_STAGE_LABELS: Record<MapStage, string> = {
  overview: "Concentração por região",
  cities: "Municípios",
  customers: "Clientes",
};

/**
 * Intensidade visual 0..1 em escala de RAIZ QUADRADA.
 *
 * Linear faria uma capital com 200 clientes apagar por completo uma cidade com
 * 5; raiz comprime o topo sem inverter a ordem. Piso de 0,12 para que qualquer
 * presença (valor > 0) continue visível.
 */
export function visualIntensity(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0.12, Math.min(1, Math.sqrt(value / max)));
}

/** Raio (px) da bolha de município — área proporcional ao valor. */
export function bubbleRadius(value: number, max: number): number {
  const intensity = visualIntensity(value, max);
  return intensity === 0 ? 0 : Math.round(11 + 21 * intensity);
}

/**
 * Escala sequencial de um matiz só (azul do sistema). Densidade não é
 * "bom/ruim", então nada de vermelho/verde.
 */
export const MAP_SEQUENTIAL_SCALE = ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"] as const;

export const MAP_EMPTY_FILL = "#f1f5f9";

export function sequentialColor(value: number, max: number): string {
  const intensity = visualIntensity(value, max);
  if (intensity === 0) return MAP_EMPTY_FILL;
  const step = Math.min(
    MAP_SEQUENTIAL_SCALE.length - 1,
    Math.floor(intensity * MAP_SEQUENTIAL_SCALE.length)
  );
  return MAP_SEQUENTIAL_SCALE[step]!;
}

/** Gradiente do heatmap, alinhado à escala sequencial. */
export const MAP_HEAT_GRADIENT: Record<number, string> = {
  0.15: "#bfdbfe",
  0.4: "#60a5fa",
  0.65: "#2563eb",
  0.85: "#1d4ed8",
  1: "#1e3a8a",
};

export function maxMetric(rows: ReadonlyArray<MapCounts>, metric: MapMetric): number {
  let max = 0;
  for (const row of rows) if (row[metric] > max) max = row[metric];
  return max;
}

/** Ranking pela métrica escolhida, sem linhas zeradas. */
export function rankByMetric<T extends MapCounts>(rows: ReadonlyArray<T>, metric: MapMetric, limit: number): T[] {
  return rows
    .filter((row) => row[metric] > 0)
    .slice()
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
}

export type ScreenCluster<T> = {
  /** Maior item do grupo — ancora a posição e dá nome à bolha. */
  anchor: T;
  members: T[];
  x: number;
  y: number;
};

/**
 * Agrupa itens que se sobreporiam NA TELA (distância em pixels), do maior para
 * o menor. Só apresentação: evita uma nuvem ilegível de bolhas "1" em zoom
 * intermediário. Quem soma os valores do grupo é o chamador.
 */
export function clusterByScreenDistance<T>(
  items: ReadonlyArray<{ item: T; x: number; y: number; weight: number }>,
  minDistancePx: number
): ScreenCluster<T>[] {
  const clusters: ScreenCluster<T>[] = [];
  const limit = minDistancePx * minDistancePx;
  for (const entry of items.slice().sort((a, b) => b.weight - a.weight)) {
    let target: ScreenCluster<T> | null = null;
    let best = limit;
    for (const cluster of clusters) {
      const dx = cluster.x - entry.x;
      const dy = cluster.y - entry.y;
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        target = cluster;
      }
    }
    if (target) target.members.push(entry.item);
    else clusters.push({ anchor: entry.item, members: [entry.item], x: entry.x, y: entry.y });
  }
  return clusters;
}

/** bbox "oeste,sul,leste,norte" com 4 casas — o formato que a API espera. */
export function formatBounds(bounds: { west: number; south: number; east: number; north: number }): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((n) => n.toFixed(4)).join(",");
}

export type MapTileConfig = { url: string | null; attribution: string };

const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/**
 * Base cartográfica configurável por ambiente (sem chave no código):
 *   VITE_ACTIVITY_MAP_TILE_URL          URL com {z}/{x}/{y}; "none" desliga os tiles
 *   VITE_ACTIVITY_MAP_TILE_ATTRIBUTION  crédito exigido pelo provedor
 * Sem tiles o mapa continua legível: o contorno das UFs é local.
 */
export function resolveTileConfig(env: Record<string, unknown> | undefined): MapTileConfig {
  const url = typeof env?.VITE_ACTIVITY_MAP_TILE_URL === "string" ? env.VITE_ACTIVITY_MAP_TILE_URL.trim() : "";
  const attribution =
    typeof env?.VITE_ACTIVITY_MAP_TILE_ATTRIBUTION === "string"
      ? env.VITE_ACTIVITY_MAP_TILE_ATTRIBUTION.trim()
      : "";
  if (url.toLowerCase() === "none") return { url: null, attribution: "" };
  if (!url) return { url: DEFAULT_TILE_URL, attribution: DEFAULT_TILE_ATTRIBUTION };
  return { url, attribution };
}
