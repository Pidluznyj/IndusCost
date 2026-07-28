import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProposalMarginReferenceDate } from "./proposalMargin.server.js";

describe("proposalMargin.server — data de referência", () => {
  it("prefere externalOpenedAt (Nomus) a createdAt", () => {
    const d = resolveProposalMarginReferenceDate({
      externalOpenedAt: "2026-01-15T12:00:00.000Z",
      createdAt: "2026-07-28T12:00:00.000Z",
    });
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-01-15");
  });

  it("usa createdAt quando não há abertura externa", () => {
    const d = resolveProposalMarginReferenceDate({
      externalOpenedAt: null,
      createdAt: "2026-07-28T12:00:00.000Z",
    });
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-07-28");
  });
});
