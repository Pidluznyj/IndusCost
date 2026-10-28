import { Prisma } from "@prisma/client";

/**
 * Ciclo de vida comercial do Pedido de Venda Nomus a partir dos ITENS (o Nomus não envia status de cabeçalho
 * comprovado — ver docs/sales/sales-order-nomus-status-lifecycle.md; `SalesOrder.status` é o fluxo de envio do
 * IndusCost e não muda com o cancelamento no Nomus).
 *
 * Distingue, por pedido:
 *   - contratado: soma dos itens como vieram no pedido;
 *   - cancelado: itens com status 6 (ou quantidade cancelada ≥ pedida);
 *   - cortado: parte não atendida de item "atendido com corte" (status 5), proporcional à quantidade;
 *   - removido: item que saiu do payload do Nomus (stale; o sync já zera quantidade e valor);
 *   - elegível: o que ainda pode ser faturado.
 *
 * Previsão de faturamento (pedidos ainda não faturados):
 *   - pedido sem nenhum item cancelado/cortado/removido → valor do cabeçalho, como sempre (indicador inalterado);
 *   - todos os itens cancelados/removidos → fora da previsão;
 *   - parte cancelada/cortada/removida → soma do valor elegível dos itens. Não subtrai do cabeçalho: soma os itens
 *     ativos, então não há dupla subtração se o Nomus já tiver reduzido `valorTotal`.
 * Faturamento realizado (NF-e) nunca é recalculado por cancelamento posterior.
 */

export type SalesOrderNomusCancellationState =
  | "NO_ITEMS"
  | "OPEN"
  | "PARTIALLY_CANCELED"
  | "FULLY_CANCELED"
  | "ALL_ITEMS_REMOVED";

export type SalesOrderNomusLifecycleItem = {
  quantity: number;
  totalNetValue: number;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusQuantityFulfilled?: number | null;
};

export type SalesOrderNomusItemValue = {
  contracted: number;
  canceled: number;
  cut: number;
  removed: number;
  eligible: number;
};

export type SalesOrderNomusLifecycleSummary = SalesOrderNomusItemValue & {
  state: SalesOrderNomusCancellationState;
  itemCount: number;
  activeItemCount: number;
  canceledItemCount: number;
  cutItemCount: number;
  removedItemCount: number;
  /** null = pedido fora da previsão de faturamento. */
  forecastValue: number | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Fração atendida de um item cortado; sem quantidades confiáveis, nada é elegível (mesma regra do fluxo). */
function fulfilledShare(quantity: number, fulfilled: number | null | undefined): number {
  if (!(quantity > 0) || fulfilled == null || !(fulfilled > 0)) return 0;
  return Math.min(1, fulfilled / quantity);
}

export function classifySalesOrderNomusItemValue(item: SalesOrderNomusLifecycleItem): SalesOrderNomusItemValue {
  const value = Number.isFinite(item.totalNetValue) ? item.totalNetValue : 0;
  const zero = { contracted: value, canceled: 0, cut: 0, removed: 0, eligible: 0 };
  if (item.nomusIsStale === true) return { ...zero, removed: value };
  if (item.nomusIsCanceled === true) return { ...zero, canceled: value };
  if (item.nomusIsCut === true) {
    const eligible = round2(value * fulfilledShare(item.quantity, item.nomusQuantityFulfilled));
    return { ...zero, eligible, cut: round2(value - eligible) };
  }
  return { ...zero, eligible: value };
}

export function summarizeSalesOrderNomusLifecycle(
  headerTotalNetValue: number,
  items: SalesOrderNomusLifecycleItem[]
): SalesOrderNomusLifecycleSummary {
  const totals: SalesOrderNomusItemValue = { contracted: 0, canceled: 0, cut: 0, removed: 0, eligible: 0 };
  let activeItemCount = 0;
  let canceledItemCount = 0;
  let cutItemCount = 0;
  let removedItemCount = 0;
  for (const item of items) {
    const v = classifySalesOrderNomusItemValue(item);
    totals.contracted += v.contracted;
    totals.canceled += v.canceled;
    totals.cut += v.cut;
    totals.removed += v.removed;
    totals.eligible += v.eligible;
    if (item.nomusIsStale === true) removedItemCount += 1;
    else if (item.nomusIsCanceled === true) canceledItemCount += 1;
    else {
      activeItemCount += 1;
      if (item.nomusIsCut === true) cutItemCount += 1;
    }
  }
  const state: SalesOrderNomusCancellationState =
    items.length === 0
      ? "NO_ITEMS"
      : activeItemCount === 0
        ? canceledItemCount > 0
          ? "FULLY_CANCELED"
          : "ALL_ITEMS_REMOVED"
        : canceledItemCount + removedItemCount > 0
          ? "PARTIALLY_CANCELED"
          : "OPEN";
  const adjusted = canceledItemCount + removedItemCount + cutItemCount > 0;
  const forecastValue =
    state === "FULLY_CANCELED" || state === "ALL_ITEMS_REMOVED"
      ? null
      : !adjusted
        ? headerTotalNetValue
        : round2(totals.eligible);
  return {
    state,
    itemCount: items.length,
    activeItemCount,
    canceledItemCount,
    cutItemCount,
    removedItemCount,
    contracted: round2(totals.contracted),
    canceled: round2(totals.canceled),
    cut: round2(totals.cut),
    removed: round2(totals.removed),
    eligible: round2(totals.eligible),
    forecastValue,
  };
}

/** SQL: o pedido ainda tem valor a faturar pelos itens (ou não tem itens — pedido local/legado). */
export function salesOrderHasNomusEligibleItemsSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(
    NOT EXISTS (SELECT 1 FROM "SalesOrderItem" lci WHERE lci."salesOrderId" = ${a}.id)
    OR EXISTS (
      SELECT 1 FROM "SalesOrderItem" lci
      WHERE lci."salesOrderId" = ${a}.id AND NOT lci."nomusIsCanceled" AND NOT lci."nomusIsStale"
    )
  )`;
}

/** SQL: valor da previsão de faturamento (mesma regra de `summarizeSalesOrderNomusLifecycle`). */
export function salesOrderNomusForecastValueSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "SalesOrderItem" lci
        WHERE lci."salesOrderId" = ${a}.id AND (lci."nomusIsCanceled" OR lci."nomusIsStale" OR lci."nomusIsCut")
      )
      THEN COALESCE((
        SELECT SUM(
          CASE
            WHEN lci."nomusIsCut" THEN ROUND(
              lci."totalNetValue" * CASE
                WHEN lci.quantity > 0 AND COALESCE(lci."nomusQuantityFulfilled", 0) > 0
                THEN LEAST(1, lci."nomusQuantityFulfilled" / lci.quantity)
                ELSE 0
              END, 2)
            ELSE lci."totalNetValue"
          END
        )
        FROM "SalesOrderItem" lci
        WHERE lci."salesOrderId" = ${a}.id AND NOT lci."nomusIsCanceled" AND NOT lci."nomusIsStale"
      ), 0)
      ELSE ${a}."totalNetValue"
    END
  )`;
}
