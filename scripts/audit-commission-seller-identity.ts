#!/usr/bin/env npx tsx
/**
 * Auditoria de identidade de vendedores / pessoas comissionadas.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-seller-identity.ts --year=2026 --month=6 --json
 *   npx tsx scripts/audit-commission-seller-identity.ts --year=2026 --month=6 --seller="GISLENE" --json --details
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { runCommissionSellerIdentityAudit } from "../src/lib/commissions/commissionSellerIdentityAudit.server.ts";
import {
  sellerIdentityDetailCsvHeader,
  sellerObservationToCsvRow,
} from "../src/lib/commissions/commissionSellerIdentityAudit.ts";
import { csvLine, fmtBrl, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const asJson = process.argv.includes("--json");
  const asCsv = process.argv.includes("--csv");
  const withDetails = process.argv.includes("--details");

  const { summary, details } = await runCommissionSellerIdentityAudit({
    year,
    month,
    seller,
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        { summary, details: withDetails ? details : undefined },
        null,
        2
      )
    );
    return;
  }

  console.log("=== Auditoria de identidade de vendedores ===");
  console.log(`Período: ${month}/${year}${seller ? ` | filtro: ${seller}` : ""}\n`);

  console.log(`Grupos encontrados: ${summary.groups.length}\n`);

  const problemGroups = summary.groups.filter(
    (g) => g.status !== "OK_CANONICAL" && g.status !== "MISSING_EXTERNAL_ID"
  );
  if (problemGroups.length > 0) {
    console.log("--- Vendedores com atenção ---");
    for (const g of problemGroups.slice(0, 20)) {
      console.log(
        `  ${g.canonicalSellerName ?? g.normalizedSellerName} | status=${g.status} | IDs=${g.rawSellerIds.join(",") || "—"} | comissão=${fmtBrl(g.releasedCommission)}`
      );
    }
  }

  for (const g of summary.groups.slice(0, 15)) {
    console.log(`\n--- ${g.canonicalSellerName ?? g.normalizedSellerName} ---`);
    console.log(`Status: ${g.status}`);
    console.log(`Nomes brutos: ${g.rawSellerNames.join(" | ") || "—"}`);
    console.log(`IDs externos: ${g.rawSellerIds.join(", ") || "sem ID"}`);
    console.log(`Cadastro canônico: ${g.canonicalSellerId ?? "—"}`);
    console.log(
      `Pedidos=${g.orderCount} NF=${g.nfeCount} CR=${g.receivableCount} | base=${fmtBrl(g.baseAmount)} | liberada=${fmtBrl(g.releasedCommission)}`
    );
    if (g.warnings.length > 0) {
      console.log(`Avisos: ${g.warnings.join("; ")}`);
    }
  }

  if (summary.gisleneAudit) {
    const g = summary.gisleneAudit;
    console.log("\n========== GISLENE LIMA ==========");
    console.log(`Status: ${g.status}`);
    console.log(`Raw IDs: ${g.rawIds.join(", ") || "sem ID"}`);
    console.log(`Nomes: ${g.rawNames.join(" | ")}`);
    console.log(`Cadastros internos: ${g.internalPersonIds.join(", ") || "—"}`);
    console.log(`Canônico: ${g.canonicalPersonName ?? "—"} / ${g.canonicalPersonId ?? "—"}`);
    console.log(`Comissão gerada (expected): ${fmtBrl(g.commission.generatedExpected)}`);
    console.log(`Comissão prevista (expected): ${fmtBrl(g.commission.forecastExpected)}`);
    console.log(`Comissão a pagar Junho (expected): ${fmtBrl(g.commission.payableExpected)}`);
    console.log(`Comissão a pagar Junho (liberada): ${fmtBrl(g.commission.payableReleased)}`);
    console.log(
      `Pendências: sem vendedor=${g.pending.withoutSeller} | fora canônico=${g.pending.outsideCanonical} | duplicados=${g.pending.duplicatedRecords}`
    );
    if (g.warnings.length > 0) {
      console.log(`Avisos: ${g.warnings.join("; ")}`);
    }
  }

  if (asCsv || withDetails) {
    const lines = [csvLine(sellerIdentityDetailCsvHeader())];
    for (const row of details) {
      lines.push(csvLine(sellerObservationToCsvRow(row)));
    }
    const suffix = seller ? `-${seller.replace(/\W+/g, "_")}` : "";
    const path = `audit-commission-seller-identity-${year}-${String(month).padStart(2, "0")}${suffix}.csv`;
    writeFileSync(path, lines.join("\n"), "utf8");
    console.log(`\nCSV detalhado: ${path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
