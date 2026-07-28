import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_AVAILABILITY_PATH, TREASURY_SCAFFOLD_VERSION } from "./contracts/treasuryContracts.js";
import { getTreasuryAvailability } from "./services/treasuryAvailabilityService.js";
import { TREASURY_ENABLED_ENV } from "./treasuryFeatureFlags.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryAvailability", () => {
  it("retorna scaffold quando mestra ON (subflags ausentes = ligadas)", () => {
    const payload = getTreasuryAvailability({
      env: { [TREASURY_ENABLED_ENV]: "1" },
      serverTime: new Date("2026-07-27T12:00:00.000Z"),
    });
    assert.equal(payload.ok, true);
    assert.equal(payload.module, "treasury");
    assert.equal(payload.enabled, true);
    assert.equal(payload.status, "scaffold");
    assert.equal(payload.scaffoldVersion, TREASURY_SCAFFOLD_VERSION);
    assert.equal(payload.serverTimeIso, "2026-07-27T12:00:00.000+00:00");
    assert.equal(payload.flags["treasury.enabled"], true);
    assert.equal(payload.flags["treasury.accounts.enabled"], true);
    assert.equal(payload.flags["treasury.dashboard.enabled"], true);
  });

  it("opt-in: env ausente mantém mestra e subflags OFF", () => {
    const payload = getTreasuryAvailability({ env: {} });
    assert.equal(payload.enabled, false);
    assert.equal(payload.status, "disabled");
    assert.equal(payload.flags["treasury.enabled"], false);
    assert.equal(payload.flags["treasury.reports.enabled"], false);
  });

  it("marca disabled quando mestra opt-out explícito", () => {
    const payload = getTreasuryAvailability({
      env: { [TREASURY_ENABLED_ENV]: "0" },
    });
    assert.equal(payload.enabled, false);
    assert.equal(payload.status, "disabled");
    assert.equal(payload.flags["treasury.enabled"], false);
    assert.equal(payload.flags["treasury.reports.enabled"], false);
  });

  it("expõe opt-out seletivo de subflag no mapa de availability", () => {
    const payload = getTreasuryAvailability({
      env: {
        [TREASURY_ENABLED_ENV]: "1",
        TREASURY_DASHBOARD_ENABLED: "1",
        TREASURY_REPORTS_ENABLED: "true",
        TREASURY_RECEIVABLES_ENABLED: "0",
      },
    });
    assert.equal(payload.flags["treasury.dashboard.enabled"], true);
    assert.equal(payload.flags["treasury.reports.enabled"], true);
    assert.equal(payload.flags["treasury.receivables.enabled"], false);
  });

  it("path canônico está estável", () => {
    assert.equal(TREASURY_AVAILABILITY_PATH, "/api/finance/treasury/availability");
  });

  it("routes não concentram regras financeiras", () => {
    const source = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(source, /registerTreasuryRoutes/);
    assert.match(source, /TREASURY_AVAILABILITY_PATH/);
    assert.doesNotMatch(source, /NomusAccountsReceivable|amountReceivable/);
    assert.doesNotMatch(source, /from ["']@prisma\/client["']/);
    assert.doesNotMatch(source, /prisma\.(treasury|Nomus)/);
  });
});
