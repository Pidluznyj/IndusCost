#!/usr/bin/env npx tsx
/**
 * Reconcilia Material.quantity a partir do saldo físico canônico do Inventory.
 *
 * Preview (padrão):
 *   npm run repair:material-inventory-quantity:preview
 *
 * Apply (explícito):
 *   npm run repair:material-inventory-quantity:apply
 *
 * Não cria InventoryMovement. Não atualiza InventoryBalance.
 * Não aponta para produção automaticamente — usa DATABASE_URL local.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { diagnoseMaterialInventoryBalances } from "../src/lib/inventory/materialInventoryBalanceDiagnostic.server.ts";
import { reconcileMaterialQuantityFromInventoryInTx } from "../src/lib/inventory/materialInventoryProjection.server.ts";

const CONFIRM = "RECONCILE_MATERIAL_QUANTITY_FROM_INVENTORY";

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

  const apply = hasFlag("--apply");
  const confirm = arg("confirm");
  const { rows, summary } = await diagnoseMaterialInventoryBalances(prisma, {
    materialCode: arg("code"),
    materialId: arg("materialId"),
  });

  const eligible = rows.filter((r) => r.status === "QUANTITY_DIVERGENCE");
  console.log("Preview reconciliação Material.quantity ← Inventory");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Elegíveis (QUANTITY_DIVERGENCE, unidade compatível): ${eligible.length}`);
  for (const row of eligible.slice(0, 30)) {
    console.log(
      `${row.materialCode}: ${row.materialQuantity} → ${row.canonicalPhysical} (item ${row.inventoryItemCode})`
    );
  }

  if (!apply) {
    console.log("Modo preview — nenhuma escrita. Use --apply --confirm=" + CONFIRM);
    return;
  }
  if (confirm !== CONFIRM) {
    console.error(`Apply recusado. Confirme com --confirm=${CONFIRM}`);
    process.exit(1);
  }

  const report: Array<{ materialId: string; before: string; after: string; changed: boolean }> = [];
  await prisma.$transaction(async (tx) => {
    const ids = eligible.map((r) => r.materialId).sort();
    for (const id of ids) {
      const result = await reconcileMaterialQuantityFromInventoryInTx(tx, id, {
        source: "RECONCILE",
        reason: "Repair preview/apply — projeção canônica",
      });
      if (result) {
        report.push({
          materialId: result.materialId,
          before: result.before.toString(),
          after: result.after.toString(),
          changed: result.changed,
        });
      }
    }
  });
  console.log(`Aplicado: ${report.filter((r) => r.changed).length} material(is).`);
  console.log(JSON.stringify(report.filter((r) => r.changed), null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
