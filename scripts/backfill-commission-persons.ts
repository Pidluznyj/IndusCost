#!/usr/bin/env npx tsx
/**
 * Importa/atualiza pessoas comissionadas a partir dos pedidos Nomus.
 *
 * Uso:
 *   npx tsx scripts/backfill-commission-persons.ts --year=2026 --dry-run
 *   npx tsx scripts/backfill-commission-persons.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  importCommissionPersonsFromOrders,
  previewCommissionPersonsFromOrders,
} from "../src/lib/commissions/commissionPersons.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const dryRun = hasFlag("dry-run");
  const apply = hasFlag("apply");
  const yearArg = parseArg("year");

  if (!dryRun && !apply) {
    throw new Error("Informe --dry-run (preview) ou --apply (executa importação).");
  }
  if (dryRun && apply) {
    throw new Error("Use apenas um modo: --dry-run ou --apply.");
  }

  console.log("=== Backfill de pessoas comissionadas ===");
  console.log(`Modo: ${dryRun ? "dry-run (sem alterações)" : "apply (grava no banco)"}`);
  if (yearArg) {
    console.log(`Nota: --year=${yearArg} é informativo; a importação considera todos os pedidos.`);
  }
  console.log();

  const existingCount = await prisma.commissionPerson.count();
  console.log(`Pessoas comissionadas existentes: ${existingCount}`);

  if (dryRun) {
    const preview = await previewCommissionPersonsFromOrders();
    console.log("\n--- Preview ---");
    console.log(`Pedidos analisados: ${preview.ordersScanned}`);
    console.log(`Seriam criadas: ${preview.created}`);
    console.log(`Seriam atualizadas: ${preview.updated}`);
    console.log(`Sem alteração: ${preview.unchanged}`);
    console.log(`Ignorados sem nome: ${preview.skippedNoName}`);
    console.log(`Ignorados sem ID Nomus: ${preview.skippedNoNomusId}`);
    console.log("\nDry-run concluído. Nenhuma alteração foi feita.");
    return;
  }

  console.log("\nExecutando importação...");
  const result = await importCommissionPersonsFromOrders();
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
