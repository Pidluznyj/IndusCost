/**
 * Mapa de Atuação — camada PURA (localização + agregações geográficas).
 *
 * Esta camada é só VISUALIZAÇÃO GEOGRÁFICA sobre regras comerciais que já
 * existem; ela não redefine nenhuma:
 *  - cliente ativo  = `Customer.status === "ACTIVE"` (mesmo critério dos cards
 *    "Ativos/Inativos" de Clientes › Indicadores);
 *  - pedidos        = pedidos de venda válidos, status fora de CANCELLED/ERROR
 *    (mesmo critério de "Com ao menos um pedido");
 *  - novos clientes = cadastro nos últimos 30 dias (mesmo critério de
 *    "Novos (últimos 30 dias)").
 *
 * O cadastro não guarda latitude/longitude. A posição vem do centróide do
 * município (cidade + UF → IBGE), então a precisão é sempre conhecida e nunca
 * é apresentada como endereço exato.
 */

import { normalizeBrazilUf } from "../../customerIndicators.js";

/** Mesma população de pedidos válidos de /api/customers/indicators. */
export const CUSTOMER_MAP_EXCLUDED_ORDER_STATUSES = ["CANCELLED", "ERROR"] as const;

/** Janela de "novo cliente" — igual ao card "Novos (últimos 30 dias)". */
export const CUSTOMER_MAP_NEW_CUSTOMER_WINDOW_DAYS = 30;

export const CUSTOMER_MAP_METRICS = ["customers", "activeCustomers", "orders", "newCustomers"] as const;
export type CustomerMapMetric = (typeof CUSTOMER_MAP_METRICS)[number];

/**
 * EXACT fica reservado para quando o cadastro tiver coordenada própria; hoje
 * nenhum cliente a tem, então o melhor nível possível é CITY.
 */
export type CustomerMapPrecision = "EXACT" | "CITY" | "STATE" | "UNKNOWN";

export type CustomerMapUnresolvedReason =
  | "FOREIGN_COUNTRY"
  | "MISSING_STATE_AND_CITY"
  | "MISSING_STATE"
  | "INVALID_STATE"
  | "MISSING_CITY"
  | "CITY_NOT_RECOGNIZED";

export const CUSTOMER_MAP_UNRESOLVED_REASON_LABELS: Readonly<
  Record<CustomerMapUnresolvedReason, string>
> = Object.freeze({
  FOREIGN_COUNTRY: "Cliente fora do Brasil",
  MISSING_STATE_AND_CITY: "Sem cidade e sem UF",
  MISSING_STATE: "Sem UF",
  INVALID_STATE: "UF não reconhecida",
  MISSING_CITY: "Sem cidade (só UF)",
  CITY_NOT_RECOGNIZED: "Cidade não reconhecida na UF informada",
});

export type BrazilMunicipality = {
  ibgeCode: number;
  name: string;
  uf: string;
  lat: number;
  lng: number;
};

export type BrazilState = { uf: string; name: string; lat: number; lng: number; region: string };

export type BrazilGeoIndex = {
  states: ReadonlyMap<string, BrazilState>;
  /** chave `UF|CIDADE NORMALIZADA` → município; ambíguos ficam de fora. */
  municipalities: ReadonlyMap<string, BrazilMunicipality>;
};

// ─── Normalização determinística ────────────────────────────────────────────

/**
 * Chave de comparação de município: sem acento, sem caixa, pontuação vira
 * espaço. Só iguala o que difere por caixa/acentuação/pontuação — nada de
 * fuzzy: "Curitíba" casa com "Curitiba"; "Curitba" não casa com nada.
 */
export function normalizeCityKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

/** "Curitiba - PR" / "Curitiba/PR" → { city: "Curitiba", uf: "PR" }. */
function splitTrailingUf(city: string): { city: string; uf: string | null } {
  const match = /^(.*?)[\s]*[-/–(,][\s]*([A-Za-z]{2})\)?\s*$/.exec(city.trim());
  if (!match || !match[1]?.trim()) return { city, uf: null };
  const uf = normalizeBrazilUf(match[2]);
  if (uf === "—" || uf === "OUTROS") return { city, uf: null };
  return { city: match[1].trim(), uf };
}

function isBrazil(country: string | null | undefined): boolean {
  if (isBlank(country)) return true;
  const key = normalizeCityKey(country);
  return key === "BRASIL" || key === "BRAZIL" || key === "BR";
}

export function buildBrazilGeoIndex(input: {
  states: ReadonlyArray<readonly [string, string, number, number, string]>;
  municipalities: ReadonlyArray<readonly [number, string, string, number, number]>;
}): BrazilGeoIndex {
  const states = new Map<string, BrazilState>();
  for (const [uf, name, lat, lng, region] of input.states) {
    states.set(uf, { uf, name, lat, lng, region });
  }

  const municipalities = new Map<string, BrazilMunicipality>();
  const ambiguous = new Set<string>();
  for (const [ibgeCode, name, uf, lat, lng] of input.municipalities) {
    const key = `${uf}|${normalizeCityKey(name)}`;
    if (ambiguous.has(key)) continue;
    if (municipalities.has(key)) {
      // Dois municípios com a mesma chave na mesma UF: na dúvida, não mapear.
      municipalities.delete(key);
      ambiguous.add(key);
      continue;
    }
    municipalities.set(key, { ibgeCode, name, uf, lat, lng });
  }
  return { states, municipalities };
}

export type CustomerMapLocation =
  | {
      precision: "CITY";
      uf: string;
      ibgeCode: number;
      cityName: string;
      lat: number;
      lng: number;
      reason: null;
    }
  | {
      precision: "STATE";
      uf: string;
      ibgeCode: null;
      cityName: null;
      lat: number;
      lng: number;
      reason: "MISSING_CITY" | "CITY_NOT_RECOGNIZED";
    }
  | {
      precision: "UNKNOWN";
      uf: null;
      ibgeCode: null;
      cityName: null;
      lat: null;
      lng: null;
      reason: "FOREIGN_COUNTRY" | "MISSING_STATE_AND_CITY" | "MISSING_STATE" | "INVALID_STATE";
    };

const UNKNOWN_BASE = {
  precision: "UNKNOWN",
  uf: null,
  ibgeCode: null,
  cityName: null,
  lat: null,
  lng: null,
} as const;

/** Resolve a posição de um cliente pela melhor informação cadastral disponível. */
export function resolveCustomerMapLocation(
  customer: { city: string | null; state: string | null; country?: string | null },
  index: BrazilGeoIndex
): CustomerMapLocation {
  if (!isBrazil(customer.country)) return { ...UNKNOWN_BASE, reason: "FOREIGN_COUNTRY" };

  let cityRaw = isBlank(customer.city) ? "" : String(customer.city).trim();
  let uf: string | null = null;

  if (!isBlank(customer.state)) {
    const normalized = normalizeBrazilUf(customer.state);
    if (normalized === "OUTROS" || normalized === "—") {
      return { ...UNKNOWN_BASE, reason: "INVALID_STATE" };
    }
    uf = normalized;
    // "Curitiba - PR" com UF = PR: descarta só o sufixo redundante.
    const split = splitTrailingUf(cityRaw);
    if (split.uf === uf) cityRaw = split.city;
  } else if (cityRaw) {
    // Sem UF no campo próprio, mas explícita no texto da cidade.
    const split = splitTrailingUf(cityRaw);
    if (!split.uf) return { ...UNKNOWN_BASE, reason: "MISSING_STATE" };
    uf = split.uf;
    cityRaw = split.city;
  } else {
    return { ...UNKNOWN_BASE, reason: "MISSING_STATE_AND_CITY" };
  }

  const state = index.states.get(uf);
  if (!state) return { ...UNKNOWN_BASE, reason: "INVALID_STATE" };

  const stateOnly = (reason: "MISSING_CITY" | "CITY_NOT_RECOGNIZED"): CustomerMapLocation => ({
    precision: "STATE",
    uf: state.uf,
    ibgeCode: null,
    cityName: null,
    lat: state.lat,
    lng: state.lng,
    reason,
  });

  const cityKey = normalizeCityKey(cityRaw);
  if (!cityKey) return stateOnly("MISSING_CITY");

  const municipality = index.municipalities.get(`${state.uf}|${cityKey}`);
  if (!municipality) return stateOnly("CITY_NOT_RECOGNIZED");

  return {
    precision: "CITY",
    uf: state.uf,
    ibgeCode: municipality.ibgeCode,
    cityName: municipality.name,
    lat: municipality.lat,
    lng: municipality.lng,
    reason: null,
  };
}

// ─── Agregação ──────────────────────────────────────────────────────────────

export type CustomerMapFactRow = {
  id: string;
  city: string | null;
  state: string | null;
  country?: string | null;
  status: string;
  createdAt: Date;
  /** Pedidos válidos no período selecionado (0 quando não há). */
  orderCount: number;
};

export type CustomerMapCounts = {
  customers: number;
  activeCustomers: number;
  orders: number;
  newCustomers: number;
};

export type CustomerMapCityAggregate = CustomerMapCounts & {
  ibgeCode: number;
  city: string;
  uf: string;
  lat: number;
  lng: number;
};

export type CustomerMapStateAggregate = CustomerMapCounts & {
  uf: string;
  name: string;
  lat: number;
  lng: number;
  /** Cidades distintas com cliente mapeado nesta UF. */
  cities: number;
  /** Clientes da UF cuja cidade não pôde ser resolvida (precisão STATE). */
  stateOnlyCustomers: number;
};

export type CustomerMapSummary = CustomerMapCounts & {
  /** Posicionados no município (precisão CITY). */
  mappedCustomers: number;
  /** UF conhecida, cidade não resolvida (precisão STATE). */
  stateOnlyCustomers: number;
  /** Sem localização nenhuma (precisão UNKNOWN). */
  unmappedCustomers: number;
  states: number;
  cities: number;
  unresolvedByReason: Array<{ reason: CustomerMapUnresolvedReason; label: string; count: number }>;
};

export type CustomerMapAggregation = {
  summary: CustomerMapSummary;
  states: CustomerMapStateAggregate[];
  cities: CustomerMapCityAggregate[];
};

function emptyCounts(): CustomerMapCounts {
  return { customers: 0, activeCustomers: 0, orders: 0, newCustomers: 0 };
}

function addCustomer(target: CustomerMapCounts, row: CustomerMapFactRow, isNew: boolean): void {
  target.customers += 1;
  if (row.status === "ACTIVE") target.activeCustomers += 1;
  target.orders += row.orderCount;
  if (isNew) target.newCustomers += 1;
}

export function isNewCustomer(createdAt: Date, now: Date): boolean {
  const windowMs = CUSTOMER_MAP_NEW_CUSTOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return createdAt.getTime() >= now.getTime() - windowMs;
}

/**
 * Agrega a carteira por município e por UF. Cada cliente entra UMA vez (a
 * identidade é o `id`); pedidos são métrica separada, somada por cliente.
 */
export function aggregateCustomerMap(
  rows: readonly CustomerMapFactRow[],
  index: BrazilGeoIndex,
  now: Date
): CustomerMapAggregation {
  const total = emptyCounts();
  const cities = new Map<number, CustomerMapCityAggregate>();
  const states = new Map<string, CustomerMapStateAggregate>();
  const citiesByState = new Map<string, Set<number>>();
  const reasons = new Map<CustomerMapUnresolvedReason, number>();
  const seen = new Set<string>();

  let mappedCustomers = 0;
  let stateOnlyCustomers = 0;
  let unmappedCustomers = 0;

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);

    const isNew = isNewCustomer(row.createdAt, now);
    addCustomer(total, row, isNew);

    const location = resolveCustomerMapLocation(row, index);
    if (location.reason) reasons.set(location.reason, (reasons.get(location.reason) ?? 0) + 1);

    if (location.precision === "UNKNOWN") {
      unmappedCustomers += 1;
      continue;
    }

    let state = states.get(location.uf);
    if (!state) {
      const ref = index.states.get(location.uf)!;
      state = {
        ...emptyCounts(),
        uf: ref.uf,
        name: ref.name,
        lat: ref.lat,
        lng: ref.lng,
        cities: 0,
        stateOnlyCustomers: 0,
      };
      states.set(location.uf, state);
    }
    addCustomer(state, row, isNew);

    if (location.precision === "STATE") {
      stateOnlyCustomers += 1;
      state.stateOnlyCustomers += 1;
      continue;
    }

    mappedCustomers += 1;
    let city = cities.get(location.ibgeCode);
    if (!city) {
      city = {
        ...emptyCounts(),
        ibgeCode: location.ibgeCode,
        city: location.cityName,
        uf: location.uf,
        lat: location.lat,
        lng: location.lng,
      };
      cities.set(location.ibgeCode, city);
      const set = citiesByState.get(location.uf) ?? new Set<number>();
      set.add(location.ibgeCode);
      citiesByState.set(location.uf, set);
    }
    addCustomer(city, row, isNew);
  }

  for (const state of states.values()) {
    state.cities = citiesByState.get(state.uf)?.size ?? 0;
  }

  const byCustomersDesc = <T extends CustomerMapCounts & { uf: string }>(a: T, b: T) =>
    b.customers - a.customers || a.uf.localeCompare(b.uf);

  return {
    summary: {
      ...total,
      mappedCustomers,
      stateOnlyCustomers,
      unmappedCustomers,
      states: states.size,
      cities: cities.size,
      unresolvedByReason: [...reasons.entries()]
        .map(([reason, count]) => ({
          reason,
          label: CUSTOMER_MAP_UNRESOLVED_REASON_LABELS[reason],
          count,
        }))
        .sort((a, b) => b.count - a.count),
    },
    states: [...states.values()].sort(byCustomersDesc),
    cities: [...cities.values()].sort(
      (a, b) => byCustomersDesc(a, b) || a.city.localeCompare(b.city)
    ),
  };
}

// ─── Filtros ────────────────────────────────────────────────────────────────

export const CUSTOMER_MAP_ORDER_PERIODS = ["all", "12m", "90d", "30d"] as const;
export type CustomerMapOrderPeriod = (typeof CUSTOMER_MAP_ORDER_PERIODS)[number];

export type CustomerMapFilters = {
  /** null = todos. */
  status: "ACTIVE" | "INACTIVE" | null;
  /** `sellerIdentityKey` do responsável oficial; "__none__" = sem responsável. */
  ownerKey: string | null;
  /**
   * Janela dos PEDIDOS. Não remove cliente do mapa: carteira é estrutural,
   * atividade é que depende do período.
   */
  orderPeriod: CustomerMapOrderPeriod;
};

export const CUSTOMER_MAP_NO_OWNER_KEY = "__none__";

export function parseCustomerMapFilters(query: Record<string, unknown>): CustomerMapFilters {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const status = text(query.status).toUpperCase();
  const period = text(query.orderPeriod);
  const ownerKey = text(query.ownerKey).slice(0, 200);
  return {
    status: status === "ACTIVE" || status === "INACTIVE" ? status : null,
    ownerKey: ownerKey || null,
    orderPeriod: (CUSTOMER_MAP_ORDER_PERIODS as readonly string[]).includes(period)
      ? (period as CustomerMapOrderPeriod)
      : "all",
  };
}

/** Início da janela de pedidos; null = todo o histórico. */
export function resolveOrderPeriodStart(period: CustomerMapOrderPeriod, now: Date): Date | null {
  const days = period === "12m" ? 365 : period === "90d" ? 90 : period === "30d" ? 30 : null;
  return days == null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type CustomerMapBounds = { west: number; south: number; east: number; north: number };

/** "oeste,sul,leste,norte" → bounds; null quando inválido. */
export function parseCustomerMapBounds(raw: unknown): CustomerMapBounds | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return { west, south, east, north };
}

export function isWithinBounds(
  point: { lat: number; lng: number },
  bounds: CustomerMapBounds
): boolean {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}
