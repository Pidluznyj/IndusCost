/**
 * Diagnóstico — itens cancelados não devem gerar comissão / NO_MARGIN.
 * Uso: npx tsx tmp-audits/inspect-canceled-items-impact-on-commissions.ts
 */
import "dotenv/config";
import {
  COMMISSION_IGNORED_CANCELED_ITEM,
  COMMISSION_IGNORED_STALE_ITEM,
  isSalesOrderItemActiveForCommission,
  resolveCommissionIgnoreReasonForSalesOrderItem,
} from "../src/lib/sales/nomusSalesOrderItemStatus.js";

async function main() {
  console.log("=== inspect-canceled-items-impact-on-commissions ===\n");

  const cases = [
    { id: "c1", nomusIsCanceled: true, nomusIsStale: false, qty: 10, net: 1000 },
    { id: "s1", nomusIsCanceled: false, nomusIsStale: true, qty: 5, net: 500 },
    { id: "a1", nomusIsCanceled: false, nomusIsStale: false, qty: 8, net: 800 },
  ];

  for (const c of cases) {
    const active = isSalesOrderItemActiveForCommission({
      nomusIsCanceled: c.nomusIsCanceled,
      nomusIsStale: c.nomusIsStale,
      quantity: c.qty,
      totalNetValue: c.net,
    });
    const reason = resolveCommissionIgnoreReasonForSalesOrderItem({
      nomusIsCanceled: c.nomusIsCanceled,
      nomusIsStale: c.nomusIsStale,
      quantity: c.qty,
      totalNetValue: c.net,
    });
    console.log({
      id: c.id,
      activeForCommission: active,
      ignoreReason: reason,
      generatesNoMargin: active ? "possible_if_no_margin_table" : "no",
    });
  }

  console.log("\nConstantes:", {
    COMMISSION_IGNORED_CANCELED_ITEM,
    COMMISSION_IGNORED_STALE_ITEM,
  });
  console.log(
    "Esperado: cancelado/stale → active=false, reason IGNORED_*, sem NO_MARGIN."
  );

  const url = process.env.DATABASE_URL ?? "";
  if (url && !/localhost|127\.0\.0\.1|dummy/i.test(url)) {
    try {
      const { prisma } = await import("../src/lib/prisma.js");
      const canceled = await prisma.salesOrderItem.count({
        where: { OR: [{ nomusIsCanceled: true }, { nomusIsStale: true }] },
      });
      console.log(`\nDB: itens cancelados/stale = ${canceled}`);
      await prisma.$disconnect();
    } catch (e) {
      console.warn("DB skip:", e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
