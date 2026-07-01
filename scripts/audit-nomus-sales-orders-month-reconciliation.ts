#!/usr/bin/env npx tsx
/**
 * Auditoria mensal read-only: reconciliação de Pedidos de Venda Nomus no banco.
 *
 * Uso:
 *   npx tsx scripts/audit-nomus-sales-orders-month-reconciliation.ts --year=2026 --month=6
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  canonicalNomusOrderCodeKey,
  detectSalesOrderHeaderItemDrift,
  sumSalesOrderItemsNetValue,
} from "../src/lib/salesOrderNomusSync.server.ts";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePdNumber(orderCode: string): number | null {
  const key = canonicalNomusOrderCodeKey(orderCode);
  if (!key?.startsWith("PD:")) return null;
  return Number(key.slice(3));
}

async function main(): Promise<void> {
  const year = Number(parseArg("year") ?? String(new Date().getFullYear()));
  const month = Number(parseArg("month") ?? String(new Date().getMonth() + 1));
  if (!Number.isFinite(year) || month < 1 || month > 12) {
    throw new Error("Informe --year=YYYY e --month=1..12");
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const label = `${year}-${String(month).padStart(2, "0")}`;

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: start, lt: endExclusive },
    },
    include: { items: true },
    orderBy: [{ issueDate: "asc" }, { orderCode: "asc" }],
  });

  let sumNet = 0;
  let sumGross = 0;
  let sumItems = 0;
  const byStatus: Record<string, { count: number; totalNet: number }> = {};
  const byDay: Record<string, { count: number; totalNet: number }> = {};
  const headerItemDrift: Array<{
    orderCode: string;
    headerTotal: number;
    itemsSum: number;
    drift: number;
    updatedAt: string;
  }> = [];
  const staleUpdated: Array<{ orderCode: string; updatedAt: string; ageDays: number }> = [];
  const possibleDrift: Array<{ orderCode: string; reason: string }> = [];

  const now = Date.now();
  const staleThresholdDays = 7;

  for (const order of orders) {
    const headerTotal = money(order.totalNetValue);
    const itemsSum = sumSalesOrderItemsNetValue(order.items);
    sumNet += headerTotal;
    sumGross += money(order.totalGrossValue);
    sumItems += itemsSum;

    byStatus[order.status] = byStatus[order.status] ?? { count: 0, totalNet: 0 };
    byStatus[order.status].count += 1;
    byStatus[order.status].totalNet += headerTotal;

    const dayKey = order.issueDate.toISOString().slice(0, 10);
    byDay[dayKey] = byDay[dayKey] ?? { count: 0, totalNet: 0 };
    byDay[dayKey].count += 1;
    byDay[dayKey].totalNet += headerTotal;

    const drift = detectSalesOrderHeaderItemDrift(order.totalNetValue, order.items);
    if (drift.hasDrift) {
      headerItemDrift.push({
        orderCode: order.orderCode,
        headerTotal: drift.headerTotal,
        itemsSum: drift.itemsSum,
        drift: drift.drift,
        updatedAt: order.updatedAt.toISOString(),
      });
      possibleDrift.push({
        orderCode: order.orderCode,
        reason: `cabeçalho (${drift.headerTotal}) ≠ soma itens (${drift.itemsSum})`,
      });
    }

    const ageDays = (now - order.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > staleThresholdDays) {
      staleUpdated.push({
        orderCode: order.orderCode,
        updatedAt: order.updatedAt.toISOString(),
        ageDays: Math.round(ageDays),
      });
    }

    const raw = order.nomusRawResponse as { valorTotal?: unknown } | null;
    if (raw?.valorTotal != null) {
      const rawTotal = money(raw.valorTotal);
      if (Math.abs(rawTotal - headerTotal) > 0.01) {
        possibleDrift.push({
          orderCode: order.orderCode,
          reason: `nomusRawResponse.valorTotal (${rawTotal}) ≠ cabeçalho (${headerTotal})`,
        });
      }
    }
  }

  const pdNumbers = orders
    .map((o) => parsePdNumber(o.orderCode))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < pdNumbers.length; i += 1) {
    const prev = pdNumbers[i - 1]!;
    const cur = pdNumbers[i]!;
    if (cur - prev > 1) {
      for (let missing = prev + 1; missing < cur; missing += 1) gaps.push(missing);
    }
  }

  const lastOrders = [...orders]
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
    .slice(0, 20)
    .map((o) => ({
      orderCode: o.orderCode,
      issueDate: o.issueDate.toISOString().slice(0, 10),
      totalNetValue: money(o.totalNetValue),
      items: o.items.length,
      updatedAt: o.updatedAt.toISOString(),
    }));

  const recentlyUpdated = [...orders]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 30)
    .map((o) => ({
      orderCode: o.orderCode,
      issueDate: o.issueDate.toISOString().slice(0, 10),
      totalNetValue: money(o.totalNetValue),
      items: o.items.length,
      updatedAt: o.updatedAt.toISOString(),
      sentToNomusAt: o.sentToNomusAt?.toISOString() ?? null,
    }));

  const blockingDrift = possibleDrift.filter((row) =>
    headerItemDrift.some((d) => d.orderCode === row.orderCode)
  );

  console.log(
    JSON.stringify(
      {
        period: label,
        status:
          blockingDrift.length > 0
            ? "ALERTA"
            : possibleDrift.length > 0
              ? "ALERTA"
              : "OK",
        totals: {
          orders: orders.length,
          sumTotalNetValue: sumNet,
          sumTotalGrossValue: sumGross,
          sumItemsNetValue: sumItems,
          headerMinusItems: sumNet - sumItems,
        },
        headerItemDriftCount: headerItemDrift.length,
        headerItemDrift: headerItemDrift.slice(0, 50),
        staleUpdatedCount: staleUpdated.length,
        staleUpdatedSample: staleUpdated.slice(0, 30),
        possibleDriftCount: possibleDrift.length,
        possibleDrift: possibleDrift.slice(0, 50),
        lastOrders,
        recentlyUpdated,
        pdSequenceGapsSample: gaps.slice(0, 30),
        totalsByDay: Object.entries(byDay)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, row]) => ({ day, ...row })),
        totalsByStatus: Object.entries(byStatus).map(([status, row]) => ({ status, ...row })),
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[audit-nomus-sales-orders-month-reconciliation]", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
