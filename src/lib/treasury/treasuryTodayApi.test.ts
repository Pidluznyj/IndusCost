import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURY_TODAY_PATH } from "./contracts/index.js";
import { buildTreasuryTodayUrl } from "./treasuryTodayApi.js";

describe("treasuryTodayApi", () => {
  it("monta URL agregada sem query", () => {
    assert.equal(buildTreasuryTodayUrl(), TREASURY_TODAY_PATH);
  });

  it("inclui data e contas", () => {
    const url = buildTreasuryTodayUrl({
      date: "2026-07-28",
      accountIds: ["a", "b"],
      scenario: "PROBABLE",
    });
    assert.match(url, new RegExp(`^${TREASURY_TODAY_PATH}\\?`));
    assert.match(url, /date=2026-07-28/);
    assert.match(url, /accountIds=a%2Cb|accountIds=a,b/);
    assert.match(url, /scenario=PROBABLE/);
  });
});
