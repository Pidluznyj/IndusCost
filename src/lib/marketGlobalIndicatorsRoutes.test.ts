import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapCollectionOutcomeToRefreshPart } from "./marketGlobalIndicators.js";

describe("mapCollectionOutcomeToRefreshPart", () => {
  it("falha parcial em PTAX não derruba Brent", () => {
    const brent = mapCollectionOutcomeToRefreshPart({
      action: "created",
      quoteDate: "2026-07-08",
      snapshot: { status: "SUCCESS" },
    });
    const ptax = mapCollectionOutcomeToRefreshPart({
      action: "created",
      quoteDate: "2026-07-08",
      snapshot: { status: "FAILED", errorMessage: "BCB indisponível" },
    });

    assert.equal(brent.ok, true);
    assert.equal(ptax.ok, false);
    if (!ptax.ok) assert.equal(ptax.error, "BCB indisponível");
  });

  it("mapeia skip e erro de transporte", () => {
    assert.deepEqual(
      mapCollectionOutcomeToRefreshPart({
        action: "skipped",
        quoteDate: "2026-07-08",
        reason: "já coletado",
      }),
      { ok: true, action: "skipped", quoteDate: "2026-07-08", reason: "já coletado" }
    );
    assert.deepEqual(mapCollectionOutcomeToRefreshPart({ error: "timeout" }), {
      ok: false,
      error: "timeout",
    });
  });
});
