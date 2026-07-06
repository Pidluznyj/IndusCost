#!/usr/bin/env npx tsx
/**
 * Preview de impacto ao aplicar exclusão de comissão por cliente (somente leitura).
 *
 * Uso:
 *   npx tsx scripts/preview-commission-customer-exclusion-impact.ts --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31
 *   npx tsx scripts/preview-commission-customer-exclusion-impact.ts --customerExternalId=123 --from=2026-01-01 --to=2026-12-31 --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { previewCustomerExclusionImpact } from "../src/lib/commissions/commissionCustomerExclusionReprocess.server.ts";
import {
  buildExclusionImpactCsv,
  parseExclusionReprocessCustomerFilter,
  parseExclusionReprocessDateRange,
} from "../src/lib/commissions/commissionCustomerExclusionReprocess.ts";
import {
  fmtBrl,
  hasFlag,
  parseArg,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
} from "./commission-script-utils.ts";

function printPreviewHuman(
  preview: Awaited<ReturnType<typeof previewCustomerExclusionImpact>>
): void {
  console.log("=== Preview — exclusão de comissão por cliente ===");
  console.log(
    `Cliente: ${preview.customerFilter.customerName ?? "—"} | externalId=${preview.customerFilter.customerExternalId ?? "—"}`
  );
  console.log(`Período: ${preview.dateRange.label}`);
  console.log(`Regras consideradas: ${preview.ruleIds.length}`);
  console.log("Modo: PREVIEW (nenhuma alteração)\n");

  for (const warning of preview.warnings) {
    console.log(`⚠ ${warning}`);
  }
  console.log("");

  console.log("--- Resumo ---");
  console.log(`Pedidos afetados: ${preview.ordersAffected}`);
  console.log(`NFs afetadas: ${preview.nfesAffected}`);
  console.log(`CRs afetados: ${preview.receivablesAffected}`);
  console.log(`Vendedores afetados: ${preview.sellersAffected}`);
  console.log(`Linhas: ${preview.lines.length}`);
  console.log(`Comissão atual: ${fmtBrl(preview.totals.currentCommission)}`);
  console.log(`Comissão após exclusão: ${fmtBrl(preview.totals.afterCommission)}`);
  console.log(`Diferença: ${fmtBrl(preview.totals.commissionDiff)}`);
  console.log(`Liberado atual: ${fmtBrl(preview.totals.currentReleased)}`);
  console.log(`Liberado após: ${fmtBrl(preview.totals.afterReleased)}`);
  console.log(`Registros pagos bloqueados: ${preview.totals.paidBlockedCount}`);
  console.log(`Registros que mudariam: ${preview.totals.wouldChangeCount}`);

  if (preview.byReferenceMonth.length > 0) {
    console.log("\n--- Impacto por mês (NF/pedido) ---");
    for (const bucket of preview.byReferenceMonth) {
      console.log(
        `  ${bucket.monthKey}: ${bucket.lineCount} linha(s) | atual ${fmtBrl(bucket.currentCommission)} → ${fmtBrl(bucket.afterCommission)} (${fmtBrl(bucket.commissionDiff)})`
      );
    }
  }

  if (preview.bySettlementMonth.length > 0) {
    console.log("\n--- Impacto por mês (settlementDate) ---");
    for (const bucket of preview.bySettlementMonth) {
      console.log(
        `  ${bucket.monthKey}: ${bucket.lineCount} linha(s) | liberado atual ${fmtBrl(bucket.currentReleased)} → ${fmtBrl(bucket.afterReleased)}`
      );
    }
  }

  if (preview.bySeller.length > 0) {
    console.log("\n--- Impacto por vendedor ---");
    for (const seller of preview.bySeller) {
      console.log(
        `  ${seller.sellerName}: ${seller.lineCount} linha(s) | ${fmtBrl(seller.currentCommission)} → ${fmtBrl(seller.afterCommission)} (${fmtBrl(seller.commissionDiff)})`
      );
    }
  }

  const settled = preview.lines.filter((line) => line.titleCategory === "settled");
  const open = preview.lines.filter((line) => line.titleCategory === "open");
  const future = preview.lines.filter(
    (line) => line.titleCategory === "future" || line.titleCategory === "forecast"
  );

  console.log("\n--- Títulos ---");
  console.log(`Baixados/liberados: ${settled.length}`);
  console.log(`Em aberto vencidos: ${open.length}`);
  console.log(`Futuros/previstos: ${future.length}`);

  const sample = preview.lines.slice(0, 25);
  if (sample.length > 0) {
    console.log("\n--- Amostra (até 25 linhas) ---");
    for (const line of sample) {
      console.log(
        `  • pedido ${line.orderCode ?? "—"} | NF ${line.nfeNumber ?? "—"} | ${line.sellerName} | ref ${line.referenceDate} | ${fmtBrl(line.currentCommissionAmount)} → ${fmtBrl(line.afterCommissionAmount)} | ${line.exclusionReason ?? "—"}`
      );
    }
  }

  console.log("\nPreview concluído. Nenhuma alteração foi feita.");
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("preview-commission-customer-exclusion-impact");
    customer: parseArg("customer"),
    customerExternalId: parseArg("customerExternalId"),
  });
  const dateRange = parseExclusionReprocessDateRange({
    from: parseArg("from"),
    to: parseArg("to"),
  });
  const ruleId = parseArg("rule-id") ?? parseArg("ruleId");

  const preview = await previewCustomerExclusionImpact(prisma, {
    customerFilter,
    dateRange,
    ruleId,
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (hasFlag("csv")) {
    console.log(buildExclusionImpactCsv(preview));
    return;
  }

  printPreviewHuman(preview);
}

main()
  .catch((err) => {
    console.error("Erro no preview:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
