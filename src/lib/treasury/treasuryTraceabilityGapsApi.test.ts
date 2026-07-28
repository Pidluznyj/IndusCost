import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_ALERTS_PATH,
  TREASURY_AUDIT_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_HEALTH_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_PAYMENT_SCHEDULE_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
  TREASURY_RECONCILIATIONS_PATH,
} from "./contracts/treasuryContracts.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryTraceabilityGapsApi — wiring", () => {
  it("registra endpoints de lacunas R03/R06/R11/R15/R17/R21/R24/R26", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_FORECAST_VS_ACTUAL_PATH,
      "/api/finance/treasury/forecast-vs-actual"
    );
    assert.equal(TREASURY_ALERTS_PATH, "/api/finance/treasury/alerts");
    assert.equal(TREASURY_AUDIT_PATH, "/api/finance/treasury/audit");
    assert.equal(TREASURY_HEALTH_PATH, "/api/finance/treasury/health");
    assert.equal(
      TREASURY_LEDGER_ENTRIES_PATH,
      "/api/finance/treasury/ledger-entries"
    );
    assert.equal(
      TREASURY_PAYMENT_SCHEDULE_PATH,
      "/api/finance/treasury/payment-schedule"
    );
    assert.equal(
      TREASURY_RECONCILE_WORKSPACE_PATH,
      "/api/finance/treasury/reconcile/workspace"
    );
    assert.match(routes, /balance-position/);
    assert.match(routes, /TREASURY_FORECAST_VS_ACTUAL_PATH/);
    assert.match(routes, /TREASURY_ALERTS_PATH/);
    assert.match(routes, /TREASURY_AUDIT_PATH/);
    assert.match(routes, /TREASURY_HEALTH_PATH/);
    assert.match(routes, /TREASURY_LEDGER_ENTRIES_PATH/);
    assert.match(routes, /TREASURY_PAYMENT_SCHEDULE_PATH/);
    assert.match(routes, /TREASURY_RECONCILE_WORKSPACE_PATH/);
    assert.match(routes, /reconciliations\.accept/);
    assert.match(routes, /reconciliations\.unmatch/);
    assert.ok(routes.includes("TREASURY_RECONCILIATIONS_PATH"));
    assert.equal(
      TREASURY_RECONCILIATIONS_PATH,
      "/api/finance/treasury/reconciliations"
    );
  });

  it("UI registra telas de lacunas", () => {
    const mod = readFileSync(
      join(here, "../../components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /manual-entries/);
    assert.match(mod, /payment-schedule/);
    assert.match(mod, /reconcile/);
    assert.match(mod, /path="ofx"/);
    assert.match(mod, /path="audit"/);
  });
});
