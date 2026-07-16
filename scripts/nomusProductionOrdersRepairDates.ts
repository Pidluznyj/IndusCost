#!/usr/bin/env npx tsx
/**
 * OP-14.1/14.2 — Repara datas + empresa de NomusProductionOrder a partir do rawJson local.
 *
 * Não consulta Nomus. Não altera closedAt, rawJson, payloadHash nem timestamps de sync.
 * Usa lock compartilhado com backfill/incremental.
 *
 * Preview:
 *   npm run repair:nomus:production-orders:dates:preview -- --only-null-dates --limit=50
 *   npm run sync:nomus:production-orders:repair-dates:preview -- --only-null-dates
 *
 * Apply (com retomada via checkpoint):
 *   npm run repair:nomus:production-orders:dates:apply -- --only-null-dates --checkpoint-file=/tmp/op-dates.ckpt.json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseProductionOrderDateRepairCli } from "../src/lib/nomusProductionOrdersDateRepair.ts";
import { runNomusProductionOrdersDateRepair } from "../src/lib/nomusProductionOrdersDateRepair.server.ts";

async function main() {
  const cli = parseProductionOrderDateRepairCli(process.argv.slice(2));
  const result = await runNomusProductionOrdersDateRepair({
    prisma,
    cli,
  });

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
          errors: result.counters.errors,
          fieldsToFill: result.counters.fieldsToFill,
          fieldsFilled: result.counters.fieldsFilled,
        },
        checkpointFile: result.checkpointFile,
        lastProcessedExternalId: result.lastProcessedExternalId,
        samples: result.samples,
        note: "closedAt / rawJson / payloadHash / vínculos nunca são alterados por este reparo.",
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
