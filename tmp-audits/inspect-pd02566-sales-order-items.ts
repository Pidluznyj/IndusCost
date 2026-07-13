/**
 * Diagnóstico PD 02566 — itens stale/zerados não devem contar como ativos.
 * Uso: npx tsx tmp-audits/inspect-pd02566-sales-order-items.ts
 */
import "dotenv/config";
import {
  isSalesOrderItemActiveForCommercialValue,
  parseNomusSalesOrderItemStatus,
} from "../src/lib/sales/nomusSalesOrderItemStatus.js";

const ORDER_CODE = "PD 02566";

async function main() {
  console.log(`=== inspect ${ORDER_CODE} ===\n`);
  const url = process.env.DATABASE_URL ?? "";
  if (!url || /localhost|127\.0\.0\.1|dummy/i.test(url)) {
    console.log("Sem DATABASE_URL real — fixture stale/zerado.");
    const rows = [
      { sku: "A", nomusIsCanceled: false, nomusIsStale: true, qty: 10, net: 100 },
      { sku: "B", nomusIsCanceled: false, nomusIsStale: false, qty: 0, net: 0 },
      { sku: "C", nomusIsCanceled: false, nomusIsStale: false, qty: 5, net: 50 },
    ];
    for (const r of rows) {
      const active = isSalesOrderItemActiveForCommercialValue({
        nomusIsCanceled: r.nomusIsCanceled,
        nomusIsStale: r.nomusIsStale,
        quantity: r.qty,
        totalNetValue: r.net,
      });
      console.log(`  ${r.sku}: active=${active} stale=${r.nomusIsStale} qty=${r.qty}`);
    }
    console.log("\nEsperado: A e B inativos; C ativo.");
    return;
  }

  const { prisma } = await import("../src/lib/prisma.js");
  const order = await prisma.salesOrder.findFirst({
    where: { orderCode: ORDER_CODE },
    include: { items: true },
  });
  if (!order) {
    console.log(`Pedido ${ORDER_CODE} não encontrado.`);
    await prisma.$disconnect();
    return;
  }
  for (const item of order.items) {
    const parsed = parseNomusSalesOrderItemStatus(item.nomusRawItem);
    const active = isSalesOrderItemActiveForCommercialValue({
      nomusIsCanceled: item.nomusIsCanceled,
      nomusIsStale: item.nomusIsStale,
      nomusItemStatusNormalized: item.nomusItemStatusNormalized,
      quantity: Number(item.quantity),
      totalNetValue: Number(item.totalNetValue),
    });
    console.log({
      sku: item.skuSnapshot,
      raw: item.nomusItemStatusRaw,
      normalized: item.nomusItemStatusNormalized ?? parsed.statusNormalized,
      canceled: item.nomusIsCanceled,
      stale: item.nomusIsStale,
      active,
      net: Number(item.totalNetValue),
    });
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
