#!/usr/bin/env npx tsx
/**
 * Reprocessamento controlado de comissões por exclusão de cliente.
 *
 * Padrão: dry-run (sem alterações). Apply exige --apply explícito.
 *
 * Uso:
 *   npx tsx scripts/apply-commission-customer-exclusion-reprocess.ts --rule-id=UUID --from=2026-01-01 --to=2026-12-31
 *   npx tsx scripts/apply-commission-customer-exclusion-reprocess.ts --rule-id=UUID --from=2026-01-01 --to=2026-12-31 --apply --skip-closed-months
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { applyCustomerExclusionReprocess } from "../src/lib/commissions/commissionCustomerExclusionReprocess.server.ts";
import {
  parseExclusionReprocessDateRange,
  parseExclusionReprocessMode,
} from "../src/lib/commissions/commissionCustomerExclusionReprocess.ts";
import {
  fmtBrl,
  hasFlag,
  parseArg,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const ruleId = parseArg("rule-id") ?? parseArg("ruleId");
  if (!ruleId?.trim()) {
    throw new Error("Informe --rule-id=UUID da regra de exclusão.");
  }

  const dateRange = parseExclusionReprocessDateRange({
    from: parseArg("from"),
    to: parseArg("to"),
  });
  const mode = parseExclusionReprocessMode({
    apply: hasFlag("apply"),
    dryRun: hasFlag("dry-run"),
  });
  const skipClosedMonths = hasFlag("skip-closed-months");

  console.log("=== Reprocessamento — exclusão de comissão por cliente ===");
  console.log(`Regra: ${ruleId}`);
  console.log(`Período: ${dateRange.label}`);
  console.log(`Modo: ${mode === "apply" ? "APPLY (grava no banco)" : "DRY-RUN (sem alterações)"}`);
  console.log(`Skip meses fechados: ${skipClosedMonths ? "sim" : "não"}\n`);

  const result = await applyCustomerExclusionReprocess(prisma, {
    ruleId: ruleId.trim(),
    dateRange,
    mode,
    skipClosedMonths,
  });

  for (const warning of result.warnings) {
    console.log(`⚠ ${warning}`);
  }

  if (result.blockers.length > 0) {
    console.log("\n--- Bloqueios ---");
    for (const blocker of result.blockers) {
      console.log(`  • ${blocker}`);
    }
  }

  console.log("\n--- Preview resumido ---");
  console.log(`Linhas elegíveis: ${result.preview.lines.length}`);
  console.log(`Comissão atual: ${fmtBrl(result.preview.totals.currentCommission)}`);
  console.log(`Comissão após: ${fmtBrl(result.preview.totals.afterCommission)}`);
  console.log(`Diferença: ${fmtBrl(result.preview.totals.commissionDiff)}`);
  console.log(`Registros que mudariam: ${result.preview.totals.wouldChangeCount}`);

  if (mode === "apply") {
    if (!result.safe) {
      console.error("\n❌ Apply abortado por bloqueios de segurança.");
      process.exit(2);
    }

    console.log("\n--- Resultado apply ---");
    console.log(`Run ID: ${result.runId ?? "—"}`);
    console.log(`Audit issues criados: ${result.auditIssuesCreated}`);
    const appliedRows = result.applied.filter((row) => row.applied);
    const skippedRows = result.applied.filter((row) => !row.applied);
    console.log(`Registros alterados: ${appliedRows.length}`);
    console.log(`Registros ignorados: ${skippedRows.length}`);

    for (const row of appliedRows.slice(0, 50)) {
      console.log(`  ✓ ${row.orderCode ?? row.recordId}`);
    }
    for (const row of skippedRows.slice(0, 20)) {
      console.log(`  – ${row.orderCode ?? row.recordId}: ${row.skippedReason ?? "—"}`);
    }

    console.log("\nReprocessamento concluído. AP/Nomus não foram alterados.");
  } else {
    console.log("\nDry-run concluído. Use --apply para persistir após revisar o preview.");
    if (!result.safe) {
      process.exit(2);
    }
  }
}

main()
  .catch((err) => {
    console.error("Erro no reprocessamento:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
