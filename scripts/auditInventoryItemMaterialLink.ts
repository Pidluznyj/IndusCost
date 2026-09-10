#!/usr/bin/env npx tsx
/**
 * Diagnóstico de InventoryItem RAW_MATERIAL sem materialId.
 * Vínculo automático só com código EXATO 1:1 e unidade compatível.
 *
 *   npm run audit:inventory-item-material-link
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { diagnoseUnlinkedInventoryItems } from "../src/lib/inventory/materialInventoryBalanceDiagnostic.server.ts";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  const { candidates, skipped } = await diagnoseUnlinkedInventoryItems(prisma);
  console.log(`Candidatos 1:1 exatos: ${candidates.length}`);
  console.log(`Ignorados (sem adivinhação): ${skipped.length}`);
  for (const row of candidates.slice(0, 40)) {
    console.log(`OK ${row.inventoryItemCode} → ${row.materialId}`);
  }
  const byReason = new Map<string, number>();
  for (const row of skipped) {
    const key = row.blockedReason ?? "OTHER";
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log("Ignorados por motivo:", Object.fromEntries(byReason));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
