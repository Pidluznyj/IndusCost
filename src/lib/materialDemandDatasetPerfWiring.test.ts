import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readServer(): string {
  return readFileSync(join(process.cwd(), "server.ts"), "utf8");
}

describe("material demand dataset performance wiring", () => {
  it("pré-explode produtos únicos em paralelo e evita includeDetails", () => {
    const server = readServer();
    const datasetFn = server.slice(
      server.indexOf("const buildMaterialDemandDataset = async"),
      server.indexOf("const buildMaterialDemandPlannedVsRealizedDataset = async")
    );
    assert.match(datasetFn, /uniqueProductIds|productPrep/);
    assert.match(datasetFn, /PRODUCT_PREP_CONCURRENCY/);
    assert.match(datasetFn, /getProductCostAnalysis\(pid, analysisCache, false\)/);
    assert.match(datasetFn, /productPrep\.get\(item\.productId\)/);
    assert.doesNotMatch(datasetFn, /await getProductAnalysis\(item\.productId\)/);
  });

  it("cache singleflight é usado no loader compartilhado", () => {
    const server = readServer();
    assert.match(server, /getCachedMaterialDemandDataset\(filters,/);
    const cache = readFileSync(
      join(process.cwd(), "src/lib/materialDemandDatasetCache.ts"),
      "utf8"
    );
    assert.match(cache, /inflight/);
    assert.match(cache, /inflight\.get\(key\)/);
  });
});
