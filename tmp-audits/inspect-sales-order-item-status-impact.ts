/**
 * Diagnóstico transversal — impacto de itens cancelados (status 6) no fluxo PV.
 *
 * Uso: npx tsx tmp-audits/inspect-sales-order-item-status-impact.ts
 */
import "dotenv/config";
import {
  isNomusSalesOrderItemCanceled,
  isSalesOrderItemActiveForCommission,
  isSalesOrderItemActiveForReceivableForecast,
  normalizeNomusSalesOrderItemStatus,
  parseNomusSalesOrderItemStatus,
} from "../src/lib/sales/nomusSalesOrderItemStatus.js";
import { extractNomusRawItems } from "../src/lib/salesOrderNomusRaw.js";
import {
  buildOrderToCashAuditRows,
  type OrderToCashAuditOrderInput,
  type OrderToCashAuditOrderItemInput,
} from "../src/lib/sales/orderToCashAuditBuilder.js";

type Hit = {
  orderCode: string;
  canceledCount: number;
  activeCount: number;
  canceledValue: number;
  activeValue: number;
  wouldBePendingBefore: number;
  pendingAfterBuilder: number;
  canceledLines: number;
  plannedReceivable: number | null;
};

function money(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function analyzeOrder(order: {
  id: string;
  orderCode: string;
  totalNetValue: number;
  nomusRawResponse: unknown;
  items: Array<{
    id: string;
    externalProductId: number | null;
    quantity: number;
    unitPrice: number;
    totalNetValue: number;
    nomusIsCanceled?: boolean;
    nomusIsStale?: boolean;
  }>;
}): Hit {
  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  let canceledCount = 0;
  let activeCount = 0;
  let canceledValue = 0;
  let activeValue = 0;
  let wouldBePendingBefore = 0;

  const mapped: OrderToCashAuditOrderItemInput[] = order.items.map((item, idx) => {
    const raw = rawItems[idx] ?? null;
    const parsed = parseNomusSalesOrderItemStatus(raw?.raw ?? raw);
    const canceled =
      item.nomusIsCanceled === true ||
      item.nomusIsStale === true ||
      parsed.isCanceled ||
      isNomusSalesOrderItemCanceled(parsed.statusRaw);
    const value = item.totalNetValue;
    if (canceled) {
      canceledCount += 1;
      canceledValue += value;
      wouldBePendingBefore += 1;
    } else {
      activeCount += 1;
      activeValue += value;
    }
    return {
      id: item.id,
      salesOrderId: order.id,
      externalProductId: item.externalProductId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalNetValue: value,
      itemStatus: canceled ? "CANCELADO" : null,
      nomusIsCanceled: canceled,
      nomusIsStale: item.nomusIsStale === true,
      nomusItemStatusNormalized: normalizeNomusSalesOrderItemStatus(parsed.statusRaw),
    };
  });

  const orderInput: OrderToCashAuditOrderInput = {
    id: order.id,
    orderCode: order.orderCode,
    totalNetValue: order.totalNetValue,
    status: "SENT_TO_NOMUS",
    issueDate: new Date("2026-01-10"),
    nomusRawResponse: order.nomusRawResponse,
  };
  const built = buildOrderToCashAuditRows({
    orders: [orderInput],
    orderItems: mapped,
    options: { today: new Date("2026-07-11") },
  });
  const pendingAfter = built.rows.filter((r) => r.lineType === "ORDER_ITEM_PENDING").length;
  const canceledLines = built.rows.filter((r) => r.lineType === "ORDER_ITEM_CANCELED").length;
  const planned =
    built.rows.find((r) => r.lineType === "ORDER_ITEM_PENDING")?.plannedReceivableValue ??
    built.rows[0]?.plannedReceivableValue ??
    null;

  return {
    orderCode: order.orderCode,
    canceledCount,
    activeCount,
    canceledValue,
    activeValue,
    wouldBePendingBefore,
    pendingAfterBuilder: pendingAfter,
    canceledLines,
    plannedReceivable: planned,
  };
}

const fixturePd02207 = {
  id: "fixture-02207",
  orderCode: "PD 02207",
  totalNetValue: 197_030,
  nomusRawResponse: {
    itensPedido: [
      { idProduto: 538, quantidade: 8, valorUnitario: 4.92, status: 4 },
      { idProduto: 453, quantidade: 6.5, valorUnitario: 4.93, status: 4 },
      { idProduto: 537, quantidade: 16.5, valorUnitario: 4.93, status: 6 },
      { idProduto: 452, quantidade: 9, valorUnitario: 4.92, status: 6 },
    ],
  },
  items: [
    { id: "a", externalProductId: 538, quantity: 8000, unitPrice: 4.92, totalNetValue: 39360 },
    { id: "b", externalProductId: 453, quantity: 6500, unitPrice: 4.93, totalNetValue: 32045 },
    { id: "c", externalProductId: 537, quantity: 16500, unitPrice: 4.93, totalNetValue: 81345, nomusIsCanceled: true },
    { id: "d", externalProductId: 452, quantity: 9000, unitPrice: 4.92, totalNetValue: 44280, nomusIsCanceled: true },
  ],
};

async function main() {
  console.log("=== inspect-sales-order-item-status-impact ===\n");

  let hits: Hit[] = [];
  const url = process.env.DATABASE_URL ?? "";
  if (url && !/localhost|127\.0\.0\.1|dummy/i.test(url)) {
    try {
      const { prisma } = await import("../src/lib/prisma.js");
      const orders = await prisma.salesOrder.findMany({
        where: {
          OR: [
            { items: { some: { nomusIsCanceled: true } } },
            { nomusRawResponse: { not: null } },
          ],
        },
        take: 200,
        select: {
          id: true,
          orderCode: true,
          totalNetValue: true,
          nomusRawResponse: true,
          items: {
            select: {
              id: true,
              externalProductId: true,
              quantity: true,
              negotiatedPrice: true,
              totalNetValue: true,
              nomusIsCanceled: true,
              nomusIsStale: true,
            },
          },
        },
      });
      for (const o of orders) {
        const raw = o.nomusRawResponse;
        const hasStatus6 =
          JSON.stringify(raw ?? {}).includes('"status":6') ||
          o.items.some((i) => i.nomusIsCanceled);
        if (!hasStatus6) continue;
        hits.push(
          analyzeOrder({
            id: o.id,
            orderCode: o.orderCode,
            totalNetValue: Number(o.totalNetValue),
            nomusRawResponse: o.nomusRawResponse,
            items: o.items.map((i) => ({
              id: i.id,
              externalProductId: i.externalProductId,
              quantity: Number(i.quantity),
              unitPrice: Number(i.negotiatedPrice),
              totalNetValue: Number(i.totalNetValue),
              nomusIsCanceled: i.nomusIsCanceled,
              nomusIsStale: i.nomusIsStale,
            })),
          })
        );
      }
      await prisma.$disconnect();
    } catch (e) {
      console.warn("DB indisponível — usando fixture PD 02207.", e);
    }
  }

  if (hits.length === 0) {
    hits = [analyzeOrder(fixturePd02207)];
    console.log("(fixture) PD 02207\n");
  }

  let canceledValueSum = 0;
  let wronglyPendingBefore = 0;
  for (const h of hits) {
    canceledValueSum += h.canceledValue;
    wronglyPendingBefore += h.wouldBePendingBefore;
    console.log(
      `${h.orderCode}: cancel=${h.canceledCount} ativo=${h.activeCount} ` +
        `cancelR$=${money(h.canceledValue)} ativoR$=${money(h.activeValue)} ` +
        `pendingAntes≈${h.wouldBePendingBefore} pendingDepois=${h.pendingAfterBuilder} ` +
        `canceledLines=${h.canceledLines} planned=${h.plannedReceivable ?? "null"}`
    );
  }

  const sample = hits[0]!;
  console.log("\nGates:");
  console.log(
    "  forecast ativo cancelado?",
    isSalesOrderItemActiveForReceivableForecast({ nomusIsCanceled: true })
  );
  console.log(
    "  comissão ativo cancelado?",
    isSalesOrderItemActiveForCommission({ nomusIsCanceled: true })
  );
  console.log("\nResumo:");
  console.log("  pedidos com status 6 / cancel flag:", hits.length);
  console.log("  valor cancelado amostrado:", money(canceledValueSum));
  console.log("  itens que antes virariam PENDING:", wronglyPendingBefore);
  console.log(
    "  PD 02207 esperado: canceledLines=2 pendingActive=0 planned≈71405"
  );
  console.log(
    `  sample ${sample.orderCode}: canceledLines=${sample.canceledLines} pending=${sample.pendingAfterBuilder}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
