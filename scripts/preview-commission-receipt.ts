#!/usr/bin/env npx tsx
/**
 * Prévia de comissão por recebimento (settlementDate).
 *
 * Uso:
 *   npx tsx scripts/preview-commission-receipt.ts --year=2026 --month=6
 *   npx tsx scripts/preview-commission-receipt.ts --year=2026 --month=6 --seller=GISLENE --json
 *   npx tsx scripts/preview-commission-receipt.ts --year=2026 --month=6 --csv
 *   npx tsx scripts/preview-commission-receipt.ts --year=2026 --month=6 --recalc-fallback
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadCommissionReceiptPreview } from "../src/lib/commissions/commissionReceiptEngine.server.ts";
import {
  receiptPreviewCsvHeader,
  receiptPreviewLineToCsvRow,
} from "../src/lib/commissions/commissionReceiptEngine.ts";
import { csvLine, fmtBrl, hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const customer = parseArg("customer");
  const asJson = process.argv.includes("--json");
  const asCsv = process.argv.includes("--csv");

  const result = await loadCommissionReceiptPreview({
    year,
    month,
    seller,
    customer,
    includeExcluded: true,
    includeExceptions: true,
    allowItemRecalculationFallback: hasFlag("recalc-fallback"),
  });

  const outputPath = `preview-commission-receipt-${year}-${String(month).padStart(2, "0")}`;

  if (asJson) {
    writeFileSync(`${outputPath}.json`, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (asCsv) {
    const rows = [receiptPreviewCsvHeader(), ...result.lines.map(receiptPreviewLineToCsvRow)];
    const content = rows.map((row) => csvLine(row)).join("\n");
    writeFileSync(`${outputPath}.csv`, content, "utf8");
    console.log(content);
    return;
  }

  console.log("=== Prévia de comissão por recebimento ===");
  console.log(`Período: ${month}/${year}`);
  if (seller) console.log(`Vendedor: ${seller}`);
  if (customer) console.log(`Cliente: ${customer}`);
  console.log();

  console.log(`Títulos baixados: ${result.totalReceivables}`);
  console.log(`Total recebido: ${fmtBrl(result.totalReceivedAmount)}`);
  console.log(`Base comissionável: ${fmtBrl(result.totalCommissionableBase)}`);
  console.log(`Comissão esperada: ${fmtBrl(result.totalExpectedCommission)}`);
  console.log(`Comissão liberada: ${fmtBrl(result.totalReleasedCommission)}`);
  console.log(`Excluídos (base): ${fmtBrl(result.totalExcludedAmount)}`);
  console.log(`Exceções (recebido): ${fmtBrl(result.totalExceptionAmount)}`);
  console.log();

  console.log("--- Por status ---");
  for (const [status, count] of Object.entries(result.countByStatus)) {
    if (count > 0) console.log(`  ${status}: ${count}`);
  }

  console.log("\n--- Por vendedor ---");
  for (const row of result.bySeller) {
    console.log(
      `  ${row.sellerName ?? "—"}: recebido ${fmtBrl(row.receivedAmount)} | comissão ${fmtBrl(row.releasedCommission)}`
    );
  }

  console.log(`\nLinhas detalhadas: ${result.lines.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
