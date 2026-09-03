import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_ACCOUNTS_PATH,
  buildTreasuryAccountDailyBalancePath,
} from "./contracts/index.js";
import { buildTreasuryAccountDailyBalanceUrl } from "./treasuryAccountDailyBalanceApi.js";

describe("treasuryAccountDailyBalanceApi", () => {
  it("monta a URL sob a rota canônica de contas", () => {
    assert.equal(
      buildTreasuryAccountDailyBalancePath("acc-1"),
      `${TREASURY_ACCOUNTS_PATH}/acc-1/daily-balance`
    );
  });

  it("leva accountId e civilDate corretos na consulta", () => {
    const url = buildTreasuryAccountDailyBalanceUrl({
      accountId: "acc-1",
      date: "2026-09-03",
    });
    assert.equal(
      url,
      `${TREASURY_ACCOUNTS_PATH}/acc-1/daily-balance?date=2026-09-03`
    );
  });

  it("sem data, deixa o servidor resolver o dia vigente", () => {
    assert.equal(
      buildTreasuryAccountDailyBalanceUrl({ accountId: "acc-1" }),
      `${TREASURY_ACCOUNTS_PATH}/acc-1/daily-balance`
    );
    assert.equal(
      buildTreasuryAccountDailyBalanceUrl({ accountId: "acc-1", date: "  " }),
      `${TREASURY_ACCOUNTS_PATH}/acc-1/daily-balance`
    );
  });

  it("escapa o accountId na URL", () => {
    assert.match(
      buildTreasuryAccountDailyBalanceUrl({ accountId: "a/b?c" }),
      /a%2Fb%3Fc\/daily-balance$/
    );
  });

  it("não usa os endpoints de workspace", () => {
    const url = buildTreasuryAccountDailyBalanceUrl({
      accountId: "acc-1",
      date: "2026-09-03",
    });
    assert.equal(url.includes("/today/opening"), false);
    assert.equal(url.includes("/today/closing"), false);
  });
});
