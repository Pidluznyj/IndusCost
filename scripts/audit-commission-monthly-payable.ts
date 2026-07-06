#!/usr/bin/env npx tsx
/**
 * Auditoria mensal oficial — comissão a pagar por recebimento (settlementDate).
 *
 * Uso:
 *   npx tsx scripts/audit-commission-monthly-payable.ts --year=2026 --month=6
 *   npx tsx scripts/audit-commission-monthly-payable.ts --year=2026 --month=6 --json
 *   npx tsx scripts/audit-commission-monthly-payable.ts --year=2026 --month=6 --csv
 *   npx tsx scripts/audit-commission-monthly-payable.ts --year=2026 --month=6 --detail --seller=<uuid>
 */
import "dotenv/config";
import { getCommissionMonthlyPayableSummary } from "../src/lib/commissions/commissionMonthlyPayable.server.ts";
import { buildMonthlyPayableCsv } from "../src/lib/commissions/commissionMonthlyPayable.ts";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";
import { fmtBrl, parseArg, parseCommissionReportSourceMode, formatReportSourceLabel, requireDatabaseUrl, warnCommissionLegacyReportSource } from "./commission-script-utils.ts";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const sourceMode = parseCommissionReportSourceMode(parseArg("source"));
  const asJson = process.argv.includes("--json");
  const asCsv = process.argv.includes("--csv");
  const withDetail = process.argv.includes("--detail");

  const summary = await getCommissionMonthlyPayableSummary(
    { year, month, sellerId: seller },
    GLOBAL_SCOPE,
    sourceMode
  );
  warnCommissionLegacyReportSource({
    sourceMode,
    dataSource: summary.reportSource,
  });

  if (asCsv) {
    console.log(buildMonthlyPayableCsv(summary));
    return;
  }

  if (asJson) {
    const payload = withDetail
      ? summary
      : { ...summary, details: undefined };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Auditoria Mensal — Comissão a Pagar por Recebimento ===");
  console.log(`Período: ${summary.monthLabelPt} (baixa CR: settlementDate)`);
  console.log(
    `Fonte: ${formatReportSourceLabel({
      sourceMode,
      dataSource: summary.reportSource,
      reportStatus: summary.reportStatus,
      closingId: summary.closingId,
      calculationHash: summary.calculationHash,
      deprecationNotice: summary.reportDeprecationNotice,
      warnings: summary.warnings,
    })}`
  );
  console.log("");
  console.log(
    `Comissão a pagar em ${summary.monthLabelPt}: ${fmtBrl(summary.payableCommissionTotal)}`
  );
  console.log(`Valor recebido/baixado (CR únicos): ${fmtBrl(summary.receivedAmountTotal)}`);
  console.log(`Base comissionável rateada: ${fmtBrl(summary.allocatedBaseAmountTotal)}`);
  console.log(
    `Diferença recebido − base rateada: ${fmtBrl(summary.receivedVsBaseDiff)}`
  );
  console.log(`Comissão esperada (parcelas): ${fmtBrl(summary.expectedCommissionAmountTotal)}`);
  console.log(`Comissão pendente nas parcelas: ${fmtBrl(summary.pendingCommissionAmountTotal)}`);
  console.log(`% médio (liberado/base): ${summary.averageCommissionRate.toFixed(4)}%`);
  console.log(
    `Títulos CR: ${summary.uniqueReceivablesCount} | Vendedores: ${summary.uniqueSellersCount}`
  );

  if (summary.sellers.length > 0) {
    console.log("\n--- Total por vendedor ---");
    for (const s of summary.sellers) {
      console.log(
        `${s.sellerName}: ${fmtBrl(s.releasedCommissionAmount)} | ` +
          `${s.receivedTitlesCount} título(s) | recebido ${fmtBrl(s.receivedAmount)} | ` +
          `base ${fmtBrl(s.allocatedBaseAmount)} | ${s.averageCommissionRate.toFixed(4)}%`
      );
    }
  }

  if (withDetail && summary.details.length > 0) {
    console.log("\n--- Detalhe por título/parcela ---");
    for (const d of summary.details) {
      console.log(
        `CR ${d.nomusReceivableId ?? "—"} parc.${d.installmentNumber ?? "—"} | ` +
          `${d.sellerName} | NF ${d.nfeNumber ?? "—"} | baixa ${d.settlementDate?.slice(0, 10) ?? "—"} | ` +
          `recebido ${fmtBrl(d.receivedAmount)} | base ${fmtBrl(d.allocatedBaseAmount)} | ` +
          `liberado ${fmtBrl(d.releasedCommissionAmount)}`
      );
    }
  }

  if (summary.warnings.length > 0) {
    console.log("\n--- Avisos de inconsistência ---");
    for (const w of summary.warnings) {
      console.log(`  • ${w}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
