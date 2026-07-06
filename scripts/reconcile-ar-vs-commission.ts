#!/usr/bin/env npx tsx
/**
 * Reconciliação AR financeiro x Comissão PAYABLE.
 *
 * Uso:
 *   npx tsx scripts/reconcile-ar-vs-commission.ts --year=2026 --month=6 --json
 *   npx tsx scripts/reconcile-ar-vs-commission.ts --year=2026 --month=6 --csv --details
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { runArVsCommissionReconcile } from "../src/lib/commissions/reconcileArVsCommission.server.ts";
import {
  arCommissionDetailCsvHeader,
  arCommissionDetailToCsvRow,
} from "../src/lib/commissions/reconcileArVsCommission.ts";
import { csvLine, fmtBrl, fmtPct, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const customer = parseArg("customer");
  const asJson = process.argv.includes("--json");
  const asCsv = process.argv.includes("--csv");
  const withDetails = process.argv.includes("--details");

  const { summary, details } = await runArVsCommissionReconcile({
    year,
    month,
    seller,
    customer,
  });

  if (asJson) {
    console.log(JSON.stringify({ summary, details: withDetails ? details : undefined }, null, 2));
    return;
  }

  console.log("=== Reconciliação AR x Comissão PAYABLE ===");
  console.log(`Período: ${month}/${year}\n`);

  console.log("--- A) AR por vencimento ---");
  console.log(`CRs únicos: ${summary.arByDue.uniqueReceivableCount}`);
  console.log(`Total nominal: ${fmtBrl(summary.arByDue.nominalTotal)}`);
  console.log(`Total recebido: ${fmtBrl(summary.arByDue.receivedTotal)}`);
  console.log(`Em aberto: ${fmtBrl(summary.arByDue.openTotal)}`);
  console.log(`Vencidos: ${summary.arByDue.overdueCount}`);

  console.log("\n--- B) AR por baixa (settlementDate) ---");
  console.log(`CRs únicos: ${summary.arBySettlement.uniqueReceivableCount}`);
  console.log(`Total nominal: ${fmtBrl(summary.arBySettlement.nominalTotal)}`);
  console.log(`Total recebido: ${fmtBrl(summary.arBySettlement.receivedTotal)}`);

  console.log("\n--- C) Comissão PAYABLE ---");
  console.log(`CRs únicos: ${summary.commissionPayable.uniqueReceivableCount}`);
  console.log(`Valor CR único: ${fmtBrl(summary.commissionPayable.receivableAmountTotal)}`);
  console.log(`Valor recebido: ${fmtBrl(summary.commissionPayable.receivedAmountTotal)}`);
  console.log(`Base comissionável: ${fmtBrl(summary.commissionPayable.commissionableBaseTotal)}`);
  console.log(`Comissão esperada: ${fmtBrl(summary.commissionPayable.expectedCommissionTotal)}`);
  console.log(`Comissão liberada: ${fmtBrl(summary.commissionPayable.releasedCommissionTotal)}`);
  console.log(`Comissão pendente: ${fmtBrl(summary.commissionPayable.pendingCommissionTotal)}`);
  console.log(`% médio: ${summary.commissionPayable.averageRatePercent.toFixed(4)}%`);
  console.log(`CRs baixados sem schedule: ${summary.commissionPayable.receivablesWithoutSchedule}`);

  console.log("\n--- Ponte AR financeiro x Comissão ---");
  console.log(`AR recebido em ${month}/${year}: ${fmtBrl(summary.bridge.arSettlementReceived)}`);
  console.log(`AR recebido com comissão: ${fmtBrl(summary.bridge.arSettlementWithCommission)}`);
  console.log(`AR recebido sem comissão: ${fmtBrl(summary.bridge.arSettlementWithoutCommission)}`);
  console.log(`Comissão — valor recebido (CR único): ${fmtBrl(summary.bridge.commissionReceivedAmount)}`);
  console.log(`Diferença AR x comissão (recebido): ${fmtBrl(summary.bridge.arVsCommissionReceivedDiff)}`);
  console.log(`Diferença AR x base comissionável: ${fmtBrl(summary.bridge.arVsCommissionBaseDiff)}`);

  console.log("\n--- D) Quebras por categoria ---");
  for (const row of summary.breakdownByCategory) {
    console.log(
      `  ${row.label}: ${row.count} título(s) | ${fmtBrl(row.receivedAmount)} (${fmtPct(row.receivedAmount, summary.bridge.arSettlementReceived)})`
    );
  }

  if (summary.topExclusionReasons.length > 0) {
    console.log("\n--- Top motivos de exclusão/divergência ---");
    for (const row of summary.topExclusionReasons.slice(0, 10)) {
      console.log(`  • ${row.reason}: ${row.count} | ${fmtBrl(row.receivedAmount)}`);
    }
  }

  if (asCsv || withDetails) {
    const lines = [csvLine(arCommissionDetailCsvHeader())];
    for (const line of details) {
      lines.push(csvLine(arCommissionDetailToCsvRow(line)));
    }
    const path = `reconcile-ar-vs-commission-${year}-${String(month).padStart(2, "0")}.csv`;
    writeFileSync(path, lines.join("\n"), "utf8");
    console.log(`\nCSV detalhado: ${path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
