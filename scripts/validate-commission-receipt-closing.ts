#!/usr/bin/env npx tsx
/**
 * Validação read-only do motor por recebimento vs legado (junho/2026 e demais períodos).
 * Não aplica fechamento — apenas prévia e comparação.
 *
 * Uso:
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --compare-legacy
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --compare-legacy --nomus-base=808107.32 --nomus-commission=20926.56
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --seller=GISLENE --json
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --csv --include-lines
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";
import { buildValidationCsv } from "../src/lib/commissions/commissionReceiptClosingValidation.ts";
import { loadCommissionReceiptClosingValidation } from "../src/lib/commissions/commissionReceiptClosingValidation.server.ts";
import { fmtBrl, hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

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
  const customer = parseArg("customer");
  const nomusBaseRaw = parseArg("nomus-base");
  const nomusCommissionRaw = parseArg("nomus-commission");
  const compareLegacy = hasFlag("compare-legacy");
  const includeLines = hasFlag("include-lines");
  const asJson = hasFlag("json");
  const asCsv = hasFlag("csv");

  const nomusBase = nomusBaseRaw ? Number(nomusBaseRaw) : null;
  const nomusCommission = nomusCommissionRaw ? Number(nomusCommissionRaw) : null;

  const { report, compareLines } = await loadCommissionReceiptClosingValidation({
    year,
    month,
    seller,
    customer,
    compareLegacy,
    includeLines,
    nomusBase,
    nomusCommission,
    scope: GLOBAL_SCOPE,
  });

  const outputPath = `validate-commission-receipt-closing-${year}-${String(month).padStart(2, "0")}`;

  if (asCsv) {
    const csv = buildValidationCsv(compareLines, report);
    writeFileSync(`${outputPath}.csv`, csv, "utf8");
    console.log(csv);
    return;
  }

  const jsonPayload = includeLines ? report : { ...report, lines: undefined };

  if (asJson) {
    writeFileSync(`${outputPath}.json`, JSON.stringify(jsonPayload, null, 2), "utf8");
    console.log(JSON.stringify(jsonPayload, null, 2));
    return;
  }

  console.log("=== Validação — Motor por Recebimento (read-only) ===");
  console.log(`Período: ${month}/${year}`);
  console.log("Modo: PRÉVIA — nenhum dado gravado no banco.");
  if (seller) console.log(`Filtro vendedor: ${seller}`);
  if (customer) console.log(`Filtro cliente: ${customer}`);
  console.log(`Hash: ${report.calculationHash}`);
  if (report.closedLedgerExists) {
    console.log(
      `⚠ Ledger fechado existente (${report.closedLedgerExists.closingId}) — diff vs prévia live: ${fmtBrl(report.closedLedgerExists.diffVsLivePreview)}`
    );
  }
  console.log();

  const n = report.summaryNewReceiptEngine;
  console.log("--- Novo motor (prévia live) ---");
  console.log(`Recebido: ${fmtBrl(n.receivedAmountTotal)}`);
  console.log(`Base comissionável: ${fmtBrl(n.allocatedBaseAmountTotal)}`);
  console.log(`Comissão esperada: ${fmtBrl(n.expectedCommissionAmountTotal)}`);
  console.log(`Comissão liberada: ${fmtBrl(n.payableCommissionTotal)}`);
  console.log(`Pendente: ${fmtBrl(n.pendingCommissionAmountTotal)}`);
  console.log(`Títulos: ${n.uniqueReceivablesCount} | Linhas: ${n.lineCount}`);

  if (report.summaryLegacy && report.diffNewVsLegacy) {
    const l = report.summaryLegacy;
    const d = report.diffNewVsLegacy;
    console.log("\n--- Legado (visual audit) ---");
    console.log(`Recebido: ${fmtBrl(l.receivedAmountTotal)}`);
    console.log(`Base: ${fmtBrl(l.allocatedBaseAmountTotal)}`);
    console.log(`Comissão liberada: ${fmtBrl(l.payableCommissionTotal)}`);
    console.log("\n--- Diff novo − legado ---");
    console.log(`Recebido: ${fmtBrl(d.receivedAmountDiff)}`);
    console.log(`Base: ${fmtBrl(d.baseDiff)}`);
    console.log(`Comissão liberada: ${fmtBrl(d.releasedCommissionDiff)}`);
    console.log(`Esperada: ${fmtBrl(d.expectedCommissionDiff)}`);
  } else if (!compareLegacy) {
    console.log("\n(dica: use --compare-legacy para diff vs motor antigo)");
  }

  if (report.nomusComparison) {
    const nc = report.nomusComparison;
    console.log("\n--- Nomus ---");
    if (nc.nomusBase != null) {
      console.log(`Base Nomus: ${fmtBrl(nc.nomusBase)} | diff novo: ${fmtBrl(nc.newBaseDiff)}`);
    }
    if (nc.nomusCommission != null) {
      console.log(
        `Comissão Nomus: ${fmtBrl(nc.nomusCommission)} | diff novo: ${fmtBrl(nc.newCommissionDiff)} | diff legado: ${fmtBrl(nc.legacyCommissionDiff)}`
      );
    }
  }

  console.log("\n--- Por status ---");
  for (const row of report.breakdownByStatus) {
    console.log(
      `  ${row.status}: ${row.count} | recebido ${fmtBrl(row.receivedAmount)} | comissão ${fmtBrl(row.commissionAmount)}`
    );
  }

  if (report.topExceptions.length > 0) {
    console.log("\n--- Top exceções ---");
    for (const row of report.topExceptions.slice(0, 10)) {
      console.log(
        `  ${row.status} | CR ${row.receivableNumber ?? "—"} | ${row.customerName ?? "—"} | ${fmtBrl(row.receivedAmount)} | ${row.exceptionReason ?? ""}`
      );
    }
  }

  if (report.topDifferences.length > 0) {
    console.log("\n--- Top diferenças novo x legado ---");
    for (const row of report.topDifferences.slice(0, 10)) {
      console.log(
        `  CR ${row.receivableNumber ?? "—"} | ${row.canonicalSellerName ?? "—"} | novo ${fmtBrl(row.newCommissionAmount)} | legado ${fmtBrl(row.legacyCommissionAmount)} | diff ${fmtBrl(row.differenceAmount)}`
      );
    }
  }

  console.log(`\nExceções totais: ${report.topExceptions.length} destacadas`);
  console.log(`Linhas comparadas: ${compareLines.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
