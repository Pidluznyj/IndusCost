#!/usr/bin/env npx tsx
/**
 * Auditoria read-only — divergência entre valor Nomus CR e parcela financeira do pedido.
 *
 * Uso:
 *   npx tsx scripts/audit-nomus-ar-order-financial-divergence.ts
 *   npx tsx scripts/audit-nomus-ar-order-financial-divergence.ts --orderCode=PD02607
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  auditArOrderFinancialDivergence,
  buildSalesOrderFinancialContext,
  parseSalesOrderParcelFromArDescription,
} from "../src/lib/nomusArOrderFinancialResolution.ts";
import { expandNomusOrderCodeLookupVariants } from "../src/lib/salesOrderNomusSync.server.ts";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

async function main() {
  const orderFilter = parseArg("orderCode");
  const arRows = await prisma.nomusAccountsReceivable.findMany({
    where: orderFilter
      ? { description: { contains: orderFilter.replace(/\D/g, "").padStart(5, "0"), mode: "insensitive" } }
      : { description: { contains: "Pedido PD", mode: "insensitive" } },
    select: {
      externalId: true,
      description: true,
      dueDate: true,
      amountReceivable: true,
      sourceInvoiceId: true,
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const orderCodes = new Set<string>();
  for (const row of arRows) {
    const parsed = parseSalesOrderParcelFromArDescription(row.description);
    if (parsed) {
      for (const v of expandNomusOrderCodeLookupVariants(parsed.orderCode)) orderCodes.add(v);
    }
  }

  const orders = await prisma.salesOrder.findMany({
    where: orderCodes.size > 0 ? { orderCode: { in: [...orderCodes] } } : undefined,
    select: { id: true, orderCode: true, nomusRawResponse: true },
    take: 200,
  });

  const contexts = new Map(
    orders.map((o) => [o.orderCode, buildSalesOrderFinancialContext(o.orderCode, o.id, o.nomusRawResponse)])
  );

  const divergences = [];
  for (const row of arRows) {
    const parsed = parseSalesOrderParcelFromArDescription(row.description);
    if (!parsed) continue;
    const context = [...contexts.values()].find((c) => c.orderCode.includes(parsed.orderCode.replace("PD ", ""))) ?? null;
    const amount = Number(row.amountReceivable);
    const audit = auditArOrderFinancialDivergence({
      externalId: row.externalId,
      description: row.description,
      dueDate: row.dueDate,
      amountReceivable: Number.isFinite(amount) ? amount : 0,
      context,
      parsed,
    });
    if (audit) divergences.push(audit);
  }

  console.log(
    JSON.stringify(
      {
        scannedArTitles: arRows.length,
        ordersLoaded: orders.length,
        divergenceCount: divergences.length,
        divergences: divergences.slice(0, 100),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
