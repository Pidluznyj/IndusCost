#!/usr/bin/env npx tsx
/**
 * Diagnóstico read-only: Material.quantity × saldo físico canônico do Inventory.
 *
 *   npm run audit:material-inventory-balance
 *   npx tsx scripts/auditMaterialInventoryBalance.ts --code=115.01--
 *
 * Não escreve. Não aplica repair.
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
  const divergentes = rows.filter((r) => r.status !== "MATCH" && r.status !== "NO_BALANCE");
  console.log(`Linhas divergentes/anômalas: ${divergentes.length}`);
  for (const row of divergentes.slice(0, 50)) {
    console.log(
      [
        row.status,
        row.materialCode,
        `qty=${row.materialQuantity}`,
        `canonical=${row.canonicalPhysical}`,
        `diff=${row.absoluteDifference}`,
        row.inventoryItemCode ?? "-",
        row.linkIssue ?? "",
      ].join(" | ")
    );
  }
  if (divergentes.length > 50) {
    console.log(`... +${divergentes.length - 50} linha(s)`);
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
