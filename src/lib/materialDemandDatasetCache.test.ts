import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearMaterialDemandDatasetCache,
  getCachedMaterialDemandDataset,
  materialDemandDatasetCacheSize,
  materialDemandDatasetInflightSize,
} from "./materialDemandDatasetCache.js";
import type { MaterialDemandFilters } from "./materialDemandFilters.js";

const baseFilters: MaterialDemandFilters = {
  startDate: "2026-01-01",
  endDate: "2026-07-20",
  dateBasis: "issueDate",
  status: null,
  statuses: ["READY_TO_SEND", "SENT_TO_NOMUS"],
  customerId: null,
  productId: null,
  materialId: null,
  companyIssuer: null,
  unitKey: null,
  mode: "value",
  search: "",
  includeOrdersWithoutDeliveryDate: true,
  invoicingScope: "all",
  seller: null,
};

describe("materialDemandDatasetCache singleflight", () => {
  it("coalesce parallel loaders for the same filters", async () => {
    clearMaterialDemandDatasetCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, n: calls };
    };

    const [a, b] = await Promise.all([
      getCachedMaterialDemandDataset(baseFilters, loader),
      getCachedMaterialDemandDataset(baseFilters, loader),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(materialDemandDatasetCacheSize(), 1);
    assert.equal(materialDemandDatasetInflightSize(), 0);
  });

  it("serves TTL hit without reloading", async () => {
    clearMaterialDemandDatasetCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { v: 1 };
    };

    await getCachedMaterialDemandDataset(baseFilters, loader);
    await getCachedMaterialDemandDataset(baseFilters, loader);
    assert.equal(calls, 1);
  });
});
