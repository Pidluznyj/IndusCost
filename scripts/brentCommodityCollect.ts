/**
 * Coleta manual Brent (commodity) — uso operacional / teste.
 *
 * Uso:
 *   npm run collect:brent
 */
import "dotenv/config";
import {
  collectBrentCommoditySnapshot,
  serializeBrentSnapshotForApi,
} from "../src/lib/brentCommodityCollection.js";

async function main(): Promise<void> {
  const outcome = await collectBrentCommoditySnapshot({ trigger: "MANUAL" });
  if (outcome.action === "skipped") {
    console.info(
      `[brent-commodity-collect] skipped slot=${outcome.slot} reason=${outcome.reason}`
    );
    return;
  }

  const snapshot = serializeBrentSnapshotForApi(outcome.snapshot);
  console.info(`[brent-commodity-collect] ${snapshot.status} id=${snapshot.id} slot=${outcome.slot}`);
  if (snapshot.status === "SUCCESS") {
    console.info(
      `[brent-commodity-collect] priceUSD=${snapshot.priceUSD} variation=${snapshot.variationFromPrevious ?? "n/a"}`
    );
  } else {
    console.error(`[brent-commodity-collect] error=${snapshot.errorMessage}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[brent-commodity-collect] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
