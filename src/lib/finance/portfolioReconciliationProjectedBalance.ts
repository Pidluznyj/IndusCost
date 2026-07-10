/**
 * Saldo projetado e forecast agregado da Conciliação de Carteira (camada paralela).
 *
 * Não soma Pedido + NF + CR. Prioridade por pedido:
 * RECEIVABLE > NFE > ORDER > UNRESOLVED (excluído).
 * Linhas técnicas (rollup FULLY_ALLOCATED, surplus, OVER_LINKED) não duplicam forecast.
 */

import { resolveDominantForecastSource } from "./portfolioReconciliationReceivables.js";
import type { PortfolioForecastSource } from "./portfolioReconciliationAllocationEngine.js";

export type ProjectedBalanceFactLike = {
  id: string;
  salesOrderId: string | null;
  orderCode?: string | null;
  salesOrderItemId?: string | null;
  nfeExternalId?: number | null;
  status: string | null;
  forecastSource: string;
  forecastDate?: Date | string | null;
  forecastValue: number | null;
  openReceivableValue: number | null;
  allocatedQuantity: number | null;
  allocatedValueByOrderPrice?: number | null;
  dueDatesJson?: unknown;
};

export type OrderAggregatedForecast = {
  source: PortfolioForecastSource;
  /** Data principal (mais cedo) em YYYY-MM-DD. */
  primaryDate: string | null;
  /** Datas únicas ordenadas (vencimentos / forecast). */
  dates: string[];
  dueCount: number;
  /** Rótulo curto para tabela/topo do drawer (pt-BR). */
  label: string;
};

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function asForecastSource(value: string): PortfolioForecastSource {
  if (value === "RECEIVABLE" || value === "NFE" || value === "ORDER" || value === "UNRESOLVED") {
    return value;
  }
  return "UNRESOLVED";
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  if (Number.isNaN(value.getTime())) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function buildAggregatedForecastLabel(dates: readonly string[]): string {
  if (dates.length === 0) return "—";
  if (dates.length === 1) return formatBrDate(dates[0]!);
  const rest = dates.length - 1;
  return `${formatBrDate(dates[0]!)} + ${rest} vencimento${rest > 1 ? "s" : ""}`;
}

function isItemAllocationLine(fact: ProjectedBalanceFactLike): boolean {
  const status = fact.status ?? "";
  const allocated = toNumber(fact.allocatedQuantity) > 0;
  if (!allocated) return false;
  return (
    status === "ITEM_ALLOCATED" ||
    status === "PRICE_MISMATCH" ||
    status === "RECEIVABLE_CONFIRMED" ||
    status === "RECEIVED" ||
    status === "STOCK_DOCUMENT_ITEMIZED"
  );
}

function isOrderRollupLine(fact: ProjectedBalanceFactLike): boolean {
  const status = fact.status ?? "";
  return status === "FULLY_ALLOCATED" || status === "PARTIALLY_ALLOCATED";
}

function isTechnicalNonForecastLine(fact: ProjectedBalanceFactLike): boolean {
  const status = fact.status ?? "";
  return (
    status === "OVER_LINKED_BY_HEADER" ||
    status === "QUANTITY_SURPLUS_IN_NFE" ||
    status === "DATA_QUALITY_ISSUE" ||
    status === "AMBIGUOUS_ALLOCATION" ||
    status === "HEADER_ONLY_LINK"
  );
}

function collectDueDatesFromFact(fact: ProjectedBalanceFactLike): string[] {
  const dates: string[] = [];
  if (Array.isArray(fact.dueDatesJson)) {
    for (const due of fact.dueDatesJson) {
      const iso = toIsoDate(due as string | Date | null);
      if (iso) dates.push(iso);
    }
  }
  const forecastIso = toIsoDate(fact.forecastDate);
  if (forecastIso) dates.push(forecastIso);
  return dates;
}

/** Facts que entram no saldo/forecast agregado para a fonte dominante. */
export function selectOrderForecastContributingFacts(
  facts: readonly ProjectedBalanceFactLike[],
  dominant: PortfolioForecastSource
): ProjectedBalanceFactLike[] {
  if (dominant === "UNRESOLVED") return [];

  if (dominant === "RECEIVABLE") {
    const itemLines = facts.filter(
      (fact) =>
        asForecastSource(fact.forecastSource) === "RECEIVABLE" &&
        isItemAllocationLine(fact) &&
        (fact.openReceivableValue != null || fact.forecastValue != null)
    );
    if (itemLines.length > 0) return itemLines;

    const seen = new Set<string>();
    const fallback: ProjectedBalanceFactLike[] = [];
    for (const fact of facts) {
      if (asForecastSource(fact.forecastSource) !== "RECEIVABLE") continue;
      if (fact.openReceivableValue == null && fact.forecastValue == null) continue;
      if (isTechnicalNonForecastLine(fact)) continue;
      const key =
        fact.nfeExternalId != null
          ? `nfe:${fact.nfeExternalId}`
          : `order:${fact.salesOrderId ?? fact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fallback.push(fact);
    }
    return fallback;
  }

  if (dominant === "NFE") {
    const itemLines = facts.filter(
      (fact) =>
        asForecastSource(fact.forecastSource) === "NFE" &&
        isItemAllocationLine(fact) &&
        fact.forecastValue != null
    );
    if (itemLines.length > 0) return itemLines;
    return facts.filter(
      (fact) =>
        isOrderRollupLine(fact) &&
        asForecastSource(fact.forecastSource) === "NFE" &&
        fact.forecastValue != null
    );
  }

  const seenItems = new Set<string>();
  const out: ProjectedBalanceFactLike[] = [];
  for (const fact of facts) {
    if (asForecastSource(fact.forecastSource) !== "ORDER") continue;
    if (fact.forecastValue == null) continue;
    const key = fact.salesOrderItemId ?? `fact:${fact.id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    out.push(fact);
  }
  return out;
}

function resolveDominantSourceForOrder(
  facts: readonly ProjectedBalanceFactLike[]
): PortfolioForecastSource {
  const eligibleSources = facts
    .filter((fact) => {
      if (isTechnicalNonForecastLine(fact) && fact.forecastSource !== "RECEIVABLE") {
        return false;
      }
      const source = asForecastSource(fact.forecastSource);
      if (source === "UNRESOLVED") return false;
      if (source === "RECEIVABLE") {
        return fact.openReceivableValue != null || fact.forecastValue != null;
      }
      return fact.forecastValue != null;
    })
    .map((fact) => asForecastSource(fact.forecastSource));

  return resolveDominantForecastSource(eligibleSources);
}

/**
 * Forecast agregado do pedido — mesma prioridade do saldo projetado.
 * Ignora FULLY_ALLOCATED/NFE quando há RECEIVABLE nas linhas do saldo.
 */
export function resolveOrderAggregatedForecast(
  facts: readonly ProjectedBalanceFactLike[]
): OrderAggregatedForecast {
  const source = resolveDominantSourceForOrder(facts);
  if (source === "UNRESOLVED") {
    return {
      source,
      primaryDate: null,
      dates: [],
      dueCount: 0,
      label: "—",
    };
  }

  const contributing = selectOrderForecastContributingFacts(facts, source);
  const dateSet = new Set<string>();
  for (const fact of contributing) {
    for (const iso of collectDueDatesFromFact(fact)) {
      dateSet.add(iso);
    }
  }
  const dates = [...dateSet].sort();
  return {
    source,
    primaryDate: dates[0] ?? null,
    dates,
    dueCount: dates.length,
    label: buildAggregatedForecastLabel(dates),
  };
}

/**
 * Saldo projetado de um único pedido a partir dos seus fatos materializados.
 */
export function computeOrderProjectedOpenBalance(
  facts: readonly ProjectedBalanceFactLike[]
): number {
  if (facts.length === 0) return 0;

  const dominant = resolveDominantSourceForOrder(facts);
  if (dominant === "UNRESOLVED") return 0;

  const contributing = selectOrderForecastContributingFacts(facts, dominant);

  if (dominant === "RECEIVABLE") {
    return round2(
      contributing.reduce(
        (sum, fact) => sum + toNumber(fact.openReceivableValue ?? fact.forecastValue),
        0
      )
    );
  }

  if (dominant === "NFE") {
    if (contributing.some(isItemAllocationLine)) {
      return round2(
        contributing.reduce((sum, fact) => sum + toNumber(fact.forecastValue), 0)
      );
    }
    let best = 0;
    for (const fact of contributing) {
      best = Math.max(best, toNumber(fact.forecastValue));
    }
    return round2(best);
  }

  return round2(
    contributing.reduce((sum, fact) => sum + toNumber(fact.forecastValue), 0)
  );
}

/**
 * Soma o saldo projetado de todos os pedidos (sem misturar fontes entre pedidos).
 */
export function computeProjectedOpenBalance(
  facts: readonly ProjectedBalanceFactLike[]
): number {
  const byOrder = new Map<string, ProjectedBalanceFactLike[]>();
  for (const fact of facts) {
    const key = fact.salesOrderId ?? fact.orderCode ?? fact.id;
    const list = byOrder.get(key) ?? [];
    list.push(fact);
    byOrder.set(key, list);
  }

  let total = 0;
  for (const orderFacts of byOrder.values()) {
    total += computeOrderProjectedOpenBalance(orderFacts);
  }
  return round2(total);
}
