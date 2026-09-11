#!/usr/bin/env npx tsx
/**
 * Diagnóstico read-only: Material.quantity × saldo físico canônico do Inventory.
 *
 *   npm run audit:material-inventory-balance
 *   npx tsx scripts/auditMaterialInventoryBalance.ts --code=115.01--
 *
 * Não escreve. Não aplica repair. Imprime TODAS as linhas não-MATCH.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { diagnoseMaterialInventoryBalances } from "../src/lib/inventory/materialInventoryBalanceDiagnostic.server.ts";

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
    console.error("DATABASE_URL ausente — auditoria requer PostgreSQL.");
    process.exit(1);
  }

  const { rows, summary } = await diagnoseMaterialInventoryBalances(prisma, {
    materialCode: arg("code"),
    materialId: arg("materialId"),
  });

  console.log("Resumo Material × Inventory (read-only)");
  console.log(JSON.stringify(summary, null, 2));

  const highlight = rows.filter(
    (r) => r.materialCode === "115.01--" || r.materialCode === arg("code")
  );
  if (highlight.length) {
    console.log("Destaque:");
    console.log(JSON.stringify(highlight, null, 2));
  }

  const anomalias = rows.filter((r) => r.status !== "MATCH");
  console.log(`Linhas não-MATCH: ${anomalias.length}`);
  for (const row of anomalias) {
    console.log(
      JSON.stringify({
        classification: row.status,
        materialId: row.materialId,
        materialCode: row.materialCode,
        description: row.materialDescription,
        unit: row.materialUnit,
        materialQuantity: row.materialQuantity,
        inventoryItemId: row.inventoryItemId,
        inventoryItemCode: row.inventoryItemCode,
        controlsLocation: row.controlsLocation,
        physicalCanonicalQuantity: row.canonicalPhysical,
        difference: row.signedDifference,
        absoluteDifference: row.absoluteDifference,
        warehouseCount: row.warehouseCount,
        locationCount: row.locationCount,
        lastMovementAt: row.lastMovementAt,
        lastMovementId: row.lastMovementId,
        hasInventoryBalance: row.hasInventoryBalance,
        balanceCount: row.balanceCount,
        hasCanonicalLedger: row.hasCanonicalLedger,
        hasInventoryMovement: row.hasInventoryMovement,
        repairEligible: row.repairEligible,
        linkIssue: row.linkIssue,
      })
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
