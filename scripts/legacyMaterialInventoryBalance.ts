#!/usr/bin/env npx tsx
/**
 * Preview (padrão) / apply explícito de saldo legado Material.quantity
 * via motor canônico INITIAL_BALANCE.
 *
 *   npm run inventory:legacy-material-balance:preview
 *   npm run inventory:legacy-material-balance:apply -- --confirm=LEGACY_MATERIAL_INITIAL_BALANCE
 *
 * Dry-run por default. Não chama Nomus. Não faz UPDATE direto de saldo.
 * Não apaga histórico. Fail-closed: critério incompleto → MANUAL_REVIEW.
 *
 * NÃO executar apply sem autorização explícita.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyEligibleLegacyMaterialBalances,
  LEGACY_MATERIAL_BALANCE_APPLY_CONFIRM,
  previewLegacyMaterialBalances,
} from "../src/lib/inventory/legacyMaterialBalanceCanonicalization.server.ts";

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

function printSummary(label: string, payload: unknown): void {
  console.log(label);
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente — preview requer PostgreSQL local do ambiente.");
    process.exit(1);
  }

  const apply = hasFlag("--apply");
  const confirm = arg("confirm");
  const materialCode = arg("code");
  const materialId = arg("materialId");
  const actorUserId = arg("actorUserId") ?? "";

  if (apply) {
    if (confirm !== LEGACY_MATERIAL_BALANCE_APPLY_CONFIRM) {
      console.error(
        `Apply recusado. Use --confirm=${LEGACY_MATERIAL_BALANCE_APPLY_CONFIRM}`
      );
      process.exit(1);
    }
    if (!actorUserId.trim()) {
      console.error("Apply recusado. Informe --actorUserId=<uuid de AppUser ativo>.");
      process.exit(1);
    }
    const result = await applyEligibleLegacyMaterialBalances(prisma, {
      confirm,
      actorUserId,
      materialCode,
      materialId,
    });
    printSummary("Apply INITIAL_BALANCE legado (motor canônico)", {
      summary: result.preview.summary,
      applied: result.applied,
      skipped: result.skipped,
      idempotent: result.idempotent,
      failed: result.failed,
    });
    return;
  }

  const preview = await previewLegacyMaterialBalances(prisma, {
    materialCode,
    materialId,
  });

  printSummary("Preview saldo legado → INITIAL_BALANCE (dry-run)", preview.summary);

  const case115 = preview.rows.filter((row) => row.code === "115.01--" || row.code === materialCode);
  if (case115.length) {
    console.log("Destaque 115.01-- / --code:");
    for (const row of case115) {
      printSummary("CASE", {
        code: row.code,
        legacyQuantity: row.legacyQuantity,
        inventoryPhysicalQuantity: row.inventoryPhysicalQuantity,
        movementCount: row.movementCount,
        latestLegacyConferenceId: row.latestLegacyConferenceId,
        latestReportedQuantity: row.latestReportedQuantity,
        classification: row.classification,
        reason: row.reason,
      });
    }
  }

  console.log(`ELIGIBLE: ${preview.eligible.length}`);
  for (const row of preview.eligible) {
    console.log(
      JSON.stringify({
        code: row.code,
        legacyQuantity: row.legacyQuantity,
        inventoryPhysicalQuantity: row.inventoryPhysicalQuantity,
        movementCount: row.movementCount,
        latestLegacyConferenceId: row.latestLegacyConferenceId,
        latestReportedQuantity: row.latestReportedQuantity,
        classification: row.classification,
        warehouseId: row.warehouseId,
        inventoryItemId: row.inventoryItemId,
        evidenceRef: row.evidenceRef,
      })
    );
  }

  console.log(`MANUAL_REVIEW (detalhe): ${preview.manualReview.length}`);
  for (const row of preview.manualReview) {
    console.log(
      JSON.stringify({
        code: row.code,
        classification: row.classification,
        reason: row.reason,
        legacyQuantity: row.legacyQuantity,
        inventoryPhysicalQuantity: row.inventoryPhysicalQuantity,
        movementCount: row.movementCount,
        latestLegacyConferenceId: row.latestLegacyConferenceId,
        latestReportedQuantity: row.latestReportedQuantity,
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
