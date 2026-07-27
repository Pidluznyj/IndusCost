import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTreasuryApplicationAvailableOn,
  isTreasuryApplicationStillLockedOn,
  resolveTreasuryCreditAvailable,
  resolveTreasuryLiquidityAvailableDate,
  TREASURY_PROJECTION_LIQUIDITY_OFFSET_DAYS,
} from "./treasuryProjectionLiquidity.js";

describe("treasuryProjectionLiquidity", () => {
  it("offsets IMMEDIATE / D+1 / D+2 / D+3", () => {
    assert.equal(TREASURY_PROJECTION_LIQUIDITY_OFFSET_DAYS.IMMEDIATE, 0);
    assert.equal(
      resolveTreasuryLiquidityAvailableDate("2026-07-27", "IMMEDIATE"),
      "2026-07-27"
    );
    assert.equal(
      resolveTreasuryLiquidityAvailableDate("2026-07-27", "D_PLUS_1"),
      "2026-07-28"
    );
    assert.equal(
      resolveTreasuryLiquidityAvailableDate("2026-07-27", "D_PLUS_2"),
      "2026-07-29"
    );
    assert.equal(
      resolveTreasuryLiquidityAvailableDate("2026-07-27", "D_PLUS_3"),
      "2026-07-30"
    );
  });

  it("aplicação permanece indisponível até a data de liquidez", () => {
    const app = {
      investedOn: "2026-07-27" as const,
      liquidity: "D_PLUS_2" as const,
    };
    assert.equal(isTreasuryApplicationAvailableOn(app, "2026-07-27"), false);
    assert.equal(isTreasuryApplicationAvailableOn(app, "2026-07-28"), false);
    assert.equal(isTreasuryApplicationStillLockedOn(app, "2026-07-28"), true);
    assert.equal(isTreasuryApplicationAvailableOn(app, "2026-07-29"), true);
    assert.equal(isTreasuryApplicationStillLockedOn(app, "2026-07-29"), false);
  });

  it("crédito disponível é separado (limite − usado)", () => {
    assert.equal(
      resolveTreasuryCreditAvailable({
        creditLimit: "1000.00",
        usedLimit: "250.25",
      }),
      "749.75"
    );
  });
});
