#!/usr/bin/env npx tsx
/**
 * Recalcula comissões para um período (preview ou apply).
 *
 * Uso:
 *   npx tsx scripts/recalculate-commissions.ts --year=2026 --month=6 --preview
 *   npx tsx scripts/recalculate-commissions.ts --year=2026 --month=6 --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { calculateCommissions } from "../src/lib/commissions/commission-calculation-service.server.ts";
import {
  evaluateApplySafety,
  previewCommissionCalculation,
} from "../src/lib/commissions/commission-preview-calculation.server.ts";
import {
  fmtBrl,
  parseScriptMode,
  parseYearPeriod,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
} from "./commission-script-utils.ts";

function printPreview(result: Awaited<ReturnType<typeof previewCommissionCalculation>>): void {
  console.log("--- Preview detalhado ---");
  console.log(`Pedidos analisados: ${result.ordersAnalyzed} (${result.ordersActive} ativos)`);
  console.log(`Itens analisados: ${result.itemsAnalyzed}`);
  console.log(`Regras ativas: ${result.activeRulesCount}`);
  console.log(`Registros ativos existentes: ${result.existingActiveRecords}`);
  console.log(`Registros pagos existentes: ${result.existingPaidRecords}`);
  console.log(`Linhas previstas: ${result.forecastLines} (${fmtBrl(result.forecastAmount)})`);
  console.log(`Aguardando NF-e: ${result.waitingNfeLines} (${fmtBrl(result.waitingNfeAmount)})`);
  console.log(`Confirmadas: ${result.confirmedLines} (${fmtBrl(result.confirmedAmount)})`);
  console.log(`Sem regra: ${result.noRuleLines} (base ${fmtBrl(result.noRuleAmount)})`);
  console.log(`Pedidos sem vendedor: ${result.noSellerLines}`);
  console.log(`Novos hashes (upsert): ${result.wouldUpsertLines}`);

  if (result.blockers.length > 0) {
    console.log("\n--- Bloqueios ---");
    for (const b of result.blockers) console.log(`  • ${b}`);
  }

  if (result.topSellers.length > 0) {
    console.log("\n--- Top vendedores/pessoas (preview) ---");
    for (const s of result.topSellers) {
      console.log(`  • ${s.name}: ${fmtBrl(s.amount)} (${s.count} linha(s))`);
    }
  }

  if (result.topCustomers.length > 0) {
    console.log("\n--- Top clientes (preview) ---");
    for (const c of result.topCustomers.slice(0, 10)) {
      console.log(`  • ${c.name}: ${fmtBrl(c.amount)} (${c.count} linha(s))`);
    }
  }

  if (result.sampleLines.length > 0) {
    console.log("\n--- Amostra (até 20 registros) ---");
    for (const line of result.sampleLines) {
      console.log(
        `  • ${line.orderCode} | ${line.productCode ?? "—"} | ${line.status} | ${line.commissionPersonName} | regra=${line.ruleName ?? "—"} | ${fmtBrl(line.commissionAmount)}`
      );
    }
  }
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("recalculate-commissions");
  const range = parseYearPeriod();
  const mode = parseScriptMode();

  console.log("=== Recálculo de comissões ===");
  console.log(`Período: ${range.label}`);
  console.log(`Modo: ${mode === "preview" ? "preview (sem alterações)" : "apply (grava no banco)"}\n`);

  const periodInput = {
    from: range.from,
    to: range.to,
    year: range.from.getFullYear(),
    month: range.from.getMonth() + 1,
    label: range.label,
  };

  if (mode === "preview") {
    const result = await previewCommissionCalculation(prisma, periodInput);
    printPreview(result);
    console.log("\nPreview concluído. Nenhuma alteração foi feita.");
    return;
  }

  const safety = await evaluateApplySafety(prisma, periodInput);
  printPreview(safety.preview);

  if (!safety.safe) {
    console.error("\n❌ Apply BLOQUEADO por segurança:");
    for (const r of safety.reasons) console.error(`  • ${r}`);
    console.error("\nCorrija os bloqueios antes de executar --apply.");
    process.exit(2);
  }

  console.log("\n✅ Checagens de segurança OK. Executando recálculo...");
  const { runId, summary } = await calculateCommissions(prisma, {
    from: range.from,
    to: range.to,
    mode: "FULL",
  });

  console.log("\n--- Resultado apply ---");
  console.log(`Run ID: ${runId}`);
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nRecálculo concluído.");
}

main()
  .catch((err) => {
    console.error("Erro no recálculo:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
