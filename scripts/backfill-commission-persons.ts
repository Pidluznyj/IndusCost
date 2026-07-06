#!/usr/bin/env npx tsx
/**
 * Importa/atualiza pessoas comissionadas a partir dos vendedores/responsáveis dos pedidos.
 *
 * Uso:
 *   npx tsx scripts/backfill-commission-persons.ts --year=2026 --month=6 --preview
 *   npx tsx scripts/backfill-commission-persons.ts --year=2026 --month=6 --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  importCommissionPersonsForPeriod,
  importCommissionPersonsFromOrders,
  previewCommissionPersonsForPeriod,
  previewCommissionPersonsFromOrders,
} from "../src/lib/commissions/commissionPersons.server.ts";
import {
  parseScriptMode,
  parseYearPeriod,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();
  const mode = parseScriptMode();
  const hasMonth = Boolean(process.argv.some((a) => a.startsWith("--month=")));

  console.log("=== Backfill de pessoas comissionadas ===");
  console.log(`Período: ${range.label}`);
  console.log(`Modo: ${mode === "preview" ? "preview (sem alterações)" : "apply (grava no banco)"}\n`);

  const existingCount = await prisma.commissionPerson.count();
  console.log(`Pessoas comissionadas existentes (global): ${existingCount}`);

  if (mode === "preview") {
    const preview = hasMonth
      ? await previewCommissionPersonsForPeriod({ from: range.from, to: range.to })
      : { ...(await previewCommissionPersonsFromOrders()), candidates: [] as never[] };

    const detailed = hasMonth
      ? (preview as Awaited<ReturnType<typeof previewCommissionPersonsForPeriod>>)
      : null;

    console.log("\n--- Preview ---");
    console.log(`Pedidos analisados: ${preview.ordersScanned}`);
    console.log(`Seriam criadas: ${preview.created}`);
    console.log(`Seriam atualizadas: ${preview.updated}`);
    console.log(`Sem alteração: ${preview.unchanged}`);
    console.log(`Ignorados sem nome: ${preview.skippedNoName}`);
    console.log(`Ignorados sem ID Nomus: ${preview.skippedNoNomusId}`);

    if (detailed && detailed.candidates.length > 0) {
      console.log("\n--- Vendedores/representantes no período ---");
      for (const c of detailed.candidates.slice(0, 50)) {
        const action = c.wouldCreate
          ? "CRIAR"
          : c.wouldUpdate
            ? "ATUALIZAR"
            : c.exists
              ? "EXISTE"
              : "—";
        console.log(
          `  • [${action}] ${c.type} id=${c.nomusPersonId} ${c.name}${c.existingId ? ` (${c.existingId.slice(0, 8)}…)` : ""}`
        );
      }
      if (detailed.candidates.length > 50) {
        console.log(`  … e mais ${detailed.candidates.length - 50} candidato(s).`);
      }
    }

    console.log("\nPreview concluído. Nenhuma alteração foi feita.");
    return;
  }

  console.log("\nExecutando importação...");
  const result = hasMonth
    ? await importCommissionPersonsForPeriod({ from: range.from, to: range.to })
    : await importCommissionPersonsFromOrders();
  console.log("\n--- Resultado ---");
  console.log(JSON.stringify(result, null, 2));
  console.log("\nBackfill concluído.");
}

main()
  .catch((err) => {
    console.error("Erro no backfill:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
