import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_TODAY_CLOSING_PATH } from "./contracts/index.js";
import {
  TREASURY_TODAY_CLOSING_PAGE_TITLE,
  parseTreasuryTodayClosingStep,
} from "./treasuryTodayClosingUi.js";
import { buildTreasuryTodayClosingUrl } from "./treasuryTodayClosingApi.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

describe("treasuryTodayClosingApi", () => {
  it("monta URL e textos simples", () => {
    assert.equal(buildTreasuryTodayClosingUrl(), TREASURY_TODAY_CLOSING_PATH);
    assert.equal(
      buildTreasuryTodayClosingUrl({ date: "2026-07-28" }),
      `${TREASURY_TODAY_CLOSING_PATH}?date=2026-07-28`
    );
    assert.equal(TREASURY_TODAY_CLOSING_PAGE_TITLE, "Saldo final e fechamento do dia");
    assert.equal(parseTreasuryTodayClosingStep("close"), "close");
  });

  it("registra GET/POST /today/closing nas rotas", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(routes, /TREASURY_TODAY_CLOSING_PATH/);
    assert.match(routes, /guidedClosing\.getWorkspace/);
    assert.match(routes, /guidedClosing\.saveFinalBalances/);
    assert.equal(
      TREASURY_TODAY_CLOSING_PATH,
      "/api/finance/treasury/today/closing"
    );
  });
});
