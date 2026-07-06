#!/usr/bin/env npx tsx
/**
 * Reconciliação IndusCost x referência Nomus por recebimento (settlementDate).
 *
 * Uso:
 *   npx tsx scripts/reconcile-commission-nomus-june-2026.ts \
 *     --seller="GISLENE LIMA" --year=2026 --month=6 \
 *     --nomus-base=808107.32 --nomus-commission=20926.56
 *
 *   npx tsx scripts/reconcile-commission-nomus-june-2026.ts ... --json
 *   npx tsx scripts/reconcile-commission-nomus-june-2026.ts ... --csv
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { getCommissionMonthlyPayableSummary } from "../src/lib/commissions/commissionMonthlyPayable.server.ts";
import {
  buildNomusReconciliationCsv,
  buildNomusReconciliationFromPayableSummary,
  formatNomusReconciliationExecutiveSummary,
  parseNomusReconciliationCliArgs,
} from "../src/lib/commissions/commissionNomusReconciliation.ts";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";
import { fmtBrl, requireDatabaseUrl, warnCommissionLegacyMode } from "./commission-script-utils.ts";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

async function resolveSellerIdByName(sellerName: string): Promise<string | null> {
  const needle = sellerName.trim().toUpperCase();
  const persons = await prisma.commissionPerson.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  const matches = persons.filter((p) => p.name.toUpperCase().includes(needle));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    console.warn(
      `Múltiplos vendedores encontrados para "${sellerName}": ${matches.map((m) => m.name).join(", ")}. Filtrando por nome na agregação.`
    );
  }
  return null;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("reconcile-commission-nomus-june-2026");

  let sellerId: string | null = null;
  if (args.sellerName) {
    sellerId = await resolveSellerIdByName(args.sellerName);
  }

  const summary = await getCommissionMonthlyPayableSummary(
    { year: args.year, month: args.month, sellerId },
    GLOBAL_SCOPE
  );

  const result = buildNomusReconciliationFromPayableSummary(summary, {
    sellerName: args.sellerName,
    nomusBase: args.nomusBase,
    nomusCommission: args.nomusCommission,
  });

  const sellerLabel =
    result.matchedSellerNames.join(", ") || args.sellerName || "todos os vendedores";

  if (args.asCsv) {
    console.log(buildNomusReconciliationCsv(result));
    return;
  }

  if (args.asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("=== Reconciliação IndusCost x Nomus ===");
  console.log(`Período: ${result.periodRangeLabel} (baixa CR: settlementDate)`);
  console.log(`Vendedor: ${sellerLabel}`);
  console.log("");
  console.log(
    `Comissão a pagar em ${result.monthLabelPt} para ${sellerLabel}: ${fmtBrl(result.indusCommission)}`
  );
  console.log("");
  console.log("--- Totais ---");
  console.log(`Base IndusCost (rateada):     ${fmtBrl(result.indusBase)}`);
  console.log(`Comissão IndusCost (liberada): ${fmtBrl(result.indusCommission)}`);
  console.log(`% médio IndusCost:             ${result.indusAverageRatePercent.toFixed(4)}%`);
  console.log(`Títulos CR no recorte:         ${result.uniqueReceivablesCount}`);
  console.log(`Valor recebido (CR únicos):    ${fmtBrl(result.receivedAmountTotal)}`);

  if (result.nomusBase != null || result.nomusCommission != null) {
    console.log("\n--- Referência Nomus (CLI) ---");
    if (result.nomusBase != null) {
      console.log(`Base Nomus:                    ${fmtBrl(result.nomusBase)}`);
    }
    if (result.nomusCommission != null) {
      console.log(`Comissão Nomus:                ${fmtBrl(result.nomusCommission)}`);
    }
    if (result.nomusAverageRatePercent != null) {
      console.log(`% médio Nomus:                 ${result.nomusAverageRatePercent.toFixed(4)}%`);
    }
    console.log("\n--- Diferenças ---");
    if (result.baseDiff != null) {
      console.log(
        `Diferença base:                ${fmtBrl(result.baseDiff)}` +
          (result.baseDiffPercent != null ? ` (${result.baseDiffPercent.toFixed(2)}%)` : "")
      );
    }
    if (result.commissionDiff != null) {
      console.log(
        `Diferença comissão:            ${fmtBrl(result.commissionDiff)}` +
          (result.commissionDiffPercent != null
            ? ` (${result.commissionDiffPercent.toFixed(2)}%)`
            : "")
      );
    }
  }

  if (result.rateBands.length > 0) {
    console.log("\n--- Percentuais por faixa ---");
    for (const band of result.rateBands) {
      console.log(
        `${band.ratePercent.toFixed(4)}% | ${band.lineCount} linha(s) | base ${fmtBrl(band.allocatedBaseAmount)} | ` +
          `comissão ${fmtBrl(band.releasedCommissionAmount)} | ${band.shareOfBasePercent.toFixed(1)}% da base`
      );
    }
  }

  if (result.topDivergences.length > 0) {
    console.log("\n--- Top divergências (amostra) ---");
    for (const d of result.topDivergences.slice(0, 8)) {
      console.log(
        `[${d.kind}] ${d.label}: base ${fmtBrl(d.allocatedBaseAmount)} | comissão ${fmtBrl(d.releasedCommissionAmount)} | ${d.averageRatePercent.toFixed(4)}%`
      );
    }
  }

  if (result.suspiciousTitles.length > 0) {
    console.log("\n--- Títulos com alerta ---");
    for (const t of result.suspiciousTitles.slice(0, 8)) {
      console.log(
        `CR ${t.nomusReceivableId ?? "—"} | NF ${t.nfeNumber ?? "—"} | baixa ${t.settlementDate?.slice(0, 10) ?? "—"} | ${t.reason}`
      );
    }
  }

  console.log("\n--- Causas prováveis ---");
  for (const cause of result.probableCauses) {
    console.log(`  • ${cause}`);
  }

  const outDir = join("tmp", "commissions-june-2026");
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, "reconciliation-detail.csv");
  writeFileSync(csvPath, buildNomusReconciliationCsv(result), "utf8");
  console.log(`\nCSV detalhado: ${csvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
