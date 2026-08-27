#!/usr/bin/env npx tsx
/**
 * DS-03.6 — Repara campos normalizados de NomusStockDocument a partir do rawJson local.
 *
 * Não consulta Nomus. Não altera rawJson, itens, IDs nem vínculos.
 * Usa o lock oficial compartilhado com o sync de Documentos de Saída.
 *
 * Preview:
 *   npm run repair:nomus:stock-documents:preview -- --only-null --limit=50
 *
 * Apply (com retomada via checkpoint):
 *   npm run repair:nomus:stock-documents:apply -- --only-null --checkpoint-file=/tmp/ds-repair.ckpt.json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseStockDocumentRepairCli } from "../src/lib/nomusStockDocumentsRepair.ts";
import { runNomusStockDocumentsRepair } from "../src/lib/nomusStockDocumentsRepair.server.ts";

async function main() {
  const cli = parseStockDocumentRepairCli(process.argv.slice(2));
  const result = await runNomusStockDocumentsRepair({
    prisma,
    cli,
  });

  // Snapshot da DRE: reparo que altera Documentos de Saída invalida o
  // fallback de itens do CMV (defensivo — mesma semântica canônica dos
  // demais writers de stock documents; soft-fail).
  if (result.mode === "apply" && (result.counters.updated ?? 0) > 0) {
    const { markFinanceDreSnapshotsDirtyForStockDocumentChanges } = await import(
      "../src/lib/financeDreSnapshot.server.ts"
    );
    await markFinanceDreSnapshotsDirtyForStockDocumentChanges(prisma, {
      changedCount: result.counters.updated ?? 0,
      reason: "stock-documents-repair",
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: result.exitCode === 0,
        mode: result.mode,
        lockBlocked: result.lockBlocked ?? false,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        counters: {
          scanned: result.counters.scanned,
          wouldUpdate: result.counters.wouldUpdate,
          updated: result.counters.updated,
          unchanged: result.counters.unchanged,
          skippedInvalid: result.counters.skippedInvalid,
          invalidDates: result.counters.invalidDates,
          absentFields: result.counters.absentFields,
          errors: result.counters.errors,
          fieldsToFill: result.counters.fieldsToFill,
          fieldsFilled: result.counters.fieldsFilled,
        },
        checkpointFile: result.checkpointFile,
        lastProcessedExternalId: result.lastProcessedExternalId,
        samples: result.samples,
        note: "rawJson / itens / IDs / vínculos / firstSeenAt / lastSeenAt / presentInLastPayload nunca são alterados por este reparo.",
      },
      null,
      2
    )
  );

  process.exitCode = result.exitCode;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
