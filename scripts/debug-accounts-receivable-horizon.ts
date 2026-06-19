/**
 * Debug do horizonte operacional de Contas a Receber (carteira aberta).
 *
 * Uso: npm run debug:ar-horizon
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildAccountsReceivableOpenHorizon,
  loadFinanceArOpenHorizonRowsFromPrisma,
} from "../src/lib/financeAccountsReceivableHorizon.js";
import { startOfLocalDay } from "../src/lib/financeHorizonBuckets.js";

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main() {
  const today = startOfLocalDay(new Date());
  console.log(`Hoje: ${today.toISOString().slice(0, 10)}\n`);

  const { rows, syncCutoff } = await loadFinanceArOpenHorizonRowsFromPrisma(prisma, today);
  const horizon = buildAccountsReceivableOpenHorizon(rows, today, syncCutoff);

  console.log(`Vencidos: ${formatMoney(horizon.overdue.amount)} (${horizon.overdue.titlesCount} título(s))`);
  for (const bucket of horizon.buckets) {
    console.log(`${bucket.label}: ${formatMoney(bucket.amount)} (${bucket.titlesCount} título(s))`);
  }
  console.log(`Total 60: ${formatMoney(horizon.total60.amount)} (${horizon.total60.titlesCount} título(s))`);
  console.log(
    `Total aberto considerado: ${formatMoney(horizon.totals.totalOpenAmount)} (${horizon.totals.totalOpenTitlesCount} título(s))`
  );
  console.log(`\nFiltros ignorados: ${horizon.audit.periodFiltersIgnored.join(", ")}`);
  console.log(`Excluídos por baixa integral: ${horizon.audit.excludedBecauseSettled}`);

  const sample = [...horizon.titlesByBucket.total_60]
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, 10);
  console.log("\nAmostra 10 próximos títulos:");
  for (const title of sample) {
    const due = title.dueDate ? title.dueDate.slice(0, 10) : "—";
    console.log(`- ${due} | ${title.customerName ?? "—"} | ${formatMoney(title.amountOpen)}`);
  }

  if (horizon.insights.length) {
    console.log("\nInsights:");
    for (const insight of horizon.insights) {
      console.log(`- ${insight}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
