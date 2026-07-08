import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeBrentSnapshotForApi } from "./brentCommodityCollection.js";

describe("brentCommodityCollection", () => {
  it("serializeBrentSnapshotForApi expõe priceUSD e variação", () => {
    const api = serializeBrentSnapshotForApi({
      id: "snap-1",
      commodityType: "BRENT",
      priceUSD: { toString: () => "78.5" } as never,
      quoteDate: new Date("2026-07-08T12:00:00.000Z"),
      collectedAt: new Date("2026-07-08T15:00:00.000Z"),
      source: "yahoo-finance",
      status: "SUCCESS",
      errorMessage: null,
      variationFromPrevious: { toString: () => "1.25" } as never,
    });

    assert.equal(api.priceUSD, 78.5);
    assert.equal(api.quoteDate, "2026-07-08");
    assert.equal(api.variationFromPrevious, 1.25);
    assert.equal(api.status, "SUCCESS");
  });

  it("serializeBrentSnapshotForApi trata falha sem preço", () => {
    const api = serializeBrentSnapshotForApi({
      id: "snap-2",
      commodityType: "BRENT",
      priceUSD: null,
      quoteDate: new Date("2026-07-08T12:00:00.000Z"),
      collectedAt: new Date("2026-07-08T15:01:00.000Z"),
      source: null,
      status: "FAILED",
      errorMessage: "Brent API indisponível",
      variationFromPrevious: null,
    });

    assert.equal(api.priceUSD, null);
    assert.equal(api.errorMessage, "Brent API indisponível");
    assert.equal(api.variationFromPrevious, null);
  });
});
