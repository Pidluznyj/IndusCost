#!/usr/bin/env npx tsx
/**
 * Backfill de InventoryItem.materialId somente com código EXATO 1:1.
 *
 * Preview:
 *   npm run backfill:inventory-item-material-id:preview
 *
 * Apply:
 *   npx tsx scripts/backfillInventoryItemMaterialId.ts --apply --confirm=LINK_INVENTORY_ITEM_MATERIAL_ID_EXACT_CODE
 *
 * Não altera códigos. Não adivinha por descrição.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { diagnoseUnlinkedInventoryItems } from "../src/lib/inventory/materialInventoryBalanceDiagnostic.server.ts";

const CONFIRM = "LINK_INVENTORY_ITEM_MATERIAL_ID_EXACT_CODE";

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }

  const { candidates, skipped } = await diagnoseUnlinkedInventoryItems(prisma);
  console.log(`Preview vínculo exato: ${candidates.length} candidato(s), ${skipped.length} ignorado(s).`);
  for (const row of candidates.slice(0, 40)) {
    console.log(`${row.inventoryItemCode} → material ${row.materialId}`);
  }

  if (!hasFlag("--apply")) {
    console.log(`Modo preview. Apply: --apply --confirm=${CONFIRM}`);
    return;
  }
  if (arg("confirm") !== CONFIRM) {
    console.error(`Apply recusado. Use --confirm=${CONFIRM}`);
    process.exit(1);
  }

  let linked = 0;
  for (const row of candidates) {
    const material = await prisma.material.findUnique({
      where: { id: row.materialId },
      select: { id: true, code: true, description: true, unit: true, category: true },
    });
    if (!material) continue;
    await prisma.inventoryItem.update({
      where: { id: row.inventoryItemId },
      data: {
        materialId: material.id,
        materialCodeSnapshot: material.code,
        materialDescriptionSnapshot: material.description,
        materialUnitSnapshot: material.unit,
        materialCategorySnapshot: material.category,
      },
    });
    linked += 1;
  }
  console.log(`Vinculados: ${linked}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
