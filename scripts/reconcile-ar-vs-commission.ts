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
import { csvLine, fmtBrl, fmtPct, parseArg, parseCommissionReportSourceMode, formatReportSourceLabel, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const customer = parseArg("customer");
  const nomusBaseRaw = parseArg("nomus-base");
  const nomusCommissionRaw = parseArg("nomus-commission");
  const sourceMode = parseCommissionReportSourceMode(parseArg("source"));
  const asJson = process.argv.includes("--json");
  const asCsv = process.argv.includes("--csv");
  const withDetails = process.argv.includes("--details");

  const nomusReference =
    nomusBaseRaw || nomusCommissionRaw
      ? {
          base: nomusBaseRaw ? Number(nomusBaseRaw) : null,
          commission: nomusCommissionRaw ? Number(nomusCommissionRaw) : null,
        }
      : undefined;

  const { summary, details } = await runArVsCommissionReconcile({
    year,
    month,
    seller,
    customer,
    nomusReference,
    sourceMode,
  });

  const outputPath = `reconcile-ar-vs-commission-${year}-${String(month).padStart(2, "0")}`;

  if (asJson) {
    const payload = { summary, details: withDetails ? details : undefined };
    writeFileSync(`${outputPath}.json`, JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Reconciliação AR x Comissão PAYABLE ===");
  console.log(`Período: ${month}/${year}`);
  if (summary.reportStatus) {
    console.log(`Fonte comissão: ${summary.reportStatus} (${summary.reportSource ?? "—"})`);
  }
  if (summary.reportWarnings?.length) {
    for (const warning of summary.reportWarnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }
  console.log("");

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
  console.log(`Diferença esperado − liberado: ${fmtBrl(summary.fieldSummary.expectedMinusReleased)}`);
  console.log(`% médio: ${summary.commissionPayable.averageRatePercent.toFixed(4)}%`);
  console.log(`% comissão/base: ${summary.fieldSummary.commissionOverBasePercent.toFixed(4)}%`);
  console.log(`CRs baixados sem schedule: ${summary.commissionPayable.receivablesWithoutSchedule}`);

  if (summary.nomusComparison) {
    console.log("\n--- Comparação Nomus ---");
    if (summary.nomusComparison.nomusBase != null) {
      console.log(`Base Nomus: ${fmtBrl(summary.nomusComparison.nomusBase)} | diff: ${fmtBrl(summary.nomusComparison.baseDiff)}`);
    }
    if (summary.nomusComparison.nomusCommission != null) {
      console.log(
        `Comissão Nomus: ${fmtBrl(summary.nomusComparison.nomusCommission)} | diff: ${fmtBrl(summary.nomusComparison.commissionDiff)}`
      );
    }
  }

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
      `  ${row.label}: ${row.count} título(s) | recebido ${fmtBrl(row.receivedAmount)} | esperado ${fmtBrl(row.expectedCommission)} | liberado ${fmtBrl(row.releasedCommission)}`
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
    const path = `${outputPath}.csv`;
    writeFileSync(path, lines.join("\n"), "utf8");
    console.log(`\nCSV detalhado: ${path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
