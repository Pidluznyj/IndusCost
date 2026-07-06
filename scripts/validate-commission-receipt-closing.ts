#!/usr/bin/env npx tsx
/**
 * Validação read-only do motor por recebimento vs legado (junho/2026 e demais períodos).
 * Não aplica fechamento — apenas prévia e comparação.
 *
 * Uso:
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --compare-legacy
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --compare-legacy --recalc-fallback
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --seller=GISLENE --json
 *   npx tsx scripts/validate-commission-receipt-closing.ts --year=2026 --month=6 --seller=GISLENE --compare-legacy --nomus-base=808107.32 --nomus-commission=20926.56 --json --csv --include-lines
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    allowItemRecalculationFallback: hasFlag("recalc-fallback"),
    scope: GLOBAL_SCOPE,
  });

  const outDir = join("tmp", "commission-receipt-closing-validation");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outputPath = join(
    outDir,
    `validate-commission-receipt-closing-${year}-${String(month).padStart(2, "0")}`
  );

  if (asCsv) {
    const csv = buildValidationCsv(compareLines, report);
    const csvPath = `${outputPath}.csv`;
    writeFileSync(csvPath, csv, "utf8");
    console.error(`CSV salvo em: ${csvPath}`);
    if (!asJson) {
      console.log(csv);
      return;
    }
  }

  const jsonPayload = includeLines ? report : { ...report, lines: undefined };

  if (asJson) {
    const jsonPath = `${outputPath}.json`;
    writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");
    console.error(`JSON salvo em: ${jsonPath}`);
    if (!asCsv) {
      console.log(JSON.stringify(jsonPayload, null, 2));
      return;
    }
    console.log(`Arquivos gravados: ${outputPath}.csv e ${outputPath}.json (pasta tmp/, gitignored)`);
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

  if (report.nomusReconciliation) {
    const r = report.nomusReconciliation;
    console.log("\n--- Conciliação Nomus ---");
    console.log(`Base Nomus: ${r.nomusBase != null ? fmtBrl(r.nomusBase) : "—"}`);
    console.log(`Comissão Nomus: ${r.nomusCommission != null ? fmtBrl(r.nomusCommission) : "—"}`);
    console.log(`Base IndusCost (antes exclusões): ${fmtBrl(r.indusCostBaseBeforeExclusions)}`);
    console.log(`Comissão IndusCost (antes exclusões): ${fmtBrl(r.indusCostCommissionBeforeExclusions)}`);
    console.log(
      `Diff antes exclusões — base: ${r.diffBaseBeforeExclusions != null ? fmtBrl(r.diffBaseBeforeExclusions) : "—"} | comissão: ${r.diffCommissionBeforeExclusions != null ? fmtBrl(r.diffCommissionBeforeExclusions) : "—"}`
    );
    console.log(`Clientes excluídos: ${r.excludedCustomers.length}`);
    console.log(`Base excluída: ${fmtBrl(r.excludedBaseTotal)}`);
    console.log(`Comissão excluída: ${fmtBrl(r.excludedCommissionTotal)}`);
    console.log(`Comissão final IndusCost: ${fmtBrl(r.indusCostFinalCommission)}`);
    console.log(
      `Diff final — comissão: ${r.diffCommissionFinal != null ? fmtBrl(r.diffCommissionFinal) : "—"} | base: ${r.diffBaseFinal != null ? fmtBrl(r.diffBaseFinal) : "—"}`
    );
    console.log(`CR divergentes: ${r.divergentReceivableCodes.length}`);
    console.log(`Sem schedule: ${r.receivablesWithoutSchedule.length}`);
    console.log(`Schedule stale: ${r.staleSchedules.length}`);
    console.log(`Recebidos duplicados: ${r.duplicateReceived.length}`);

    if (r.excludedCustomers.length > 0) {
      console.log("\n--- Clientes excluídos ---");
      for (const row of r.excludedCustomers.slice(0, 10)) {
        console.log(
          `  ${row.customerName ?? "—"} | base ${fmtBrl(row.excludedBase)} | comissão bruta ${fmtBrl(row.excludedCommission)} | ${row.exclusionReason ?? ""}`
        );
      }
    }

    if (r.divergentReceivableCodes.length > 0) {
      console.log("\n--- CR divergentes (amostra) ---");
      for (const row of r.divergentReceivableCodes.slice(0, 10)) {
        console.log(
          `  CR ${row.nomusReceivableId} ${row.receivableNumber ?? ""} | ${row.status} | ${fmtBrl(row.receivedAmount)} | ${row.statusReason ?? ""}`
        );
      }
    }
  } else if (report.nomusComparison) {
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
