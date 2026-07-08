/**
 * Coleta manual Brent (commodity) — uso operacional / teste.
 *
 * Uso:
 *   npm run collect:brent
 *   npm run collect:brent -- --trigger=manual
 */
import { collectBrentCommoditySnapshot } from "@/src/lib/brentCommodityCollection.js";
import { listRegisteredScheduledJobs } from "@/src/lib/brentCommodityJobRegistry.js";

async function main(): Promise<void> {
  const jobs = listRegisteredScheduledJobs();
  console.info("[brent-commodity-collect] jobs registrados:", jobs.map((j) => j.id).join(", "));

  const outcome = await collectBrentCommoditySnapshot({ trigger: "MANUAL" });
  if (outcome.action === "skipped") {
    console.info("[brent-commodity-collect] dedup:", outcome.reason);
    console.info("[brent-commodity-collect] existingSnapshotId:", outcome.existingSnapshotId);
    return;
  }

  console.info(
    `[brent-commodity-collect] ${outcome.snapshot.status} id=${outcome.snapshot.id} slot=${outcome.slot} quoteDate=${outcome.quoteDate}`
  );
  if (outcome.snapshot.status === "SUCCESS") {
    console.info(`[brent-commodity-collect] priceUSD=${outcome.snapshot.priceUSD}`);
  } else {
    console.error(`[brent-commodity-collect] error=${outcome.snapshot.errorMessage}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[brent-commodity-collect] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
