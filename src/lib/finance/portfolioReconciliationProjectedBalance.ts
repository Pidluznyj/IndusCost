/**
 * Saldo projetado da Conciliação de Carteira (camada paralela).
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
  forecastValue: number | null;
  openReceivableValue: number | null;
  allocatedQuantity: number | null;
  allocatedValueByOrderPrice?: number | null;
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

/**
 * Saldo projetado de um único pedido a partir dos seus fatos materializados.
 */
export function computeOrderProjectedOpenBalance(
  facts: readonly ProjectedBalanceFactLike[]
): number {
  if (facts.length === 0) return 0;

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

  const dominant = resolveDominantForecastSource(eligibleSources);
  if (dominant === "UNRESOLVED") return 0;

  if (dominant === "RECEIVABLE") {
    const itemLines = facts.filter(
      (fact) =>
        asForecastSource(fact.forecastSource) === "RECEIVABLE" &&
        isItemAllocationLine(fact) &&
        fact.openReceivableValue != null
    );
    if (itemLines.length > 0) {
      return round2(itemLines.reduce((sum, fact) => sum + toNumber(fact.openReceivableValue), 0));
    }

    // Fallback: um valor por NF (ou por pedido se sem NF), sem duplicar rollups.
    const seen = new Set<string>();
    let sum = 0;
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
      sum += toNumber(fact.openReceivableValue ?? fact.forecastValue);
    }
    return round2(sum);
  }

  if (dominant === "NFE") {
    const itemLines = facts.filter(
      (fact) =>
        asForecastSource(fact.forecastSource) === "NFE" &&
        isItemAllocationLine(fact) &&
        fact.forecastValue != null
    );
    if (itemLines.length > 0) {
      return round2(itemLines.reduce((sum, fact) => sum + toNumber(fact.forecastValue), 0));
    }

    // Rollup FULLY/PARTIALLY: no máximo uma vez (não somar com itens).
    let best = 0;
    for (const fact of facts) {
      if (!isOrderRollupLine(fact)) continue;
      if (asForecastSource(fact.forecastSource) !== "NFE") continue;
      if (fact.forecastValue == null) continue;
      best = Math.max(best, toNumber(fact.forecastValue));
    }
    return round2(best);
  }

  // ORDER — uma vez por item do pedido
  const seenItems = new Set<string>();
  let sum = 0;
  for (const fact of facts) {
    if (asForecastSource(fact.forecastSource) !== "ORDER") continue;
    if (fact.forecastValue == null) continue;
    const key = fact.salesOrderItemId ?? `fact:${fact.id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    sum += toNumber(fact.forecastValue);
  }
  return round2(sum);
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
