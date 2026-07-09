/**
 * Coleta manual PTAX (BCB) — uso operacional / teste.
 *
 * Uso:
 *   npm run collect:ptax
 */
import "dotenv/config";
import {
  collectPtaxSnapshot,
  serializePtaxSnapshotForApi,
} from "../src/lib/ptaxSnapshotCollection.js";

async function main(): Promise<void> {
  const outcome = await collectPtaxSnapshot({ trigger: "MANUAL" });
  if (outcome.action === "skipped") {
    console.info(
      `[ptax-snapshot-collect] skipped quoteDate=${outcome.quoteDate} reason=${outcome.reason}`
    );
    return;
  }

  const snapshot = serializePtaxSnapshotForApi(outcome.snapshot);
  console.info(`[ptax-snapshot-collect] ${snapshot.status} id=${snapshot.id}`);
  if (snapshot.status === "SUCCESS") {
    console.info(
      `[ptax-snapshot-collect] quoteDate=${snapshot.quoteDate} buy=${snapshot.buyRate} sell=${snapshot.sellRate}`
    );
  } else {
    console.error(`[ptax-snapshot-collect] error=${snapshot.errorMessage}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[ptax-snapshot-collect] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
