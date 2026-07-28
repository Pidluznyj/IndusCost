import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveProposalFreightAbsolute,
  resolveProposalFreightPercent,
} from "./proposalFreightPercent.js";

describe("proposalFreightPercent", () => {
  it("lê freightPercent de proposalDefaults", () => {
    assert.equal(
      resolveProposalFreightPercent({
        proposalDefaults: { freightPercent: 3 },
      }),
      3
    );
  });

  it("lê rates.freightRate (fração) do formulaSnapshot", () => {
    assert.equal(
      resolveProposalFreightPercent({
        item: {
          formulaSnapshotJson: {
            rates: { freightRate: 0.03 },
          },
        },
      }),
      3
    );
  });

  it("lê frete absoluto legado", () => {
    assert.equal(
      resolveProposalFreightAbsolute({
        item: { formulaSnapshotJson: { freight: 1.5 } },
      }),
      1.5
    );
  });
});
